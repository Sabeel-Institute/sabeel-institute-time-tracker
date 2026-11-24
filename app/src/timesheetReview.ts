import { useMemo } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  addDays,
  APP_CONFIG_COLLECTION,
  DEFAULT_REVIEW_LIMITS,
  overlappingEntryIds,
  reviewTimesheet,
  TIMESHEET_REVIEW_CONFIG_DOC,
  type ReviewLimits,
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

export function saveReviewLimits(limits: ReviewLimits): Promise<void> {
  return setDoc(limitsRef(), { ...limits });
}

export function useTimesheetReview(uid: string, fromKey: string, toKey: string) {
  // Account for entries in other periods that overlap or contribute to an
  // overnight total. Zone offsets can differ by up to 26 hours, and an
  // entry may span 24 hours, so include three start dates on either side.
  const nearby = useEntriesRange(uid, addDays(fromKey, -3), addDays(toKey, 3), true);
  const limits = useReviewLimits();
  return useMemo(() => {
    const entries = (nearby ?? []).filter((e) => e.dayKey >= fromKey && e.dayKey <= toKey);
    const overlaps = overlappingEntryIds(nearby ?? []);
    return {
      loaded: nearby !== undefined,
      entries,
      conflicts: new Set(entries.filter((e) => overlaps.has(e.id)).map((e) => e.id)),
      review: nearby && limits ? reviewTimesheet(limits, nearby, { fromKey, toKey }) : undefined,
    };
  }, [nearby, fromKey, toKey, limits]);
}
