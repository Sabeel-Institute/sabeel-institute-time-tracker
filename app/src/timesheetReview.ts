import { useLayoutEffect, useMemo, useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import {
  addDays,
  APP_CONFIG_COLLECTION,
  DEFAULT_REVIEW_LIMITS,
  overlappingEntryIds,
  reviewTimesheet,
  TIMESHEET_REVIEW_CONFIG_DOC,
  validReviewLimits,
  type ReviewLimits,
  type ReviewSnapshot,
} from '@sabeel/shared';
import { useEntriesRange } from './entries';
import { db } from './firebase';
import { useLiveDoc } from './liveQuery';

const limitsRef = () => doc(db, APP_CONFIG_COLLECTION, TIMESHEET_REVIEW_CONFIG_DOC);

export function useReviewLimits(): ReviewLimits | undefined {
  return useLiveDoc<ReviewLimits | undefined>(limitsRef, [], {
    label: 'useReviewLimits',
    map: (snap) => snap.exists() ? snap.data() as ReviewLimits : DEFAULT_REVIEW_LIMITS,
    empty: undefined,
  });
}

export function saveReviewLimits(changes: Partial<ReviewLimits>): Promise<void> {
  const ref = limitsRef();
  return runTransaction(db, async (tx) => {
    const saved = (await tx.get(ref)).data() as ReviewLimits | undefined;
    const limits = { ...(saved ?? DEFAULT_REVIEW_LIMITS), ...changes };
    if (!validReviewLimits(limits)) {
      throw new Error('The thresholds changed while you were editing. Check the new values and try again.');
    }
    tx.set(ref, limits);
  });
}

export function useTimesheetReview(uid: string, fromKey: string, toKey: string) {
  // Account for entries in other periods that overlap or contribute to an
  // overnight total. Zone offsets can differ by up to 26 hours, and an
  // entry may span 24 hours, so include three start dates on either side.
  const nearby = useEntriesRange(uid, addDays(fromKey, -3), addDays(toKey, 3), true);
  const limits = useReviewLimits();
  return useMemo(() => {
    const entries = (nearby ?? []).filter((e) => e.dayKey >= fromKey && e.dayKey <= toKey);
    const needsReview = entries.some((entry) => entry.end !== null);
    const overlaps = needsReview ? overlappingEntryIds(nearby ?? []) : new Set<string>();
    return {
      loaded: nearby !== undefined,
      needsReview,
      entries,
      conflicts: new Set(entries.filter((e) => overlaps.has(e.id)).map((e) => e.id)),
      review: needsReview && nearby && limits ? reviewTimesheet(limits, nearby, { fromKey, toKey }) : undefined,
    };
  }, [nearby, fromKey, toKey, limits]);
}

/** The confirmation is for the version on screen when it opened. */
export function useReviewConfirmation(
  target: string,
  review: ReviewSnapshot | undefined,
  onInvalidated: (message: string) => void,
) {
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const version = JSON.stringify([target, review]);
  const stale = openedFor !== null && openedFor !== version;
  useLayoutEffect(() => {
    if (stale) {
      setOpenedFor(null);
      onInvalidated('This review changed. Check the updated timesheet and try again.');
    }
  }, [stale, onInvalidated]);
  return {
    visible: openedFor === version,
    open: () => setOpenedFor(version),
    close: () => setOpenedFor(null),
  };
}
