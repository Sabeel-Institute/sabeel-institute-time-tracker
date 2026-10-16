#!/usr/bin/env node
/**
 * Is the push SEND PATH reachable and authorised against the real project?
 *
 *     node scripts/check-push.mjs        (also `npm run check:push`)
 *
 * There is no FCM or APNs emulator, so the tests stand in for both senders and
 * `functions/src/messaging.ts` meets the real services only in production. The
 * signature failure of push is that every visible part works while nothing is
 * delivered, so this asks each service the one question answerable without a
 * device: will you accept a message from us? Each probe sends to a token that
 * cannot exist, and the right refusal proves the request was authenticated as
 * this project and this app.
 *
 *  1. **FCM** (Android and browsers): answers `registration-token-not-registered`
 *     only once it has accepted our credentials. The code is checked against
 *     the codes `messaging.ts` prunes on, read out of that file, so a pruner
 *     that stopped matching what FCM really says fails here.
 *  2. **Apple** (iPhones), production service: answers `BadDeviceToken` only
 *     after accepting the provider token, so the key, its id, the team id and
 *     the topic were all right. The key is Secret Manager's APNS_KEY (via
 *     gcloud, never printed), or the file at APNS_KEY_FILE.
 *
 * With CHECK_ACCESS_TOKEN set, FCM authenticates as that user token
 * (`gcloud auth print-access-token --account=<owner>`) rather than Application
 * Default Credentials. Reads and writes nothing; reaches no real device.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { FIREBASE_PROJECT_ID as projectId } from '@sabeel/shared';
import { sendToApns } from '../functions/src/apns.ts';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const ROOT = new URL('..', import.meta.url);
let failed = false;
console.log(`Push send path against ${projectId}\n`);

// ---------------------------------------------------------------- FCM
const admin = require('firebase-admin');
const accessToken = process.env.CHECK_ACCESS_TOKEN;
admin.initializeApp({
  projectId,
  ...(accessToken
    ? { credential: { getAccessToken: async () => ({ access_token: accessToken, expires_in: 3000 }) } }
    : {}),
});
const messagingSrc = readFileSync(new URL('functions/src/messaging.ts', ROOT), 'utf8');
const deadCodes = [
  ...(messagingSrc.match(/const DEAD_TOKEN_CODES = new Set\(\[([\s\S]*?)\]\)/)?.[1].matchAll(/'([^']+)'/g) ?? []),
].map((m) => m[1]);
let fcmCode;
try {
  const res = await admin.messaging().sendEachForMulticast({
    tokens: ['dGhpcy1pcy1ub3QtYS10b2tlbg:APA91bHnotarealtokennotarealtokennotareal'],
    notification: { title: 'reachability probe', body: 'never delivered to anyone' },
  });
  fcmCode = res.responses[0].error?.code;
} catch (e) {
  fcmCode = `threw: ${e.message}`;
}
if (deadCodes.length === 0) {
  failed = true;
  console.log('  FAIL  DEAD_TOKEN_CODES is no longer readable from functions/src/messaging.ts');
} else if (deadCodes.includes(fcmCode)) {
  console.log(`  ok    FCM accepted our credentials and refused the bogus token as ${fcmCode},`);
  console.log('        a code the sender prunes on');
} else {
  failed = true;
  console.log(`  FAIL  unexpected answer from FCM: ${fcmCode ?? 'the bogus token was ACCEPTED'}`);
  console.log('        an auth or permission code means Cloud Messaging is off, or these');
  console.log('        credentials are not this project (try CHECK_ACCESS_TOKEN)');
}

// ---------------------------------------------------------------- Apple
const params = Object.fromEntries(
  readFileSync(new URL(`functions/.env.${projectId}`, ROOT), 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
let appleKey = '';
try {
  appleKey = process.env.APNS_KEY_FILE
    ? readFileSync(process.env.APNS_KEY_FILE, 'utf8')
    : execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret=APNS_KEY', `--project=${projectId}`], {
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
} catch {
  appleKey = '';
}
if (!appleKey) {
  failed = true;
  console.log('  FAIL  no APNS_KEY (Secret Manager via gcloud, or APNS_KEY_FILE): iPhones would hear nothing');
} else {
  const probe = 'ab'.repeat(32);
  const apple = await sendToApns(
    [{ token: probe, apnsEnvironment: 'production' }],
    { title: 'reachability probe', body: 'never delivered to anyone', route: null },
    { key: appleKey, keyId: params.APNS_KEY_ID, teamId: params.APPLE_TEAM_ID },
  );
  if (apple.dead.includes(probe)) {
    console.log(`  ok    Apple accepted key ${params.APNS_KEY_ID} for team ${params.APPLE_TEAM_ID} and this app,`);
    console.log('        and refused the bogus token as one the sender prunes on');
  } else {
    failed = true;
    console.log(`  FAIL  unexpected answer from Apple: ${apple.failed[0]?.reason ?? 'the bogus token was ACCEPTED'}`);
    console.log('        InvalidProviderToken: the key, its id or the team id is wrong;');
    console.log('        TopicDisallowed or BadTopic: the key is not for this app');
  }
}

console.log(failed ? '\nthe send path is NOT ready' : '\nthe send path is ready; a banner appearing is still a device check');
process.exit(failed ? 1 : 0);
