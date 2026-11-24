import { expect, it, vi } from 'vitest';
import { runTransaction, type Transaction } from 'firebase/firestore';
import type { TimeEntry } from './entries';

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => collection + '/' + id,
  runTransaction: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./liveQuery', () => ({ useLiveDoc: vi.fn(), useLiveQuery: vi.fn() }));

const { clockOut } = await import('./entries');

const entry = {
  uid: 'member', id: 'old', start: 1000, end: null, dayKey: '2026-07-12', periodKey: '2026-07-12',
  timeZone: 'UTC', source: 'clock', activityId: 'activity', activityName: 'Activity',
  createdAt: 1000, updatedAt: 1000,
} satisfies TimeEntry;

function transactionWith(pointer: string) {
  const tx = {
    get: vi.fn(async (path: string) => ({
      data: () => path.startsWith('users/') ? { activeEntryId: pointer } : { ...entry, end: 121000 },
    })),
    update: vi.fn(),
  };
  vi.mocked(runTransaction).mockImplementationOnce((_db, operation) => operation(tx as unknown as Transaction));
  return tx;
}

it('leaves a newer timer and the old hours alone when a stale screen clocks out', async () => {
  const tx = transactionWith('new');
  await clockOut('member', entry);
  expect(tx.update).not.toHaveBeenCalled();
});

it('can clear a dangling pointer without overwriting the already closed hours', async () => {
  const tx = transactionWith('old');
  await clockOut('member', entry);
  expect(tx.update.mock.calls).toEqual([['users/member', { activeEntryId: null }]]);
});
