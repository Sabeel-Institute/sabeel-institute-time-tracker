#!/usr/bin/env node
// EVERY KIND OF NOTIFICATION, TAPPED ON THE WEB, OPENS ITS ROUTE.
//
//   node scripts/push-e2e.mjs            (from the repo root)
//
// The real service worker (app/public/firebase-messaging-sw.js, from the
// exported bundle) in Chromium: for each notification the server builds
// (`texts` in functions/src/notifyCore.ts), a push in FCM's own JSON shape is
// DELIVERED to the worker (DevTools' `ServiceWorker.deliverPushMessage`, which
// runs the worker's real `push` handler), the banner it draws is read back with
// its data, and a `notificationclick` is dispatched on THAT notification inside
// the worker. The app must then land on the route's screen. A real person's
// click is the one step this does not make: no browser lets a script click its
// notification tray.
//
// Both ends of a click are covered: with the app open (the worker posts the
// open tab the route) and with no tab open, where the worker opens a new one at
// `subjectUrl` — computed by the worker's own function and loaded here, since a
// script may not open a window from a click it dispatched itself.
//
// It also holds the web to having no minimum-version floor: with the floor
// raised past this build, the web app still runs (`useMinVersion`).
//
// Full Chromium, not the headless shell: the shell refuses notification
// permission, so the worker could draw nothing.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { encodeNotifRoute, periodLabel, periodRangeFor } from '@sabeel/shared';
import {
  ROOT as root,
  EMULATOR_HOSTS,
  PROJECT,
  buildWebBundle,
  devSignIn,
  grantAdmin,
  serveWebBundle,
  settle,
  shutdown as cleanup,
  startEmulators,
} from './lib/e2e-stack.mjs';

