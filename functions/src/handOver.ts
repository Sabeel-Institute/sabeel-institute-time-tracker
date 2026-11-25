import { FieldValue, getFirestore, type Transaction } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  approverFor,
  canApproveTimesheets,
  type TimesheetDoc,
  type UserDoc,
} from '@sabeel/shared';

// Only firebase-admin and @sabeel/shared, so scripts/hand-over-waiting-timesheets.mjs
// can bundle and run this exact code against production.

/**
 * Who `uid`'s waiting weeks belong with now: approverFor(uid, profile), when
 * that is someone who may approve; null when it is nobody. Read in `tx`, so
 * the answer holds at commit time.
 */
export async function currentApprover(tx: Transaction, uid: string, owner?: UserDoc): Promise<string | null> {
  const users = getFirestore().collection(COLLECTIONS.users);
  const profile = owner ?? (await tx.get(users.doc(uid))).data() as UserDoc | undefined;
  const target = profile ? approverFor(uid, profile) : null;
  if (target === null) return null;
  const approver = target === uid ? profile : (await tx.get(users.doc(target))).data() as UserDoc | undefined;
  return canApproveTimesheets(approver) ? target : null;
}

export type Week = { id: string; periodKey: string; toKey: string; approverUid: string };
export type HandOver = {
  /** Who the weeks belong with now, or null. */
  to: string | null;
  /** Weeks passed to `to` at `now`, with who had them before, oldest first. */
  moved: Week[];
  /** With nobody to go to: weeks whose holder may no longer approve them. */
  stuck: Week[];
  /** Those of `stuck` that became stuck at `now`: their person is told once. */
  newlyStuck: Week[];
};

/**
 * A waiting week belongs with the person's approver as they stand now. Moves
 * each submitted week of `uid` to currentApprover, stamping when the new
 * holder got it; leaves every week alone when that is nobody (the week stays
 * with whoever had it, and the app asks for a new approver), marking when it
 * became stuck.
 *
 * Reads the profiles at commit time rather than trusting the event that woke
 * it, so events delivered late, twice or out of order all end in the latest
 * choice. `now` is the event's time: a retry of the same event finds the
 * weeks its first attempt moved or marked by that stamp, so what it reports,
 * and the pushes made from that, do not depend on which attempt committed.
 * Approved and rejected weeks are never touched: a rejected week goes to the
 * current approver when it is resubmitted. `apply: false` only reports.
 */
export async function handOverWaitingWeeks(
  uid: string,
  { now = Date.now(), apply = true }: { now?: number; apply?: boolean } = {},
): Promise<HandOver> {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const users = db.collection(COLLECTIONS.users);
    const owner = (await tx.get(users.doc(uid))).data() as UserDoc | undefined;
    const to = owner ? await currentApprover(tx, uid, owner) : null;
    const waiting = (await tx.get(db.collection(COLLECTIONS.timesheets)
      .where('uid', '==', uid).where('status', '==', 'submitted'))).docs
      .map((doc) => {
        const data = doc.data() as TimesheetDoc;
        const { periodKey, toKey, approverUid } = data;
        return { ref: doc.ref, data, week: { id: doc.id, periodKey, toKey, approverUid } };
      })
      .sort((a, b) => a.week.periodKey.localeCompare(b.week.periodKey));
    const able = new Set<string>();
    if (to === null) {
      for (const holder of new Set(waiting.map((w) => w.week.approverUid))) {
        const profile = holder === uid ? owner : (await tx.get(users.doc(holder))).data() as UserDoc | undefined;
        if (canApproveTimesheets(profile)) able.add(holder);
      }
    }
    const moving = to === null ? [] : waiting.filter((w) => w.week.approverUid !== to);
    const movedEarlier = to === null ? [] : waiting.filter((w) => w.week.approverUid === to && w.data.heldSince === now);
    // Stuck only with nobody to go to: a week on its way to `to` is not.
    const stuck = to === null ? waiting.filter((w) => !able.has(w.week.approverUid)) : [];
    const newlyStuck = stuck.filter((w) => w.data.stuckSince === undefined || w.data.stuckSince === now);
    if (apply) {
      for (const w of moving) {
        tx.update(w.ref, { approverUid: to, heldSince: now, updatedAt: now, stuckSince: FieldValue.delete() });
      }
      for (const w of newlyStuck) if (w.data.stuckSince === undefined) tx.update(w.ref, { stuckSince: now });
      // Approvable again (its holder got the role back): a later episode is told anew.
      for (const w of waiting) {
        if (!moving.includes(w) && !stuck.includes(w) && w.data.stuckSince !== undefined) {
          tx.update(w.ref, { stuckSince: FieldValue.delete() });
        }
      }
    }
    const weeks = (list: typeof waiting) => list.map((w) => w.week)
      .sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    return { to, moved: weeks([...moving, ...movedEarlier]), stuck: weeks(stuck), newlyStuck: weeks(newlyStuck) };
  });
}
