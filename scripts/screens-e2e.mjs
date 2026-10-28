#!/usr/bin/env node
/**
 * THE visual/layout regression harness. Every screen, every width, looked at
 * AND checked.
 *
 *   npm run test:screens                      the CI sweep
 *   SWEEP_WIDTHS=320 npm run test:screens     one width, for a tight loop
 *
 * It exists because `CLAUDE.md` named a multi-width sweep the highest-value
 * testing work missing from this repo: `scripts/web-e2e.mjs` proves the FLOWS
 * but looks at one 420x860 viewport, so every layout decision on the other side
 * of the breakpoint shipped unphotographed and unchecked.
 *
 * A TOUR THAT CANNOT FAIL IS A SCREENSHOT GENERATOR. So this one asserts and
 * exits non-zero, and `functions/test/unit/ci-coverage.test.ts` fails if CI ever
 * stops running it. Both of the holes found in it so far were found by
 * deliberately breaking a screen and watching it go red — do that again after
 * changing a check; each one is recorded at the check it belongs to.
 *
 * WHAT IT CHECKS, and the bug each one is here for:
 *   - the page never scrolls sideways      the classic responsive failure a
 *                                          top-of-page shot never reveals
 *   - nothing extends past the right edge  react-native-web's vertical
 *                                          ScrollView sets overflow-x: hidden,
 *                                          so an over-wide row is sliced off in
 *                                          silence and the page width above
 *                                          never moves
 *   - no two same-layer controls overlap   crowding that appears at one width
 *                                          and not another
 *   - every screen has a way out           a pushed screen with no header Back
 *                                          is a dead end on a phone browser,
 *                                          where there is no hardware Back
 *                                          either; the root answers with Sign out
 *   - the layout that width should produce  buttons stretch below the breakpoint
 *     actually rendered                    and hug their label above it; card
 *                                          grids stack below and flow above —
 *                                          checked against the breakpoint READ
 *                                          FROM SOURCE
 *   - a native field fits its own value    a field squashed by a flex row
 *                                          neither bleeds nor overlaps, so
 *                                          nothing else here can see it
 *   - targets under 44px are REPORTED      not failed — informational
 *
 * Deliberately NOT checked: a generic "is any text truncated". Every
 * `numberOfLines` in this app is an intentional clamp (the picker's field, an
 * entry's note, a rejection reason), so the check would fire on correct code at
 * every width and drown the real signal. Nor is kanban's "no interactive content
 * nested inside a <button>" ported: this app sets no `accessibilityRole`, so
 * react-native-web emits `<div tabindex>` rather than `<button>`, and the one
 * nesting it does have — the picker's backdrop Pressable wrapping the sheet and
 * its TextInput — is the correct dismiss pattern, not the invalid-HTML bug that
 * check exists for. A check that fires on correct code is worse than no check.
 *
 * A SCREEN WITH AN EDITOR OPEN IS A DIFFERENT SCREEN. The searchable picker is
 * a modal with a text field over a capped list; the review screen grows a reason
 * box and two more buttons only once a timesheet is submitted. Those rows exist
 * in no other state and 320px is where they run out of room, so they are toured
 * explicitly rather than trusted because the screen underneath them measured fine.
 *
 * Seeding goes through the Admin SDK: deterministic, seconds not minutes, and
 * rules would refuse most of it from a client anyway. The shapes seeded are the
 * ones that BREAK layouts — the longest realistic activity name, a note longer
 * than its row, a rejection reason of real length, a week with nothing in it —
 * not tidy ones. Accounts are still provisioned through the UI, because
 * `onUserCreate` is the sole provisioner and a hand-written user doc would be a
 * shape production never produces.
 */
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  addDays,
  COLLECTIONS,
  dayKeyFor,
  deviceTimeZone,
  epochFor,
  minutesBetween,
  monthRange,
  periodLabel,
  periodRangeFor,
  periodsOfMonth,
  RULES_VERSION,
} from '@sabeel/shared';
import {
  ROOT,
  EMULATOR_HOSTS,
  PROJECT,
  buildWebBundle,
  devSignIn,
  grantAdmin,
  launchBrowser,
  serveWebBundle,
  settle,
  shutdown,
  startEmulators,
} from './lib/e2e-stack.mjs';

const SHOTS = process.env.E2E_SHOTS_DIR ?? resolve(ROOT, 'shots', 'screens');

process.env.FIRESTORE_EMULATOR_HOST ??= EMULATOR_HOSTS.firestore;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= EMULATOR_HOSTS.auth;
process.env.GCLOUD_PROJECT = PROJECT;

/*
 * TEARDOWN ON A SIGNAL, not only on the happy path.
 *
 * `shutdown()` reaps the emulator process GROUP, and it runs at the end of a
 * run and in the catch below — but a signalled process runs neither, so an
 * interrupted sweep orphans its whole emulator group and leaves
 * `functionsEmulatorRuntime` children resident until the next
 * `sabeel-ci free-emulator-ports` finds them as orphans (docs/DEV-TOOLING.md).
 *
 * SIGTERM matters more than SIGINT here: it is what
 * `sabeel-ci free-emulator-ports` sends to this checkout's leftovers, so a
 * second run started here stops this one, and the orphans found on 2026-08-27
 * came from runs stopped by a SIGTERM. The happy path tearing down and the
 * interrupted path silently not is indistinguishable without going to look for
 * the strays.
 */
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    console.error(`\n${sig} — tearing down the emulators before exiting.`);
    shutdown(130);
  });
}
/*
 * …and on a throw outside the tour. Provisioning and seeding run at the top
 * level, outside the tour's try/catch, so a timeout there used to end the
 * process with the whole emulator group still running (seen 2026-10-16), and
 * the next run of anything on this machine met it.
 */
process.on('uncaughtException', (e) => {
  console.error(e);
  shutdown(1);
});

const results = [];
/** Sign-ins that reached "Still setting up your account" and took Try again (`settle`). */
let raced = 0;

/**
 * The notification settings screen must always say SOMETHING about this device —
 * exactly one of the four states, never none and never two.
 *
 * Deliberately browser-independent: headless Chromium reports permission as
 * 'denied' and the full browser reports 'default', so asserting a particular
 * message would only ever hold under one of them. What must hold under both is
 * that the section exists at all. Without this the sweep merely photographs
 * whatever renders, and the whole control could vanish with every check green.
 */
async function checkDeviceState(page, tag) {
  const messages = [
    'Notifications are not enabled on this device.',
    'Notifications are enabled on this device.',
    'Notifications are blocked for this app on this device.',
    'This device can\u2019t show notifications.',
  ];
  const shown = [];
  for (const m of messages) {
    if (await page.getByText(m, { exact: false }).first().isVisible().catch(() => false)) {
      shown.push(m);
    }
  }
  check(
    `${tag} / notification-settings says exactly one thing about this device`,
    shown.length === 1,
    `saw ${shown.length}: ${shown.join(' | ') || '(none)'}`,
  );
}

