#!/usr/bin/env node
// Phase 1 closed-loop e2e: drives the real exported web bundle in headless
// Chromium against live Firebase emulators. Proves the full auth story end to end:
//   dev Google-credential sign-in → onUserCreate trigger provisions a pending
//   profile server-side → gate screen → grant-admin bootstrap → live claims
//   refresh un-gates without reload → in-app approval of a second user flips
//   THEIR page live too.
//
//   node scripts/web-e2e.mjs            (from the repo root)
//
// The stack bring-up (emulators, bundle, static server, browser) is shared with
// scripts/screens-e2e.mjs — see scripts/lib/e2e-stack.mjs.
//
// Prereqs: JDK 21 for the emulators (`npx sabeel-ci jdk21` finds it, as for
// `npm run test:emulator`) and Playwright's Chromium (`npx playwright install
// chromium`).
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  ROOT as root,
  EMULATOR_HOSTS,
  PROJECT,
  buildWebBundle,
  devSignIn,
  grantAdmin,
  launchBrowser,
  serveWebBundle,
  settle,
  shutdown as cleanup,
  startEmulators,
} from './lib/e2e-stack.mjs';

const shots = process.env.E2E_SHOTS_DIR ?? join(root, 'shots');

// Which URLs are calls to OUR functions emulator. Derived, not a literal: this
// checkout's ports moved out of the shared block, and a stale `:5001/` here
// would silently stop reporting callable failures rather than fail loudly.
const FN_ORIGIN = `:${EMULATOR_HOSTS.functions.split(':')[1]}/`;

// The emulators whose failing responses are recorded, with how much of each
// body to keep. The app reaches all three at the literal 127.0.0.1.
const WATCHED_EMULATORS = Object.entries({ functions: 400, firestore: 200, auth: 200 }).map(
  ([name, keep]) => ({ name, keep, origin: `http://${EMULATOR_HOSTS[name]}/` }),
);

// The Firestore emulator's REST root, read as the owner by the helpers below.
const FIRESTORE_DOCS = `http://${EMULATOR_HOSTS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents`;

/** A recorded console error, as printed: who saw it, what it said, and where. */
const describe = (e) => `[${e.label}] ${e.text} (${e.url || 'no url'})`;
mkdirSync(shots, { recursive: true });

process.on('SIGINT', () => cleanup(130));

