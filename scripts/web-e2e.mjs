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

/** A recorded console error, as printed: who saw it, what it said, and where. */
const describe = (e) => `[${e.label}] ${e.text} (${e.url || 'no url'})`;
mkdirSync(shots, { recursive: true });

process.on('SIGINT', () => cleanup(130));

/** Look up a uid the way a notification payload would have it: server-side. */
async function uidByEmail(email) {
  const res = await fetch(
    `http://${EMULATOR_HOSTS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/users`,
    { headers: { Authorization: 'Bearer owner' } },
  );
  const body = await res.json();
  const hit = (body.documents ?? []).find((d) => d.fields?.email?.stringValue === email);
  if (!hit) throw new Error(`no user doc for ${email}`);
  return hit.name.split('/').pop();
}

/**
 * `.first()` and `.last()` ARE NOT "the one on screen".
 *
 * The stack navigator keeps the screen underneath MOUNTED but hidden, and its
 * text is still in the DOM — Home carries a "Pick an activity" field of its own,
 * so between tapping "Add hours manually" and the pushed screen mounting, the
 * last match is HOME's, which is display:none and can never be clicked or
 * waited for. Playwright then retries for 30s against an element that will never
 * become visible, and the run dies at a step with nothing wrong with it.
 * Reproduced on clean HEAD on 2026-08-27 — it long predates the e2e-stack
 * extraction and had been failing this suite roughly one run in two.
 *
 * So EVERY positional text locator in this file goes through one of these. The
 * property is what matters, not the two sites that happened to bite: a bare
 * `.first()`/`.last()` anywhere here is the bug waiting to happen again.
 *
 * `getByRole` needs no such treatment — role selectors skip display:none
 * subtrees the way a screen reader does, which is why `screens-e2e.mjs` (which
 * navigates by role) never hit this. `getByTestId` is NOT immune, whatever it
 * looks like: it is a plain CSS attribute selector and matches hidden nodes
 * just as happily.
 */
/**
 * Nothing of Home: none of the screens where hours are posted is reachable.
 * Called once the rules screen's title is on screen, which is the settled
 * state (App.tsx draws the rules INSTEAD of the navigator), so an absence here
 * is not a screen that has not loaded yet.
 */