function check(name, ok, detail = '') {
  results.push({ name, ok, ...(ok ? {} : { detail }) });
  // Detail describes the FAILURE, so it is printed only when there is one —
  // appending it to a passing line reads as the opposite of what happened.
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

/**
 * Layout constants come from the SOURCE, never from a copy here. A constant
 * restated in a test drifts from the thing it is testing, and a silent fallback
 * is the same failure wearing a default — so a missing one throws.
 */
const layoutSrc = await readFile(resolve(ROOT, 'app/src/theme/layout.ts'), 'utf8');
const fromSource = (name) => {
  const hit = layoutSrc.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  if (!hit) throw new Error(`${name} is no longer readable from app/src/theme/layout.ts`);
  return Number(hit[1]);
};
const WIDE_BREAKPOINT = fromSource('WIDE_BREAKPOINT');
const CONTENT_MAX_WIDTH = fromSource('CONTENT_MAX_WIDTH');
const LIST_MAX_WIDTH = fromSource('LIST_MAX_WIDTH');

/**
 * Widths chosen to STRADDLE the breakpoint rather than to look thorough: a bug
 * on one side of it is invisible from the other. One below, one phone-typical,
 * one exactly at it, one above, one wide.
 */
const WIDTHS = process.env.SWEEP_WIDTHS
  ? process.env.SWEEP_WIDTHS.split(',').map(Number)
  : [320, 390, WIDE_BREAKPOINT, 1024, 1440];

// ---- People -----------------------------------------------------------------
// `landing`: the text of the first screen each account reaches after signing in.
const ADMIN = { email: 'admin@oursabeel.com', name: 'Admin', landing: 'Salaam,' };
const MEMBER = { email: 'volunteer@oursabeel.com', name: 'Fatima Abdul-Rahman', landing: 'Salaam,' };
// A long, real-shaped name and address: the Users card, the approvals row and
// every picker row are laid out around a person's name, and a short one never
// tests them.
const MANAGER = {
  email: 'programme.coordinator@oursabeel.com',
  name: 'Abdur-Rahman Oyelaran',
  landing: 'Salaam,',
};
const PENDING = { email: 'newcomer@oursabeel.com', name: 'Newcomer', landing: 'waiting for an administrator' };
// Approved, but has not yet accepted the institute's rules: the one screen it
// sees, at every width, because the tour never taps I agree.
const UNACCEPTED = { email: 'first.day@oursabeel.com', name: 'Yusuf First-Day', landing: 'Before you continue' };

// A clean folder, so the report (`sabeel-ci screens-report`) shows this run's
// screens and no other's, and the checks beside them however the run ends.
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });
process.on('exit', () => writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 1)));

console.log('▸ building functions and web bundle (emulator mode)…');
buildWebBundle();
console.log('▸ starting Firebase emulators…');
await startEmulators({ logPath: join(SHOTS, 'emulator.log') });
const { baseUrl } = await serveWebBundle();
const browser = await launchBrowser();

initializeApp({ projectId: PROJECT });
const db = getFirestore();

// ---- Provision through the UI, then seed against the real uids --------------
/**
 * `onUserCreate` is the SOLE provisioner (it also deletes non-org accounts), so
 * every account here is created the way production creates one and only its
 * role/status is set afterwards. A hand-written user doc would be a shape
 * production never produces, and the gate screens would then be testing fiction.
 */
