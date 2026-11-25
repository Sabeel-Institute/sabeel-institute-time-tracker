import { expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { runTransaction, writeBatch, type Transaction, type WriteBatch } from 'firebase/firestore';
import type { TimeEntry } from './entries';

vi.mock('firebase/firestore', () => ({
  doc: (parent: unknown, collection?: string, id?: string) => collection === undefined ? parent + '/new-id' : collection + '/' + id,
  collection: (_db: unknown, name: string) => name,
  runTransaction: vi.fn(),
  writeBatch: vi.fn(),
  setDoc: vi.fn(),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./liveQuery', () => ({ useLiveDoc: vi.fn(), useLiveQuery: vi.fn() }));

const { clockOut, deleteEntry, ENTRY_CHANGED, SESSION_ALREADY_ENDED, updateEntry } = await import('./entries');

const entry = {
  uid: 'member', id: 'running_member', start: 1000, end: null, dayKey: '2026-07-12', periodKey: '2026-07-12',
  timeZone: 'UTC', source: 'clock', activityId: 'activity', activityName: 'Activity',
  createdAt: 1000, updatedAt: 1000,
} satisfies TimeEntry;

function recordingBatch(commit: () => Promise<void>) {
  const batch = { set: vi.fn(), delete: vi.fn(), commit: vi.fn(commit) };
  vi.mocked(writeBatch).mockReturnValueOnce(batch as unknown as WriteBatch);
  return batch;
}

it('clocks out by writing the finished entry and removing the session in one write', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(121000);
  try {
    const batch = recordingBatch(async () => {});
    await clockOut(entry);
    const { id: _id, ...fields } = entry;
    expect(batch.set.mock.calls).toEqual([['timeEntries/clock_member_1000', { ...fields, end: 121000, durationMinutes: 2, updatedAt: 121000 }]]);
    expect(batch.delete.mock.calls).toEqual([['timeEntries/running_member']]);
  } finally {
    vi.restoreAllMocks();
  }
});

it('says the timer was already stopped when the rules refuse a stale clock-out', async () => {
  recordingBatch(async () => { throw new FirebaseError('permission-denied', 'denied'); });
  await expect(clockOut(entry)).rejects.toThrow(SESSION_ALREADY_ENDED);
});

it('rejects a stale correction and a stale deletion of changed hours', async () => {
  const original = { ...entry, end: 121000, durationMinutes: 2 };
  for (const act of [
    () => updateEntry(original, { start: original.start, end: original.end, editorUid: 'member' }),
    () => deleteEntry(original),
  ]) {
    const tx = {
      get: vi.fn(async () => ({ data: () => ({ ...original, note: 'Corrected on another device' }) })),
      update: vi.fn(),
      delete: vi.fn(),
    };
    vi.mocked(runTransaction).mockImplementationOnce((_db, operation) => operation(tx as unknown as Transaction));
    await expect(act()).rejects.toThrow(ENTRY_CHANGED);
    expect(tx.update).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  }
});

it('treats a retried commit that finds its own save or deletion as success', async () => {
  const original = { ...entry, end: 121000, durationMinutes: 2 };
  vi.spyOn(Date, 'now').mockReturnValue(5000);
  try {
    // First attempt: commits the patch, then the response is lost.
    const first = { get: vi.fn(async () => ({ data: () => original })), update: vi.fn(), delete: vi.fn() };
    vi.mocked(runTransaction).mockImplementationOnce((_db, operation) => operation(first as unknown as Transaction));
    const save = () => updateEntry(original, { start: original.start, end: original.end, editorUid: 'member' });
    await save();
    const [[, patch]] = first.update.mock.calls as unknown as [[string, object]];
    // The SDK's retry reruns the same callback and reads what it committed.
    for (const [act, current] of [[save, { ...original, ...patch }], [() => deleteEntry(original), undefined]] as const) {
      const tx = { get: vi.fn(async () => ({ data: () => current })), update: vi.fn(), delete: vi.fn() };
      vi.mocked(runTransaction).mockImplementationOnce((_db, operation) => operation(tx as unknown as Transaction));
      await expect(act()).resolves.toBeUndefined();
      expect(tx.update).not.toHaveBeenCalled();
      expect(tx.delete).not.toHaveBeenCalled();
    }
  } finally {
    vi.restoreAllMocks();
  }
});
