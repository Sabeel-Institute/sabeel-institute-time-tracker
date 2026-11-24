import { describe, expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { runTransaction, type Transaction } from 'firebase/firestore';
import { WEEK_CHANGED, type TimesheetDoc } from '@sabeel/shared';

vi.mock('firebase/firestore', () => ({ doc: vi.fn(), runTransaction: vi.fn() }));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./liveQuery', () => ({ useLiveDoc: () => undefined, useLiveQuery: () => [] }));

const { rejectTimesheet, withdrawTimesheet, reopenTimesheet, weekWriteError } = await import('./timesheets');

describe('weekWriteError', () => {
  it('says in words that the week changed when the rules refuse the write', () => {
    const said = weekWriteError(new FirebaseError('permission-denied', 'PERMISSION_DENIED: evaluation error at L435'));
    expect((said as Error).message).toBe(WEEK_CHANGED);
  });

  it('leaves every other failure as it was', () => {
    const offline = new FirebaseError('unavailable', 'offline');
    expect(weekWriteError(offline)).toBe(offline);
    const other = new Error('boom');
    expect(weekWriteError(other)).toBe(other);
  });
});

describe('timesheet actions bind to the displayed revision', () => {
  const submitted = {
    id: 'member_2026-11-01', uid: 'member', periodKey: '2026-11-01', toKey: '2026-11-07',
    status: 'submitted' as const, approverUid: 'manager', entryCount: 0, totalMinutes: 0,
    createdAt: 1, submittedAt: 1, updatedAt: 1,
  };

  function transactionReading(current: TimesheetDoc) {
    const tx = { get: vi.fn(async () => ({ data: () => current })), update: vi.fn(), delete: vi.fn() };
    vi.mocked(runTransaction).mockImplementationOnce((_, callback) => callback(tx as unknown as Transaction));
    return tx;
  }

  it.each([
    ['reject', () => rejectTimesheet(submitted, 'manager', 'Please check.')],
    ['withdraw', () => withdrawTimesheet(submitted)],
  ])('refuses to %s a replacement that still says submitted', async (_, act) => {
    const tx = transactionReading({ ...submitted, createdAt: 2, submittedAt: 2, updatedAt: 2 });
    await expect(act()).rejects.toThrow(WEEK_CHANGED);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it('refuses to reopen an approved replacement revision', async () => {
    const approved = { ...submitted, status: 'approved' as const, decidedAt: 2, updatedAt: 2 };
    const tx = transactionReading({ ...approved, decidedAt: 3, updatedAt: 3 });
    await expect(reopenTimesheet(approved)).rejects.toThrow(WEEK_CHANGED);
    expect(tx.delete).not.toHaveBeenCalled();
  });

});
