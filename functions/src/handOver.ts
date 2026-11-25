import { getFirestore, type Transaction } from 'firebase-admin/firestore';
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
  /** Weeks passed to `to`, as they were before, oldest first. */
  moved: Week[];
  /** With nobody to go to: weeks whose holder may no longer approve them. */
  stuck: Week[];
};

/**
 * A waiting week belongs with the person's approver as they stand now. Moves
 * each submitted week of `uid` to currentApprover, stamping when the new
 * holder got it; leaves every week alone when that is nobody (the week stays
 * with whoever had it, and the app asks for a new approver).
 *
 * Reads the profiles at commit time rather than trusting the event that woke
 * it, so events delivered late, twice or out of order all end in the latest
 * choice. Approved and rejected weeks are never touched: a rejected week goes
 * to the current approver when it is resubmitted. `apply: false` only reports.
 */
export async function handOverWaitingWeeks(
  uid: string,
  { now = Date.now(), apply = true }: { now?: number; apply?: boolean } = {},
): Promise<HandOver> {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const owner = (await tx.get(db.collection(COLLECTIONS.users).doc(uid))).data() as UserDoc | undefined;
    const to = owner ? await currentApprover(tx, uid, owner) : null;
    const waiting = (await tx.get(db.collection(COLLECTIONS.timesheets)
      .where('uid', '==', uid).where('status', '==', 'submitted'))).docs
      .map((doc) => {
        const { periodKey, toKey, approverUid } = doc.data() as TimesheetDoc;
        return { ref: doc.ref, week: { id: doc.id, periodKey, toKey, approverUid } };
      })
      .sort((a, b) => a.week.periodKey.localeCompare(b.week.periodKey));
    if (to !== null) {
      const moving = waiting.filter((w) => w.week.approverUid !== to);
      if (apply) for (const w of moving) tx.update(w.ref, { approverUid: to, heldSince: now, updatedAt: now });
      return { to, moved: moving.map((w) => w.week), stuck: [] };
    }
    const holders = [...new Set(waiting.map((w) => w.week.approverUid))];
    const able = new Set<string>();
    for (const holder of holders) {
      const profile = holder === uid ? owner : (await tx.get(db.collection(COLLECTIONS.users).doc(holder))).data() as UserDoc | undefined;
      if (canApproveTimesheets(profile)) able.add(holder);
    }
    return { to, moved: [], stuck: waiting.filter((w) => !able.has(w.week.approverUid)).map((w) => w.week) };
  });
}
