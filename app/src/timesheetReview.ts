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
import { useSyncedEntriesRange } from './entries';
import { db } from './firebase';
import { useLiveDoc } from './liveQuery';

const limitsRef = () => doc(db, APP_CONFIG_COLLECTION, TIMESHEET_REVIEW_CONFIG_DOC);

export function useReviewLimits(): ReviewLimits | undefined {
  return useLiveDoc<ReviewLimits | undefined>(limitsRef, [], {
    label: 'useReviewLimits',
    // A cache miss is not "never saved": wait for the server's answer once,
    // then keep it (and the flags it drives) through a dropped connection.
    waitForServer: true,
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
  const nearby = useSyncedEntriesRange(uid, range.fromKey, range.toKey);
  const limits = useReviewLimits();
  return useMemo(() => ({
    /** Rows to show: confirmed by the server once, kept if it disconnects. */
    loaded: nearby !== undefined,
    /** The server confirmed the rows: only then may the week be submitted or approved. */
    synced: nearby?.synced === true,
    ...timesheetReviewEntries(nearby?.rows ?? [], { fromKey, toKey }, limits),
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
