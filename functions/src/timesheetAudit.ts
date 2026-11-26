import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, recordedReviewFor, type TimesheetDoc } from '@sabeel/shared';
import { reportError, sentryDsn } from './sentry';

/**
 * Append-only history of every timesheet transition.
 *
 * A timesheet is a SINGLE mutable doc, and two of its transitions are deletes:
 * withdraw (owner, pre-approval) and reopen (admin, any state). So approving a
 * period and later reopening it left no trace at all — who approved it, when, and
 * the fact that it was undone were simply gone. For an org whose official record
 * is "approved hours", that history is the thing you most want during an audit
 * and the thing hardest to reconstruct after the fact.
 *
 * Written server-side from the document trigger rather than by the client: the
 * client could otherwise omit or forge the very events this exists to preserve.
 * Rules deny all client access (see firestore.rules /timesheetEvents).
 */

export type TimesheetEventKind =
  | 'submitted'
  | 'resubmitted'
  | 'approved'
  | 'rejected'
  | 'withdrawn'
  | 'reopened'
  | 'handedOver';

export interface TimesheetEvent {
  /** `${uid}_${periodKey}` — the timesheet this happened to. */
  sheetId: string;
  uid: string;
  periodKey: string;
  kind: TimesheetEventKind;
  /** Who caused it, when the doc records that; null for a delete or a hand-over (see below). */
  actorUid: string | null;
  at: number;
  totalMinutes: number;
  entryCount: number;
  approverUid: string | null;
  /** handedOver: who had it before. */
  fromApproverUid?: string;
  rejectReason?: string;
  review?: TimesheetDoc['submissionReview'];
}

/**
 * Classify a before/after pair. Pure so every transition is unit-testable
 * without the emulator. Returns null for writes that change nothing we track
 * (a totals refresh, an updatedAt touch).
 *
 * A delete carries no actor — Firestore triggers don't report who issued a write.
 * `withdrawn` vs `reopened` is inferred from the state it was deleted FROM:
 * only an admin can delete an approved sheet, and an owner withdrawing has by
 * definition not been approved.
 */
export function classify(
  before: TimesheetDoc | null,
  after: TimesheetDoc | null,
): { kind: TimesheetEventKind; actorUid: string | null } | null {
  if (!after) {
    if (!before) return null;
    return before.status === 'approved'
      ? { kind: 'reopened', actorUid: null }
      : { kind: 'withdrawn', actorUid: null };
  }
  if (after.status === 'submitted') {
    if (!before) return { kind: 'submitted', actorUid: after.uid };
    if (before.status === 'rejected') return { kind: 'resubmitted', actorUid: after.uid };
    // Passed to a new approver: the server moves it when the person's approver
    // changes. Who changed that is not recorded; from whom to whom is.
    if (before.status === 'submitted' && before.approverUid !== after.approverUid) {
      return { kind: 'handedOver', actorUid: null };
    }
    return null;
  }
  if (before?.status === after.status) return null;
  if (after.status === 'approved') {
    return { kind: 'approved', actorUid: after.decidedBy ?? null };
  }
  if (after.status === 'rejected') {
    return { kind: 'rejected', actorUid: after.decidedBy ?? null };
  }
  return null;
}

export const onTimesheetWritten = onDocumentWritten(
  { document: 'timesheets/{sheetId}', secrets: [sentryDsn] },
  async (event) => {
    try {
      const before = event.data?.before?.exists
        ? (event.data.before.data() as TimesheetDoc)
        : null;
      const after = event.data?.after?.exists ? (event.data.after.data() as TimesheetDoc) : null;
      const verdict = classify(before, after);
      if (!verdict) return;

      // On a delete the only surviving facts are the ones from `before`.
      const state = after ?? before;
      if (!state) return;

      const review = verdict.kind === 'approved' ? recordedReviewFor(state.approvalReview, state.decidedAt)
        : verdict.kind === 'submitted' || verdict.kind === 'resubmitted'
          ? recordedReviewFor(state.submissionReview, state.submittedAt)
          : undefined;
      const record: TimesheetEvent = {
        sheetId: event.params.sheetId,
        uid: state.uid,
        periodKey: state.periodKey,
        kind: verdict.kind,
        actorUid: verdict.actorUid,
        at: Date.now(),
        totalMinutes: state.totalMinutes,
        entryCount: state.entryCount,
        approverUid: state.approverUid ?? null,
        ...(review ? { review } : {}),
        ...(verdict.kind === 'handedOver' && before ? { fromApproverUid: before.approverUid } : {}),
        ...(state.rejectReason ? { rejectReason: state.rejectReason } : {}),
      };
      await getFirestore().collection(COLLECTIONS.timesheetEvents).add(record);
    } catch (e) {
      await reportError(e);
      throw e;
    }
  },
);
