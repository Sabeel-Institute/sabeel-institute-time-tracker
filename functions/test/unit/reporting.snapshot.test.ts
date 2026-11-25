import { describe, expect, it, vi } from 'vitest';

const { fake } = vi.hoisted(() => ({ fake: { getFirestore: vi.fn() } }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: fake.getFirestore }));

const { computeTotals } = await import('../../src/reporting');

describe('official report snapshot', () => {
  it('never combines old hours with a new approval', async () => {
    let approved = false;
    type Collection = 'timeEntries' | 'timesheets' | 'users';
    const read = (name: Collection, atApproval: boolean) => {
      switch (name) {
        case 'timeEntries': return { docs: [{ data: () => ({
          uid: 'member', periodKey: '2026-07-12', dayKey: '2026-07-13',
          end: 1, durationMinutes: atApproval ? 120 : 60, activityId: 'prep', activityName: 'Prep',
        }) }] };
        case 'timesheets': return { docs: atApproval
          ? [{ id: 'member_2026-07-12', data: () => ({ toKey: '2026-07-18' }) }] : [] };
        case 'users': return { docs: [] };
      }
    };
    const collection = (name: Collection) => {
      const query = {
        name,
        where: () => query,
        orderBy: () => query,
        get: async () => {
          const snapshot = read(name, approved);
          if (name === 'timeEntries') approved = true;
          return snapshot;
        },
        doc: () => ({ get: async () => ({ data: () => ({ displayName: 'Volunteer' }) }) }),
      };
      return query;
    };
    const runTransaction = vi.fn(async (run) => {
      const snapshot = approved;
      return run({
        get: async ({ name }: { name: Collection }) => {
          if (name === 'timeEntries') approved = true;
          return read(name, snapshot);
        },
      });
    });
    fake.getFirestore.mockReturnValue({ collection, runTransaction });

    const filter = { fromKey: '2026-07-12', toKey: '2026-07-18' };
    expect((await computeTotals(filter)).totalMinutes).toBe(0);
    expect((await computeTotals(filter)).totalMinutes).toBe(120);
  });
});
