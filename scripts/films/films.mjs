/**
 * THE TIME TRACKER'S HELP FILMS, as `sabeel-ci films` reads them (ci-tools.json
 * `films.module`; ci-tools' README, "Help films"). The catalogue is the shared
 * package's `HELP_VIDEOS`, which More → Help lists; the scripts are in
 * `scripts.mjs`; the world they are filmed in is `world.mjs`.
 *
 * Filmed against the emulators and the web build the browser suites use
 * (`sabeel-ci build-web --emulators`), signed in through its dev row, which the
 * films hide. See "The help films" in docs/DEV-TOOLING.md.
 */
import { initializeApp } from 'firebase-admin/app';
import { HELP_VARIANTS, HELP_VIDEOS, helpFilmFile } from '@sabeel/shared';
import {
  EMULATOR_HOSTS,
  PROJECT,
  ROOT,
  buildWebBundle,
  serveWebBundle,
  settle,
  startEmulators,
  stopAll,
} from '../lib/e2e-stack.mjs';
import { buildWorld, makeAccounts } from './world.mjs';
import { FILMS } from './scripts.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= EMULATOR_HOSTS.firestore;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= EMULATOR_HOSTS.auth;
process.env.GCLOUD_PROJECT = PROJECT;

/** The dev row's sign-in, hidden in the film but still what signs in. */
async function devSignIn(page, email) {
  await page.getByPlaceholder('email').fill(email);
  await page.getByText('Dev: sign in', { exact: true }).evaluate((e) => e.click());
}

export default {
  catalogue: HELP_VIDEOS,
  variants: HELP_VARIANTS,
  fileName: helpFilmFile,
  films: FILMS,

  async stack() {
    buildWebBundle();
    await startEmulators({ logPath: `${ROOT}/shots/films-emulator.log` });
    const { baseUrl } = await serveWebBundle();
    initializeApp({ projectId: PROJECT });
    await makeAccounts();
    return { web: `${baseUrl}/`, stop: async () => stopAll() };
  },

  world: buildWorld,

  /** Signed in as the film needs, on a page of its own whose video is discarded. */
  async signIn(context, email, web) {
    const page = await context.newPage();
    await page.goto(web, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('email').waitFor({ state: 'attached', timeout: 60000 });
    await devSignIn(page, email);
    await settle(page, page.getByTestId('tab-more').filter({ visible: true }).first());
    // The push nudge is once per account on each device; answered here, it is
    // not in the film. Only the notifications film lets the browser ask.
    const notNow = page.getByText('Not now', { exact: true }).filter({ visible: true }).first();
    await notNow.waitFor({ timeout: 4000 }).then(() => notNow.click(), () => {});
    await page.close();
  },

  /** The screen a film starts on: a signed-in screen's tabs, or the sign-in screen. */
  ready: (page, film) =>
    (film.as ? page.getByTestId('tab-more') : page.getByText('Sign in with Google', { exact: true }))
      .filter({ visible: true })
      .first(),

  /** The Time Tracker's own moves, for a script's `do(t)`. */
  helpers: (page) => {
    const visible = (loc) => loc.filter({ visible: true }).first();
    return {
      /** A tab, in the bar or the rail, by its key: today, timesheet, approvals, reports, more. */
      tabOf: (key) => visible(page.getByTestId(`tab-${key}`)),
      /** A row in the More sheet. */
      moreRow: (label) => visible(page.getByRole('dialog').getByText(label, { exact: true })),
      /** A row in a picker or sheet, by its words. */
      inSheet: (text) => visible(page.getByRole('dialog').getByText(text, { exact: true })),
      /** An entry's row, by its activity: rows are named "<activity>, <times>. Edit this entry." */
      entryRow: (activity) => visible(page.getByRole('button', { name: new RegExp(`^${activity}, `) })),
      /** The dev row's sign-in, for the film that shows signing up. */
      devSignIn: (email) => devSignIn(page, email),
    };
  },

  hide: ['[data-testid="dev-sign-in"]'],
  // "v0.31.0 · 4f716ed" on the sign-in screen and at the foot of More.
  buildStamp: /v\d+\.\d+\.\d+ · \S+$/,
};
