import { describe, it, expect } from 'vitest';
import { classify } from '../../src/timesheetAudit';
import type { TimesheetDoc } from '@sabeel/shared';

// The transition table in isolation — no emulator. Every lifecycle edge the
// audit trail has to survive, especially the two that are DELETES.

const sheet = (over: Partial<TimesheetDoc> = {}): TimesheetDoc =>
  ({
    uid: 'alice',
    periodKey: '2026-07-12',
    toKey: '2026-07-18',
    status: 'submitted',
    approverUid: 'mgr',
    submittedAt: 1,
    totalMinutes: 60,
    entryCount: 1,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }) as TimesheetDoc;

describe('classify', () => {
  it('records a first submission, attributed to the owner', () => {
    expect(classify(null, sheet())).toEqual({ kind: 'submitted', actorUid: 'alice' });
  });

  it('distinguishes a resubmission from a first submission', () => {
    expect(classify(sheet({ status: 'rejected' }), sheet())).toEqual({
      kind: 'resubmitted',
      actorUid: 'alice',
    });
  });

  it('records decisions against the decider, not the owner', () => {
    expect(
      classify(sheet(), sheet({ status: 'approved', decidedBy: 'mgr' })),
    ).toEqual({ kind: 'approved', actorUid: 'mgr' });
    expect(
      classify(sheet(), sheet({ status: 'rejected', decidedBy: 'adm', rejectReason: 'no' })),
    ).toEqual({ kind: 'rejected', actorUid: 'adm' });
  });

  it('a self-approval is still attributed to the person who decided', () => {
    const own = sheet({ uid: 'mgr', approverUid: 'mgr' });
    expect(classify(own, { ...own, status: 'approved', decidedBy: 'mgr' })).toEqual({
      kind: 'approved',
      actorUid: 'mgr',
    });
  });

  // The whole reason this file exists: both of these destroy the doc, so without
  // an event nothing anywhere records that the period was ever approved.
  it('a delete from approved is a REOPEN (only an admin can do it)', () => {
    expect(classify(sheet({ status: 'approved', decidedBy: 'mgr' }), null)).toEqual({
      kind: 'reopened',
      actorUid: null,
    });
  });

  it('a delete from any other state is a WITHDRAW', () => {
    expect(classify(sheet(), null)).toEqual({ kind: 'withdrawn', actorUid: null });
    expect(classify(sheet({ status: 'rejected' }), null)).toEqual({
      kind: 'withdrawn',
      actorUid: null,
    });
  });

  it('records a waiting week passed to a new approver, with no actor', () => {
    expect(classify(sheet({ approverUid: 'old' }), sheet())).toEqual({ kind: 'handedOver', actorUid: null });
  });

  it('ignores writes that change no lifecycle state', () => {
    // A totals refresh, an updatedAt touch, or the auto-close reconciliation.
    expect(classify(sheet(), sheet({ totalMinutes: 120, updatedAt: 2 }))).toBeNull();
    const approved = sheet({ status: 'approved', decidedBy: 'mgr' });
    expect(classify(approved, { ...approved, totalMinutes: 999 })).toBeNull();
  });

  it('ignores a no-op with neither side present', () => {
    expect(classify(null, null)).toBeNull();
  });
});
