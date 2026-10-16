#!/usr/bin/env node
/**
 * Send one real push to one device, as the real project.
 *
 *     node scripts/send-test-push.mjs <fcm-token> [key=value ...]
 *     node scripts/send-test-push.mjs --apple <development|production> <iphone-token> [key=value ...]
 *
 * The device check no emulator can do: there is no FCM or APNs emulator, and
 * the emulated functions send nothing (`functions/src/messaging.ts`), so "a
 * push is shown, and a tap opens its screen" is proved only by a real message
 * reaching a real device. The `key=value` pairs are the tap's route
 * (`NotifRoute` in @sabeel/shared), e.g. `screen=Timesheet periodKey=2026-10-11`;
 * left out, a tap opens the app where it was.
 *
 * The message is built by the functions' own code (`functions/src/fcm.ts`,
 * `functions/src/apns.ts`), loaded from source, so this sends exactly what a
 * notification sends.
 *
 * An iPhone's token goes to the Apple service that issued it: `development`
 * for a debug build (an Apple-silicon simulator receives these too),
 * `production` for TestFlight and the App Store. The device's row in
 * `users/{uid}/pushTokens` says which. The key is read from APNS_KEY_FILE, or
 * ~/.config/sabeel-time-tracker/AuthKey_<APNS_KEY_ID>.p8; its id and the team id
 * from functions/.env.<project>.
 *
 * FCM sends authenticate as Application Default Credentials, or as
 * CHECK_ACCESS_TOKEN when that is set (`gcloud auth print-access-token`).
 *
 * Writes nothing: no document, no notification record.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { FIREBASE_PROJECT_ID, decodeNotifRoute } from '@sabeel/shared';
import { fcmMessage } from '../functions/src/fcm.ts';
import { sendToApns } from '../functions/src/apns.ts';

const USAGE = `usage: send-test-push.mjs <fcm-token> [key=value ...]
       send-test-push.mjs --apple <development|production> <iphone-token> [key=value ...]`;

function message(pairs) {
  let route = null;
  if (pairs.length) {
    const fields = Object.fromEntries(pairs.map((p) => p.split('=')));
    route = decodeNotifRoute(fields);
    if (!route) {
      console.error(`not a route the app opens: ${pairs.join(' ')}\n${USAGE}`);
      process.exit(2);
    }
  }
  return { title: 'Test push', body: 'Sent by scripts/send-test-push.mjs. Safe to dismiss.', route };
}

const args = process.argv.slice(2);

if (args[0] === '--apple') {
  const [, environment, token, ...pairs] = args;
  if (environment !== 'development' && environment !== 'production') {
    console.error(`--apple needs the service the token came from: development or production\n${USAGE}`);
    process.exit(2);
  }
  if (!token || !/^[0-9a-f]{64,200}$/i.test(token)) {
    console.error(`an iPhone's token is hex, at least 64 characters\n${USAGE}`);
    process.exit(2);
  }
  const env = Object.fromEntries(
    readFileSync(resolve(import.meta.dirname, '..', 'functions', `.env.${FIREBASE_PROJECT_ID}`), 'utf8')
      .split('\n')
      .map((line) => /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const keyFile =
    process.env.APNS_KEY_FILE || resolve(homedir(), '.config', 'sabeel-time-tracker', `AuthKey_${env.APNS_KEY_ID}.p8`);
  let key;
  try {
    key = readFileSync(keyFile, 'utf8');
  } catch {
    console.error(`no push key at ${keyFile} (set APNS_KEY_FILE)`);
    process.exit(2);
  }
  const out = await sendToApns([{ token, apnsEnvironment: environment }], message(pairs), {
    key,
    keyId: env.APNS_KEY_ID,
    teamId: env.APPLE_TEAM_ID,
  });
  if (out.delivered.length) console.log(`accepted by Apple (${environment})`);
  else if (out.dead.length) console.log('Apple says this token will never work (the other service, another app, or the app was removed)');
  else console.log(`not delivered: ${out.failed[0]?.reason}`);
  process.exit(out.delivered.length ? 0 : 1);
}

const [token, ...pairs] = args;
if (!token || token.length < 100) {
  console.error(`an FCM token is ~150 characters\n${USAGE}`);
  process.exit(2);
}
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');
const accessToken = process.env.CHECK_ACCESS_TOKEN;
admin.initializeApp({
  projectId: FIREBASE_PROJECT_ID,
  ...(accessToken
    ? { credential: { getAccessToken: async () => ({ access_token: accessToken, expires_in: 3000 }) } }
    : {}),
});
const id = await admin.messaging().send({ token, ...fcmMessage(message(pairs)) });
console.log(`sent ${id}`);
process.exit(0);