async function provision({ email }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  try {
    await page.goto(baseUrl + '/');
    await page.getByText('Time Tracker', { exact: true }).waitFor({ timeout: 30000 });
    await devSignIn(page, email);
    if (await settle(page, page.getByText('waiting for an administrator', { exact: false }))) raced += 1;
  } catch (error) {
    console.error('Provisioning page errors:', pageErrors);
    await page.screenshot({ path: join(SHOTS, 'provision-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await ctx.close();
  }
  const snap = await db.collection(COLLECTIONS.users).where('email', '==', email).get();
  if (snap.empty) throw new Error(`${email} was never provisioned`);
  return snap.docs[0].id;
}

console.log('▸ provisioning accounts through the sign-in gate…');
const adminUid = await provision(ADMIN);
grantAdmin(ADMIN.email);
const memberUid = await provision(MEMBER);
const managerUid = await provision(MANAGER);
const pendingUid = await provision(PENDING);
if (!pendingUid) throw new Error('the pending account was never provisioned');
const unacceptedUid = await provision(UNACCEPTED);

/** Approve + set a role the way an admin does — claims AND doc, or the two disagree. */
async function setAccess(uid, next, extra = {}) {
  await getAuth().setCustomUserClaims(uid, next);
  await db
    .collection(COLLECTIONS.users)
    .doc(uid)
    .set({ ...next, ...extra, claimsUpdatedAt: Date.now() }, { merge: true });
}
/**
 * The institute's rules, accepted, as the acceptRules callable records it. The
 * web e2e proves the screen and the callable; here the three tours are about
 * the screens behind it.
 */
const accepted = { rulesVersion: RULES_VERSION, rulesAcceptedAt: Date.now() };
await setAccess(adminUid, { status: 'active', role: 'manager', admin: true }, {
  displayName: ADMIN.name,
  approverUid: adminUid,
  ...accepted,
});
await setAccess(memberUid, { status: 'active', role: 'member', admin: false }, {
  displayName: MEMBER.name,
  approverUid: adminUid,
  ...accepted,
});
await setAccess(managerUid, { status: 'active', role: 'manager', admin: false }, {
  displayName: MANAGER.name,
  approverUid: adminUid,
  ...accepted,
});
await setAccess(unacceptedUid, { status: 'active', role: 'member', admin: false }, {
  displayName: UNACCEPTED.name,
  approverUid: adminUid,
});
// PENDING is left exactly as the trigger left it — that IS the state under test.

// ---- Seed the shapes that break layouts -------------------------------------
const TZ = deviceTimeZone();
const todayKey = dayKeyFor(Date.now(), TZ);
const CURRENT = periodRangeFor(todayKey);

/**
 * The interesting weeks live in the PREVIOUS month, always.
 *
 * The month strip only shows the anchored month's weeks, so a tour that wanted
 * three past weeks in the current one would break on the 1st of a month — a
 * harness that fails on some days of the year for a reason unrelated to layout
 * teaches everyone to ignore it. The previous month always has at least four
 * clipped periods, and reaching them exercises the month-step arrows, which no
 * other step touches.
 */
const LAST_MONTH = periodsOfMonth(addDays(monthRange(todayKey).fromKey, -1));
/**
 * INTERIOR periods, deliberately. Only the first and last period of a month are
 * clipped, and the last one can be a SINGLE DAY (a month ending on a Sunday) —
 * a week seeded across it would spill its later entries into the next month, out
 * of the timesheet they belong to and, because those entries then share a day,
 * into accidental overlaps that the conflict check would report as real. A month
 * always has at least four periods, so indices `len-2` and `len-3` are always
 * full Sunday-to-Saturday weeks. The empty one is the first, which nothing seeds.
 */
const SUBMITTED = LAST_MONTH[LAST_MONTH.length - 2];
const DECIDED = LAST_MONTH[LAST_MONTH.length - 3];
const EMPTY_WEEK = LAST_MONTH[0];

/**
 * The nth day of a period, clamped to the period AND to today. The CURRENT
 * period is clipped by the same month boundary, so on the 1st a fixed `+1` would
 * seed tomorrow's hours into next week — or into the future, which is hours
 * nobody could have worked.
 */
const dayIn = (period, n) => {
  let d = period.fromKey;
  for (let i = 0; i < n; i += 1) {
    const next = addDays(d, 1);
    if (next > period.toKey || next > todayKey) break;
    d = next;
  }
  return d;
};

const ACTIVITIES = [
  ['sw_act_tutoring', 'Tutoring', 'active'],
  // The longest realistic name: it has to lay out beside an Archive button on
  // the Activities row and inside a picker row, and a short name tests neither.
  ['sw_act_mentoring', 'Saturday morning youth mentoring and homework club', 'active'],
  ['sw_act_food', 'Food Drive', 'active'],
  ['sw_act_ramadan', 'Ramadan food distribution (2025)', 'archived'],
];
for (const [id, name, status] of ACTIVITIES) {
  await db.doc(`${COLLECTIONS.activities}/${id}`).set({
    name,
    status,
    createdAt: Date.now(),
    createdBy: adminUid,
  });
}

const entryDocs = [];
/** One closed entry, with its duration computed the way the app computes it. */
function entry(id, uid, activity, dayKey, from, to, extra = {}) {
  const tz = extra.timeZone ?? TZ;
  const start = epochFor(dayKey, from, tz);
  const end = epochFor(dayKey, to, tz);
  entryDocs.push([
    id,
    {
      uid,
      activityId: activity[0],
      activityName: activity[1],
      start,
      end,
      durationMinutes: Math.max(1, minutesBetween(start, end)),
      timeZone: tz,
      dayKey,
      periodKey: periodRangeFor(dayKey).fromKey,
      source: 'manual',
      createdAt: start,
      updatedAt: start,
      ...extra,
    },
  ]);
  return id;
}
const [TUTORING, MENTORING, FOOD] = ACTIVITIES;

// The member's CURRENT week: in progress, with the two shapes that change how a
// row renders — a note longer than its line, and a pair that OVERLAPS (which
// turns two rows red, adds a conflict label to each and a hint under the list).
entry(
  'sw_e_now_1',
  memberUid,
  TUTORING,
  CURRENT.fromKey,
  '09:00',
  '12:30',
  {
    note: 'Algebra and geometry with the Saturday group — three of them needed the whole session on word problems, so we did not reach the practice test.',
  },
);
entry('sw_e_now_2', memberUid, FOOD, CURRENT.fromKey, '12:00', '13:00');
entry('sw_e_now_3', memberUid, MENTORING, dayIn(CURRENT, 1), '14:00', '16:00', {
  source: 'clock',
});

// The member's SUBMITTED week — what an approver opens. One entry is in another
// timezone (the row grows a "(GMT+n)" suffix), one was auto-closed by the cap.
entry('sw_e_sub_1', memberUid, TUTORING, SUBMITTED.fromKey, '09:00', '11:30', { source: 'clock' });
entry('sw_e_sub_2', memberUid, MENTORING, dayIn(SUBMITTED, 1), '13:00', '17:00', {
  timeZone: 'Asia/Karachi',
  note: 'Travelling — logged against Karachi time, which is the clock the work happened on.',
});
entry('sw_e_sub_3', memberUid, FOOD, dayIn(SUBMITTED, 2), '08:00', '20:00', {
  source: 'clock',
  autoClosed: true,
});
entry('sw_e_sub_4', memberUid, TUTORING, dayIn(SUBMITTED, 4), '10:00', '12:00', {
  lastEditedBy: adminUid,
});

// The member's APPROVED week — the locked state.
entry('sw_e_ok_1', memberUid, TUTORING, DECIDED.fromKey, '09:00', '12:00');
entry('sw_e_ok_2', memberUid, FOOD, dayIn(DECIDED, 3), '14:00', '17:30');

// The admin's own REJECTED week, which is what puts the banner on their Home and
// a row on Needs attention.
entry('sw_e_adm_1', adminUid, MENTORING, DECIDED.fromKey, '10:00', '13:00', {
  note: 'Coordinating the volunteer rota for the term.',
});
entry('sw_e_adm_2', adminUid, TUTORING, dayIn(DECIDED, 2), '15:00', '18:00');

for (const [id, doc] of entryDocs) {
  await db.doc(`${COLLECTIONS.timeEntries}/${id}`).set(doc);
}

/** The admin is CLOCKED IN right now — the running card is its own Home layout. */
const runningStart = Date.now() - 95 * 60 * 1000;
await db.doc(`${COLLECTIONS.timeEntries}/sw_e_running`).set({
  uid: adminUid,
  activityId: TUTORING[0],
  activityName: TUTORING[1],
  start: runningStart,
  end: null,
  timeZone: TZ,
  dayKey: dayKeyFor(runningStart, TZ),
  periodKey: periodRangeFor(dayKeyFor(runningStart, TZ)).fromKey,
  source: 'clock',
  createdAt: runningStart,
  updatedAt: runningStart,
});
await db.doc(`${COLLECTIONS.users}/${adminUid}`).update({ activeEntryId: 'sw_e_running' });

const minutesIn = (period, uid) =>
  entryDocs
    .filter(([, d]) => d.uid === uid && d.periodKey === period.fromKey)
    .reduce((s, [, d]) => s + d.durationMinutes, 0);
const countIn = (period, uid) =>
  entryDocs.filter(([, d]) => d.uid === uid && d.periodKey === period.fromKey).length;

async function timesheet(uid, period, fields) {
  const now = Date.now();
  await db.doc(`${COLLECTIONS.timesheets}/${uid}_${period.fromKey}`).set({
    uid,
    periodKey: period.fromKey,
    toKey: period.toKey,
    approverUid: adminUid,
    submittedAt: now,
    totalMinutes: minutesIn(period, uid),
    entryCount: countIn(period, uid),
    createdAt: now,
    updatedAt: now,
    ...fields,
  });
}
await timesheet(memberUid, SUBMITTED, { status: 'submitted' });
await timesheet(memberUid, DECIDED, {
  status: 'approved',
  decidedAt: Date.now(),
  decidedBy: adminUid,
});
// A rejection reason of REAL length — the card wraps it, the Needs-attention row
// clamps it to three lines, and a two-word reason tests neither.
await timesheet(adminUid, DECIDED, {
  status: 'rejected',
  decidedAt: Date.now(),
  decidedBy: adminUid,
  rejectReason:
    'Thursday and Friday are both logged against Tutoring, but the Friday session was the food drive — please move it before this goes into the quarterly report.',
});

console.log(
  `  seeded ${ACTIVITIES.length} activities, ${entryDocs.length + 1} entries, 3 timesheets, 5 accounts`,
);
console.log(`  breakpoint read from source: ${WIDE_BREAKPOINT}px`);
console.log(
  `  weeks: current ${periodLabel(CURRENT)} · submitted ${periodLabel(SUBMITTED)} · ` +
    `decided ${periodLabel(DECIDED)} · empty ${periodLabel(EMPTY_WEEK)}\n`,
);

// ---- Assertions -------------------------------------------------------------
/**
 * react-native-web renders every `Pressable` as a `<div tabindex="0">` (or
 * `-1` when disabled) — this app sets no `accessibilityRole`, so `[tabindex]`
 * is what "a control" looks like in its DOM. Native inputs and the navigation
 * header's back link are added explicitly.
 */
const CONTROLS = '[tabindex], input, textarea, select, a[href]';

const layoutFaults = (page) =>
  page.evaluate(
    (sel) => {
      const faults = [];
      /**
       * THE REFERENCE WIDTH IS WHAT THE PAGE LAID OUT AT, not what this run
       * asked for.
       *
       * Every geometric check below is measured against `w`, which makes it the
       * most load-bearing number in the sweep — and taking it from the Playwright
       * viewport option would be measuring against an ASSUMPTION that the option
       * applied. If it ever did not (a context-option change, a device profile,
       * a scrollbar taking ~15px out of the layout box on some other runner),
       * every check here would quietly compare against the wrong reference and
       * pass. That is a check that cannot fail, which is the thing this file
       * exists to avoid.
       *
       * `documentElement.clientWidth` IS the layout viewport, by definition, so
       * the question is answered rather than assumed. The two are reported
       * separately once per width — see "laid out at the width it was asked for"
       * — so a divergence is named loudly instead of silently moving the goalposts.
       */
      const w = document.documentElement.clientWidth;
      // The PAGE must never widen: any horizontal scroller in this app is its
      // own element. This is the classic responsive failure a top-of-page
      // screenshot never reveals.
      const bleed = document.documentElement.scrollWidth - w;
      if (bleed > 1) faults.push(`page scrolls sideways by ${bleed}px`);

      /**
       * The part of an element that is actually laid out where it claims.
       *
       * `getBoundingClientRect` reports where an element would be, not what is
       * on screen — and the sibling kanban's version of this clips to the
       * VIEWPORT in both axes. That is wrong here: every screen in this app is
       * one tall scrolling column, so clipping the vertical axis to the viewport
       * would zero out everything below the fold and the overlap check would
       * quietly stop looking at most of the page — a check that cannot fail.
       *
       * So: clip HORIZONTALLY to the viewport and to any ancestor that clips or
       * scrolls sideways (being sliced off at the right edge is exactly that),
       * and clip VERTICALLY only to ancestors with `overflow-y: hidden`, which
       * genuinely hide what overflows. A scrolling ancestor hides nothing — you
       * scroll to it — and two controls inside one scroller are laid out against
       * each other wherever they sit.
       */
      const visibleRect = (el) => {
        const raw = el.getBoundingClientRect();
        let { left, right, top, bottom } = raw;
        for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          const c = n.getBoundingClientRect();
          if (/hidden|auto|scroll|clip/.test(cs.overflowX)) {
            left = Math.max(left, c.left);
            right = Math.min(right, c.right);
          }
          if (/hidden|clip/.test(cs.overflowY)) {
            top = Math.max(top, c.top);
            bottom = Math.min(bottom, c.bottom);
          }
        }
        return { left: Math.max(left, 0), right: Math.min(right, w), top, bottom };
      };
      const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

      /** The nearest positioned ancestor — a modal, or the page. */
      const layerOf = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          const pos = getComputedStyle(n).position;
          if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return n;
        }
        return document.body;
      };

      // A pushed screen leaves the one under it mounted at zero size, so an
      // area filter is also what keeps the previous screen's controls out of
      // this measurement.
      const els = [...document.querySelectorAll(sel)].filter((e) => area(visibleRect(e)) > 4);
      const name = (e) =>
        (
          e.getAttribute('aria-label') ||
          e.textContent ||
          e.getAttribute('placeholder') ||
          `<${e.tagName.toLowerCase()} ${e.getAttribute('type') ?? ''}>`
        )
          .trim()
          .slice(0, 26);

      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i];
          const b = els[j];
          // Nesting is legitimate (a control inside a pressable row); two
          // INDEPENDENT controls sharing pixels is not.
          if (a.contains(b) || b.contains(a)) continue;
          // Neither is overlap ACROSS LAYERS: a modal sits over a screen by
          // design, and comparing the two reports every control on the screen
          // beneath as overlapping the sheet.
          if (layerOf(a) !== layerOf(b)) continue;
          const ra = visibleRect(a);
          const rb = visibleRect(b);
          const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (ox > 1 && oy > 1) {
            faults.push(
              `"${name(a)}" overlaps "${name(b)}" by ${Math.round(ox)}x${Math.round(oy)}px`,
            );
          }
        }
      }

      /*
       * A NATIVE FIELD MUST BE WIDE ENOUGH FOR ITS OWN CONTENT.
       *
       * The narrow, targeted version of the generic "is any text truncated"
       * check that is deliberately absent above: scoped to `<input>`, where the
       * value is never an intentional clamp. A field squashed by a flex row
       * neither bleeds the page nor overlaps anything, so nothing else here can
       * see it — at 320px the Add-hours date input was squeezed to "08" while
       * every other check stayed green.
       *
       * Measured by CLONING the field outside the flex row, because a squashed
       * date input does not report it: `scrollWidth` equals `clientWidth` on a
       * `type="date"` (its segments are clipped, not scrolled), so the obvious
       * test passes on the very bug it was written for.
       */
      /*
       * INPUT ONLY, and that is a SCOPE not an oversight — a control this skips
       * passes by never being looked at, which is the shape this whole file
       * exists to distrust. `<select>` and `<textarea>` are excluded because
       * this app renders neither: every picker here is a custom Modal, not a
       * native select. If one ever appears, widen this loop rather than assuming
       * it is covered — and note that `width: auto` sizes a select to its
       * LONGEST OPTION, which is not always the same as its min-content width.
       */
      for (const e of els) {
        if (e.tagName !== 'INPUT' || ['checkbox', 'radio'].includes(e.type)) continue;
        const clone = e.cloneNode(false);
        clone.style.position = 'absolute';
        clone.style.visibility = 'hidden';
        clone.style.width = 'auto';
        clone.style.maxWidth = 'none';
        clone.style.flex = 'none';
        document.body.appendChild(clone);
        const natural = clone.getBoundingClientRect().width;
        clone.remove();
        const shown = e.getBoundingClientRect().width;
        if (natural - shown > 2) {
          faults.push(
            `the ${e.type} field is squashed to ${Math.round(shown)}px, ` +
              `${Math.round(natural - shown)}px under what its own value needs`,
          );
        }
      }

      /*
       * NOTHING MAY EXTEND PAST THE RIGHT EDGE.
       *
       * Distinct from "the page scrolls sideways": react-native-web's vertical
       * ScrollView sets `overflow-x: hidden`, so a child wider than the screen
       * is silently sliced off and the page width never moves. Checked over
       * EVERY element rather than over controls, and reporting only the
       * OUTERMOST offender — the one whose parent still fits — because a card
       * that overflows drags its whole subtree past the edge with it and naming
       * all forty of them buries the one line that matters.
       *
       * The first version of this looped over the controls that survived the
       * visible-area filter, which is the sibling kanban's shape and correct
       * THERE (its board pager lays whole columns off-screen by design). Here it
       * meant a control pushed ENTIRELY off the edge had no visible area left
       * and was skipped — so widening a card to 520px at 320px wide was toured,
       * screenshotted, and passed.
       */
      for (const e of document.querySelectorAll('*')) {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.right <= w + 1) continue;
        const p = e.parentElement;
        if (!p) continue;
        // The outermost offender only…
        if (p.getBoundingClientRect().right > w + 1) continue;
        // …and never the content of something built to scroll sideways.
        if (/auto|scroll/.test(getComputedStyle(p).overflowX)) continue;
        const label = (e.getAttribute('aria-label') || e.textContent || `<${e.tagName.toLowerCase()}>`)
          .trim()
          .slice(0, 40);
        faults.push(`"${label}" runs ${Math.round(r.right - w)}px past the right edge`);
      }

      /*
       * GUARD THE GUARD.
       *
       * Every fault above is produced by iterating `els`. If that selector ever
       * matches nothing — react-native-web dropping `tabindex` from Pressable,
       * a screen that renders no control — the loops run zero times, zero faults
       * are reported, and the sweep stays green forever with two of its checks
       * silently switched off. Same failure as a blind signal, wearing an empty
       * population instead: both pass, both look exactly like working.
       *
       * So the counts come back too, and the caller asserts on them. This repo
       * already had the pattern in `ci-coverage.test.ts` ("if the glob ever
       * matches nothing, this test would pass while proving nothing") — it just
       * had not been applied here.
       */
      return {
        faults: [...new Set(faults)],
        controls: els.length,
        fields: els.filter((e) => e.tagName === 'INPUT' && !['checkbox', 'radio'].includes(e.type))
          .length,
      };
    },
    CONTROLS,
  );