const shots = process.env.E2E_SHOTS_DIR ?? join(root, 'shots');
mkdirSync(shots, { recursive: true });
process.on('SIGINT', () => cleanup(130));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
/** On screen: the stack keeps the screen underneath mounted but hidden (see web-e2e.mjs). */
const onScreen = (locator, timeout = 20000) =>
  locator.filter({ visible: true }).first().waitFor({ timeout }).then(() => true, () => false);
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function main() {
  console.log('▸ building functions and web bundle (emulator mode)…');
  buildWebBundle();
  console.log('▸ starting Firebase emulators…');
  await startEmulators({ logPath: join(shots, 'emulator-push.log') });
  const { baseUrl } = await serveWebBundle();
  const origin = new URL(baseUrl).origin;

  // Chromium's own notification centre, not the desktop's: with a notification
  // daemon on the machine's session bus, Chromium hands banners to it and drops
  // them from `getNotifications()` when the daemon closes them, so the banner
  // this suite reads back can be gone before it looks.
  const browser = await chromium.launch({ channel: 'chromium', args: ['--no-sandbox', '--disable-features=NativeNotifications,SystemNotifications'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.grantPermissions(['notifications'], { origin });
  const page = await context.newPage();

  // ---- an admin, signed in ------------------------------------------------
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await devSignIn(page, 'admin@oursabeel.com');
  await settle(page, page.getByText('waiting for an administrator', { exact: false }));
  grantAdmin('admin@oursabeel.com');
  await page.getByText('Before you continue', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText('I agree', { exact: true }).click();
  await page.getByText('Salaam,', { exact: false }).waitFor({ timeout: 30000 });

  // ---- the seed: a colleague waiting, and one whose week is to be decided --
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOSTS.firestore;
  initializeApp({ projectId: PROJECT });
  const db = getFirestore();
  const profile = (email, displayName, status) => ({
    displayName, email, photoURL: null, status, role: 'member', admin: false,
    activeEntryId: null, approverUid: null, createdAt: Date.now(),
  });
  const PENDING = { uid: 'push_pending', email: 'pending-push@oursabeel.com', name: 'Pending Colleague' };
  const MEMBER = { uid: 'push_member', email: 'member-push@oursabeel.com', name: 'Week To Decide' };
  await db.doc(`users/${PENDING.uid}`).set(profile(PENDING.email, PENDING.name, 'pending'));
  await db.doc(`users/${MEMBER.uid}`).set(profile(MEMBER.email, MEMBER.name, 'active'));

  // Weeks that are not this one, so landing on the right week is seen, not assumed.
  const reviewWeek = periodRangeFor('2026-09-08');
  const ownWeek = periodRangeFor('2026-08-12');
  /** One per notification the server builds (notifyCore.ts `texts`), each with the screen its tap must open. */
  const cases = [
    {
      kind: 'newUser',
      notification: { title: 'New account request', body: `${PENDING.name} (${PENDING.email}) is waiting for approval.` },
      route: { screen: 'Users' },
      landed: (p) => onScreen(p.getByText(PENDING.email, { exact: true })),
    },
    ...['submitted', 'resubmitted'].map((kind) => ({
      kind,
      notification: { title: kind === 'submitted' ? 'Timesheet submitted' : 'Timesheet resubmitted', body: `${MEMBER.name} · ${periodLabel(reviewWeek)}` },
      route: { screen: 'TimesheetReview', uid: MEMBER.uid, displayName: MEMBER.name, periodKey: reviewWeek.fromKey },
      landed: async (p) => (await onScreen(p.getByText(MEMBER.name, { exact: true })))
        && onScreen(p.getByText(periodLabel(reviewWeek), { exact: true }), 5000),
    })),
    ...['approved', 'rejected', 'reminder'].map((kind) => ({
      kind,
      notification: { title: `Timesheet ${kind}`, body: `For ${periodLabel(ownWeek)}.` },
      route: { screen: 'Timesheet', periodKey: ownWeek.fromKey },
      landed: async (p) => (await onScreen(p.getByText('My timesheet', { exact: true })))
        && onScreen(p.getByText(periodLabel(ownWeek), { exact: true }), 5000),
    })),
  ];

  // ---- the worker -----------------------------------------------------------
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;
  });
  /**
   * The worker of the registration at the origin root, the one the app registers
   * and pushes are delivered to. Looked up each time rather than held: the
   * browser can hold more than one worker for the same script (a second
   * registration under another scope, or a version on its way out), and a
   * handle to the wrong one reads another registration's banners.
   */
  async function worker() {
    for (const w of context.serviceWorkers()) {
      const root = await w.evaluate(() => self.registration.scope === `${self.location.origin}/`
        && self.serviceWorker?.state !== 'redundant').catch(() => false);
      if (root) return w;
    }
    throw new Error('no worker at the origin root');
  }
  const cdp = await context.newCDPSession(page);
  const registrations = new Map();
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: list }) => {
    for (const r of list) if (!r.isDeleted) registrations.set(r.scopeURL, r.registrationId);
  });
  await cdp.send('ServiceWorker.enable');
  const registrationId = await until(() => registrations.get(`${origin}/`), 10000);
  check('the worker is registered at the origin root', Boolean(registrationId));

  const shown = async () =>
    (await worker()).evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data })));
  /** Every worker the browser holds, its registration's scope and its banners: what to read when none came back. */
  async function diagnose() {
    return JSON.stringify(await Promise.all(context.serviceWorkers().map((w) => w.evaluate(async () => ({
      scope: self.registration.scope,
      state: self.serviceWorker?.state,
      banners: (await self.registration.getNotifications()).map((n) => n.title),
    })).catch((e) => e.message))));
  }
  /** Home first, so every tap has to navigate to be seen to work. */
  async function home(p) {
    await p.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    return onScreen(p.getByText('Salaam,', { exact: false }), 30000);
  }

  for (const c of cases) {
    console.log(`\n${c.kind}`);
    const data = encodeNotifRoute(c.route);
    check(`${c.kind}: the app is on Home before the tap`, await home(page));
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin, registrationId, data: JSON.stringify({ notification: c.notification, data }),
    });
    const banner = await until(async () => (await shown()).find((n) => n.body === c.notification.body && n.title === c.notification.title));
    check(`${c.kind}: the push is shown, with its words and its route`,
      Boolean(banner) && JSON.stringify(banner.data) === JSON.stringify(data), banner ? JSON.stringify(banner) : await diagnose());
    await (await worker()).evaluate(async ({ title, body }) => {
      const n = (await self.registration.getNotifications()).find((x) => x.title === title && x.body === body);
      // eslint-disable-next-line no-undef -- runs in the worker, where it is a global
      if (n) self.dispatchEvent(new NotificationEvent('notificationclick', { notification: n }));
    }, c.notification);
    check(`${c.kind}: tapping it opens its route in the open tab`, await c.landed(page));
    check(`${c.kind}: the tapped notification is closed`,
      await until(async () => !(await shown()).some((n) => n.body === c.notification.body && n.title === c.notification.title)));

    // eslint-disable-next-line no-undef -- the worker's own function, run in the worker
    const url = await (await worker()).evaluate((d) => subjectUrl(d), data);
    const fresh = await context.newPage();
    await fresh.goto(new URL(url, baseUrl).href, { waitUntil: 'domcontentloaded' });
    check(`${c.kind}: the address the worker opens lands on the route (${url})`, await c.landed(fresh));
    check(`${c.kind}: and the route leaves the address bar`, new URL(fresh.url()).search === '', fresh.url());
    await fresh.close();
  }

  // ---- the web has no minimum-version floor -------------------------------
  console.log('\nminimum version');
  await db.doc('config/app').set({ minVersionCode: 999999999 });
  check('with the floor raised past this build, the web app still runs',
    (await home(page)) && (await page.getByText('Update needed').count()) === 0);
  await db.doc('config/app').delete();

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const f of failed) console.log(`FAILED: ${f.name}`);
  cleanup(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  cleanup(1);
});
