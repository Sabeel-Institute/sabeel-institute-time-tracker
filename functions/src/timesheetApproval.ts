import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  APP_CONFIG_COLLECTION,
  COLLECTIONS,
  DEFAULT_REVIEW_LIMITS,
  isDayKey,
  periodRangeFor,
  reviewEntryRange,
  TIMESHEET_REVIEW_CONFIG_DOC,
  timesheetEntriesVersion,
  timesheetReviewEntries,
  timesheetReviewVersion,
  timesheetRevision,
  WEEK_CHANGED,
  type ApprovalRequest,
  type ReviewLimits,
  type TimeEntryDoc,
  type TimesheetDoc,
  type UserDoc,
} from '@sabeel/shared';
import { requireManagerOrAdmin, roleOf } from './auth';
import { guarded, sentryDsn } from './sentry';

function approvalInput(value: unknown): ApprovalRequest {
  const data = value as Partial<ApprovalRequest> | null;
  if (typeof data?.uid !== 'string' || !data.uid || data.uid.includes('/')
      || !isDayKey(data.periodKey) || typeof data.sheetVersion !== 'string'
      || typeof data.entriesVersion !== 'string' || typeof data.reviewVersion !== 'string') {
    throw new HttpsError('invalid-argument', 'The timesheet and its reviewed version are required.');
  }
  const { uid, periodKey, sheetVersion, entriesVersion, reviewVersion } = data;
  return { uid, periodKey, sheetVersion, entriesVersion, reviewVersion };
}

function changed(): never {
  throw new HttpsError('failed-precondition', WEEK_CHANGED);
}

/** Verify what was reviewed and seal the exact rows in one commit. */
export async function approveReviewed(
  input: ApprovalRequest,
  reviewerUid: string,
  role: 'admin' | 'manager' | 'member',
) {
  const db = getFirestore();
  const period = periodRangeFor(input.periodKey);
  if (period.fromKey !== input.periodKey) throw new HttpsError('invalid-argument', 'Invalid timesheet period.');
  const sheetRef = db.collection(COLLECTIONS.timesheets).doc(input.uid + '_' + period.fromKey);
  const personRef = db.collection(COLLECTIONS.users).doc(reviewerUid);
  const range = reviewEntryRange(period);
  return db.runTransaction(async (tx) => {
    const [sheetSnap, personSnap] = await tx.getAll(sheetRef, personRef);
    const sheet = sheetSnap.data() as TimesheetDoc | undefined;
    const person = personSnap.data() as UserDoc | undefined;
    const admin = role === 'admin' && person?.admin === true;
    const manager = role !== 'member' && person?.role === 'manager';
    if (person?.status !== 'active' || (!admin && !manager)
        || (sheet && !admin && sheet.approverUid !== reviewerUid)) {
      throw new HttpsError('permission-denied', 'You are no longer able to approve this timesheet.');
    }
    if (!sheet || sheet.uid !== input.uid || sheet.status !== 'submitted'
        || timesheetRevision(sheet) !== input.sheetVersion) changed();

    const nearby = (await tx.get(db.collection(COLLECTIONS.timeEntries)
      .where('uid', '==', input.uid)
      .where('dayKey', '>=', range.fromKey)
      .where('dayKey', '<=', range.toKey))).docs.map((doc) => ({
      ...doc.data() as TimeEntryDoc, id: doc.id,
    }));
    const hasClosed = nearby.some((entry) => entry.end !== null
      && entry.dayKey >= period.fromKey && entry.dayKey <= period.toKey);
    const savedLimits = hasClosed
      ? (await tx.get(db.collection(APP_CONFIG_COLLECTION).doc(TIMESHEET_REVIEW_CONFIG_DOC))).data() as ReviewLimits | undefined
      : undefined;
    const { entries, conflicts, review, hasRunning } = timesheetReviewEntries(nearby, period, savedLimits ?? DEFAULT_REVIEW_LIMITS);
    if (timesheetEntriesVersion(entries) !== input.entriesVersion
        || timesheetReviewVersion(review) !== input.reviewVersion) changed();
    if (conflicts.size > 0) throw new HttpsError('failed-precondition', 'Fix overlapping entries before approving.');
    if (hasRunning) throw new HttpsError('failed-precondition', 'This week still has a running timer.');

    const now = Date.now();
    tx.update(sheetRef, {
      status: 'approved',
      toKey: period.toKey,
      decidedAt: now,
      decidedBy: reviewerUid,
      updatedAt: now,
      entryCount: entries.length,
      totalMinutes: entries.reduce((sum, entry) => sum + (entry.durationMinutes ?? 0), 0),
      ...(review ? { approvalReview: { ...review, at: now } } : {}),
    });
  });
}

export const approveReviewedTimesheet = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => {
    const reviewerUid = requireManagerOrAdmin(req);
    await approveReviewed(approvalInput(req.data), reviewerUid, roleOf(req));
    return {};
  }),
);