/**
 * Can you LEAVE this screen without the browser's Back?
 *
 * This app is a native stack with no tab bar: the root answers with Sign out and
 * every pushed screen has the header's back link ("<previous screen>, back").
 * A screen with neither is a dead end on a phone browser, where there is no
 * hardware Back either.
 */
const escapes = (page) =>
  page.evaluate(
    (sel) => {
      const shown = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const controls = [...document.querySelectorAll(sel)].filter(shown);
      return {
        back: controls.some((e) => /,\s*back$/i.test(e.getAttribute('aria-label') ?? '')),
        signOut: controls.some((e) => (e.textContent ?? '').trim() === 'Sign out'),
      };
    },
    CONTROLS,
  );

/** Reported, never failed: a list of what a thumb would struggle with. */
const smallTargets = (page) =>
  page.evaluate(
    (sel) => [
      ...new Set(
        [...document.querySelectorAll(sel)]
          .map((e) => ({
            // Same fallback chain as the fault reporter: a switch and a search
            // box have no text, and a report of "? 20px" names nothing.
            n: (
              e.getAttribute('aria-label') ||
              e.textContent ||
              e.getAttribute('placeholder') ||
              `<${e.tagName.toLowerCase()} ${e.getAttribute('type') ?? ''}>`
            )
              .trim()
              .slice(0, 18),
            r: e.getBoundingClientRect(),
          }))
          .filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.height < 44)
          .map((x) => `${x.n} ${Math.round(x.r.height)}px`),
      ),
    ],
    CONTROLS,
  );

