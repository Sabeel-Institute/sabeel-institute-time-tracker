import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { canApproveTimesheets, COLLECTIONS, type TimesheetDoc, type UserDoc } from '@sabeel/shared';
import { handOverWaitingWeeks, type HandOver } from './handOver';
import { prefOn, texts, type Notif } from './notifyCore';
import { PUSH_SECRETS } from './messaging';
import { sendToUser } from './notify';
import { reportError, sentryDsn } from './sentry';

/**
 * The fields currentApprover reads from a person's own profile: their choice,
 * and what makes them able to approve (for an admin who chose nobody).
 */
function handoffInputs(user: UserDoc | undefined): string {
  return JSON.stringify([user?.approverUid ?? null, user?.admin === true, user?.role ?? null, user?.status ?? null]);
}

type Push = { to: string; notif: Notif };

async function noticesFor(uid: string, result: HandOver): Promise<Push[]> {
  const users = getFirestore().collection(COLLECTIONS.users);
  const profile = async (id: string) => (await users.doc(id).get()).data() as UserDoc | undefined;
  const range = (week: { periodKey: string; toKey: string }) => ({ fromKey: week.periodKey, toKey: week.toKey });
  const pushes: Push[] = [];
  if (result.moved.length > 0 && result.to !== null && result.to !== uid) {
    const [owner, approver] = await Promise.all([profile(uid), profile(result.to)]);
    if (approver && prefOn(approver.notifPrefs, 'submitted')) {
      pushes.push({ to: result.to, notif: texts.handedOver(uid, owner?.displayName ?? uid, range(result.moved[0]), result.moved.length) });
    }
  }
  // A week nobody can approve is the person's to fix: told once, when it becomes so.
  // Not an admin whose choice is merely on its way to being cleared (the
  // cleanup runs after the role change): their weeks are about to come to them.
  if (result.newlyStuck.length > 0) {
    const owner = await profile(uid);
    if (owner && prefOn(owner.notifPrefs, 'rejected') && !(owner.admin && owner.approverUid !== null)) {
      const own = result.newlyStuck.every((week) => week.approverUid === uid);
      pushes.push({ to: uid, notif: texts.needsApprover(range(result.newlyStuck[0]), result.newlyStuck.length, own) });
    }
  }
  return pushes;
}

/**
 * What a profile change does to waiting weeks, and the pushes it calls for.
 * The person's own choice, or their own ability to approve when they are
 * their own approver, decides where their weeks go. A change in whether they
 * may approve also decides it for everyone who chose them (normally cleared
 * when they lose the role, but a choice left pointing at them waits for them
 * to be able again) and for everyone whose weeks they have (stuck once they
 * lose it). `now` is the event's time, the same on every retry of it.
 */
export async function followProfileChange(
  uid: string,
  before: UserDoc | undefined,
  after: UserDoc | undefined,
  now: number,
): Promise<Push[]> {
  const owners = new Set<string>();
  if (handoffInputs(before) !== handoffInputs(after)) owners.add(uid);
  if (canApproveTimesheets(before) !== canApproveTimesheets(after)) {
    const db = getFirestore();
    const [choosers, holding] = await Promise.all([
      db.collection(COLLECTIONS.users).where('approverUid', '==', uid).get(),
      db.collection(COLLECTIONS.timesheets).where('approverUid', '==', uid).where('status', '==', 'submitted').get(),
    ]);
    for (const doc of choosers.docs) owners.add(doc.id);
    for (const doc of holding.docs) owners.add((doc.data() as TimesheetDoc).uid);
  }
  const pushes: Push[] = [];
  for (const owner of [...owners].sort()) pushes.push(...await noticesFor(owner, await handOverWaitingWeeks(owner, { now })));
  return pushes;
}

/**
 * Every way an approver changes (the person, a manager or admin, or the
 * cleanup when an approver loses the role) writes a profile, so this one
 * trigger keeps waiting weeks with the current approver whichever way it came.
 * Retried on failure: the hand-over is safe to repeat, and a retry rebuilds
 * the pushes its earlier attempts committed but did not send, from the
 * event's time stamped on the weeks. A push that fails to send is reported,
 * not retried. (A second delivery of the same event can repeat a push.)
 */
export const handOverTimesheets = onDocumentUpdated(
  { document: 'users/{uid}', secrets: [sentryDsn, ...PUSH_SECRETS], retry: true },
  async (event) => {
    const before = event.data?.before.data() as UserDoc | undefined;
    const after = event.data?.after.data() as UserDoc | undefined;
    let pushes: Push[];
    try {
      pushes = await followProfileChange(event.params.uid, before, after, Date.parse(event.time));
    } catch (e) {
      await reportError(e);
      throw e;
    }
    for (const { to, notif } of pushes) {
      try {
        await sendToUser(to, notif);
      } catch (e) {
        await reportError(e);
      }
    }
  },
);
