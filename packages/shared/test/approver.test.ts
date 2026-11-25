import { describe, expect, it } from 'vitest';
import { approverFor, canApproveTimesheets, waitingState } from '../src/approver';

describe('approverFor', () => {
  it('is the chosen approver, an admin themself when none is chosen, or nobody', () => {
    expect(approverFor('ann', { approverUid: 'mgr', admin: false })).toBe('mgr');
    expect(approverFor('ann', { approverUid: 'mgr', admin: true })).toBe('mgr');
    expect(approverFor('ann', { approverUid: null, admin: true })).toBe('ann');
    expect(approverFor('ann', { approverUid: null, admin: false })).toBeNull();
  });
});

describe('canApproveTimesheets', () => {
  it('is an active manager or admin', () => {
    expect(canApproveTimesheets({ status: 'active', role: 'manager', admin: false })).toBe(true);
    expect(canApproveTimesheets({ status: 'active', role: 'member', admin: true })).toBe(true);
    expect(canApproveTimesheets({ status: 'active', role: 'member', admin: false })).toBe(false);
    expect(canApproveTimesheets({ status: 'disabled', role: 'manager', admin: true })).toBe(false);
    expect(canApproveTimesheets(undefined)).toBe(false);
  });
});

describe('waitingState', () => {
  const eligible = new Set(['old', 'new']);
  it('is waiting with an approver who may approve and is still chosen', () => {
    expect(waitingState({ approverUid: 'old' }, 'old', eligible)).toEqual({ kind: 'waiting', approverUid: 'old' });
  });
  it('is moving to a newly chosen approver who may approve', () => {
    expect(waitingState({ approverUid: 'old' }, 'new', eligible)).toEqual({ kind: 'moving', approverUid: 'new' });
  });
  it('is stuck with someone who may no longer approve, unless someone else is chosen', () => {
    expect(waitingState({ approverUid: 'gone' }, null, eligible)).toEqual({ kind: 'stuck', approverUid: 'gone' });
    expect(waitingState({ approverUid: 'gone' }, 'gone', eligible)).toEqual({ kind: 'stuck', approverUid: 'gone' });
    expect(waitingState({ approverUid: 'gone' }, 'new', eligible)).toEqual({ kind: 'moving', approverUid: 'new' });
  });
  it('stays waiting when the chosen approver may not approve: nothing will move it', () => {
    expect(waitingState({ approverUid: 'old' }, 'gone', eligible)).toEqual({ kind: 'waiting', approverUid: 'old' });
  });
});
