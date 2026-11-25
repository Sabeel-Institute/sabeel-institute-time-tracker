import { useMemo } from 'react';
import { approverFor, dayKeyFor, deviceTimeZone, shortDayLabel, waitingState, type WaitingState } from '@sabeel/shared';
import type { Timesheet } from './timesheets';
import { useApproverChoices, type UserRow } from './users';

/**
 * Everyone who may approve now, by uid, for telling where a waiting week
 * stands (waitingState). undefined while the list loads, so no week reads as
 * stuck before it has been checked.
 */
export function useEligibleApprovers(): ReadonlyMap<string, UserRow> | undefined {
  const approvers = useApproverChoices();
  return useMemo(() => (approvers ? new Map(approvers.map((a) => [a.uid, a])) : undefined), [approvers]);
}

/**
 * Where a person's waiting week stands, given their profile as it is now, and
 * one line about it for them: who has it and since when, who it is on its way
 * to, or that it needs a new approver. `ownStuck`: it is stuck with the
 * person themself, a manager or admin who may no longer approve.
 */
export function weekStanding(
  sheet: Timesheet,
  owner: { approverUid: string | null; admin: boolean },
  eligible: ReadonlyMap<string, UserRow>,
): WaitingState & { line: string; ownStuck: boolean } {
  const state = waitingState(sheet, approverFor(sheet.uid, owner), new Set(eligible.keys()));
  const self = state.approverUid === sheet.uid;
  const name = eligible.get(state.approverUid)?.displayName ?? 'your approver';
  const since = shortDayLabel(dayKeyFor(sheet.heldSince ?? sheet.submittedAt, deviceTimeZone()));
  const line = state.kind === 'stuck' ? 'Needs a new approver'
    : state.kind === 'moving' ? (self ? 'Passing to you to approve' : `Passing to ${name}`)
    : self ? `For your own approval since ${since}` : `With ${name} since ${since}`;
  return { ...state, line, ownStuck: state.kind === 'stuck' && self };
}

/** What to say when weeks are stuck: whose approval is gone, the person's own or their approver's. */
export function stuckMessage(own: boolean, count: number, where: 'onWeek' | 'onToday'): string {
  const who = own ? 'You can no longer approve timesheets yourself.' : 'Your approver can no longer approve timesheets.';
  if (where === 'onWeek') return `${who} Choose ${own ? 'an' : 'a new'} approver below, and this week goes to them.`;
  const weeks = count === 1 ? 'your waiting week goes' : `your ${count} waiting weeks go`;
  return `${who} Choose ${own ? 'an approver' : 'a new one'}, and ${weeks} to them.`;
}
