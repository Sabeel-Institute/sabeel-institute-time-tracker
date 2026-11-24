import { useLayoutEffect, useMemo, useState } from 'react';
import { doc, runTransaction } from 'firebase/firestore';
import {
  APP_CONFIG_COLLECTION,
  DEFAULT_REVIEW_LIMITS,
  reviewEntryRange,
  timesheetReviewEntries,
  timesheetReviewVersion,
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
  const range = reviewEntryRange({ fromKey, toKey });
  const nearby = useEntriesRange(uid, range.fromKey, range.toKey, true);
  const limits = useReviewLimits();
  return useMemo(() => ({
    loaded: nearby !== undefined,
    ...timesheetReviewEntries(nearby ?? [], { fromKey, toKey }, limits),
  }), [nearby, fromKey, toKey, limits]);
}

/** The confirmation is for the version on screen when it opened. */
export function useReviewConfirmation(
  target: string,
  review: ReviewSnapshot | undefined,
  onInvalidated: (message: string) => void,
) {
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const version = JSON.stringify([target, timesheetReviewVersion(review)]);
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
