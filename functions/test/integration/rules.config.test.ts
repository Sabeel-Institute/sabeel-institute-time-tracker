import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { APP_CONFIG_COLLECTION, APP_CONFIG_DOC, COLLECTIONS, EMULATOR_PROJECT_ID } from '@sabeel/shared';

/**
 * `config/app` — the oldest phone build allowed to run — is read by the app
 * BEFORE anyone signs in, so a retired build lands on the update screen on its
 * first frame rather than after a sign-in the rules then refuse. That is why
 * the read is open to a signed-out reader, which no other collection is; and
 * why nobody but the Admin SDK writes it, which is the half that keeps an open
 * read from being a hole.
 */
let testEnv: RulesTestEnvironment;

function hostPort(envName: string) {
  const value = process.env[envName];
  if (!value) throw new Error(`${envName} is unset — run via npm run test:emulator`);
  const [host, port] = value.split(':');
  return { host: host || '127.0.0.1', port: Number(port) };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      ...hostPort('FIRESTORE_EMULATOR_HOST'),
      rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), APP_CONFIG_COLLECTION, APP_CONFIG_DOC), { minVersionCode: 32 });
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

describe('config/app', () => {
  it('is readable before sign-in, and by any account', async () => {
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), APP_CONFIG_COLLECTION, APP_CONFIG_DOC)));
    await assertSucceeds(
      getDoc(doc(testEnv.authenticatedContext('mem', { role: 'member', status: 'active' }).firestore(), APP_CONFIG_COLLECTION, APP_CONFIG_DOC)),
    );
  });

  it('is written by nobody — not even an admin', async () => {
    const admin = testEnv.authenticatedContext('adm', { role: 'manager', admin: true, status: 'active' }).firestore();
    await assertFails(setDoc(doc(admin, APP_CONFIG_COLLECTION, APP_CONFIG_DOC), { minVersionCode: 1 }));
    await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), APP_CONFIG_COLLECTION, APP_CONFIG_DOC), { minVersionCode: 1 }));
  });

  it('opens no other document under config than the one the app reads', async () => {
    // The rule is `config/{doc}`, so a second document would be readable too;
    // there is none, and a write to create one is refused above. This pins
    // that the read-open collection is not the deny-all catch-all by mistake.
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), APP_CONFIG_COLLECTION, 'other')));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), COLLECTIONS.reports, 'x')));
  });
});

describe('config/timesheetReview', () => {
  const settings = { minEntryMinutes: 3, maxEntryMinutes: 480, maxDayMinutes: 720 };
  const ref = (uid: string, claims: Record<string, string | boolean>) =>
    doc(testEnv.authenticatedContext(uid, claims).firestore(), APP_CONFIG_COLLECTION, 'timesheetReview');

  it('allows active accounts to read and only admins to save', async () => {
    const admin = ref('adm', { role: 'member', admin: true, status: 'active' });
    const manager = ref('mgr', { role: 'manager', status: 'active' });
    const member = ref('mem', { role: 'member', status: 'active' });
    const pending = ref('pending', { role: 'member', status: 'pending' });
    await assertSucceeds(getDoc(member)); // absent config uses defaults
    await assertSucceeds(setDoc(admin, settings));
    await assertSucceeds(getDoc(member));
    await assertSucceeds(getDoc(manager));
    await assertFails(getDoc(pending));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), APP_CONFIG_COLLECTION, 'timesheetReview')));
    await assertFails(setDoc(manager, settings));
    await assertFails(setDoc(member, settings));
  });

  it('rejects invalid, incomplete, and unrelated settings', async () => {
    const admin = ref('adm', { role: 'member', admin: true, status: 'active' });
    await assertFails(setDoc(admin, { ...settings, minEntryMinutes: 2.5 }));
    await assertFails(setDoc(admin, { ...settings, minEntryMinutes: 481 }));
    await assertFails(setDoc(admin, { ...settings, maxDayMinutes: 1501 }));
    await assertFails(setDoc(admin, { minEntryMinutes: 3, maxEntryMinutes: 480 }));
    await assertFails(setDoc(admin, { ...settings, extra: true }));
    await assertSucceeds(setDoc(admin, { ...settings, maxEntryMinutes: 600 }));
  });
});
