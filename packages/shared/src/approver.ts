import type { TimesheetDoc, UserDoc } from './types';

/**
 * Who may approve timesheets: an active manager or admin. Mirrors approverOk
 * in firestore.rules.
 */
export function canApproveTimesheets(u: Pick<UserDoc, 'status' | 'role' | 'admin'> | undefined): boolean {
  return u !== undefined && u.status === 'active' && (u.role === 'manager' || u.admin === true);
}

/**
 * Who a person's waiting weeks belong with: the approver they chose, or, for
 * an admin who chose nobody, themself. null = nobody.
 */
export function approverFor(uid: string, owner: Pick<UserDoc, 'approverUid' | 'admin'>): string | null {
  return owner.approverUid ?? (owner.admin ? uid : null);
}

/**
 * Where a submitted week stands. `waiting`: with someone who may approve it.
 * `moving`: the person chose someone else and the server is passing it on.
 * `stuck`: the one holding it may no longer approve, and nobody else is
 * chosen. `eligible` is everyone who may approve now.
 */
export type WaitingState = { kind: 'waiting' | 'moving' | 'stuck'; approverUid: string };

export function waitingState(
  sheet: Pick<TimesheetDoc, 'approverUid'>,
  target: string | null,
  eligible: ReadonlySet<string>,
): WaitingState {
  if (target !== null && target !== sheet.approverUid && eligible.has(target)) {
    return { kind: 'moving', approverUid: target };
  }
  return { kind: eligible.has(sheet.approverUid) ? 'waiting' : 'stuck', approverUid: sheet.approverUid };
}
