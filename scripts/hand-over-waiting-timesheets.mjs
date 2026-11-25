#!/usr/bin/env node
/**
 * Pass every week waiting for approval to its person's current approver, once
 * (v0.34.0).
 *
 *     node scripts/hand-over-waiting-timesheets.mjs            # dry run: counts what would move
 *     node scripts/hand-over-waiting-timesheets.mjs --apply    # moves them
 *     CHECK_PROJECT="$(npx sabeel-ci ports --project)" \
 *       FIRESTORE_EMULATOR_HOST="127.0.0.1:$(npx sabeel-ci ports firestore)" \
 *       node scripts/hand-over-waiting-timesheets.mjs --apply  # against the emulator
 *
 * From v0.34.0 the handOverTimesheets trigger moves a person's waiting weeks
 * whenever their approver changes. Weeks whose approver changed before that
 * are still with the old one; this moves them with the trigger's own code
 * (functions/src/handOver.ts, bundled here from source with
 * packages/shared/src), so a week moves exactly when the trigger would have
 * moved it. It sends no push: the weeks it moves have waited a while already.
 * The dry run lists every week it would move, from whom to whom, and every
 * week nobody can approve.
 *
 * Run it after the v0.34.0 functions are deployed and before the v0.34.0 web
 * app, which shows an old mismatched week as "Passing to …" until it moves.
 * It is safe to run again.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { COLLECTIONS, FIREBASE_PROJECT_ID } from '@sabeel/shared';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply')) {
  console.error(`usage: hand-over-waiting-timesheets.mjs [--apply]  (got "${args.join(' ')}")`);
  process.exit(2);
}
const apply = args.includes('--apply');

// The module as the functions bundle has it: @sabeel/shared inlined (from its
// source, not a lib/ that may be stale), npm packages required from this repo,
// so firebase-admin is the one initialised here.
const require = createRequire(import.meta.url);
const sharedSource = fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url));
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../functions/src/handOver.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
  plugins: [{
    name: 'externalize-npm-deps',
    setup(b) {
      b.onResolve({ filter: /^@sabeel\/shared$/ }, () => ({ path: sharedSource }));
      b.onResolve({ filter: /^[^./]/ }, (a) => (a.path.startsWith('@sabeel/') ? null : { path: a.path, external: true }));
    },
  }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports);
const { handOverWaitingWeeks } = module.exports;

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const PROJECT_ID = process.env.CHECK_PROJECT ?? FIREBASE_PROJECT_ID;
initializeApp({ projectId: PROJECT_ID });

const waiting = await getFirestore().collection(COLLECTIONS.timesheets).where('status', '==', 'submitted').get();
const owners = [...new Set(waiting.docs.map((doc) => doc.data().uid))].sort();
let moved = 0;
let stuck = 0;
for (const uid of owners) {
  const result = await handOverWaitingWeeks(uid, { apply });
  for (const week of result.moved) console.log(`${week.id}: ${apply ? 'moved' : 'would move'} from ${week.approverUid} to ${result.to}`);
  for (const week of result.stuck) console.log(`${week.id}: nobody can approve it (with ${week.approverUid}, and no one who can approve is chosen)`);
  moved += result.moved.length;
  stuck += result.stuck.length;
}
console.log(`${PROJECT_ID}: ${apply ? '' : '[dry run] '}${waiting.size} waiting week(s) of ${owners.length} people; `
  + `${apply ? 'moved' : 'would move'} ${moved}; nobody can approve ${stuck}`);
process.exit(0);
