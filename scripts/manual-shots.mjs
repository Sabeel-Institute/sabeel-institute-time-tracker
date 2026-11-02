/**
 * THE USER MANUAL'S SCREENSHOTS (`docs/manual/img/`), taken in the help films'
 * guide world (`scripts/films/world.mjs`): made-up people and hours, never
 * anyone's real ones, on the web build at a phone's width.
 *
 *   npm run manual:shots                 every screenshot
 *   npm run manual:shots -- today review some of them, by name
 *
 * Then `npx sabeel-ci render-manual` for the PDF. Each screenshot gets a world
 * of its own, so none depends on what another did. It brings up the emulator
 * stack the films use (films.mjs `stack`), so it is HEAVY: nothing else heavy
 * beside it. A screenshot whose screen does not show what it should fails the
 * run rather than landing in the manual.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import films from './films/films.mjs';
import { PEOPLE } from './films/world.mjs';

const OUT = new URL('../docs/manual/img/', import.meta.url).pathname;
const VIEWPORT = { width: 420, height: 860 };

/** The dev sign-in row off the screen and the build stamp hidden: neither is what a person sees. */
function conceal({ hide, stamp }) {
  const install = () => {
    const style = document.createElement('style');
    style.textContent = hide.map((sel) => `${sel} { position: fixed !important; left: -10000px !important; }`).join('\n');
    document.head.appendChild(style);
    const re = new RegExp(stamp);
    const pass = () => {
      for (const el of document.querySelectorAll('div')) {
        if (el.childElementCount === 0 && re.test(el.textContent ?? '')) el.style.visibility = 'hidden';
      }
    };
    new MutationObserver(pass).observe(document.body, { childList: true, subtree: true });
    pass();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

/** The browser's notification permission, as the page reads it. */
function notificationPermission(permission) {
  try {
    Object.defineProperty(window.Notification, 'permission', { get: () => permission, configurable: true });
  } catch {
    // No Notification here: nothing reads it either.
  }
}

/** What a shot's `do` gets: the page, the world, and the moves the shots share. */
function moves(page, world) {
  const visible = (loc) => loc.filter({ visible: true }).first();
  const h = films.helpers(page);
  const m = {
    page,
    world,
    ...h,
    btn: (name) => visible(page.getByRole('button', { name, exact: typeof name === 'string' })),
    text: (text) => visible(page.getByText(text, { exact: typeof text === 'string' })),
    radio: (name) => visible(page.getByRole('radio', { name, exact: true })),
    label: (name) => visible(page.getByLabel(name, { exact: true })),
    timeBox: (n) => page.locator('input[type="time"]').filter({ visible: true }).nth(n),
    tap: async (loc) => {
      await loc.waitFor({ timeout: 20000 });
      await loc.click();
    },
    see: (loc) => loc.waitFor({ timeout: 20000 }),
    tab: (key) => m.tap(h.tabOf(key)),
    more: async (row) => {
      await m.tab('more');
      await m.tap(h.moreRow(row));
    },
    /** The scroller holding `loc` moved so that `loc` sits `top` pixels down the screen. */
    scrollTo: async (loc, top = 140) => {
      await loc.waitFor({ timeout: 20000 });
      await loc.evaluate((e, y) => {
        let s = e.parentElement;
        while (s && !(s.scrollHeight > s.clientHeight && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
        if (s) s.scrollTop += e.getBoundingClientRect().top - s.getBoundingClientRect().top - y;
      }, top);
      await page.waitForTimeout(300);
    },
  };
  return m;
}

/**
 * The screenshots, by file name. `as` is who is signed in (none: signed out);
 * `before` changes the world first; `permission` is the browser's answer on
 * notifications (headless Chromium's own is "denied"); `do` brings the screen
 * up and waits for what proves it is the right one.
 */
const SHOTS = [
  // Part 1: everyone.
  { name: 'signin', do: (s) => s.see(s.text('Sign in with Google')) },
  // A pending account has no tabs to wait for, so these two sign in on camera.
  {
    name: 'pending',
    do: async (s) => {
      await s.devSignIn(PEOPLE.layla.email);
      await s.see(s.text('Almost there'));
    },
  },
  {
    name: 'rules',
    do: async (s) => {
      await s.devSignIn(PEOPLE.layla.email);
      await s.see(s.text('Almost there'));
      await s.world.setAccess('layla', { status: 'active', role: 'member', admin: false });
      await s.see(s.btn('I agree'));
    },
  },
  {
    name: 'today',
    as: PEOPLE.sara.email,
    do: (s) => s.see(s.text('So far')),
  },
  {
    name: 'clocked-in',
    as: PEOPLE.sara.email,
    do: async (s) => {
      await s.tap(s.text('Pick an activity'));
      await s.tap(s.inSheet('Tutoring'));
      await s.tap(s.btn('Clock in'));
      await s.see(s.btn('Clock out'));
    },
  },
  {
    name: 'add-hours',
    as: PEOPLE.sara.email,
    do: async (s) => {
      await s.tap(s.btn('Add hours'));
      await s.tap(s.text('Pick an activity'));
      await s.tap(s.inSheet('Youth Mentoring'));
      await s.tap(s.radio('Yesterday'));
      await s.timeBox(0).fill('09:00');
      await s.timeBox(1).fill('17:00');
      await s.tap(s.label('What did you work on? (optional)'));
      await s.page.keyboard.type('Mentoring day at the youth centre.');
      await s.page.evaluate(() => document.activeElement?.blur());
      await s.see(s.text("That's 8h 00m"));
    },
  },
  {
    name: 'timesheet',
    as: PEOPLE.sara.email,
    do: (s) => s.tab('timesheet').then(() => s.see(s.entryRow('Tutoring'))),
  },
  {
    name: 'overlap',
    as: PEOPLE.sara.email,
    before: (w) => w.entry('sara', 'mentoring', w.dayIn(w.weeks.CURRENT, 0), '10:30', '12:00'),
    do: async (s) => {
      await s.tab('timesheet');
      await s.scrollTo(s.text('Overlaps another entry'), 220);
    },
  },
  {
    name: 'submitted',
    as: PEOPLE.yusuf.email,
    start: (w) => `timesheet?initialPeriodKey=${w.weeks.PREV.fromKey}`,
    do: (s) => s.see(s.btn('Withdraw submission')),
  },
  {
    name: 'needs-attention',
    as: PEOPLE.sara.email,
    do: async (s) => {
      await s.tap(s.text(/rejected/i));
      await s.see(s.text(/mentoring session finished at 5/));
    },
  },
  {
    name: 'rejected-week',
    as: PEOPLE.sara.email,
    start: 'needs-attention',
    do: async (s) => {
      await s.tap(s.text(/mentoring session finished at 5/));
      await s.see(s.btn('Resubmit timesheet'));
    },
  },
  {
    name: 'approved',
    as: PEOPLE.sara.email,
    start: (w) => `timesheet?initialPeriodKey=${w.weeks.PREV2.fromKey}`,
    do: (s) => s.see(s.text('Approved')),
  },
  {
    name: 'notification-settings',
    as: PEOPLE.sara.email,
    // Not yet asked, as on most devices the first time: the card offers Enable notifications.
    permission: 'default',
    do: (s) => s.more('Notifications').then(() => s.see(s.btn('Enable notifications'))),
  },
  {
    name: 'report-problem',
    as: PEOPLE.sara.email,
    do: async (s) => {
      await s.more('Report a problem');
      await s.tap(s.page.getByRole('textbox').filter({ visible: true }).first());
      await s.page.keyboard.type('A note on the food drive entry for last Saturday is not mine. Could someone look at it?');
      await s.see(s.btn('Send'));
    },
  },
  { name: 'help', as: PEOPLE.sara.email, do: (s) => s.more('Help').then(() => s.see(s.page.getByTestId('help-film-clocking'))) },
  // Part 2: managers.
  { name: 'approvals', as: PEOPLE.omar.email, do: (s) => s.tab('approvals').then(() => s.see(s.text('Yusuf Khan'))) },
  {
    name: 'review',
    as: PEOPLE.omar.email,
    do: async (s) => {
      await s.tab('approvals');
      await s.tap(s.text('Yusuf Khan'));
      await s.see(s.btn('Approve timesheet'));
    },
  },
  { name: 'activities', as: PEOPLE.omar.email, do: (s) => s.more('Activities').then(() => s.see(s.text(/^Archived/i))) },
  // All time, so the hours the world approved are counted whatever today's date.
  {
    name: 'reports',
    as: PEOPLE.omar.email,
    do: async (s) => {
      await s.tab('reports');
      await s.tap(s.radio('All time'));
      await s.see(s.text(/^By activity$/i));
    },
  },
  {
    name: 'person-detail',
    as: PEOPLE.omar.email,
    do: async (s) => {
      await s.tab('reports');
      await s.tap(s.radio('All time'));
      await s.scrollTo(s.text(/^By person$/i));
      await s.tap(s.text('Sara Malik'));
      await s.see(s.text('Lifetime hours'));
    },
  },
  // Part 3: admins.
  { name: 'people', as: PEOPLE.amina.email, do: (s) => s.more('People').then(() => s.see(s.text('Layla Hassan'))) },
  {
    name: 'person',
    as: PEOPLE.amina.email,
    do: async (s) => {
      await s.more('People');
      await s.tap(s.text('Sara Malik'));
      await s.see(s.text('Approver'));
    },
  },
];

const only = new Set(process.argv.slice(2));
for (const name of only) {
  if (!SHOTS.some((s) => s.name === name)) {
    console.error(`no screenshot is called ${name}; they are: ${SHOTS.map((s) => s.name).join(' ')}`);
    process.exit(2);
  }
}

mkdirSync(OUT, { recursive: true });
const stack = await films.stack();
const browser = await chromium.launch();
let failed = 0;
try {
  for (const shot of SHOTS) {
    if (only.size && !only.has(shot.name)) continue;
    process.stdout.write(`${shot.name} … `);
    const world = await films.world();
    if (shot.before) await shot.before(world);
    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.addInitScript(conceal, { hide: films.hide, stamp: films.buildStamp.source });
    if (shot.permission) await context.addInitScript(notificationPermission, shot.permission);
    try {
      if (shot.as) await films.signIn(context, shot.as, stack.web);
      const page = await context.newPage();
      const start = typeof shot.start === 'function' ? shot.start(world) : (shot.start ?? '');
      await page.goto(new URL(start, stack.web).href, { waitUntil: 'domcontentloaded' });
      await films.ready(page, { as: shot.as }).waitFor({ timeout: 40000 });
      await shot.do(moves(page, world));
      // Fonts, icons and the last live update in.
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}${shot.name}.png` });
      console.log('ok');
    } catch (e) {
      failed += 1;
      console.log(`FAILED: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await stack.stop();
}
process.exit(failed ? 1 : 0);
