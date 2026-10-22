#!/usr/bin/env node
// The account the native flows sign in as (`sabeel-ci native-e2e`, which runs
// this as ci-tools.json's native.seed once the emulators are up): an admin
// who has NOT accepted the institute's rules, so the flows meet that screen.
// It is the address the dev sign-in row is filled with, so a flow signs in
// with one tap and never edits that field.
//
// Made the way the app's dev sign-in row makes one — the Auth emulator accepts
// an unsigned Google id token, the same payload `devSignInAsGoogle` sends — so
// `onUserCreate` provisions it as it would a real first sign-in. The dev row on
// a phone refuses an address with no account, which is why it is made here.
// Then the first-admin bootstrap, as an operator would run it.
import { execFileSync } from 'node:child_process';
import { config } from '@sabeel-institute/ci-tools/lib/config.mjs';
import { ports } from '@sabeel-institute/ci-tools/lib/ports.mjs';

const NATIVE_ADMIN = 'volunteer@oursabeel.com';

const settings = config(new URL('..', import.meta.url).pathname);
const { auth: authPort, firestore: firestorePort } = ports(settings);
const auth = `http://127.0.0.1:${authPort}`;
const firestore = `http://127.0.0.1:${firestorePort}/v1/projects/${settings.emulators.project}/databases/(default)/documents`;
const sub = `dev-${NATIVE_ADMIN.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
const idToken = JSON.stringify({ sub, email: NATIVE_ADMIN, email_verified: true, name: 'Native Admin' });

const response = await fetch(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
    requestUri: 'http://localhost',
    returnSecureToken: true,
  }),
});
if (!response.ok) throw new Error(`the Auth emulator refused the sign-in: ${response.status} ${await response.text()}`);
const { localId } = await response.json();

// onUserCreate writes the profile; the bootstrap needs it there first.
for (let i = 0; ; i += 1) {
  const profile = await fetch(`${firestore}/users/${localId}`, { headers: { Authorization: 'Bearer owner' } });
  if (profile.ok) break;
  if (i === 60) throw new Error('onUserCreate never wrote the profile');
  await new Promise((done) => setTimeout(done, 1000));
}
execFileSync('node', ['scripts/grant-admin.mjs', NATIVE_ADMIN], { stdio: 'inherit' });
console.log(`Seeded ${NATIVE_ADMIN}, an admin who has not yet accepted the rules`);
