import { describe, it, expect } from 'vitest';
import { evaluateCounts, type Counts } from '../../src/health';

// The alerting policy in isolation: no emulator, no Firebase. Every branch of
// "is this drop worth waking someone" is decided here.

const base: Counts = { users: 10, activities: 6, timeEntries: 100, timesheets: 20 };

describe('evaluateCounts — no baseline', () => {
  it('reports nothing on the first ever run', () => {
    expect(evaluateCounts(null, base)).toEqual([]);
  });

  it('ignores a collection with no previous count (newly added)', () => {
    const prev: Counts = { users: 10 };
    expect(evaluateCounts(prev, { users: 10, activities: 6 })).toEqual([]);
  });
});

describe('evaluateCounts — growth and stability never alert', () => {
  it('is silent when counts hold steady', () => {
    expect(evaluateCounts(base, { ...base })).toEqual([]);
  });

  it('is silent when everything grows', () => {
    expect(
      evaluateCounts(base, { users: 11, activities: 7, timeEntries: 140, timesheets: 25 }),
    ).toEqual([]);
  });
});

describe('evaluateCounts — zero-tolerance collections', () => {
  it('flags losing a single user (deletion is deliberate and rare)', () => {
    const f = evaluateCounts(base, { ...base, users: 9 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ collection: 'users', previous: 10, current: 9, dropped: 1, allowed: 0 });
  });

  it('flags losing a single report (nothing deletes one; it is the record)', () => {
    const f = evaluateCounts({ ...base, reports: 3 }, { ...base, reports: 2 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ collection: 'reports', dropped: 1, allowed: 0 });
  });
});

describe('evaluateCounts — tolerant collections', () => {
  it('absorbs an admin deleting a few archived activities', () => {
    expect(evaluateCounts(base, { ...base, activities: 1 })).toEqual([]);
  });

  it('absorbs routine deletions under the floor', () => {
    // 100 → 96 is 4, under the minDrop floor of 5.
    expect(evaluateCounts(base, { ...base, timeEntries: 96 })).toEqual([]);
  });

  it('absorbs a drop up to the 20% fraction', () => {
    // 20% of 100 = 20; a drop of exactly 20 is tolerated.
    expect(evaluateCounts(base, { ...base, timeEntries: 80 })).toEqual([]);
  });

  it('flags a drop past the fraction', () => {
    const f = evaluateCounts(base, { ...base, timeEntries: 79 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ collection: 'timeEntries', dropped: 21, allowed: 20 });
  });

  it('uses the floor, not the fraction, on small datasets', () => {
    // 20% of 8 is 1, but the floor of 5 governs: losing 5 of 8 is tolerated…
    const small: Counts = { timeEntries: 8 };
    expect(evaluateCounts(small, { timeEntries: 3 })).toEqual([]);
    // …losing 6 is not.
    expect(evaluateCounts(small, { timeEntries: 2 })).toHaveLength(1);
  });

  it('flags a catastrophic wipe', () => {
    const f = evaluateCounts(base, { users: 0, activities: 0, timeEntries: 0, timesheets: 0 });
    expect(f.map((x) => x.collection).sort()).toEqual([
      'activities',
      'timeEntries',
      'timesheets',
      'users',
    ]);
  });
});
