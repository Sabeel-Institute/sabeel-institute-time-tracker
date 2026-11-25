import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { canApproveTimesheets, COLLECTIONS, type UserDoc } from '@sabeel/shared';
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

async function noticesFor(uid: string, result: HandOver, clearedChoice: boolean): Promise<Push[]> {
  const users = getFirestore().collection(COLLECTIONS.users);
  const profile = async (id: string) => (await users.doc(id).get()).data() as UserDoc | undefined;
  const pushes: Push[] = [];
  if (result.moved.length > 0 && result.to !== null && result.to !== uid) {
    const [owner, approver] = await Promise.all([profile(uid), profile(result.to)]);
    if (approver && prefOn(approver.notifPrefs, 'submitted')) {
      const week = result.moved[0];
      pushes.push({
        to: result.to,
        notif: texts.handedOver(uid, owner?.displayName ?? uid, { fromKey: week.periodKey, toKey: week.toKey }, result.moved.length),
      });
    }
  }
  // Told once, when the choice is cleared because the approver lost the role:
  // a week nobody can approve is the person's to fix.
  if (clearedChoice && result.stuck.length > 0) {
    const owner = await profile(uid);
    if (owner && prefOn(owner.notifPrefs, 'rejected')) {
      const week = result.stuck[0];
      pushes.push({ to: uid, notif: texts.needsApprover({ fromKey: week.periodKey, toKey: week.toKey }, result.stuck.length) });
    }
  }
  return pushes;
}

/**
 * What a profile change does to waiting weeks, and the pushes it calls for.
 * Two kinds of change matter. The person's own choice, or their own ability
 * to approve when they are their own approver, moves their weeks. A change
 * in whether they may approve also moves the weeks of everyone who chose
 * them: those who chose them are normally cleared when they lose the role,
 * but a choice left pointing at them waits for them to be able again.
 */
export async function followProfileChange(
  uid: string,
  before: UserDoc | undefined,
  after: UserDoc | undefined,
  now = Date.now(),
): Promise<Push[]> {
  const pushes: Push[] = [];
  if (handoffInputs(before) !== handoffInputs(after)) {
    const clearedChoice = (before?.approverUid ?? null) !== null && (after?.approverUid ?? null) === null;
    pushes.push(...await noticesFor(uid, await handOverWaitingWeeks(uid, { now }), clearedChoice));
  }
  if (canApproveTimesheets(before) !== canApproveTimesheets(after)) {
    const choosers = await getFirestore().collection(COLLECTIONS.users).where('approverUid', '==', uid).get();
    for (const doc of choosers.docs.filter((d) => d.id !== uid)) {
      pushes.push(...await noticesFor(doc.id, await handOverWaitingWeeks(doc.id, { now }), false));
    }
  }
  return pushes;
}

/**
 * Every way an approver changes (the person, a manager or admin, or the
 * cleanup when an approver loses the role) writes a profile, so this one
 * trigger keeps waiting weeks with the current approver whichever way it came.
 * Retried on failure; the hand-over is safe to repeat. A push that fails is
 * reported, not retried: the weeks have already moved.
 */
export const handOverTimesheets = onDocumentUpdated(
  { document: 'users/{uid}', secrets: [sentryDsn, ...PUSH_SECRETS], retry: true },
  async (event) => {
    const before = event.data?.before.data() as UserDoc | undefined;
    const after = event.data?.after.data() as UserDoc | undefined;
    let pushes: Push[];
    try {
      pushes = await followProfileChange(event.params.uid, before, after);
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
