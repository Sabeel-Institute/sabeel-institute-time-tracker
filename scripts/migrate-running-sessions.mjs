#!/usr/bin/env node
/**
 * Move clock sessions in progress to their fixed id, and drop the profile
 * pointer that used to name them (v0.33.0).
 *
 *     node scripts/migrate-running-sessions.mjs            # dry run: says what it would do
 *     node scripts/migrate-running-sessions.mjs --apply    # does it
 *     CHECK_PROJECT="$(npx sabeel-ci ports --project)" \
 *       FIRESTORE_EMULATOR_HOST="127.0.0.1:$(npx sabeel-ci ports firestore)" \
 *       node scripts/migrate-running-sessions.mjs --apply  # against the emulator
 *
 * Before v0.33.0 a session in progress was a time entry with a random id and
 * `users/{uid}.activeEntryId` pointing at it. From v0.33.0 it is the entry at
 * `runningEntryId(uid)`, and the rules refuse the pointer. For each profile
 * that still has the field, in one transaction: a running entry it names
 * moves to the fixed id (same fields), and the field is deleted. A running
 * entry nothing points at is reported, not moved: auto-close finishes it.
 *
 * Run it after the v0.33.0 rules are live and before anyone clocks in on the
 * new app; it is safe to run again.
 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, FIREBASE_PROJECT_ID, runningEntryId } from '@sabeel/shared';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply')) {
  console.error(`usage: migrate-running-sessions.mjs [--apply]  (got "${args.join(' ')}")`);
  process.exit(2);
}
const apply = args.includes('--apply');
const PROJECT_ID = process.env.CHECK_PROJECT ?? FIREBASE_PROJECT_ID;
initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const entries = db.collection(COLLECTIONS.timeEntries);

const counts = { moved: 0, pointerOnly: 0, conflict: 0 };
for (const profile of (await db.collection(COLLECTIONS.users).get()).docs) {
  if (!('activeEntryId' in profile.data())) continue;
  const uid = profile.id;
  const outcome = await db.runTransaction(async (tx) => {
    const pointer = (await tx.get(profile.ref)).data()?.activeEntryId ?? null;
    const target = runningEntryId(uid);
    const [named, fixed] = typeof pointer === 'string' && pointer.length > 0 && !pointer.includes('/')
      ? await tx.getAll(entries.doc(pointer), entries.doc(target))
      : [null, await tx.get(entries.doc(target))];
    const session = named?.exists ? named.data() : undefined;
    let result = 'pointerOnly';
    if (session && session.end === null && session.uid === uid && named.id !== target) {
      if (fixed.exists) {
        result = 'conflict';
      } else {
        if (apply) {
          tx.create(entries.doc(target), session);
          tx.delete(named.ref);
        }
        result = 'moved';
      }
    }
    if (apply && result !== 'conflict') tx.update(profile.ref, { activeEntryId: FieldValue.delete() });
    return { result, pointer };
  });
  counts[outcome.result]++;
  if (outcome.result !== 'pointerOnly') console.log(`${uid}: ${outcome.result} (pointer ${outcome.pointer})`);
}

const orphans = (await entries.where('end', '==', null).get()).docs
  .filter((doc) => doc.id !== runningEntryId(doc.data().uid));
for (const doc of orphans) console.log(`unmoved running entry ${doc.id} (uid ${doc.data().uid}); auto-close will finish it`);

console.log(`${PROJECT_ID}: ${apply ? '' : '[dry run] '}moved ${counts.moved}, pointer cleared ${counts.pointerOnly}, `
  + `conflicts ${counts.conflict}, running entries left at another id ${orphans.length}`);
process.exit(counts.conflict > 0 ? 1 : 0);
