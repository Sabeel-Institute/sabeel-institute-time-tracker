import { FieldValue, getFirestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  APP_CONFIG_COLLECTION,
  COLLECTIONS,
  dayKeyFor,
  DEFAULT_REVIEW_LIMITS,
  isDayKey,
  periodHasStarted,
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
  type SubmissionRequest,
  type TimeEntryDoc,
  type TimesheetDoc,
  type UserDoc,
} from '@sabeel/shared';
import { requireActive, requireManagerOrAdmin, roleOf } from './auth';
import { guarded, sentryDsn } from './sentry';

function isUid(uid: unknown): uid is string {
  return typeof uid === 'string' && uid.length > 0 && !uid.includes('/');
}

type RequestFields = Partial<Omit<ApprovalRequest, 'sheetVersion'> & SubmissionRequest>;

function commonInput(value: unknown) {
  const data = value as RequestFields | null;
  if (!isDayKey(data?.periodKey) || typeof data.entriesVersion !== 'string'
      || typeof data.reviewVersion !== 'string') {
    throw new HttpsError('invalid-argument', 'The timesheet and its reviewed version are required.');
  }
  const { periodKey, entriesVersion, reviewVersion, uid, approverUid, sheetVersion } = data;
  if (periodRangeFor(periodKey).fromKey !== periodKey) {
    throw new HttpsError('invalid-argument', 'Invalid timesheet period.');
  }
  return { periodKey, entriesVersion, reviewVersion, uid, approverUid, sheetVersion };
}

function changed(): never {
  throw new HttpsError('failed-precondition', WEEK_CHANGED);
}

/** Verify the version the person saw and calculate the snapshot from the same rows. */
async function reviewedHours(tx: Transaction, uid: string, input: ApprovalRequest | SubmissionRequest) {
  const db = getFirestore();
  const period = periodRangeFor(input.periodKey);
  const range = reviewEntryRange(period);
  const nearby = (await tx.get(db.collection(COLLECTIONS.timeEntries)
    .where('uid', '==', uid)
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
  if (conflicts.size > 0) throw new HttpsError('failed-precondition', 'Fix overlapping entries first.');
  if (hasRunning) throw new HttpsError('failed-precondition', 'This week still has a running timer.');
  return {
    review,
    snapshot: {
      toKey: period.toKey,
      entryCount: entries.length,
      totalMinutes: entries.reduce((sum, entry) => sum + (entry.durationMinutes ?? 0), 0),
    },
  };
}

export async function submitReviewed(input: SubmissionRequest, uid: string, adminClaim: boolean) {
  const db = getFirestore();
  const now = Date.now();
  // Same UTC+14 boundary as periodStarted in firestore.rules for older clients.
  if (!periodHasStarted(input.periodKey, dayKeyFor(now + 14 * 3600000, 'UTC'))) {
    throw new HttpsError('failed-precondition', 'This week has not started.');
  }
  const sheetRef = db.collection(COLLECTIONS.timesheets).doc(uid + '_' + input.periodKey);
  const ownerRef = db.collection(COLLECTIONS.users).doc(uid);
  return db.runTransaction(async (tx) => {
    const [sheetSnap, ownerSnap] = await tx.getAll(sheetRef, ownerRef);
    const sheet = sheetSnap.data() as TimesheetDoc | undefined;
    const owner = ownerSnap.data() as UserDoc | undefined;
    if (owner?.status !== 'active') throw new HttpsError('permission-denied', 'Account is not active.');
    if (input.sheetVersion === null ? sheet !== undefined
      : !sheet || sheet.uid !== uid || sheet.status !== 'rejected' || timesheetRevision(sheet) !== input.sheetVersion) {
      changed();
    }

    const selfAdmin = adminClaim && owner.admin === true && input.approverUid === uid;
    const approver = input.approverUid === uid ? owner
      : (await tx.get(db.collection(COLLECTIONS.users).doc(input.approverUid))).data() as UserDoc | undefined;
    if ((!selfAdmin && owner.approverUid !== input.approverUid)
        || approver?.status !== 'active' || (approver.role !== 'manager' && approver.admin !== true)) {
      throw new HttpsError('failed-precondition', 'Choose an active approver before submitting.');
    }

    const { review, snapshot } = await reviewedHours(tx, uid, input);
    const submitted = {
      uid, periodKey: input.periodKey, status: 'submitted' as const, approverUid: input.approverUid,
      submittedAt: now, updatedAt: now, ...snapshot,
    };
    if (sheet) {
      tx.update(sheetRef, {
        ...submitted,
        submissionReview: review ? { ...review, at: now } : FieldValue.delete(),
        decidedAt: FieldValue.delete(), decidedBy: FieldValue.delete(), rejectReason: FieldValue.delete(),
      });
    } else {
      tx.create(sheetRef, {
        ...submitted, createdAt: now,
        ...(review ? { submissionReview: { ...review, at: now } } : {}),
      });
    }
  });
}

export async function approveReviewed(
  input: ApprovalRequest,
  reviewerUid: string,
  role: 'admin' | 'manager' | 'member',
) {
  const db = getFirestore();
  const sheetRef = db.collection(COLLECTIONS.timesheets).doc(input.uid + '_' + input.periodKey);
  const personRef = db.collection(COLLECTIONS.users).doc(reviewerUid);
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

    const { review, snapshot } = await reviewedHours(tx, input.uid, input);
    const now = Date.now();
    tx.update(sheetRef, {
      ...snapshot, status: 'approved', decidedAt: now, decidedBy: reviewerUid, updatedAt: now,
      ...(review ? { approvalReview: { ...review, at: now } } : {}),
    });
  });
}

export const submitReviewedTimesheet = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => {
    const uid = requireActive(req);
    const { periodKey, approverUid, sheetVersion, entriesVersion, reviewVersion } = commonInput(req.data);
    if (!isUid(approverUid) || (sheetVersion !== null && typeof sheetVersion !== 'string')) {
      throw new HttpsError('invalid-argument', 'The approver and timesheet version are required.');
    }
    await submitReviewed({ periodKey, approverUid, sheetVersion, entriesVersion, reviewVersion }, uid, roleOf(req) === 'admin');
    return {};
  }),
);

export const approveReviewedTimesheet = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => {
    const reviewerUid = requireManagerOrAdmin(req);
    const { periodKey, uid, sheetVersion, entriesVersion, reviewVersion } = commonInput(req.data);
    if (!isUid(uid) || typeof sheetVersion !== 'string') {
      throw new HttpsError('invalid-argument', 'The member and timesheet version are required.');
    }
    await approveReviewed({ periodKey, uid, sheetVersion, entriesVersion, reviewVersion }, reviewerUid, roleOf(req));
    return {};
  }),
);