async function expectNoHome(page, who) {
  // Not 'Report a problem': the rules themselves say where it is.
  for (const text of ['Salaam,', 'Clock in', 'Add hours manually', 'My timesheet']) {
    const n = await page.getByText(text, { exact: text !== 'Salaam,' }).count();
    if (n !== 0) throw new Error(`${who} can see "${text}" behind the rules`);
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

const firstOnScreen = (locator) => locator.filter({ visible: true }).first();
const lastOnScreen = (locator) => locator.filter({ visible: true }).last();

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
  async function newPage(label) {
    const ctx = await browser.newContext({
      viewport: { width: 420, height: 860 },
      acceptDownloads: true,
    });
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
  // nothing of Home behind it (App.tsx renders one or the other).
  await admin.getByText('Before you continue', { exact: true }).waitFor({ timeout: 30000 });
  await expectNoHome(admin, 'an admin who has not accepted the rules');
  await admin.getByText('I agree', { exact: true }).click();
  await admin.getByText('Salaam,', { exact: false }).waitFor({ timeout: 30000 });
  await admin.screenshot({ path: join(shots, '2-admin-home.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ a volunteer signs in on their own device → pending gate…');
  const vol = await newPage('volunteer');
  await devSignIn(vol, 'volunteer@oursabeel.com');
  await settled(vol, vol.getByText('waiting for an administrator', { exact: false }));

  console.log('▸ admin opens Manage users and sees the volunteer name+email…');
  await admin.getByText('Manage users').click();
  await admin.getByText('volunteer@oursabeel.com').waitFor();
  await admin.screenshot({ path: join(shots, '3-users-pending.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ admin taps Approve → volunteer page must flip to the rules live…');
  await admin.getByText('Approve', { exact: true }).click();
  // The claims refresh un-gates the volunteer on its own; what it un-gates
  // onto is the institute's rules, before anything they could post with.
  await vol.getByText('Before you continue', { exact: true }).waitFor({ timeout: 30000 });
  await vol.getByText('By continuing you agree to the institute', { exact: false }).waitFor();
  await vol.getByText('on Home; administrators respond within 24 hours', { exact: false }).waitFor();
  await expectNoHome(vol, 'a volunteer who has not accepted the rules');
  await vol.screenshot({ path: join(shots, '4a-rules.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await admin.screenshot({ path: join(shots, '5-users-after.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ the rules stand in front of a notification tap, which waits for them…');
  // A tapped notification for a screen where hours are posted. Reloading with
  // the route: the rules screen again (nothing was accepted), and not the
  // timesheet the route names.
  const sharedEarly = await import('@sabeel/shared');
  const volToday = sharedEarly.dayKeyFor(Date.now(), sharedEarly.deviceTimeZone());
  await vol.goto(`${baseUrl}/?screen=Timesheet&periodKey=${sharedEarly.periodKeyFor(volToday)}`);
  await vol.getByText('Before you continue', { exact: true }).waitFor({ timeout: 45000 });
  await expectNoHome(vol, 'a reload before accepting');
  if ((await vol.getByText('No hours in this week.').count()) !== 0)
    throw new Error('a notification route reached the timesheet past the rules');
  await vol.getByText('I agree', { exact: true }).click();
  // Accepted: the waiting route opens the week it named.
  await vol.getByText('No hours in this week.').waitFor({ timeout: 30000 });

  console.log('▸ accepted once: never again — not on reload, not after signing out and in…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.screenshot({ path: join(shots, '4-volunteer-home.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await vol.getByText('Sign out', { exact: true }).click();
  await vol.getByText('Time Tracker', { exact: true }).waitFor({ timeout: 30000 });
  await devSignIn(vol, 'volunteer@oursabeel.com');
  // Home is only ever drawn once the rules are accepted, so Home appearing is
  // the proof; a rules screen here would never draw it.
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  if ((await vol.getByText('Before you continue', { exact: true }).count()) !== 0)
    throw new Error('the rules came back after signing in again');

  // Volunteer must NOT see the admin button.
  const manageCount = await vol.getByText('Manage users').count();
  if (manageCount !== 0) throw new Error('volunteer sees the admin Manage users button');

  console.log('▸ Phase 2: manager creates, archives, restores activities…');
  // Fresh page, same context: auth persists (IndexedDB), lands on Home.
  const admin2 = await admin.context().newPage();
  pages.set('admin2', admin2);
  await admin2.goto(baseUrl + '/');
  await admin2.getByText('Salaam,', { exact: false }).waitFor();
  await admin2.getByText('Activities', { exact: true }).click();

  async function addActivity(name) {
    const input = admin2.getByPlaceholder('New activity name');
    await input.fill(name);
    await admin2.getByText('Add', { exact: true }).click();
    // Successful create clears the input; an error would leave it filled.
    await admin2.waitForFunction(
      () => document.querySelector('input')?.value === '',
      undefined,
      { timeout: 10000 },
    );
    // .last(): the stack navigator keeps Home mounted (hidden) underneath, and
    // its picker chip for the new activity also matches; the visible Activities
    // screen is the most recently mounted, so it sits last in the DOM.
    await lastOnScreen(admin2.getByText(name, { exact: true })).waitFor();
  }
  await addActivity('Tutoring');
  await addActivity('Food Drive');
  // Food Drive, the first active activity by name.
  await firstOnScreen(admin2.getByText('Archive', { exact: true })).click();
  // Archived activities wait below the list, in a section that opens on a tap.
  await admin2.getByRole('button', { name: 'Show Archived (1)' }).click();
  await admin2.getByText('Restore', { exact: true }).waitFor();
  // An admin may delete an archived activity, after a confirmation. Old Drive
  // sorts before Tutoring among the active, and after Food Drive once archived.
  await addActivity('Old Drive');
  await firstOnScreen(admin2.getByText('Archive', { exact: true })).click();
  await admin2.getByRole('button', { name: 'Hide Archived (2)' }).waitFor();
  admin2.once('dialog', (d) => d.accept());
  await lastOnScreen(admin2.getByText('Delete', { exact: true })).click();
  await admin2.getByRole('button', { name: 'Hide Archived (1)' }).waitFor();
  if ((await admin2.getByText('Old Drive', { exact: true }).count()) !== 0)
    throw new Error('the deleted activity is still listed');
  await admin2.screenshot({ path: join(shots, '6-activities.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  // Members don't get the manager entry point (Home's Activities button).
  const actCount = await vol.getByText('Activities', { exact: true }).count();
  if (actCount !== 0) throw new Error('member sees the manager Activities button');

  // The activity/approver pickers are searchable modals now: click the field,
  // then the item inside the modal (modals render last in the DOM → .last()).
  async function pickFromModal(page, fieldText, itemText) {
    await lastOnScreen(page.getByText(fieldText, { exact: false })).click();
    await page.getByPlaceholder('Search…').waitFor();
    await lastOnScreen(page.getByText(itemText, { exact: false })).click();
  }

  console.log('▸ Phase 3: volunteer clocks in, clocks out, adds manual hours…');
  // Tutoring is the only active activity (Food Drive was archived above).
  await pickFromModal(vol, 'Pick an activity', 'Tutoring');
  await vol.getByText('Clock in', { exact: true }).click();
  await vol.getByText('CLOCKED IN').waitFor();
  await vol.screenshot({ path: join(shots, '7-clocked-in.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  await vol.getByText('Clock out', { exact: true }).click();
  await vol.getByText('What are you working on?').waitFor();
  // The 1-minute floor on clock sessions must show up in today's total.
  await vol.getByText('Today: 1m').waitFor();

  await vol.getByText('Add hours manually').click();
  await pickFromModal(vol, 'Pick an activity', 'Tutoring');
  const times = vol.locator('input');
  await times.nth(1).fill('09:00'); // from  (nth(0) is the date)
  await times.nth(2).fill('10:30'); // to
  await vol.getByText('What did you work on?', { exact: false }).waitFor();
  await vol.locator('textarea').fill('Math tutoring with the kids');
  // The filled form, pre-save — this is the manual's add-hours illustration.
  await vol.screenshot({ path: join(shots, '8a-add-hours.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  await vol.getByText('Save hours', { exact: true }).click();
  await vol.getByText('Today: 1h 31m').waitFor({ timeout: 15000 });
  await vol.screenshot({ path: join(shots, '8-after-manual.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 4: period timesheet — edit an entry, delete an entry…');
  await vol.getByText('My timesheet', { exact: true }).click();
  await vol.getByText('Week total: 1h 31m', { exact: true }).waitFor();
  await vol.screenshot({ path: join(shots, '9-timesheet.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  // Edit the manual entry (found by its note) to end at 11:00 → total 2h 01m.
  await vol.getByText('Math tutoring with the kids').click();
  await vol.locator('input').nth(2).fill('11:00');
  await vol.getByText('Save changes', { exact: true }).click();
  await vol.getByText('Week total: 2h 01m', { exact: true }).waitFor();

  // A note alone saves on the clock entry, and leaves its minutes alone. The
  // form shows whole minutes while a clocked session keeps its seconds; a
  // session inside one minute must not read back as no length at all.
  await lastOnScreen(vol.getByText('1m', { exact: true })).click();
  await firstOnScreen(vol.locator('textarea')).fill('Set up the room');
  await vol.getByText('Save changes', { exact: true }).click();
  await vol.getByText('Set up the room', { exact: true }).waitFor();
  await vol.getByText('Week total: 2h 01m', { exact: true }).waitFor();

  // Delete the 1-minute clock entry → total 2h 00m.
  await lastOnScreen(vol.getByText('1m', { exact: true })).click();
  await vol.getByText('Delete entry', { exact: true }).click();
  await vol.getByText('Week total: 2h 00m', { exact: true }).waitFor();
  await vol.screenshot({ path: join(shots, '10-timesheet-period.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ overlap guard: conflicting entries are flagged and block submission…');
  // 10:00–10:45 overlaps the existing 09:00–11:00 entry → both rows flagged.
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.getByText('Add hours manually').click();
  await pickFromModal(vol, 'Pick an activity', 'Tutoring');
  const ovIn = vol.locator('input');
  await ovIn.nth(1).fill('10:00');
  await ovIn.nth(2).fill('10:45');
  await vol.getByText('Save hours', { exact: true }).click();
  await vol.getByText('My timesheet', { exact: true }).click();
  const flagged = vol.getByText('Overlaps another entry', { exact: true });
  await firstOnScreen(flagged).waitFor();
  if ((await flagged.count()) !== 2) throw new Error('expected both overlapping rows flagged');
  await vol.getByText('fix the highlighted times', { exact: false }).waitFor();
  await vol.screenshot({ path: join(shots, '10b-overlap.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // A butt-joint edit (start at the other entry's end) clears the conflict.
  // Select the row by its unique times — both rows carry the same conflict label.
  await vol.getByText('10:00–10:45', { exact: false }).click();
  await vol.locator('input').nth(1).fill('11:00');
  await vol.locator('input').nth(2).fill('11:45');
  await vol.getByText('Save changes', { exact: true }).click();
  await vol.getByText('Week total: 2h 45m', { exact: true }).waitFor();
  if ((await vol.getByText('Overlaps another entry', { exact: true }).count()) !== 0)
    throw new Error('overlap flag should clear after the fix');
  // Put the total back where later phases expect it: delete the extra entry.
  await lastOnScreen(vol.getByText('45m', { exact: true })).click();
  await vol.getByText('Delete entry', { exact: true }).click();
  await vol.getByText('Week total: 2h 00m', { exact: true }).waitFor();

  console.log('▸ stale-listener guard: switching weeks must clear rows even on a slow network…');
  // Localhost snapshots arrive in ~ms, which is exactly why this bug class
  // (docs/POSTMORTEM-2026-07-16-stale-week.md) escaped the e2e: on a real phone
  // the new week's snapshot lags and the old week's rows lingered on screen.
  // Simulate the lag by stalling all Firestore emulator traffic; the UI must
  // clear the previous week's entries IMMEDIATELY (reset-on-input-change),
  // without waiting for data.
  const shared = await import('@sabeel/shared');
  const todayKey = shared.dayKeyFor(Date.now(), shared.deviceTimeZone());
  const otherWeek = shared
    .periodsOfMonth(todayKey)
    .find((p) => p.fromKey !== shared.periodKeyFor(todayKey));
  const stall = async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue().catch(() => {});
  };
  await vol.context().route(`http://${EMULATOR_HOSTS.firestore}/**`, stall);
  await firstOnScreen(vol.getByText(shared.periodLabel(otherWeek), { exact: false })).click();
  // Old rows must vanish at once — long before the stalled snapshot can land.
  await vol.getByText('No hours in this week.').waitFor({ timeout: 1500 });
  if ((await vol.getByText('Math tutoring with the kids').count()) !== 0)
    throw new Error("stale entries visible under a different week's timesheet");
  await vol.context().unroute(`http://${EMULATOR_HOSTS.firestore}/**`);
  await vol.getByText('Jump to current week', { exact: true }).click();
  await vol.getByText('Math tutoring with the kids').waitFor({ timeout: 15000 });

  console.log('▸ Phase 7: volunteer picks an approver and submits the week…');
  // Submit is gated until an approver is chosen (rules require the stamp).
  await vol.getByText('Pick your timesheet approver', { exact: false }).waitFor();
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await pickFromModal(vol, 'Choose who approves your hours', 'Admin');
  // The field echoes the selection once the profile listener catches up — wait
  // for it so Submit isn't clicked while still disabled.
  await firstOnScreen(vol.getByText('Admin', { exact: true })).waitFor();
  await vol.getByText('My timesheet', { exact: true }).click();
  await vol.getByText('Submit timesheet', { exact: true }).click();
  await firstOnScreen(vol.getByText('Submitted', { exact: true })).waitFor();
  await vol.screenshot({ path: join(shots, '11-submitted.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 7: approver rejects with a reason → volunteer sees it live…');
  const mgr = admin;
  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await mgr.getByText('Approvals (1)', { exact: true }).click();
  await lastOnScreen(mgr.getByText('Volunteer', { exact: true })).click();
  await mgr.getByText('Total: 2h 00m', { exact: false }).waitFor();
  await mgr.getByPlaceholder('What needs fixing?').fill('Tuesday hours belong to Food Drive.');
  await mgr.getByText('Reject timesheet', { exact: true }).click();
  await mgr.getByText('Nothing waiting for approval', { exact: false }).waitFor();

  // Volunteer home shows the rejection banner live; the reason shows on the sheet.
  await vol.goto(baseUrl + '/');
  await vol.getByText('A timesheet was rejected', { exact: false }).waitFor({ timeout: 30000 });
  // Banner → Needs-attention list (reason inline) → tap the row → the week view.
  await vol.getByText('A timesheet was rejected', { exact: false }).click();
  await vol.getByText('to fix and resubmit', { exact: false }).waitFor();
  await vol.getByText('Tuesday hours belong to Food Drive.', { exact: false }).click();
  await vol.getByText('Fix the entries below', { exact: false }).waitFor();
  await vol.screenshot({ path: join(shots, '12-rejected.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 7: volunteer resubmits; approver adds hours on behalf + approves…');
  await vol.getByText('Resubmit timesheet', { exact: true }).click();
  await firstOnScreen(vol.getByText('Submitted', { exact: true })).waitFor();

  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await mgr.getByText('Approvals (1)', { exact: true }).click();
  await lastOnScreen(mgr.getByText('Volunteer', { exact: true })).click();
  // Add a 1h entry on the volunteer's behalf (approver correction path).
  await mgr.getByText('Add entry for Volunteer', { exact: true }).click();
  await mgr.getByText('Adding hours for Volunteer', { exact: false }).waitFor();
  await pickFromModal(mgr, 'Pick an activity', 'Tutoring');
  const mgrTimes = mgr.locator('input');
  await mgrTimes.nth(1).fill('14:00');
  await mgrTimes.nth(2).fill('15:00');
  await mgr.getByText('Save hours', { exact: true }).click();
  // Back on the review screen the live total includes the added hour.
  await mgr.getByText('Total: 3h 00m', { exact: false }).waitFor({ timeout: 15000 });
  await mgr.getByText('Approve timesheet', { exact: true }).click();
  await mgr.getByText('Nothing waiting for approval', { exact: false }).waitFor();
  await mgr.screenshot({ path: join(shots, '13-approved-queue-empty.png'), timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 7: approved week is locked for the volunteer…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await firstOnScreen(vol.getByText('Approved', { exact: true })).waitFor({ timeout: 30000 });
  // The clock-in card is replaced by the lock notice.
  await vol.getByText("This week's timesheet is approved", { exact: false }).waitFor();
  await vol.getByText('My timesheet', { exact: true }).click();
  await vol.getByText('this week is locked', { exact: false }).waitFor();
  const editCount = await vol.getByText('Submit timesheet', { exact: true }).count();
  if (editCount !== 0) throw new Error('approved sheet still offers Submit');
  await vol.screenshot({ path: join(shots, '14-approved-locked.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ Phase 5: reports count APPROVED hours; CSV has real emails…');
  await mgr.goto(baseUrl + '/');
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await mgr.getByText('Reports', { exact: true }).click();
  // 'all' period, everyone, official view → the volunteer's approved 3h.
  await mgr.getByText('all', { exact: true }).click();
  await firstOnScreen(mgr.getByText('3h 00m', { exact: true })).waitFor({ timeout: 15000 });
  await mgr.screenshot({ path: join(shots, '15-reports.png'), timeout: 8000 }).catch(async (e) => {
    console.log('  (shot15 page-shot failed: ' + e.message.split('\n')[0] + ' — trying element shot)');
    await mgr.locator('body').screenshot({ path: join(shots, '15-reports.png'), timeout: 8000 }).catch((e2) => console.log('  (shot15 element shot failed too: ' + e2.message.split('\n')[0] + ')'));
  });

  // CSV download: capture the browser download and assert its contents.
  const [dl] = await Promise.all([
    mgr.waitForEvent('download'),
    mgr.getByText('Export CSV', { exact: true }).click(),
  ]);
  const dlPath = join(shots, 'export.csv');
  await dl.saveAs(dlPath);
  const csv = readFileSync(dlPath, 'utf8');
  if (!/Person,Email,Activity,Date,Start,End/.test(csv))
    throw new Error('CSV missing header: ' + csv.slice(0, 80));
  if (!/Volunteer/.test(csv)) throw new Error('CSV missing the volunteer row');
  if (!/volunteer@oursabeel\.com/.test(csv)) throw new Error('CSV missing the volunteer email');

  // Lifetime statement for the volunteer. "Volunteer" appears both as a Person
  // filter chip (earlier) and as the tappable By-person row (later) — .last()
  // is the row that navigates to the statement.
  await lastOnScreen(mgr.getByText('Volunteer', { exact: true })).click();
  await lastOnScreen(mgr.getByText('LIFETIME APPROVED HOURS')).waitFor();
  await lastOnScreen(mgr.getByText('3h 00m', { exact: true })).waitFor();
  await mgr.screenshot({ path: join(shots, '16-person-detail.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ notification taps land on the right screen (web transport)…');
  // A tapped push carries its destination as the same key/values on both
  // surfaces: an FCM data payload on Android, this query string on the web
  // (the browser can only hand the page a URL). Same shared decoder either way,
  // so exercising it here covers the routing for both.
  const volUid = await uidByEmail('volunteer@oursabeel.com');
  await vol.goto(`${baseUrl}/?screen=Timesheet&periodKey=${otherWeek.fromKey}`);
  // Right screen AND right week: that week is the empty one used above.
  await vol.getByText('No hours in this week.').waitFor({ timeout: 45000 });
  // The route must be stripped, or a reload would navigate all over again.
  if (new URL(vol.url()).search !== '')
    throw new Error('notification route left in the URL: ' + vol.url());

  // A member has no Users screen; navigating to a name the navigator doesn't
  // have would throw, so an out-of-reach route must be dropped, not attempted.
  await vol.goto(`${baseUrl}/?screen=Users`);
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  if ((await vol.getByText('Manage users', { exact: true }).count()) !== 0)
    throw new Error('member was routed into an approver-only screen');

  // The approver's submission notification: straight to that person's week.
  await mgr.goto(
    `${baseUrl}/?screen=TimesheetReview&uid=${volUid}&displayName=Volunteer&periodKey=${shared.periodKeyFor(todayKey)}`,
  );
  await mgr.getByText('Total: 3h 00m', { exact: false }).waitFor({ timeout: 45000 });
  // Garbage in the query must leave you on Home rather than crash the app.
  await mgr.goto(`${baseUrl}/?screen=Timesheet`);
  await mgr.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });

  console.log('▸ notification settings: reminder toggle flips and persists…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await vol.getByText('Notification settings', { exact: true }).click();
  await vol.getByText('Weekly submit reminder').waitFor();
  // Members see three switches; the reminder is last. RN-web renders them as
  // checkbox inputs — checked is a DOM *property*, so read it via evaluate.
  const reminderState = () =>
    vol.evaluate(() => {
      const sws = document.querySelectorAll('[role="switch"]');
      const el = sws[sws.length - 1];
      return el ? !!el.checked : null;
    });
  if ((await reminderState()) !== true) throw new Error('reminder pref should default ON');
  await lastOnScreen(vol.locator('[role="switch"]')).click();
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
  await vol.waitForFunction(() => {
    const sws = document.querySelectorAll('[role="switch"]');
    return sws.length > 0 && sws[sws.length - 1].checked === false;
  }, undefined, { timeout: 15000 });
  const reminderStored = async () => {
    const res = await fetch(
      `http://${EMULATOR_HOSTS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/users/${volUid}`,
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
  await vol.getByText('Notification settings', { exact: true }).click();
  await vol.getByText('Weekly submit reminder').waitFor();
  await vol.waitForFunction(
     
    () => {
      const sws = document.querySelectorAll('[role="switch"]');
      return sws.length > 0 && sws[sws.length - 1].checked === false;
    },
    undefined,
    { timeout: 10000 },
  );
  await vol.screenshot({ path: join(shots, '17-notification-settings.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});

  console.log('▸ report a problem: the draft survives Back, Send stores one report and clears the field…');
  await vol.goto(baseUrl + '/');
  await vol.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await firstOnScreen(vol.getByText('Report a problem', { exact: true })).click();
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
  await firstOnScreen(vol.getByText('Report a problem', { exact: true })).click();
  await reportField().waitFor();
  if ((await reportField().inputValue()) !== REPORT_TEXT)
    throw new Error('the unsent report was lost on Back: ' + (await reportField().inputValue()));
  await vol.getByText('Send', { exact: true }).click();
  await vol.getByText('Sent. An administrator will reply by email within a day.', { exact: true }).waitFor({ timeout: 30000 });
  if ((await reportField().inputValue()) !== '') throw new Error('the field kept the sent report');
  await vol.screenshot({ path: join(shots, '19-report-sent.png'), animations: 'disabled', timeout: 8000 }).catch(() => {});
  // Exactly one report, the volunteer's, kept by the server; under the
  // emulator the email is skipped, never sent.
  const reportsRes = await fetch(
    `http://${EMULATOR_HOSTS.firestore}/v1/projects/${PROJECT}/databases/(default)/documents/reports`,
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
  // says it cannot reach the backend) and Auth's 400 for a deleted account.
  const provoked = (e) =>
    /^(slow|stuck|outsider)$/.test(e.label) &&
    /Could not reach Cloud Firestore backend|status of 400/.test(e.text);
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
