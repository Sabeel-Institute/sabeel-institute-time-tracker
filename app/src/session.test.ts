import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVISIONING_PATIENCE_MS, type Session } from './session';

/**
 * What a new colleague is promised while their account is set up: "Setting
 * up your account…" for as long as a cold start can take, then, if it is
 * still not there, a neutral "still setting up" with Try again. Never "This
 * app is for Sabeel Institute accounts only" for an account that exists: that
 * refusal is for an account the server deleted, and Auth is what says so.
 *
 * Asserted on the session's own phases (what App.tsx draws), driven through
 * the real module with Firebase replaced at its boundary: the auth listener,
 * the profile listener, the Auth lookup (`accountLookup.ts`) and the clock.
 * Ten seconds of waiting used to be read as a refusal; the first test is the
 * one that old behaviour fails.
 */

const fb = vi.hoisted(() => ({
  authCallback: null as ((u: unknown) => void) | null,
  auth: { currentUser: null as unknown },
  profileListeners: [] as { next: (snap: unknown) => void; error: (e: Error) => void; live: boolean }[],
  disableNetwork: vi.fn(async () => undefined),
  enableNetwork: vi.fn(async () => undefined),
  lookUpAccount: vi.fn(async (): Promise<'exists' | 'deleted' | 'unknown'> => 'exists'),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: unknown) => void) => {
    fb.authCallback = cb;
    return () => undefined;
  },
  signOut: async () => {
    fb.auth.currentUser = null;
    fb.authCallback?.(null);
  },
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  onSnapshot: (_ref: unknown, next: (snap: unknown) => void, error: (e: Error) => void) => {
    const listener = { next, error, live: true };
    fb.profileListeners.push(listener);
    return () => {
      listener.live = false;
    };
  },
  disableNetwork: fb.disableNetwork,
  enableNetwork: fb.enableNetwork,
}));
vi.mock('./firebase', () => ({ auth: fb.auth, db: {} }));
vi.mock('./auth/accountLookup', () => ({ lookUpAccount: fb.lookUpAccount }));
vi.mock('./auth/google', () => ({ googleSignOut: async () => undefined }));
vi.mock('./notify', () => ({ unregisterPush: async () => undefined }));
vi.mock('./sentry', () => ({ setSentryUser: () => undefined }));

const user = {
  uid: 'u1',
  email: 'new.colleague@oursabeel.com',
  getIdTokenResult: async () => ({ claims: { status: 'pending', role: 'member', admin: false } }),
};
const profile = {
  displayName: 'New Colleague',
  email: user.email,
  photoURL: null,
  status: 'pending',
  role: 'member',
  admin: false,
  activeEntryId: null,
  approverUid: null,
  createdAt: 1,
  claimsUpdatedAt: 1,
};

async function signIn() {
  vi.resetModules();
  fb.profileListeners.length = 0;
  const session = await import('./session');
  const phases: Session[] = [];
  session.onSessionChange((s) => phases.push(s));
  fb.auth.currentUser = user;
  fb.authCallback?.(user);
  return {
    session,
    phases: () => phases.map((p) => p.phase),
    now: () => phases[phases.length - 1],
  };
}

/** What the live profile listener hears. */
async function profileSnapshot(exists: boolean) {
  const listener = fb.profileListeners.filter((l) => l.live).at(-1);
  if (!listener) throw new Error('no live profile listener');
  listener.next({ exists: () => exists, data: () => profile });
  await vi.advanceTimersByTimeAsync(0);
}

const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  fb.lookUpAccount.mockReset();
  fb.lookUpAccount.mockResolvedValue('exists');
  fb.disableNetwork.mockClear();
  fb.enableNetwork.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a new account waiting for its profile', () => {
  it('is "setting up" for a slow set-up, never refused, and moves on when the profile arrives', async () => {
    const s = await signIn();
    await profileSnapshot(false);
    // A cold start of the trigger: thirty seconds, three times the old limit.
    await wait(30_000);
    expect(s.now().phase).toBe('provisioning');
    expect(s.phases()).not.toContain('notProvisioned');
    await profileSnapshot(true);
    expect(s.now().phase).toBe('signedIn');
    expect(s.phases()).not.toContain('notProvisioned');
  });

  it('after the whole wait says "still setting up", not the refusal; Try again starts over on a fresh connection', async () => {
    const s = await signIn();
    await profileSnapshot(false);
    await wait(PROVISIONING_PATIENCE_MS - 1);
    expect(s.now().phase).toBe('provisioning');
    await wait(1);
    expect(s.now()).toEqual({ phase: 'provisioningSlow', uid: 'u1', email: user.email });
    expect(s.phases()).not.toContain('notProvisioned');

    const listenersBefore = fb.profileListeners.length;
    await s.session.retryProvisioning();
    expect(s.now().phase).toBe('provisioning');
    expect(fb.disableNetwork).toHaveBeenCalledTimes(1);
    expect(fb.enableNetwork).toHaveBeenCalledTimes(1);
    expect(fb.profileListeners.length).toBe(listenersBefore + 1);
    await profileSnapshot(true);
    expect(s.now().phase).toBe('signedIn');
  });

  it('a profile that arrives after "still setting up" moves on by itself', async () => {
    const s = await signIn();
    await profileSnapshot(false);
    await wait(PROVISIONING_PATIENCE_MS);
    expect(s.now().phase).toBe('provisioningSlow');
    await profileSnapshot(true);
    expect(s.now().phase).toBe('signedIn');
  });

  it('an address the trigger deleted is refused at the next look, long before the wait is over', async () => {
    fb.lookUpAccount.mockResolvedValueOnce('exists').mockResolvedValue('deleted');
    const s = await signIn();
    await profileSnapshot(false);
    await wait(3_000);
    expect(s.now().phase).toBe('provisioning');
    await wait(5_000);
    expect(s.now()).toEqual({ phase: 'notProvisioned', uid: 'u1', email: user.email });
    // …and stays refused: no "still setting up" over the top of it.
    await wait(60_000);
    expect(s.now().phase).toBe('notProvisioned');
    expect(s.phases()).not.toContain('provisioningSlow');
  });

  it('a look Auth cannot answer (offline) is never a refusal', async () => {
    fb.lookUpAccount.mockResolvedValue('unknown');
    const s = await signIn();
    await profileSnapshot(false);
    await wait(60_000);
    expect(s.now().phase).toBe('provisioningSlow');
    expect(s.phases()).not.toContain('notProvisioned');
  });

  it('the profile arriving ends the looks', async () => {
    const s = await signIn();
    await profileSnapshot(true);
    await wait(60_000);
    expect(s.now().phase).toBe('signedIn');
    expect(fb.lookUpAccount).not.toHaveBeenCalled();
  });

  it('signing out during the wait ends it', async () => {
    const s = await signIn();
    await profileSnapshot(false);
    await wait(2_000);
    await s.session.signOut();
    await wait(60_000);
    expect(s.now().phase).toBe('signedOut');
    expect(fb.lookUpAccount).not.toHaveBeenCalled();
  });
});