/**
 * DID THIS WIDTH ACTUALLY PRODUCE ITS LAYOUT?
 *
 * `Button` stretches to its column below the breakpoint and hugs its label above
 * it (a full-width button becomes a bar on a desktop); `Screen` caps and centres
 * the column on wide only. Both come off `useLayout().isWide`, so this is the
 * check that the width the browser reports is the width the app laid out for —
 * with the threshold read from source, never copied here.
 */
const buttonLayout = (page) =>
  page.evaluate(() => {
    const btn = [...document.querySelectorAll('[tabindex]')].find(
      (e) => (e.textContent ?? '').trim() === 'Notification settings',
    );
    if (!btn) return null;
    return {
      button: Math.round(btn.getBoundingClientRect().width),
      column: Math.round(btn.parentElement.getBoundingClientRect().width),
    };
  });

/**
 * The card GRID, which is the other thing the breakpoint decides: one full-width
 * column on a phone, as many cards as fit above it. Measured by the LEFT edge of
 * each card's email line rather than its top — cards in one row need not be the
 * same height, and comparing tops would make a wrapped name look like a stacked
 * grid.
 */
const gridLayout = (page) =>
  page.evaluate(() => {
    const emails = [...document.querySelectorAll('div')].filter(
      (e) => e.children.length === 0 && /@oursabeel\.com$/.test((e.textContent ?? '').trim()),
    );
    const rects = emails.map((e) => e.getBoundingClientRect());
    return {
      cards: rects.length,
      columns: new Set(rects.map((r) => Math.round(r.left))).size,
      span: rects.length
        ? Math.round(Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left)))
        : 0,
    };
  });

// ---- The tour ---------------------------------------------------------------
const ADMIN_SCREENS = 18;
const MEMBER_SCREENS = 3;
const MANAGER_SCREENS = 2;
const PENDING_SCREENS = 1;
const UNACCEPTED_SCREENS = 1;

/** Only what is on screen. `getByText` matches a hidden node; a person cannot tap one. */
const vis = (loc) => loc.filter({ visible: true }).first();
const tap = async (page, text, exact = true) => {
  await vis(page.getByText(text, { exact })).click();
  await page.waitForTimeout(400);
};
/**
 * A picker is a react-native-web `Modal`, which portals to `document.body` with
 * `role="dialog"`. Scoping to it matters: the field that OPENED the picker
 * carries the same text as the row that is selected inside it, so an unscoped
 * click lands on the field, which the backdrop is covering, and hangs.
 */
