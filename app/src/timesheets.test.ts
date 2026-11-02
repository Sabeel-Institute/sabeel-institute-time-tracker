import { describe, expect, it, vi } from 'vitest';
import { FirebaseError } from 'firebase/app';

vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./liveQuery', () => ({ useLiveDoc: () => undefined, useLiveQuery: () => [] }));

const { WEEK_CHANGED, weekWriteError } = await import('./timesheets');

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