/** Look up a uid the way a notification payload would have it: server-side. */
async function uidByEmail(email) {
  const res = await fetch(
    `${FIRESTORE_DOCS}/users`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const body = await res.json();
  const hit = (body.documents ?? []).find((d) => d.fields?.email?.stringValue === email);
  if (!hit) throw new Error(`no user doc for ${email}`);
  return hit.name.split('/').pop();
}

/** What the server holds about one person's access: the fields the Users screen edits. */
async function storedAccess(uid) {
  const res = await fetch(`${FIRESTORE_DOCS}/users/${uid}`, { headers: { Authorization: 'Bearer owner' } });
  const f = (await res.json()).fields;
  return { status: f.status.stringValue, role: f.role.stringValue, admin: f.admin.booleanValue };
}

/** The server's entries for one person with a day in [fromKey, toKey], in day order. */
async function storedEntries(uid, fromKey, toKey) {
  const res = await fetch(`${FIRESTORE_DOCS}/timeEntries?pageSize=300`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return ((await res.json()).documents ?? [])
    .map((d) => d.fields)
    .filter((f) => f.uid.stringValue === uid && f.dayKey.stringValue >= fromKey && f.dayKey.stringValue <= toKey)
    .map((f) => ({ dayKey: f.dayKey.stringValue, note: f.note?.stringValue ?? '' }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey));
}

/** The status the server holds for one person's week: null while it is a draft, which has no document. */
async function storedSheetStatus(uid, periodKey) {
  const res = await fetch(`${FIRESTORE_DOCS}/timesheets/${uid}_${periodKey}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  return res.ok ? (await res.json()).fields.status.stringValue : null;
}

/**
 * The Admin SDK's Auth, reaching the Auth emulator the way scripts/grant-admin.mjs
 * does. Only an administrator's path may make the one password account: the
 * public sign-up is refused by the sign-in gate.
 */
function adminAuth() {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= EMULATOR_HOSTS.auth;
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  return getAuth();
}

// Emulator-only: the Auth emulator holds no real account, so this guards nothing.
const EMULATOR_PASSWORD = 'emulator-only-password-for-e2e';

/**
 * Stand-in for a browser that has not been asked about notifications yet.
 * Headless Chromium reports permission as 'denied' (a full browser: 'default'),
 * and the nudge on Today is only drawn for 'default', so the button it exists
 * for could not be pressed. requestPermission is counted and says yes, so a
 * press that never asks is seen. Runs in the page, before the app loads.
 */
function askableNotifications() {
  let permission = 'default';
  window.__permissionAsks = 0;
  Object.defineProperty(Notification, 'permission', { get: () => permission, configurable: true });
  Notification.requestPermission = () => {
    window.__permissionAsks += 1;
    permission = 'granted';
    return Promise.resolve('granted');
  };
}

/**
 * `.first()` and `.last()` ARE NOT "the one on screen".
 *
 * The stack navigator keeps the screen underneath MOUNTED but hidden, and its
 * text is still in the DOM: Today carries a "Pick an activity" field of its own,
 * so between tapping "Add hours" and the pushed screen mounting, the last match
 * is TODAY's, which is display:none and can never be clicked or waited for.
 * Playwright then retries for 30s against an element that will never become
 * visible, and the run dies at a step with nothing wrong with it. Reproduced on
 * clean HEAD on 2026-08-27 — it long predates the e2e-stack extraction and had
 * been failing this suite roughly one run in two.
 *
 * So EVERY positional text locator in this file goes through one of these. The
 * property is what matters, not the two sites that happened to bite: a bare
 * `.first()`/`.last()` anywhere here is the bug waiting to happen again.
 *
 * `getByRole` needs no such treatment — role selectors skip display:none
 * subtrees the way a screen reader does, which is why `screens-e2e.mjs` (which
 * navigates by role) never hit this, and why the controls below are found by
 * role and name wherever they have one. `getByTestId` is NOT immune, whatever
 * it looks like: it is a plain CSS attribute selector and matches hidden nodes
 * just as happily.
 */
const onScreen = (locator) => locator.filter({ visible: true });
const firstOnScreen = (locator) => onScreen(locator).first();
const lastOnScreen = (locator) => onScreen(locator).last();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Nothing of the app's own screens: none of the screens where hours are posted
 * is reachable, and the navigation bar is not drawn. Called once the rules
 * screen's title is on screen, which is the settled state (App.tsx renders the
 * rules INSTEAD of the navigator), so an absence here is not a screen that has
 * not loaded yet.
 */
async function expectNoApp(page, who) {
  // Not 'Report a problem': the rules themselves say where it is.
  for (const text of ['Salaam,', 'Clock in', 'Add hours', 'Timesheet']) {
    const n = await page.getByText(text, { exact: text !== 'Salaam,' }).count();
    if (n !== 0) throw new Error(`${who} can see "${text}" behind the rules`);
  }
  for (const key of ['today', 'timesheet', 'more']) {
    if ((await page.getByTestId(`tab-${key}`).count()) !== 0)
      throw new Error(`${who} can see the ${key} tab behind the rules`);
  }
}

/** `settle`, saying so when a sign-in needed the app's Try again. */
async function settled(page, landing) {
  if (await settle(page, landing)) {
    console.log('  (this sign-in reached "Still setting up your account" and took Try again)');
  }
}

/**
 * Hold every Firestore emulator request from this page's browser context
 * until the returned release is called: a profile that reaches the page late,
 * however fast the server made it. Auth is not held, so the account lookups
 * the app makes meanwhile are answered.
 */
async function holdFirestore(page) {
  let release;
  const held = new Promise((r) => (release = r));
  const url = `http://${EMULATOR_HOSTS.firestore}/**`;
  await page.context().route(url, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  return async () => {
    release();
    await page.context().unroute(url);
  };
}

/**
 * Tap something that raises a window.confirm, answer it, and return what it
 * asked. Playwright dismisses a dialog nobody listens for, which would make
 * Cancel and "never asked" look the same, so the listener goes in BEFORE the
 * tap and a tap that raises none fails here after 10 s. The tap cannot finish
 * until the dialog is answered, so the answer is wired to the event itself.
 */
async function tapAndAnswer(page, tap, accept) {
  const asked = page.waitForEvent('dialog', { timeout: 10000 }).then(async (dialog) => {
    const message = dialog.message();
    await (accept ? dialog.accept() : dialog.dismiss());
    return message;
  });
  await tap();
  return asked;
}

/** The window.confirm texts a tap raised (each dismissed): [] when it asked nothing. */
async function confirmsRaisedBy(page, tap) {
  const raised = [];
  const onDialog = (dialog) => {
    raised.push(dialog.message());
    void dialog.dismiss();
  };
  page.on('dialog', onDialog);
  try {
    await tap();
    await page.waitForTimeout(500);
  } finally {
    page.off('dialog', onDialog);
  }
  return raised;
}

/** Poll `read` until `ok` accepts what it returns; fail naming `what` and the last answer. */
async function eventually(page, what, read, ok, timeoutMs = 15000) {
  for (let waited = 0; ; waited += 250) {
    const got = await read();
    if (ok(got)) return got;
    if (waited >= timeoutMs) throw new Error(`${what}: still ${JSON.stringify(got)} after ${timeoutMs}ms`);
    await page.waitForTimeout(250);
  }
}

// ---- Getting around the redesigned app -------------------------------------
// Tabs are found by test id (a tab's text also holds its icon's glyph), the
// More menu and every picker by role="dialog", entries by their accessible
// name. Nothing here reads a tab's textContent.

/** A tab, in the bar (a phone) or the rail (a wide screen). A tab press resets the stack. */
const tab = (page, key) => firstOnScreen(page.getByTestId(`tab-${key}`)).click();

/**
 * The More menu and a picker are each a react-native-web `Modal`, which portals
 * to `document.body` with `role="dialog"`. Scoping a click to it matters: the
 * field that OPENED a picker carries the same text as the row selected inside it.
 */
const dialogOf = (page) => page.getByRole('dialog');
async function closeDialog(page) {
  await dialogOf(page).getByRole('button', { name: 'Close', exact: true }).click();
  await dialogOf(page).waitFor({ state: 'hidden' });
}

/** A destination in the More menu. */
async function more(page, label) {
  await tab(page, 'more');
  // A count is appended to a row's name ("People, 1 waiting"), so the name STARTS with the label.
  await dialogOf(page).getByRole('button', { name: new RegExp(`^${escapeRe(label)}(,|$)`) }).click();
}

/** What the More menu offers this person, in order; opens it and closes it again. */
async function moreRows(page) {
  await tab(page, 'more');
  await dialogOf(page).waitFor();
  const names = await dialogOf(page)
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''));
  await closeDialog(page);
  return names.filter((n) => n !== 'Close').map((n) => n.replace(/, \d+ waiting$/, ''));
}

const MEMBER_MORE = ['Notifications', 'Help', 'Report a problem', 'Privacy policy', 'Sign out'];
const APPROVER_MORE = ['People', 'Activities', ...MEMBER_MORE];

/** A member has no manager tab and nothing of the institute's tools in More. */
async function expectMemberTools(page, who) {
  for (const key of ['approvals', 'reports'])
    if ((await page.getByTestId(`tab-${key}`).count()) !== 0) throw new Error(`${who} has the ${key} tab`);
  const rows = await moreRows(page);
  if (JSON.stringify(rows) !== JSON.stringify(MEMBER_MORE))
    throw new Error(`${who} is offered ${rows.join(', ')} in More`);
}

/**
 * A picker: press the field, search-and-pick inside its dialog. The field shows
 * `fieldText` (its placeholder, or what is chosen), the row shows `itemText`.
 */
async function pickFromModal(page, fieldText, itemText) {
  await firstOnScreen(page.getByText(fieldText, { exact: true })).click();
  const picker = dialogOf(page);
  await picker.getByPlaceholder('Search…').waitFor();
  await picker.getByText(itemText, { exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
}

/**
 * The Timesheet tab pages a month at a time and picks a week by its chip: a
 * radio named "<periodLabel>", then ", <state>" once the week has one. The week
 * shown is the checked chip. (Review timesheet steps weeks with its own arrows.)
 */
const weekChip = (page, label) =>
  onScreen(page.getByRole('radio', { name: new RegExp(`^${escapeRe(label)}(,|$)`) }));
async function expectWeekShown(page, label) {
  const chip = weekChip(page, label);
  await chip.waitFor();
  await eventually(page, `the ${label} chip being the checked one`, () => chip.getAttribute('aria-checked'), (v) => v === 'true');
}
/** Show the week labelled `label`: page back through the months until its chip is drawn, then pick it. */
async function goToWeek(page, label) {
  const chip = weekChip(page, label);
  for (let i = 0; i < 6 && (await chip.count()) === 0; i += 1) {
    await onScreen(page.getByRole('button', { name: 'Previous month', exact: true })).click();
    await chip.waitFor({ timeout: 1000 }).catch(() => {});
  }
  // Paging back may land on it (a month's last week is where the arrow puts you).
  if ((await chip.getAttribute('aria-checked')) !== 'true') await chip.click();
}

/** The Add hours / Edit entry form's native inputs. The note is a textbox of its own. */
const formFields = (page) => ({
  date: onScreen(page.locator('input[type="date"]')),
  from: onScreen(page.locator('input[type="time"]')).nth(0),
  to: onScreen(page.locator('input[type="time"]')).nth(1),
});
const noteField = (page, label) => page.getByRole('textbox', { name: label, exact: true });

/** Timesheet and Review timesheet say what a week holds under their title: "<status> · 2h 01m logged". */
const logged = (page, total) => firstOnScreen(page.getByText(`· ${total} logged`, { exact: true }));

/** A day's entries on a timesheet, each a button named "<activity>, <times>. Edit this entry." */
const entryRows = (page) => onScreen(page.getByRole('button', { name: /Edit this entry\.$/ }));
const entryRow = (page, has) => entryRows(page).filter({ has });

/**
 * A figure and the words under it (the Reports total, Lifetime hours). The
 * innermost element whose whole text is the two, which no ancestor's is.
 */
const statTile = (page, value, caption) =>
  firstOnScreen(page.locator('div').filter({ hasText: new RegExp(`^${escapeRe(value)}${escapeRe(caption)}$`) }));

/** A row of Today's "So far" list that is not a button: its label and its value. */
const soFarRow = (page, label, value) =>
  firstOnScreen(page.locator('div').filter({ hasText: new RegExp(`^${escapeRe(label)}${escapeRe(value)}$`) }));

/** The row of the Activities list named `name`: the innermost element holding it and its buttons. */
const activityRow = (page, name) =>
  lastOnScreen(
    page
      .locator('div')
      .filter({ has: page.getByText(name, { exact: true }) })
      .filter({ has: page.getByRole('button', { name: /^(Archive|Restore|Delete)$/ }) }),
  );

// A person's page: the status line under the name, then Role and the two switches.
const statusLine = (page) =>
  firstOnScreen(page.getByText(/^(Waiting for approval|Active|Disabled) · (Member|Manager|Admin)$/));
const roleOption = (page, role) => page.getByRole('tab', { name: role, exact: true });
const adminSwitch = (page) => page.getByRole('switch', { name: 'Admin', exact: true });
const activeSwitch = (page) => page.getByRole('switch', { name: 'Active', exact: true });

/** Everything a person's page shows about access, to compare before and after a declined change. */
const personState = async (page) =>
  JSON.stringify({
    line: await statusLine(page).innerText(),
    role: await page.getByRole('tab', { selected: true }).innerText(),
    admin: await adminSwitch(page).isChecked(),
    active: await activeSwitch(page).isChecked(),
  });

async function main() {
  // 1. Build functions + export the web bundle in emulator mode.
  console.log('▸ building functions and web bundle (emulator mode)…');
  buildWebBundle();

  // 2. Emulators (frees stale ports, waits for a callable to be REGISTERED).
  console.log('▸ starting Firebase emulators…');
  await startEmulators({ logPath: join(shots, 'emulator.log') });
  console.log('  (functions registered)');

  // 3. Static server for the exported bundle (SPA fallback to index.html).
  const { baseUrl } = await serveWebBundle();

  // 4. Drive it.
  console.log('▸ launching Chromium…');
  const browser = await launchBrowser();

  // { label, text, url }: Chromium words a failed request as "Failed to load
  // resource: ... status of 400" and nothing more, so the URL travels with it.
  const consoleErrors = [];
  // Every failing response from the functions, Firestore and Auth emulators,
  // WITH ITS BODY. A callable failure reaches the UI as a bare "internal" and,
  // if the function is missing entirely, as a browser CORS complaint — neither
  // says what happened server-side. Capturing the raw response here is the
  // difference between reading the answer and hand-writing a repro script to
  // find it.
  const emulatorFailures = [];
  const pages = new Map();
  async function newPage(label, { init } = {}) {
    const ctx = await browser.newContext({
      viewport: { width: 420, height: 860 },
      acceptDownloads: true,
    });
    // A script run in every page of this context before the app's own.
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    pages.set(label, page);
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push({ label, text: m.text(), url: m.location().url });
      if (m.type() === 'warning' && /listener|session poll/.test(m.text()))
        console.log(`  (warn) [${label}] ${m.text()}`);
    });
    page.on('response', async (resp) => {
      const watched = WATCHED_EMULATORS.find((w) => resp.url().startsWith(w.origin));
      if (!watched || resp.status() < 400) return;
      let body = '';
      try {
        body = (await resp.text()).slice(0, watched.keep);
      } catch {
        /* body already discarded */
      }
      emulatorFailures.push(`[${label}] ${resp.status()} ${resp.url()}\n    ${body}`);
    });
    page.on('requestfailed', (req) => {
      if (!req.url().includes(FN_ORIGIN)) return;
      emulatorFailures.push(
        `[${label}] REQUEST FAILED ${req.url()}\n    ${req.failure()?.errorText ?? ''}` +
          '\n    (a 404 from the functions emulator carries no CORS headers, so the' +
          '\n     browser reports this as a CORS error — check function registration)',
      );
    });
    await page.goto(baseUrl + '/');
    return page;
  }
  // On any failure, dump what every page was showing AND why the server said no.
  process.on('unhandledRejection', () => {});
  globalThis.dumpDiagnostics = () => {
    if (emulatorFailures.length) {
      console.error('\n--- failed calls to the emulators ---');
      console.error(emulatorFailures.join('\n'));
    }
    if (consoleErrors.length) {
      console.error('\n--- browser console errors ---');
      console.error(consoleErrors.slice(-15).map(describe).join('\n'));
    }
    console.error(`\n--- emulator log: ${join(shots, 'emulator.log')} (this run) ---`);
  };
  globalThis.dumpPages = async () => {
    for (const [label, p] of pages) {
      await p
        .screenshot({ path: join(shots, `fail-${label}.png`), animations: 'disabled' })
        .catch(() => {}).catch(() => {});
    }
  };
  console.log('▸ admin signs in → must land on the pending gate…');
  const admin = await newPage('admin');
  // Capture the sign-in screen itself (ivory chrome) before signing in — the
  // screen that once diverged from the sibling app on brand chrome.
  await admin.getByText('Time Tracker', { exact: true }).waitFor();
  await admin.screenshot({ path: join(shots, '0-signin.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await devSignIn(admin, 'admin@oursabeel.com');
  await settled(admin, admin.getByText('waiting for an administrator', { exact: false }));
  await admin.screenshot({ path: join(shots, '1-admin-pending.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ grant-admin bootstrap → page must un-gate LIVE (claims refresh) onto the rules…');
  grantAdmin('admin@oursabeel.com');
  // Approved, but the institute's rules come first: the rules screen, and
  // nothing of the app behind it (App.tsx renders one or the other).
  await admin.getByText('Before you continue', { exact: true }).waitFor({ timeout: 30000 });
  await expectNoApp(admin, 'an admin who has not accepted the rules');
  await admin.getByText('I agree', { exact: true }).click();
  await admin.getByText('Salaam,', { exact: false }).waitFor({ timeout: 30000 });
  await admin.screenshot({ path: join(shots, '2-admin-home.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ a volunteer signs in on their own device → pending gate…');
  const vol = await newPage('volunteer');
  await devSignIn(vol, 'volunteer@oursabeel.com');
  await settled(vol, vol.getByText('waiting for an administrator', { exact: false }));

  console.log('▸ admin opens People and sees the volunteer name+email…');
  await more(admin, 'People');
  await admin.getByText('volunteer@oursabeel.com').waitFor();
  await admin.screenshot({ path: join(shots, '3-users-pending.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ admin taps Approve → volunteer page must flip to the rules live…');
  await admin.getByRole('button', { name: 'Approve', exact: true }).click();
  // The claims refresh un-gates the volunteer on its own; what it un-gates
  // onto is the institute's rules, before anything they could post with.
  await vol.getByText('Before you continue', { exact: true }).waitFor({ timeout: 30000 });
  await vol.getByText('By continuing you agree to the institute', { exact: false }).waitFor();
  await vol.getByText('in More; administrators respond within 24 hours', { exact: false }).waitFor();
  await expectNoApp(vol, 'a volunteer who has not accepted the rules');
  await vol.screenshot({ path: join(shots, '4a-rules.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await admin.screenshot({ path: join(shots, '5-users-after.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ the rules stand in front of a notification tap, which waits for them…');
  // A tapped notification for a screen where hours are posted. Reloading with
  // the route: the rules screen again (nothing was accepted), and not the
  // timesheet the route names.
  const shared = await import('@sabeel/shared');
  const volUid = await uidByEmail('volunteer@oursabeel.com');
  const todayKey = shared.dayKeyFor(Date.now(), shared.deviceTimeZone());
  const thisWeek = shared.periodRangeFor(todayKey);
  // The week before this one: it has started, and the volunteer logs nothing in it.
  const otherWeek = shared.periodRangeFor(shared.addDays(thisWeek.fromKey, -1));
  const EMPTY_WEEK = /^Nothing logged this week yet\./;
  await vol.goto(`${baseUrl}/?screen=Timesheet&periodKey=${thisWeek.fromKey}`);
  await vol.getByText('Before you continue', { exact: true }).waitFor({ timeout: 45000 });
  await expectNoApp(vol, 'a reload before accepting');
  if ((await vol.getByText(EMPTY_WEEK).count()) !== 0)
    throw new Error('a notification route reached the timesheet past the rules');
  await vol.getByText('I agree', { exact: true }).click();
  // Accepted: the waiting route opens the week it named.
  await onScreen(vol.getByText(EMPTY_WEEK)).waitFor({ timeout: 30000 });
  await expectWeekShown(vol, shared.periodLabel(thisWeek));

  console.log('▸ accepted once: never again — not on reload, not after signing out and in…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.screenshot({ path: join(shots, '4-volunteer-home.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await more(vol, 'Sign out');
  await vol.getByText('Time Tracker', { exact: true }).waitFor({ timeout: 30000 });
  await devSignIn(vol, 'volunteer@oursabeel.com');
  // Today is only ever drawn once the rules are accepted, so Today appearing is
  // the proof; a rules screen here would never draw it.
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  if ((await vol.getByText('Before you continue', { exact: true }).count()) !== 0)
    throw new Error('the rules came back after signing in again');

  // A volunteer has neither manager tab and nothing of People or Activities in More.
  await expectMemberTools(vol, 'a volunteer');

  console.log('▸ Phase 2: manager creates, archives, restores activities…');
  // Fresh page, same context: auth persists (IndexedDB), lands on Today.
  const admin2 = await admin.context().newPage();
  pages.set('admin2', admin2);
  await admin2.goto(baseUrl + '/');
  await admin2.getByText('Salaam,', { exact: false }).waitFor();
  await more(admin2, 'Activities');

  async function addActivity(name) {
    const input = admin2.getByPlaceholder('New activity name');
    await input.fill(name);
    await admin2.getByRole('button', { name: 'Add', exact: true }).click();
    // Successful create clears the input; an error would leave it filled.
    await eventually(admin2, `the "${name}" field clearing`, () => input.inputValue(), (v) => v === '', 10000);
    await lastOnScreen(admin2.getByText(name, { exact: true })).waitFor();
  }
  await addActivity('Tutoring');
  await addActivity('Food Drive');
  await activityRow(admin2, 'Food Drive').getByRole('button', { name: 'Archive', exact: true }).click();
  // Archived activities wait below the list, in a section that opens on a tap.
  await admin2.getByRole('button', { name: 'Show Archived (1)' }).click();
  await admin2.getByRole('button', { name: 'Restore', exact: true }).waitFor();
  // An admin may delete an archived activity, after a confirmation.
  await addActivity('Old Drive');
  await activityRow(admin2, 'Old Drive').getByRole('button', { name: 'Archive', exact: true }).click();
  await admin2.getByRole('button', { name: 'Hide Archived (2)' }).waitFor();
  const deleteAsked = await tapAndAnswer(
    admin2,
    () => activityRow(admin2, 'Old Drive').getByRole('button', { name: 'Delete', exact: true }).click(),
    true,
  );
  if (!deleteAsked.startsWith('Delete Old Drive?'))
    throw new Error('deleting an activity asked something else: ' + deleteAsked);
  await admin2.getByRole('button', { name: 'Hide Archived (1)' }).waitFor();
  if ((await admin2.getByText('Old Drive', { exact: true }).count()) !== 0)
    throw new Error('the deleted activity is still listed');
  await admin2.screenshot({ path: join(shots, '6-activities.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  // Members don't get the manager entry points (More's Activities and People).
  await expectMemberTools(vol, 'a volunteer');

  console.log('▸ Phase 3: volunteer clocks in, clocks out, adds manual hours…');
  // Tutoring is the only active activity (Food Drive was archived above).
  await pickFromModal(vol, 'Pick an activity', 'Tutoring');
  await vol.getByRole('button', { name: 'Clock in', exact: true }).click();
  await vol.getByText('CLOCKED IN').waitFor();
  await vol.screenshot({ path: join(shots, '7-clocked-in.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  await vol.getByRole('button', { name: 'Clock out', exact: true }).click();
  await vol.getByText('What are you working on?').waitFor();
  // The 1-minute floor on clock sessions must show up in today's total.
  await soFarRow(vol, 'Today', '1m').waitFor();

  await vol.getByRole('button', { name: 'Add hours', exact: true }).click();
  await pickFromModal(vol, 'Pick an activity', 'Tutoring');
  // The day defaults to today, on the Today pill.
  if ((await vol.getByRole('radio', { name: 'Today', exact: true }).getAttribute('aria-checked')) !== 'true')
    throw new Error('Add hours does not start on Today');
  const addFields = formFields(vol);
  await addFields.from.fill('09:00');
  await addFields.to.fill('10:30');
  await vol.getByText("That's 1h 30m", { exact: true }).waitFor();
  await noteField(vol, 'What did you work on? (optional)').fill('Math tutoring with the kids');
  // The filled form, pre-save — this is the manual's add-hours illustration.
  await vol.screenshot({ path: join(shots, '8a-add-hours.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await vol.getByRole('button', { name: 'Save hours', exact: true }).click();
  await soFarRow(vol, 'Today', '1h 31m').waitFor({ timeout: 15000 });
  await vol.screenshot({ path: join(shots, '8-after-manual.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 4: period timesheet — edit an entry, delete an entry…');
  await tab(vol, 'timesheet');
  await logged(vol, '1h 31m').waitFor();
  await vol.screenshot({ path: join(shots, '9-timesheet.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  // Edit the manual entry (found by its note) to end at 11:00 → total 2h 01m.
  await entryRow(vol, vol.getByText('Math tutoring with the kids', { exact: true })).click();
  await formFields(vol).to.fill('11:00');
  await vol.getByRole('button', { name: 'Save changes', exact: true }).click();
  await logged(vol, '2h 01m').waitFor();

  // A note alone saves on the clock entry, and leaves its minutes alone. The
  // form shows whole minutes while a clocked session keeps its seconds; a
  // session inside one minute must not read back as no length at all.
  const clockRow = () => entryRow(vol, vol.getByText('1m', { exact: true }));
  await clockRow().click();
  await noteField(vol, 'Note').fill('Set up the room');
  await vol.getByRole('button', { name: 'Save changes', exact: true }).click();
  await firstOnScreen(vol.getByText('Set up the room', { exact: true })).waitFor();
  await logged(vol, '2h 01m').waitFor();

  // Delete the 1-minute clock entry → total 2h 00m. It asks first: declined,
  // the entry stays (on the screen and on the server); accepted, it goes.
  const deleteEntry = vol.getByRole('button', { name: 'Delete entry', exact: true });
  await clockRow().click();
  const keptDelete = await tapAndAnswer(vol, () => deleteEntry.click(), false);
  if (!keptDelete.startsWith('Delete this entry?'))
    throw new Error('deleting an entry asked something else: ' + keptDelete);
  await vol.waitForTimeout(1500);
  if ((await storedEntries(volUid, todayKey, todayKey)).length !== 2)
    throw new Error('a declined delete removed the entry');
  await vol.getByRole('button', { name: 'Save changes', exact: true }).waitFor({ timeout: 1000 });
  await tapAndAnswer(vol, () => deleteEntry.click(), true);
  await logged(vol, '2h 00m').waitFor();
  await eventually(vol, 'the deleted entry leaving the server', () => storedEntries(volUid, todayKey, todayKey), (got) => got.length === 1);
  await vol.screenshot({ path: join(shots, '10-timesheet-period.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ overlap guard: conflicting entries are flagged and block submission…');
  // 10:00–10:45 overlaps the existing 09:00–11:00 entry → both rows flagged.
  await tab(vol, 'today');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.getByRole('button', { name: 'Add hours', exact: true }).click();
  await pickFromModal(vol, 'Pick an activity', 'Tutoring');
  const overlapFields = formFields(vol);
  await overlapFields.from.fill('10:00');
  await overlapFields.to.fill('10:45');
  await vol.getByRole('button', { name: 'Save hours', exact: true }).click();
  // Saved: the form closes onto Today, and only then is another tab pressed.
  await soFarRow(vol, 'Today', '2h 45m').waitFor({ timeout: 15000 });
  await tab(vol, 'timesheet');
  const flagged = onScreen(vol.getByText('Overlaps another entry', { exact: true }));
  await flagged.first().waitFor();
  if ((await flagged.count()) !== 2) throw new Error('expected both overlapping rows flagged');
  await onScreen(vol.getByText('Fix the flagged times', { exact: false })).waitFor();
  await vol.screenshot({ path: join(shots, '10b-overlap.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // A butt-joint edit (start at the other entry's end) clears the conflict.
  // Select the row by its unique times — both rows carry the same conflict label.
  await entryRow(vol, vol.getByText('10:00 – 10:45', { exact: false })).click();
  await formFields(vol).from.fill('11:00');
  await formFields(vol).to.fill('11:45');
  await vol.getByRole('button', { name: 'Save changes', exact: true }).click();
  await logged(vol, '2h 45m').waitFor();
  if ((await flagged.count()) !== 0) throw new Error('overlap flag should clear after the fix');
  // Put the total back where later phases expect it: delete the extra entry.
  await entryRow(vol, vol.getByText('45m', { exact: true })).click();
  await tapAndAnswer(vol, () => deleteEntry.click(), true);
  await logged(vol, '2h 00m').waitFor();

  console.log('▸ stale-listener guard: switching weeks must clear rows even on a slow network…');
  // Localhost snapshots arrive in ~ms, which is exactly why this bug class
  // (docs/POSTMORTEM-2026-07-16-stale-week.md) escaped the e2e: on a real phone
  // the new week's snapshot lags and the old week's rows lingered on screen.
  // Simulate the lag by stalling all Firestore emulator traffic; the UI must
  // clear the previous week's entries IMMEDIATELY (reset-on-input-change),
  // without waiting for data.
  const stall = async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue().catch(() => {});
  };
  await vol.context().route(`http://${EMULATOR_HOSTS.firestore}/**`, stall);
  // Not for a single painted frame either: a reset left to a passive effect
  // paints one frame of the old week's rows, status and buttons under the new
  // week before clearing them. Every frame is sampled while weeks change.
  await vol.evaluate((week) => {
    window.__staleFrames = 0;
    window.__sampling = true;
    const tick = () => {
      const on = document
        .querySelector('[role="radiogroup"][aria-label="Week"] [role="radio"][aria-checked="true"]')
        ?.getAttribute('aria-label');
      if (on && !on.startsWith(week) && document.body.innerText.includes('Math tutoring with the kids')) {
        window.__staleFrames += 1;
      }
      if (window.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, shared.periodLabel(thisWeek));
  await goToWeek(vol, shared.periodLabel(otherWeek));
  await expectWeekShown(vol, shared.periodLabel(otherWeek));
  // Old rows must vanish at once — long before the stalled snapshot can land.
  await onScreen(vol.getByText(EMPTY_WEEK)).waitFor({ timeout: 1500 });
  if ((await vol.getByText('Math tutoring with the kids').count()) !== 0)
    throw new Error("stale entries visible under a different week's timesheet");
  const staleFrames = await vol.evaluate(() => {
    window.__sampling = false;
    return window.__staleFrames;
  });
  if (staleFrames !== 0) throw new Error(`${staleFrames} frame(s) painted this week's entries under another week`);
  await vol.context().unroute(`http://${EMULATOR_HOSTS.firestore}/**`);
  await onScreen(vol.getByRole('link', { name: 'Back to this week', exact: true })).click();
  await firstOnScreen(vol.getByText('Math tutoring with the kids')).waitFor({ timeout: 15000 });

  console.log('▸ Phase 7: volunteer picks an approver and submits the week…');
  // Submit is gated until an approver is chosen (rules require the stamp): the
  // week offers the Approver picker with nobody chosen, says to choose one, and
  // Submit is dead.
  const submit = vol.getByRole('button', { name: 'Submit timesheet', exact: true });
  await onScreen(vol.getByText('Choose who approves your hours', { exact: true })).waitFor();
  await onScreen(vol.getByText('Choose who approves your hours above, then submit.', { exact: true })).waitFor();
  if (!(await submit.isDisabled())) throw new Error('Submit is offered before an approver is chosen');
  await pickFromModal(vol, 'Choose who approves your hours', 'Admin');
  // The field echoes the selection once the profile listener catches up — wait
  // for it so Submit isn't clicked while still disabled.
  await firstOnScreen(vol.getByText('Admin', { exact: true })).waitFor();
  await submit.click();
  await firstOnScreen(vol.getByText('Submitted', { exact: true })).waitFor();
  await vol.screenshot({ path: join(shots, '11-submitted.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 7: approver rejects with a reason → volunteer sees it live…');
  const mgr = admin;
  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  // The Approvals tab carries the number waiting.
  await firstOnScreen(mgr.getByTestId('tab-approvals-badge')).waitFor({ timeout: 30000 });
  if ((await mgr.getByTestId('tab-approvals-badge').innerText()) !== '1')
    throw new Error('the Approvals tab does not say one timesheet is waiting');
  await tab(mgr, 'approvals');
  await mgr.getByRole('button', { name: "Review Volunteer's timesheet", exact: true }).click();
  await logged(mgr, '2h 00m').waitFor();
  await mgr.getByRole('button', { name: 'Reject timesheet…', exact: true }).click();
  // The reason is required: Reject is dead until something is typed.
  const rejectSheet = dialogOf(mgr);
  const rejectButton = rejectSheet.getByRole('button', { name: 'Reject timesheet', exact: true });
  if (!(await rejectButton.isDisabled())) throw new Error('Reject is offered with no reason');
  await rejectSheet.getByPlaceholder('What needs fixing?').fill('Tuesday hours belong to Food Drive.');
  await rejectButton.click();
  await mgr.getByText('Nothing waiting for you.', { exact: false }).waitFor();

  // Today shows the rejection banner live; the reason shows on the sheet.
  await vol.goto(baseUrl + '/');
  await vol.getByRole('button', { name: /A timesheet was rejected/ }).waitFor({ timeout: 30000 });
  // Banner → Needs-attention list (reason inline) → tap the row → the week view.
  await vol.getByRole('button', { name: /A timesheet was rejected/ }).click();
  await vol.getByText('Open it to fix it and resubmit', { exact: false }).waitFor();
  await vol.getByText('Tuesday hours belong to Food Drive.', { exact: false }).click();
  await vol.getByText('Fix the entries below', { exact: false }).waitFor();
  await vol.getByText('Rejected by Admin: Tuesday hours belong to Food Drive.', { exact: false }).waitFor();
  await vol.screenshot({ path: join(shots, '12-rejected.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 7: volunteer resubmits; approver adds hours on behalf + approves…');
  await vol.getByRole('button', { name: 'Resubmit timesheet', exact: true }).click();
  await firstOnScreen(vol.getByText('Submitted', { exact: true })).waitFor();

  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await tab(mgr, 'approvals');
  await mgr.getByRole('button', { name: "Review Volunteer's timesheet", exact: true }).click();
  // Add a 1h entry on the volunteer's behalf (approver correction path).
  await mgr.getByRole('button', { name: 'Add hours for Volunteer', exact: true }).click();
  await mgr.getByText('Adding hours for Volunteer', { exact: false }).waitFor();
  await pickFromModal(mgr, 'Pick an activity', 'Tutoring');
  const mgrFields = formFields(mgr);
  await mgrFields.from.fill('14:00');
  await mgrFields.to.fill('15:00');
  await mgr.getByRole('button', { name: 'Save hours', exact: true }).click();
  // Back on the review screen the live total includes the added hour.
  await logged(mgr, '3h 00m').waitFor({ timeout: 15000 });
  await mgr.getByRole('button', { name: 'Approve timesheet', exact: true }).click();
  await mgr.getByText('Nothing waiting for you.', { exact: false }).waitFor();
  await mgr.screenshot({ path: join(shots, '13-approved-queue-empty.png'), timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 7: approved week is locked for the volunteer…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await firstOnScreen(vol.getByText('Approved', { exact: true })).waitFor({ timeout: 30000 });
  // The clock-in card is replaced by the lock notice.
  await vol.getByText('This week is approved, so it is closed for new hours', { exact: false }).waitFor();
  await tab(vol, 'timesheet');
  await onScreen(vol.getByText('Approved, so this week is closed', { exact: false })).waitFor();
  const editCount = await vol.getByRole('button', { name: 'Submit timesheet', exact: true }).count();
  if (editCount !== 0) throw new Error('approved sheet still offers Submit');
  await vol.screenshot({ path: join(shots, '14-approved-locked.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 5: reports count APPROVED hours; CSV has real emails…');
  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await tab(mgr, 'reports');
  // 'All time' period, everyone, official view → the volunteer's approved 3h.
  await mgr.getByRole('radio', { name: 'All time', exact: true }).click();
  await statTile(mgr, '3h 00m', 'Approved hours, all time, everyone, all activities').waitFor({ timeout: 15000 });
  await mgr.screenshot({ path: join(shots, '15-reports.png'), timeout: 8000 }).catch(async (e) => {
    console.log('  (shot15 page-shot failed: ' + e.message.split('\n')[0] + ' — trying element shot)');
    await mgr.locator('body').screenshot({ path: join(shots, '15-reports.png'), timeout: 8000 }).catch((e2) => console.log('  (shot15 element shot failed too: ' + e2.message.split('\n')[0] + ')'));
  });

  // CSV download: capture the browser download and assert its contents.
  const [dl] = await Promise.all([
    mgr.waitForEvent('download'),
    mgr.getByRole('button', { name: 'Export CSV', exact: true }).click(),
  ]);
  const dlPath = join(shots, 'export.csv');
  await dl.saveAs(dlPath);
  const csv = readFileSync(dlPath, 'utf8');
  if (!/Person,Email,Activity,Date,Start,End/.test(csv))
    throw new Error('CSV missing header: ' + csv.slice(0, 80));
  if (!/Volunteer/.test(csv)) throw new Error('CSV missing the volunteer row');
  if (!/volunteer@oursabeel\.com/.test(csv)) throw new Error('CSV missing the volunteer email');

  // Lifetime statement for the volunteer: the By-person row opens it.
  await mgr.getByRole('button', { name: /^Volunteer, 3h 00m\. Open their lifetime hours\.$/ }).click();
  await firstOnScreen(mgr.getByRole('heading', { name: 'Volunteer', exact: true })).waitFor();
  await statTile(mgr, '3h 00m', 'Lifetime approved hours').waitFor();
  await mgr.screenshot({ path: join(shots, '16-person-detail.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ notification taps land on the right screen (web transport)…');
  // A tapped push carries its destination as the same key/values on both
  // surfaces: an FCM data payload on Android, this query string on the web
  // (the browser can only hand the page a URL). Same shared decoder either way,
  // so exercising it here covers the routing for both.
  await vol.goto(`${baseUrl}/?screen=Timesheet&periodKey=${otherWeek.fromKey}`);
  // Right screen AND right week: that week is the empty one used above.
  await onScreen(vol.getByText(EMPTY_WEEK)).waitFor({ timeout: 45000 });
  await expectWeekShown(vol, shared.periodLabel(otherWeek));
  // The route must be consumed, or a reload would replay the notification: the
  // address that remains is the Timesheet's own, and a reload stays on that week.
  const landed = new URL(vol.url());
  if (landed.searchParams.has('screen') || landed.pathname !== '/timesheet')
    throw new Error('the notification route is not replaced by the screen’s own address: ' + vol.url());
  await vol.reload();
  await expectWeekShown(vol, shared.periodLabel(otherWeek));

  // A member has no People screen; navigating to a name the navigator doesn't
  // have would throw, so an out-of-reach route must be dropped, not attempted:
  // the member stays on Today, a tab root with no way back, and no list of people.
  await vol.goto(`${baseUrl}/?screen=Users`);
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.waitForTimeout(1000);
  if ((await vol.getByText(/^Everyone \(\d+\)$/).count()) !== 0 || (await vol.getByRole('link', { name: /,\s*back$/i }).count()) !== 0)
    throw new Error('member was routed into an approver-only screen');

  // The approver's submission notification: straight to that person's week.
  await mgr.goto(
    `${baseUrl}/?screen=TimesheetReview&uid=${volUid}&displayName=Volunteer&periodKey=${shared.periodKeyFor(todayKey)}`,
  );
  await logged(mgr, '3h 00m').waitFor({ timeout: 45000 });
  // Garbage in the query must leave you on Today rather than crash the app.
  await mgr.goto(`${baseUrl}/?screen=Timesheet`);
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });

  console.log('▸ notification settings: reminder toggle flips and persists…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await more(vol, 'Notifications');
  await vol.getByText('Weekly submit reminder').waitFor();
  // Members see three switches; the reminder is last. They are role=switch
  // rows, checked or not by aria-checked.
  const switchNames = await onScreen(vol.getByRole('switch')).evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')),
  );
  if (JSON.stringify(switchNames) !== JSON.stringify(['My timesheet is rejected', 'My timesheet is approved', 'Weekly submit reminder']))
    throw new Error('the notification switches are not the three a member sees, the reminder last: ' + switchNames.join(' | '));
  const reminder = vol.getByRole('switch', { name: 'Weekly submit reminder', exact: true });
  if ((await reminder.isChecked()) !== true) throw new Error('reminder pref should default ON');
  await reminder.click();
  /*
   * WAIT FOR THE SERVER TO HOLD THE WRITE BEFORE NAVIGATING.
   *
   * The toggle fires `updateDoc` and returns; navigating immediately can tear
   * the page down with the write still unsent, and the reload below then reads
   * back the pref unchanged — which looks exactly like "the pref did not
   * persist", i.e. like the bug this check exists to catch. The switch reading
   * OFF proves nothing here: the profile listener delivers the page's own
   * write at once, before the server has it, and on a slow CI runner the
   * reload overtook it. So the stored document is read until it says OFF.
   */
  await eventually(vol, 'the reminder switch reading off', () => reminder.isChecked(), (on) => on === false);
  const reminderStored = async () => {
    const res = await fetch(
      `${FIRESTORE_DOCS}/users/${volUid}`,
      { headers: { Authorization: 'Bearer owner' } },
    );
    return (await res.json()).fields?.notifPrefs?.mapValue?.fields?.reminder?.booleanValue;
  };
  for (let waited = 0; (await reminderStored()) !== false; waited += 250) {
    if (waited >= 15000) throw new Error('the reminder switch went OFF but the server never stored it');
    await vol.waitForTimeout(250);
  }
  // Reload → the pref must come back OFF from Firestore, not local state.
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await more(vol, 'Notifications');
  await vol.getByText('Weekly submit reminder').waitFor();
  await eventually(vol, 'the reminder switch after a reload', () => reminder.isChecked(), (on) => on === false, 10000);
  await vol.screenshot({ path: join(shots, '17-notification-settings.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ report a problem: the draft survives Back, Send stores one report and clears the field…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await more(vol, 'Report a problem');
  const reportField = () =>
    vol.getByRole('textbox', { name: 'What or who are you reporting, and what is wrong?' });
  await reportField().waitFor();
  const REPORT_TEXT =
    'The note on my Tuesday Tutoring entry was changed to something I did not write.';
  await reportField().fill(REPORT_TEXT);
  await vol.screenshot({ path: join(shots, '18-report-problem.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // Back, then in again: what was typed is still there.
  await vol.getByRole('link', { name: /,\s*back$/i }).first().click();
  await vol.getByText('Salaam,', { exact: false }).waitFor();
  await more(vol, 'Report a problem');
  await reportField().waitFor();
  if ((await reportField().inputValue()) !== REPORT_TEXT)
    throw new Error('the unsent report was lost on Back: ' + (await reportField().inputValue()));
  await vol.getByRole('button', { name: 'Send', exact: true }).click();
  await vol.getByText('Sent. An administrator will reply by email within a day.', { exact: true }).waitFor({ timeout: 30000 });
  if ((await reportField().inputValue()) !== '') throw new Error('the field kept the sent report');
  await vol.screenshot({ path: join(shots, '19-report-sent.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // Exactly one report, the volunteer's, kept by the server; under the
  // emulator the email is skipped, never sent.
  const reportsRes = await fetch(
    `${FIRESTORE_DOCS}/reports`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const reports = ((await reportsRes.json()).documents ?? []).map((d) => d.fields);
  if (reports.length !== 1) throw new Error(`expected one stored report, found ${reports.length}`);
  const [kept] = reports;
  const keptOk =
    kept.uid?.stringValue === volUid &&
    kept.text?.stringValue === REPORT_TEXT &&
    kept.email?.stringValue === 'volunteer@oursabeel.com' &&
    kept.platform?.stringValue === 'web' &&
    kept.mail?.mapValue?.fields?.status?.stringValue === 'skipped';
  if (!keptOk) throw new Error('the stored report is not the one sent: ' + JSON.stringify(kept).slice(0, 400));

  console.log('▸ copy last week’s hours: declining copies nothing, accepting fills the empty week…');
  // Two full weeks of the previous month, which always has them: a harness that
  // needs a particular day of the month fails on the others for reasons that are
  // not the app's (see the sweep). The admin keeps these hours, so none of the
  // volunteer's weeks, which the checks above and below read, move.
  const adminUid = await uidByEmail('admin@oursabeel.com');
  const [, copyFrom, copyTo] = shared.periodsOfMonth(
    shared.addDays(shared.monthRange(todayKey).fromKey, -1),
  );
  const copyHours = [
    { day: shared.addDays(copyFrom.fromKey, 1), from: '09:00', to: '10:00', note: 'Copy check A' },
    { day: shared.addDays(copyFrom.fromKey, 3), from: '13:00', to: '14:30', note: 'Copy check B' },
  ];
  for (const h of copyHours) {
    await mgr.goto(baseUrl + '/');
    await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
    await mgr.getByRole('button', { name: 'Add hours', exact: true }).click();
    await pickFromModal(mgr, 'Pick an activity', 'Tutoring');
    const fields = formFields(mgr);
    await fields.date.fill(h.day);
    await fields.from.fill(h.from);
    await fields.to.fill(h.to);
    await noteField(mgr, 'What did you work on? (optional)').fill(h.note);
    await mgr.getByRole('button', { name: 'Save hours', exact: true }).click();
    // Saved: the form closes onto Today.
    await firstOnScreen(mgr.getByText('Salaam,', { exact: false })).waitFor();
  }
  if ((await storedEntries(adminUid, copyFrom.fromKey, copyFrom.toKey)).length !== 2)
    throw new Error('the two hours to copy were not saved');

  await mgr.goto(`${baseUrl}/?screen=Timesheet&periodKey=${copyTo.fromKey}`);
  await onScreen(mgr.getByText(EMPTY_WEEK)).waitFor({ timeout: 45000 });
  const copyButton = mgr.getByRole('button', { name: "Copy last week's hours", exact: true });
  // Declined: the confirmation names the week it would copy from, and nothing is copied.
  const declined = await tapAndAnswer(mgr, () => copyButton.click(), false);
  if (!declined.startsWith('Copy last week?') || !declined.includes(shared.periodLabel(copyFrom)))
    throw new Error('the copy asked something else: ' + declined);
  await mgr.waitForTimeout(1500);
  if ((await storedEntries(adminUid, copyTo.fromKey, copyTo.toKey)).length !== 0)
    throw new Error('a declined copy copied entries');
  await onScreen(mgr.getByText(EMPTY_WEEK)).waitFor({ timeout: 1000 });
  // Accepted: every entry arrives a week later, same times and notes; the
  // source week keeps its own.
  await tapAndAnswer(mgr, () => copyButton.click(), true);
  await logged(mgr, '2h 30m').waitFor({ timeout: 15000 });
  for (const h of copyHours) await firstOnScreen(mgr.getByText(h.note, { exact: true })).waitFor();
  if ((await copyButton.count()) !== 0) throw new Error('Copy last week is still offered on a week with hours');
  // The screen shows a write the moment it is made; the server holds it once it
  // has answered, so it is the server that is waited for.
  const copied = await eventually(
    mgr,
    'the copied entries on the server',
    () => storedEntries(adminUid, copyTo.fromKey, copyTo.toKey),
    (got) => got.length === copyHours.length,
  );
  const wanted = copyHours.map((h) => ({ dayKey: shared.addDays(h.day, 7), note: h.note }));
  if (JSON.stringify(copied) !== JSON.stringify(wanted))
    throw new Error('the copied entries are not last week’s, a week on: ' + JSON.stringify(copied));
  if ((await storedEntries(adminUid, copyFrom.fromKey, copyFrom.toKey)).length !== 2)
    throw new Error('copying changed the week it copied from');
  await mgr.screenshot({ path: join(shots, '19a-copied-week.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ an admin reopens an approved week: it is a draft again, and editable…');
  // The Reopen button is on the Timesheet tab, so the admin's own week is the
  // one it can be pressed on first: submitted to themself (an admin is their
  // own approver by default), approved on the review screen, then back here.
  const copySheet = (status) =>
    eventually(mgr, `the week's status on the server`, () => storedSheetStatus(adminUid, copyTo.fromKey), (got) => got === status);
  await mgr.getByRole('button', { name: 'Submit timesheet', exact: true }).click();
  await firstOnScreen(mgr.getByText('Submitted', { exact: true })).waitFor();
  // Each write is waited for on the SERVER before the page moves on: the screen
  // reflects a write the moment it is made, and a navigation can overtake it.
  await copySheet('submitted');
  await mgr.goto(
    `${baseUrl}/?screen=TimesheetReview&uid=${adminUid}&displayName=Admin&periodKey=${copyTo.fromKey}`,
  );
  await logged(mgr, '2h 30m').waitFor({ timeout: 45000 });
  await mgr.getByRole('button', { name: 'Approve timesheet', exact: true }).click();
  await copySheet('approved');
  await mgr.goto(`${baseUrl}/?screen=Timesheet&periodKey=${copyTo.fromKey}`);
  await firstOnScreen(mgr.getByText('Approved', { exact: true })).waitFor({ timeout: 45000 });
  await onScreen(mgr.getByText('Approved, so this week is closed', { exact: false })).waitFor();
  if ((await mgr.getByRole('button', { name: 'Submit timesheet', exact: true }).count()) !== 0)
    throw new Error('an approved week still offers Submit to its admin');
  await mgr.screenshot({ path: join(shots, '19b-admin-approved.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // One press: Reopen asks nothing. A question appearing would be a change worth seeing here.
  const reopenAsked = await confirmsRaisedBy(mgr, () =>
    mgr.getByRole('button', { name: 'Reopen (admin)', exact: true }).click(),
  );
  if (reopenAsked.length !== 0) throw new Error('Reopen now asks first: ' + reopenAsked.join(' | '));
  // A draft as the app shows one: Submit again, no Approved status, no lock, no
  // Reopen, and no sheet left on the server.
  await mgr.getByRole('button', { name: 'Submit timesheet', exact: true }).waitFor({ timeout: 15000 });
  await copySheet(null);
  if ((await onScreen(mgr.getByText('Approved', { exact: true })).count()) !== 0)
    throw new Error('"Approved" is still shown after the week was reopened');
  if ((await mgr.getByRole('button', { name: 'Reopen (admin)', exact: true }).count()) !== 0)
    throw new Error('"Reopen (admin)" is still shown after the week was reopened');
  if ((await onScreen(mgr.getByText('Approved, so this week is closed', { exact: false })).count()) !== 0)
    throw new Error('the lock notice outlived the reopen');
  // Editable: the entry the lock refused to touch saves.
  await entryRow(mgr, mgr.getByText('Copy check B', { exact: true })).click();
  await formFields(mgr).to.fill('15:00');
  await mgr.getByRole('button', { name: 'Save changes', exact: true }).click();
  await logged(mgr, '3h 00m').waitFor({ timeout: 15000 });

  console.log('▸ an admin reopens SOMEONE ELSE’s approved week from Review timesheet…');
  // The volunteer's week was approved above. The admin reaches it the way
  // people do: Reports → By person → Lifetime hours → View timesheets.
  const volPeriod = shared.periodKeyFor(todayKey);
  if ((await storedSheetStatus(volUid, volPeriod)) !== 'approved')
    throw new Error("the volunteer's week is not approved for the reopen to act on");
  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await tab(mgr, 'reports');
  await mgr.getByRole('radio', { name: 'All time', exact: true }).click();
  await mgr.getByRole('button', { name: /^Volunteer, 3h 00m\. Open their lifetime hours\.$/ }).click();
  await mgr.getByRole('button', { name: 'View timesheets', exact: true }).click();
  await firstOnScreen(mgr.getByRole('heading', { name: shared.periodLabel(thisWeek), exact: true })).waitFor();
  // Approved: locked, so no hours can be added for them, and the admin can reopen it.
  await firstOnScreen(mgr.getByText('Approved', { exact: true })).waitFor();
  await logged(mgr, '3h 00m').waitFor();
  if ((await mgr.getByRole('button', { name: 'Add hours for Volunteer', exact: true }).count()) !== 0)
    throw new Error('hours can be added to an approved week from Review timesheet');
  await mgr.screenshot({ path: join(shots, '19bb-review-approved.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  const reviewReopenAsked = await confirmsRaisedBy(mgr, () =>
    mgr.getByRole('button', { name: 'Reopen (admin)', exact: true }).click(),
  );
  if (reviewReopenAsked.length !== 0) throw new Error('Reopen now asks first: ' + reviewReopenAsked.join(' | '));
  // A draft on the server (no sheet left), the hours untouched, and the screen
  // reads as a draft that hours can be added to again.
  await eventually(mgr, `the volunteer's week on the server`, () => storedSheetStatus(volUid, volPeriod), (got) => got === null);
  await mgr.getByRole('button', { name: 'Add hours for Volunteer', exact: true }).waitFor({ timeout: 15000 });
  await firstOnScreen(mgr.getByText('Not submitted', { exact: true })).waitFor();
  await logged(mgr, '3h 00m').waitFor();
  if ((await onScreen(mgr.getByText('Approved', { exact: true })).count()) !== 0)
    throw new Error('"Approved" is still shown after the volunteer’s week was reopened');
  if ((await mgr.getByRole('button', { name: 'Reopen (admin)', exact: true }).count()) !== 0)
    throw new Error('"Reopen (admin)" is still shown after the volunteer’s week was reopened');
  await mgr.screenshot({ path: join(shots, '19bc-review-reopened.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // The volunteer's own session is unlocked: Today offers the clock again.
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.getByText('What are you working on?').waitFor({ timeout: 30000 });
  if ((await vol.getByText('closed for new hours', { exact: false }).count()) !== 0)
    throw new Error('the volunteer’s Today is still locked after the reopen');

  console.log('▸ People: role, admin and active each ask first, and a reload keeps the answer…');
  const VOL = 'volunteer@oursabeel.com';
  const volAccess = () => storedAccess(volUid);
  const sameAccess = (a, b) => a.status === b.status && a.role === b.role && a.admin === b.admin;
  const access = (status, role, admin) => ({ status, role, admin });
  /** The People list, on a fresh page. */
  async function openPeople() {
    await mgr.goto(baseUrl + '/');
    await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
    await more(mgr, 'People');
    await mgr.getByText(/^Everyone \(\d+\)$/).waitFor();
  }
  /** One person's page: a disabled account waits in the list's closed Disabled section. */
  async function openPerson(name, { disabled = false } = {}) {
    await openPeople();
    if (disabled) await mgr.getByRole('button', { name: /^Show Disabled \(\d+\)$/ }).click();
    await mgr.getByRole('button', { name: `${name}. Open their account.`, exact: true }).click();
    await statusLine(mgr).waitFor();
  }
  /**
   * One change to the volunteer's access, made the way an admin makes it twice:
   * declined (the page and the server both stay as they were), then accepted
   * (the server holds it, and a fresh page, which has only Firestore to go on,
   * still shows it).
   */
  async function changeVolunteer({ tap, asks, from, to, shows }) {
    const before = await personState(mgr);
    const declined = await tapAndAnswer(mgr, () => tap(mgr), false);
    if (!declined.startsWith(asks)) throw new Error(`expected "${asks}", it asked: ${declined}`);
    await mgr.waitForTimeout(1500);
    const kept = await volAccess();
    if (!sameAccess(kept, from)) throw new Error(`a declined "${asks}" changed ${JSON.stringify(kept)}`);
    if ((await personState(mgr)) !== before) throw new Error(`a declined "${asks}" moved the page`);
    await tapAndAnswer(mgr, () => tap(mgr), true);
    await eventually(mgr, `"${asks}" accepted`, volAccess, (a) => sameAccess(a, to));
    await openPerson('Volunteer', { disabled: to.status === 'disabled' });
    await eventually(mgr, `"${asks}" after a reload`, () => statusLine(mgr).innerText(), shows);
  }
  /** Put the volunteer's access back; it asks again, in its own words. */
  async function restoreVolunteer({ tap, asks, to }) {
    const asked = await tapAndAnswer(mgr, () => tap(mgr), true);
    if (!asked.startsWith(asks)) throw new Error(`expected "${asks}", it asked: ${asked}`);
    await eventually(mgr, `"${asks}" accepted`, volAccess, (a) => sameAccess(a, to));
  }
  const memberAccess = access('active', 'member', false);
  const volIdle = () => vol.goto(baseUrl + '/').then(() =>
    vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 }),
  );
  await volIdle();
  await openPerson('Volunteer');
  await mgr.screenshot({ path: join(shots, '19c-users-controls.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  // Role member -> manager: the person's own app grows the manager tabs and More's Activities.
  await changeVolunteer({
    tap: (page) => roleOption(page, 'Manager').click(),
    asks: 'Change role to manager?',
    from: memberAccess,
    to: access('active', 'manager', false),
    shows: (line) => line.includes('Manager'),
  });
  await firstOnScreen(vol.getByTestId('tab-approvals')).waitFor({ timeout: 30000 });
  await firstOnScreen(vol.getByTestId('tab-reports')).waitFor();
  if (!(await moreRows(vol)).includes('Activities')) throw new Error('a manager is not offered Activities in More');
  await restoreVolunteer({
    tap: (page) => roleOption(page, 'Member').click(),
    asks: 'Change role to member?',
    to: memberAccess,
  });
  await eventually(vol, 'the volunteer losing the Approvals tab', () => vol.getByTestId('tab-approvals').count(), (n) => n === 0, 30000);
  await expectMemberTools(vol, 'a volunteer made a member again');

  // The Admin switch: the person's app grows People.
  await changeVolunteer({
    tap: (page) => adminSwitch(page).click(),
    asks: 'Grant admin access?',
    from: memberAccess,
    to: access('active', 'member', true),
    shows: (line) => line.includes('Admin'),
  });
  await firstOnScreen(vol.getByTestId('tab-approvals')).waitFor({ timeout: 30000 });
  if (JSON.stringify(await moreRows(vol)) !== JSON.stringify(APPROVER_MORE))
    throw new Error('an admin is not offered People and Activities in More');
  await restoreVolunteer({
    tap: (page) => adminSwitch(page).click(),
    asks: 'Remove admin?',
    to: memberAccess,
  });
  await eventually(vol, 'the volunteer losing the Approvals tab', () => vol.getByTestId('tab-approvals').count(), (n) => n === 0, 30000);
  await expectMemberTools(vol, 'a volunteer who is no longer an admin');

  // Nobody can demote, un-admin or disable themself: the controls on the
  // admin's own page are disabled, and pressing them anyway asks nothing.
  await openPerson('Admin');
  const adminBefore = await storedAccess(adminUid);
  if (!(await adminSwitch(mgr).isDisabled())) throw new Error('an admin can press their own Admin switch');
  if (!(await activeSwitch(mgr).isDisabled())) throw new Error('an admin can press their own Active switch');
  // They hold manager, so the Role option they could press is member.
  if ((await roleOption(mgr, 'Member').getAttribute('aria-disabled')) !== 'true')
    throw new Error('an admin can press member on their own Role');
  const selfAsked = await confirmsRaisedBy(mgr, async () => {
    await roleOption(mgr, 'Member').click({ force: true });
    await adminSwitch(mgr).click({ force: true });
    await activeSwitch(mgr).click({ force: true });
  });
  if (selfAsked.length !== 0) throw new Error('pressing their own access controls asked: ' + selfAsked.join(' | '));
  if (!sameAccess(await storedAccess(adminUid), adminBefore)) throw new Error('an admin changed their own access');

  console.log('▸ disabling an account: that session shows "Account disabled" with Sign out, live…');
  await openPerson('Volunteer');
  await changeVolunteer({
    tap: (page) => activeSwitch(page).click(),
    asks: 'Disable account?',
    from: memberAccess,
    to: access('disabled', 'member', false),
    shows: (line) => line.startsWith('Disabled'),
  });
  await vol.getByText('Account disabled', { exact: true }).waitFor({ timeout: 30000 });
  await vol.getByText(VOL, { exact: true }).waitFor();
  await vol.screenshot({ path: join(shots, '19d-account-disabled.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await expectNoApp(vol, 'a disabled account');
  // Sign out leaves; signing in again meets the same screen, from the profile alone.
  await vol.getByText('Sign out', { exact: true }).click();
  await vol.getByText('Time Tracker', { exact: true }).waitFor({ timeout: 30000 });
  await devSignIn(vol, VOL);
  await vol.getByText('Account disabled', { exact: true }).waitFor({ timeout: 45000 });
  // Re-activated, the same session un-gates by itself, with no rules to accept again.
  await restoreVolunteer({
    tap: (page) => activeSwitch(page).click(),
    asks: 'Re-activate account?',
    to: memberAccess,
  });
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  if ((await vol.getByText('Before you continue', { exact: true }).count()) !== 0)
    throw new Error('the rules came back after a re-activation');

  console.log('▸ the email door: a refused address says so, the one account signs in…');
  // Made the way production made it: by an administrator, with the Admin SDK
  // (the sign-up gate refuses every public sign-up); pending until approved on
  // the People screen like anyone else.
  await adminAuth().createUser({
    email: shared.PASSWORD_ACCOUNT_EMAIL,
    password: EMULATOR_PASSWORD,
    emailVerified: true,
  });
  await openPeople();
  await mgr.getByText(shared.PASSWORD_ACCOUNT_EMAIL, { exact: true }).waitFor({ timeout: 30000 });
  await lastOnScreen(
    mgr
      .locator('div')
      .filter({ has: mgr.getByText(shared.PASSWORD_ACCOUNT_EMAIL, { exact: true }) })
      .filter({ has: mgr.getByRole('button', { name: 'Approve', exact: true }) }),
  )
    .getByRole('button', { name: 'Approve', exact: true })
    .click();
  // Approved: its row moves from "Waiting for approval" to "Everyone".
  await mgr
    .getByRole('button', { name: /Open their account\.$/ })
    .filter({ hasText: shared.PASSWORD_ACCOUNT_EMAIL })
    .waitFor();
  const email = await newPage('email');
  await email.getByText('Sign in with email', { exact: true }).click();
  const emailField = email.getByPlaceholder('Email', { exact: true });
  const passwordField = email.getByPlaceholder('Password', { exact: true });
  const NO_MATCH = 'That email and password do not match an account.';
  // An address with no password account, then the right address and a wrong password.
  await emailField.fill('someone.else@oursabeel.com');
  await passwordField.fill(EMULATOR_PASSWORD);
  await email.getByText('Sign in', { exact: true }).click();
  await email.getByText(NO_MATCH, { exact: true }).waitFor({ timeout: 15000 });
  await emailField.fill(shared.PASSWORD_ACCOUNT_EMAIL);
  await passwordField.fill('not-the-password');
  await email.getByText('Sign in', { exact: true }).click();
  await email.getByText(NO_MATCH, { exact: true }).waitFor({ timeout: 15000 });
  await email.screenshot({ path: join(shots, '19e-email-refused.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // The account itself: signed in, past the rules once, and only a member.
  await passwordField.fill(EMULATOR_PASSWORD);
  await email.getByText('Sign in', { exact: true }).click();
  await email.getByText('Before you continue', { exact: true }).waitFor({ timeout: 45000 });
  await email.getByText('I agree', { exact: true }).click();
  await email.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await expectMemberTools(email, 'the password account');
  await more(email, 'Sign out');
  await email.getByText('Time Tracker', { exact: true }).waitFor({ timeout: 30000 });

  console.log('▸ the notification nudge on Today: Enable notifications asks from the press, Not now stays gone…');
  const nudge = await newPage('nudge', { init: askableNotifications });
  await devSignIn(nudge, VOL);
  await nudge.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await nudge.getByText('Notifications are not enabled on this device.', { exact: true }).waitFor();
  await nudge.screenshot({ path: join(shots, '19f-notification-nudge.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await firstOnScreen(nudge.getByText('Enable notifications', { exact: true })).click();
  // Allowed, but the emulators mint no push token: the card says this device
  // cannot, and offers no second press that would do the same nothing.
  await nudge.getByText('This device can’t show notifications.', { exact: true }).waitFor({ timeout: 15000 });
  if ((await nudge.evaluate(() => window.__permissionAsks)) !== 1)
    throw new Error('Enable notifications did not ask for permission exactly once');
  if ((await nudge.getByText('Enable notifications', { exact: true }).count()) !== 0)
    throw new Error('Enable notifications is offered again after it failed');
  await firstOnScreen(nudge.getByText('Not now', { exact: true })).click();
  if ((await nudge.getByText('This device can’t show notifications.', { exact: true }).count()) !== 0)
    throw new Error('the nudge stayed after Not now');
  // Dismissed for this person on this browser: the stand-in is still unasked
  // on the reload, so a nudge that came back would be drawn.
  await nudge.goto(baseUrl + '/');
  await nudge.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await nudge.waitForTimeout(2000);
  if ((await nudge.getByText('Notifications are not enabled on this device.', { exact: true }).count()) !== 0)
    throw new Error('the nudge came back after Not now');

  console.log('▸ a slow account set-up is waited for, never refused…');
  // Every Firestore answer to this page held for 15 s: the profile arrives
  // late, as after a cold start of onUserCreate. Ten seconds used to be read
  // as "This app is for Sabeel Institute accounts only".
  const slow = await newPage('slow');
  const releaseSlow = await holdFirestore(slow);
  await devSignIn(slow, 'slow.start@oursabeel.com');
  await slow.getByText('Setting up your account…', { exact: true }).waitFor({ timeout: 30000 });
  await slow.waitForTimeout(15000);
  if ((await slow.getByText('Can’t sign in').count()) !== 0) throw new Error('a slow set-up was refused');
  await slow.getByText('Setting up your account…', { exact: true }).waitFor({ timeout: 1000 });
  await releaseSlow();
  await slow.getByText('waiting for an administrator', { exact: false }).waitFor({ timeout: 30000 });

  console.log('▸ …while an address outside the institute is refused, in seconds…');
  // onUserCreate deletes it. A warm trigger beats the sign-in itself (the
  // sign-in screen says why); a slow one leaves a session that Auth then
  // reports deleted ("Can't sign in"). The same words, either way, and never
  // "still setting up".
  const outsider = await newPage('outsider');
  await devSignIn(outsider, 'someone.outside@gmail.com');
  await outsider
    .getByText('This app is for Sabeel Institute accounts only', { exact: false })
    .waitFor({ timeout: 25000 });
  if ((await outsider.getByText('Still setting up your account', { exact: false }).count()) !== 0)
    throw new Error('a deleted account was told it is still being set up');

  console.log('▸ …and a profile that never comes says so, neutrally, with Try again…');
  const stuck = await newPage('stuck');
  const releaseStuck = await holdFirestore(stuck);
  await devSignIn(stuck, 'stuck.start@oursabeel.com');
  await stuck
    .getByText('Still setting up your account. Try again in a minute.', { exact: true })
    .waitFor({ timeout: 70000 });
  if ((await stuck.getByText('Can’t sign in').count()) !== 0) throw new Error('a stuck set-up was refused');
  await stuck.screenshot({ path: join(shots, '20-still-setting-up.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // Try again starts the wait over (the new requests are held too), then the
  // profile arrives and the account lands on its gate.
  await stuck.getByText('Try again', { exact: true }).click();
  await stuck.getByText('Setting up your account…', { exact: true }).waitFor({ timeout: 10000 });
  await releaseStuck();
  await stuck.getByText('waiting for an administrator', { exact: false }).waitFor({ timeout: 30000 });

  await browser.close();

  // The set-up checks provoke two on purpose: a held connection (Firestore
  // says it cannot reach the backend) and Auth's 400 for a deleted account;
  // the email form's refusals provoke a third.
  const provoked = (e) =>
    (/^(slow|stuck|outsider)$/.test(e.label) &&
      /Could not reach Cloud Firestore backend|status of 400/.test(e.text)) ||
    // The email form's refusals: Auth answers a sign-in it will not make with a 400.
    (e.label === 'email' &&
      /status of 400/.test(e.text) &&
      e.url.startsWith(`http://${EMULATOR_HOSTS.auth}/`));
  // Any page, any time: a request on a Firestore Listen or Write channel whose
  // session the emulator has already closed is answered 400 "Unknown SID", and
  // the SDK reconnects on its own (the same routine churn as the
  // WebChannelConnection "transport errored" lines). Chromium logs that 400
  // as a console error naming only the status, so the URL is what tells it
  // from every other 400, which still fails the suite.
  const closedSessionUrls = ['Listen', 'Write'].map(
    (s) => `http://${EMULATOR_HOSTS.firestore}/google.firestore.v1.Firestore/${s}/channel`,
  );
  const closedSession = (e) =>
    /^Failed to load resource: the server responded with a status of 400\b/.test(e.text) &&
    closedSessionUrls.includes(e.url.split('?')[0]);
  const realErrors = consoleErrors.filter(
    (e) => !/WebChannelConnection|transport errored/.test(e.text) && !closedSession(e) && !provoked(e),
  );
  if (realErrors.length) {
    console.error('console errors:\n' + realErrors.map(describe).join('\n'));
    throw new Error('console errors during e2e');
  }
  console.log(`✔ Phase 1 e2e passed — screenshots in ${shots}`);
  cleanup(0);
}

main().catch(async (e) => {
  console.error(e);
  globalThis.dumpDiagnostics?.();
  await globalThis.dumpPages?.();
  cleanup(1);
});