const sheet = (page) => page.getByRole('dialog');
const tapInSheet = async (page, text, exact = true) => {
  await vis(sheet(page).getByText(text, { exact })).click();
  await page.waitForTimeout(400);
};
/**
 * The header back link, which react-navigation labels "<previous screen>, back".
 * `getByRole` skips `display: none` subtrees exactly as a screen reader does, so
 * this can never pick up the back link of a screen further down the stack.
 */
const goBack = async (page) => {
  await page.getByRole('link', { name: /,\s*back$/i }).first().click();
  await page.waitForTimeout(700);
};

/**
 * The page a failure should be photographed from. A tour that dies on
 * `waiting for getByText('Salaam,')` tells you nothing about what the screen was
 * actually showing; `web-e2e.mjs` learned this and dumps its pages on failure.
 */
let lastOpened = null;

/**
 * THE SWEEP'S OWN PREMISE, checked before a single screen is measured.
 *
 * Every geometric assertion in this file is relative to the layout viewport, so
 * if a viewport option ever silently failed to apply, all of them would compare
 * against the wrong reference and pass — the screenshots would be mislabelled
 * and "300 checks across five widths" would be a sentence about nothing. That is
 * this file's own headline rule (a tour that cannot fail is a screenshot
 * generator) applied one level up, to the tour's premise.
 *
 * Asked once per CONTEXT and BEFORE that context's tour, so a wrong width fails
 * here rather than after a tour's worth of geometry has been measured against
 * it. Per context rather than per width because each context carries its OWN
 * viewport option, and per context rather than per screen because the answer is
 * a property of the viewport: that is four lines per width instead of the
 * twenty-three a per-screen version would print on a runner whose scrollbars
 * take space.
 */
async function checkViewport(page, tag, width) {
  const actual = await page.evaluate(() => document.documentElement.clientWidth);
  check(
    `${tag} / the page laid out at the width it was asked for`,
    actual === width,
    `asked ${width}px, laid out ${actual}px — every geometric check is measured against the latter`,
  );
}

/** Sign in fresh, in this width's own context. */
async function open(who, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  lastOpened = page;
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 90)));
  await page.goto(baseUrl + '/');
  await page.getByText('Time Tracker', { exact: true }).waitFor({ timeout: 30000 });
  await devSignIn(page, who.email);
  await checkViewport(page, `${width}px`, width);
  if (await settle(page, page.getByText(who.landing, { exact: false }))) raced += 1;
  return { ctx, page, errors };
}

/**
 * Look at one screen, and check it. Everything a screen must satisfy regardless
 * of what is on it goes here — a screen added to a tour cannot forget them.
 */
function visitor(page, tag) {
  let seen = 0;
  let fieldsSeen = 0;
  const visit = async (name, go) => {
    await go();
    await page.waitForTimeout(400);
    const { faults, controls, fields } = await layoutFaults(page);
    check(`${tag} / ${name}`, faults.length === 0, faults.join('; ').slice(0, 200));
    // A screen with no controls found is not a clean screen, it is a check that
    // examined nothing. Every screen in this app has at least one — even the
    // gate, which has Sign out.
    check(`${tag} / ${name} — the layout checks examined something`, controls > 0, '0 controls');
    fieldsSeen += fields;
    const out = await escapes(page);
    check(`${tag} / ${name} has a way out`, out.back || out.signOut, 'no Back and no Sign out');
    const small = await smallTargets(page);
    if (small.length) console.log(`         under 44px: ${small.join(', ').slice(0, 110)}`);
    await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`), fullPage: true });
    seen += 1;
  };
  return { visit, count: () => seen, fields: () => fieldsSeen };
}

/** The whole app, as the person who can see all of it. */
async function tourAdmin(tag, width) {
  const { ctx, page, errors } = await open(ADMIN, width);
  const { visit, count, fields } = visitor(page, tag);
  const wide = width >= WIDE_BREAKPOINT;

  await visit('home', async () => {
    await page.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
    // The two states that make this the fullest Home there is.
    await page.getByText('CLOCKED IN').waitFor({ timeout: 20000 });
    await vis(page.getByText('A timesheet was rejected', { exact: false })).waitFor({
      timeout: 20000,
    });
  });

  /**
   * THE BREAKPOINT ITSELF, on the screen everybody lands on.
   *
   * Checked here rather than once at the end because it is the assertion that
   * the width the browser reports is the width the app LAID OUT FOR — if that
   * ever stops being true, every other check in this sweep is measuring the
   * wrong layout and passing.
   */
  {
    const l = await buttonLayout(page);
    const ok =
      l &&
      (wide
        ? // Hugging its label, inside a column the cap has narrowed.
          l.button < l.column - 20 && l.column <= CONTENT_MAX_WIDTH
        : // Stretched to the full width of the column.
          Math.abs(l.button - l.column) <= 1);
    check(
      `${tag} / home renders the ${wide ? 'wide (buttons hug, column capped)' : 'narrow (buttons stretch)'} layout`,
      ok,
      JSON.stringify(l),
    );
  }

  /**
   * A PICKER IS ITS OWN SCREEN — a modal with a text field over a capped list,
   * which is the shape most likely to break narrow and the one no structural
   * check can see while it is closed.
   */
  await visit('home-picker', async () => {
    await tap(page, 'Admin (myself)');
    await sheet(page).waitFor({ timeout: 15000 });
    await page.getByPlaceholder('Search…').waitFor({ timeout: 15000 });
  });
  await tapInSheet(page, 'Admin (myself)'); // re-pick the same approver; closes the sheet
  await page.waitForTimeout(500);

  await visit('manual-entry', async () => {
    await tap(page, 'Add hours manually');
    await vis(page.getByText('Pick an activity')).waitFor({ timeout: 20000 });
  });
  /** The activity list, which is where the longest name in the app has to fit. */
  await visit('manual-entry-picker', async () => {
    await tap(page, 'Pick an activity');
    await sheet(page).waitFor({ timeout: 15000 });
    await vis(sheet(page).getByText(ACTIVITIES[1][1])).waitFor({ timeout: 10000 });
  });
  await tapInSheet(page, 'Tutoring');
  await goBack(page);

  await visit('timesheet', async () => {
    await tap(page, 'My timesheet');
    await vis(page.getByText('Week total:', { exact: false })).waitFor({ timeout: 20000 });
  });

  /**
   * REJECTED, which is three rows this screen has in no other state: the reason
   * card, the conflict/approver hints, and Resubmit. Reached by stepping the
   * month back — the only step in this tour that touches the month arrows.
   */
  await visit('timesheet-rejected', async () => {
    await tap(page, '‹');
    await page.waitForTimeout(600);
    await tap(page, periodLabel(DECIDED));
    await vis(page.getByText('Fix the entries below', { exact: false })).waitFor({ timeout: 20000 });
  });

  /** An EMPTY week: the state with nothing to lay out, which lays out badly too. */
  await visit('timesheet-empty', async () => {
    await tap(page, periodLabel(EMPTY_WEEK));
    await vis(page.getByText('No hours in this week.')).waitFor({ timeout: 20000 });
  });

  await visit('entry-edit', async () => {
    await tap(page, periodLabel(DECIDED));
    await vis(page.getByText('Coordinating the volunteer rota for the term.')).click();
    await vis(page.getByText('Save changes')).waitFor({ timeout: 20000 });
  });
  await goBack(page);
  await goBack(page);

  await visit('needs-attention', async () => {
    await tap(page, 'A timesheet was rejected', false);
    await vis(page.getByText('to fix and resubmit', { exact: false })).waitFor({ timeout: 20000 });
  });
  await goBack(page);

  await visit('notification-settings', async () => {
    await tap(page, 'Notification settings');
    await vis(page.getByText('Weekly submit reminder')).waitFor({ timeout: 20000 });
  });
  await checkDeviceState(page, tag);
  await goBack(page);

  /** One field and Send, with a report of real length typed in (Send enabled). */
  await visit('report-problem', async () => {
    await tap(page, 'Report a problem');
    const field = page.getByRole('textbox', { name: 'What or who are you reporting, and what is wrong?' });
    await field.waitFor({ timeout: 20000 });
    await field.fill(
      'On the Saturday mentoring week, two of my entries now carry a note I did not write, ' +
        'and the activity on Friday was changed from Food Drive to Tutoring. Could someone look?',
    );
  });
  await goBack(page);

  await visit('approvals', async () => {
    await vis(page.getByText(/^Approvals( \(\d+\))?$/)).click();
    await vis(page.getByText(MEMBER.name)).waitFor({ timeout: 20000 });
  });

  /**
   * A SUBMITTED week under review, which grows a reason box and two more buttons
   * that exist in no other state — the closest thing this app has to kanban's
   * "a card with the editor open is a different screen".
   */
  await visit('timesheet-review', async () => {
    await vis(page.getByText(MEMBER.name)).click();
    await vis(page.getByPlaceholder('What needs fixing?')).waitFor({ timeout: 20000 });
  });
  await goBack(page);
  await goBack(page);

  await visit('reports', async () => {
    await tap(page, 'Reports');
    await tap(page, 'all');
    await vis(page.getByText('By person (tap for lifetime statement)')).waitFor({ timeout: 25000 });
  });
  /** The person filter: the longest list in the app, and the one that grows. */
  await visit('reports-picker', async () => {
    await tap(page, 'Everyone');
    await sheet(page).waitFor({ timeout: 15000 });
    await vis(sheet(page).getByText(MEMBER.email)).waitFor({ timeout: 10000 });
  });
  await tapInSheet(page, 'Everyone');
  await page.waitForTimeout(500);

  await visit('person-detail', async () => {
    await vis(page.getByText(MEMBER.name)).click();
    await vis(page.getByText('LIFETIME APPROVED HOURS')).waitFor({ timeout: 25000 });
  });
  await goBack(page);
  await goBack(page);

  await visit('activities', async () => {
    await tap(page, 'Activities');
    await vis(page.getByText(ACTIVITIES[0][1], { exact: true })).waitFor({ timeout: 20000 });
    // The archived one, in its section opened.
    await page.getByRole('button', { name: 'Show Archived (1)' }).click();
    await vis(page.getByText(ACTIVITIES[3][1])).waitFor({ timeout: 20000 });
  });
  await goBack(page);

  await visit('users', async () => {
    await vis(page.getByText(/^Manage users( \(\d+\))?$/)).click();
    await vis(page.getByText(PENDING.email)).waitFor({ timeout: 25000 });
  });
  {
    const g = await gridLayout(page);
    const ok = wide
      ? g.cards >= 4 && g.columns >= 2 && g.span <= LIST_MAX_WIDTH
      : g.cards >= 4 && g.columns === 1;
    check(
      `${tag} / users renders the ${wide ? 'flowing' : 'stacked'} card grid`,
      ok,
      JSON.stringify(g),
    );
  }

  check(
    `${tag} / admin reached every screen`,
    count() === ADMIN_SCREENS,
    `${count()}/${ADMIN_SCREENS}`,
  );
  /*
   * …and the squashed-FIELD check had fields to look at.
   *
   * It is scoped to `<input>`, so unlike the checks above it can be starved by
   * a population that is empty for its own narrower reason — every control on
   * screen being a Pressable, say.
   *
   * The floor is ONE, deliberately, and the count is printed rather than
   * asserted at some tighter number. A higher floor would be a figure reasoned
   * to rather than measured, which is the thing this file exists to distrust;
   * the printed count is what makes a drop from many to few visible to a reader
   * without pretending a threshold was derived from anything.
   */
  check(
    `${tag} / the squashed-field check had fields to examine`,
    fields() > 0,
    `${fields()} field-measurements across ${count()} screens`,
  );
  console.log(`         fields measured: ${fields()} across ${count()} screens`);
  check(`${tag} / admin raised no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/**
 * THE MEMBER, whose Home is a DIFFERENT SCREEN — no Approvals, Reports,
 * Activities or Manage users. It is the layout the person who owns the app never
 * renders, which is exactly where a bug survives longest.
 */
async function tourMember(tag, width) {
  const { ctx, page, errors } = await open(MEMBER, width);
  const { visit, count } = visitor(page, tag);

  await visit('member-home', async () => {
    await page.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
    await vis(page.getByText('What are you working on?')).waitFor({ timeout: 20000 });
  });
  const gated = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('[tabindex]')]
      .filter((e) => e.getBoundingClientRect().width > 2)
      .map((e) => (e.textContent ?? '').trim());
    return {
      manager: labels.filter((l) => /^(Reports|Activities|Approvals)/.test(l)),
      admin: labels.filter((l) => /^Manage users/.test(l)),
      own: labels.includes('My timesheet'),
    };
  });
  check(
    `${tag} / a member sees none of the manager entry points`,
    gated.manager.length === 0 && gated.admin.length === 0 && gated.own,
    JSON.stringify(gated),
  );

  /** Overlapping entries: two rows turn red, each grows a label, the list grows a hint. */
  await visit('member-timesheet', async () => {
    await tap(page, 'My timesheet');
    await vis(page.getByText('fix the highlighted times', { exact: false })).waitFor({
      timeout: 25000,
    });
  });
  const flagged = await page
    .getByText('Overlaps another entry')
    .filter({ visible: true })
    .count();
  // BOTH rows, not one: the seed puts 09:00–12:30 against 12:00–13:00, and a
  // conflict marked on only one of them tells the owner half of what to fix.
  check(`${tag} / both sides of an overlap are flagged`, flagged === 2, `${flagged} row(s)`);

  /** APPROVED: the locked week, where the submit controls are replaced by a notice. */
  await visit('member-timesheet-locked', async () => {
    await tap(page, '‹');
    await page.waitForTimeout(600);
    await tap(page, periodLabel(DECIDED));
    await vis(page.getByText('this week is locked', { exact: false })).waitFor({ timeout: 20000 });
  });

  check(
    `${tag} / member reached every screen`,
    count() === MEMBER_SCREENS,
    `${count()}/${MEMBER_SCREENS}`,
  );
  check(`${tag} / member raised no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/**
 * THE NON-ADMIN MANAGER: the same two screens as the admin's, minus the controls
 * only an admin may use. Both are laid out around what is missing, so the
 * read-only shapes have no coverage from any other run.
 */
async function tourManager(tag, width) {
  const { ctx, page, errors } = await open(MANAGER, width);
  const { visit, count } = visitor(page, tag);

  await page.getByText('Salaam,', { exact: false }).waitFor({ timeout: 45000 });
  await visit('manager-users', async () => {
    await vis(page.getByText(/^Manage users( \(\d+\))?$/)).click();
    await vis(page.getByText(PENDING.email)).waitFor({ timeout: 25000 });
  });
  const readOnly = await page.evaluate(() => {
    const vis2 = [...document.querySelectorAll('[tabindex], [role="switch"]')].filter(
      (e) => e.getBoundingClientRect().width > 2,
    );
    return {
      approve: vis2.filter((e) => (e.textContent ?? '').trim() === 'Approve').length,
      switches: vis2.filter((e) => e.getAttribute('role') === 'switch').length,
      roleOptions: vis2.filter((e) => /^(member|manager)$/.test((e.textContent ?? '').trim()))
        .length,
      approverFields: vis2.filter((e) => /^(No approver assigned|Admin)/.test((e.textContent ?? '').trim()))
        .length,
    };
  });
  check(
    `${tag} / a manager gets the read-only user list, and can still assign approvers`,
    readOnly.approve === 0 &&
      readOnly.switches === 0 &&
      readOnly.roleOptions === 0 &&
      readOnly.approverFields > 0,
    JSON.stringify(readOnly),
  );
  await goBack(page);

  await visit('manager-approvals', async () => {
    await vis(page.getByText(/^Approvals( \(\d+\))?$/)).click();
    await vis(page.getByText('Nothing waiting for approval', { exact: false })).waitFor({
      timeout: 20000,
    });
  });
  const adminOnly = await page.getByText('All submitted').filter({ visible: true }).count();
  check(
    `${tag} / the all-submitted view stays admin-only`,
    adminOnly === 0,
    `${adminOnly} toggle(s)`,
  );

  check(
    `${tag} / manager reached every screen`,
    count() === MANAGER_SCREENS,
    `${count()}/${MANAGER_SCREENS}`,
  );
  check(`${tag} / manager raised no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/**
 * THE GATE, which is the first screen a new colleague ever sees and the one with
 * the fewest ways out — it has no navigator at all, so Sign out is the ONLY one.
 */
async function tourPending(tag, width) {
  const { ctx, page, errors } = await open(PENDING, width);
  const { visit, count } = visitor(page, tag);
  await visit('pending-gate', async () => {
    await page.getByText('waiting for an administrator', { exact: false }).waitFor({
      timeout: 45000,
    });
  });
  check(
    `${tag} / pending reached every screen`,
    count() === PENDING_SCREENS,
    `${count()}/${PENDING_SCREENS}`,
  );
  check(`${tag} / pending raised no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

/**
 * APPROVED, NOT YET AGREED: the institute's rules, which stand in front of
 * everything else. Like the gate it has no navigator, so Sign out is its only
 * way out; and nothing of Home may be on screen behind it.
 */
async function tourUnaccepted(tag, width) {
  const { ctx, page, errors } = await open(UNACCEPTED, width);
  const { visit, count } = visitor(page, tag);
  await visit('rules', async () => {
    await page.getByText('Before you continue', { exact: true }).waitFor({ timeout: 45000 });
    await vis(page.getByText('I agree', { exact: true })).waitFor({ timeout: 20000 });
  });
  const behind = await page.evaluate(() =>
    [...document.querySelectorAll('[tabindex]')]
      .filter((e) => e.getBoundingClientRect().width > 2)
      .map((e) => (e.textContent ?? '').trim())
      .filter((l) => /^(Clock in|Add hours manually|My timesheet|Report a problem)$/.test(l)),
  );
  check(`${tag} / nothing to post with behind the rules`, behind.length === 0, JSON.stringify(behind));
  check(
    `${tag} / unaccepted reached every screen`,
    count() === UNACCEPTED_SCREENS,
    `${count()}/${UNACCEPTED_SCREENS}`,
  );
  check(`${tag} / unaccepted raised no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// ---- Run --------------------------------------------------------------------
try {
  for (const width of WIDTHS) {
    const tag = `${width}px`;
    console.log(`\n▸ ${tag} (${width >= WIDE_BREAKPOINT ? 'wide' : 'narrow'})`);
    await tourAdmin(tag, width);
    await tourMember(tag, width);
    await tourManager(tag, width);
    await tourPending(tag, width);
    await tourUnaccepted(tag, width);
  }
} catch (e) {
  check('the tour completed', false, String(e).split('\n')[0].slice(0, 200));
  console.error(e);
  // What the screen was actually showing when it died.
  if (lastOpened) {
    const shot = join(SHOTS, 'FAILED.png');
    await lastOpened.screenshot({ path: shot, fullPage: true }).catch(() => {});
    const text = await lastOpened
      .evaluate(() => document.body.innerText.slice(0, 400))
      .catch(() => '(the page was already gone)');
    console.error(`\n--- the page was showing ---\n${text}\n--- and is photographed at ${shot} ---`);
  }
}

const failed = results.filter((r) => !r.ok);
const perWidth = ADMIN_SCREENS + MEMBER_SCREENS + MANAGER_SCREENS + PENDING_SCREENS + UNACCEPTED_SCREENS;
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`${SHOTS} — ${WIDTHS.length} widths x ${perWidth} screens`);
console.log('SWEEP_WIDTHS=320 runs one width, for a tight loop.');
if (raced) {
  console.log(
    `${raced} sign-in(s) reached "Still setting up your account" and took Try again: ` +
      'a database connection that delivered nothing (settle, scripts/lib/e2e-stack.mjs).',
  );
}
if (failed.length) {
  console.error(`\nFAILED: ${failed.map((f) => f.name).join('; ')}`);
  shutdown(1);
}
shutdown(0);
