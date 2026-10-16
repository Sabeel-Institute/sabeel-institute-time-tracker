/**
 * The signed-in session: who you are, and what you may do.
 *
 * Single source of truth for auth state, set up once at module load (one auth
 * listener for the whole app; components subscribe via `useSession`). The client
 * NEVER writes its own user doc — the `onUserCreate` Cloud Function is the sole
 * provisioner (sets pending claims + creates the doc, or deletes a non-org
 * account). This module only OBSERVES: it watches `users/{uid}` and reads role/
 * status from the token.
 *
 * Claim freshness: custom claims live in the ID token, refreshed only on expiry
 * (up to an hour) or an explicit force-refresh. So when an admin approves someone,
 * their token still says `pending` and they stay gated — "approved and nothing
 * happened". The fix: `setUserAccess` stamps `claimsUpdatedAt` on the doc, this
 * module watches the doc, and force-refreshes the token whenever that stamp moves
 * (and on the first sighting, since the trigger sets claims after sign-in). No
 * polling.
 *
 * Exempt from the useLiveQuery lint rule (eslint.config.mjs): it owns the auth
 * lifecycle and does its own listener + reset.
 */
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { disableNetwork, doc, enableNetwork, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { COLLECTIONS, type TokenClaims, type UserDoc } from '@sabeel/shared';
import { lookUpAccount } from './auth/accountLookup';
import { googleSignOut } from './auth/google';
import { unregisterPush } from './notify';
import { auth, db } from './firebase';
import { setSentryUser } from './sentry';

export type Session =
  | { phase: 'loading' }
  | { phase: 'signedOut' }
  /** Signed in, but the user doc/claims have not arrived yet. */
  | { phase: 'provisioning'; uid: string }
  /**
   * No profile after PROVISIONING_PATIENCE_MS, and the account still exists:
   * a trigger slower than that, or a connection that delivered nothing. Never
   * a refusal: the person is told to try again in a minute, and Try again
   * (`retryProvisioning`) starts the wait over on a fresh connection.
   */
  | { phase: 'provisioningSlow'; uid: string; email: string }
  /**
   * The `onUserCreate` trigger REJECTED the account (a non-org address) and
   * deleted it, which Auth itself confirms (`lookUpAccount`). The client's token
   * stays valid until it refreshes, so without this state the person would
   * watch a spinner forever instead of being told what happened.
   */
  | { phase: 'notProvisioned'; uid: string; email: string }
  | { phase: 'signedIn'; user: User; profile: UserDoc; claims: TokenClaims };

type Listener = (s: Session) => void;

let current: Session = { phase: 'loading' };
const listeners = new Set<Listener>();

function emit(next: Session) {
  current = next;
  listeners.forEach((l) => l(next));
}

let unsubDoc: (() => void) | null = null;
let lastClaimsStamp: number | null = null;
/**
 * Snapshot ordering guard. handleSnapshot awaits a token read (up to 8s on a
 * forced refresh, ~0 on the cached path), so two snapshots in flight can finish
 * out of order and let an older profile overwrite a newer one. Each snapshot
 * takes a ticket; only the latest may emit.
 */
let snapshotSeq = 0;

/**
 * How long "Setting up your account…" waits for the profile before saying it
 * is still being set up. Provisioning normally takes well under a second; a
 * cold start of the onUserCreate trigger can take tens. Time alone never
 * refuses anyone: ten seconds once told a colleague on a cold start that the
 * app was not for them.
 */
export const PROVISIONING_PATIENCE_MS = 45_000;
/**
 * While waiting, Auth is asked whether the account still exists, so an
 * address the trigger rejected is told so in seconds rather than after the
 * whole wait. The first look leaves the trigger a moment to decide.
 */
const FIRST_LOOK_MS = 3_000;
const LOOK_EVERY_MS = 5_000;

let provisioningTimers: ReturnType<typeof setTimeout>[] = [];
let provisioningWatched = false;
/** Moves on every stop, so a look still in flight cannot act for a wait that is over. */
let provisioningGeneration = 0;

function stopProvisioningWatch() {
  provisioningTimers.forEach(clearTimeout);
  provisioningTimers = [];
  provisioningWatched = false;
  provisioningGeneration++;
}

/**
 * The wait for a new account's profile, which ends one of three ways: the
 * profile arrives (handleSnapshot stops this), Auth says the account is gone
 * (the refusal), or PROVISIONING_PATIENCE_MS passes with the account still
 * there (still setting up). A look Auth cannot answer is not a refusal.
 */
function watchProvisioning(user: User) {
  stopProvisioningWatch();
  provisioningWatched = true;
  const generation = provisioningGeneration;
  const email = user.email ?? '';
  const later = (fn: () => void, ms: number) => {
    provisioningTimers.push(setTimeout(fn, ms));
  };
  const look = async () => {
    const state = await lookUpAccount(user);
    if (generation !== provisioningGeneration) return;
    if (state === 'deleted') {
      stopProvisioningWatch();
      emit({ phase: 'notProvisioned', uid: user.uid, email });
      return;
    }
    later(() => void look(), LOOK_EVERY_MS);
  };
  later(() => void look(), FIRST_LOOK_MS);
  later(() => {
    if (generation !== provisioningGeneration) return;
    stopProvisioningWatch();
    emit({ phase: 'provisioningSlow', uid: user.uid, email });
  }, PROVISIONING_PATIENCE_MS);
}

function stopWatching() {
  unsubDoc?.();
  unsubDoc = null;
  lastClaimsStamp = null;
  // Invalidate anything still in flight — on a sign-out or account switch its
  // emit would restore the previous user's session.
  snapshotSeq++;
  stopProvisioningWatch();
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Read role/status/admin from the TOKEN, not the doc — rules trust the token, so
 * the UI must agree with it or people see buttons that always fail. A forced
 * refresh is a network round trip; bound it and fall back to the cached token so
 * neither a failure nor a hang strands the user on the provisioning spinner.
 */
async function readClaims(user: User, forceRefresh: boolean): Promise<TokenClaims> {
  let token;
  try {
    token = await withTimeout(
      user.getIdTokenResult(forceRefresh),
      forceRefresh ? 8000 : 4000,
      'token refresh',
    );
  } catch (e) {
    console.warn('token refresh failed, falling back to cached claims', e);
    try {
      token = await withTimeout(user.getIdTokenResult(false), 4000, 'cached token');
    } catch {
      return { status: 'pending', role: 'member', admin: false };
    }
  }
  const c = token.claims;
  return {
    status: (c.status as UserDoc['status']) ?? 'pending',
    role: (c.role as UserDoc['role']) ?? 'member',
    admin: (c.admin as boolean) ?? false,
  };
}

async function handleSnapshot(user: User, snap: DocumentSnapshot): Promise<void> {
  const seq = ++snapshotSeq;
  if (!snap.exists()) {
    // The trigger has not finished yet, or it rejected the account and is
    // about to delete it: the watch tells the two apart. A screen that has
    // already said "still setting up" or refused keeps saying so.
    if (current.phase === 'provisioningSlow' || current.phase === 'notProvisioned') return;
    emit({ phase: 'provisioning', uid: user.uid });
    if (!provisioningWatched) watchProvisioning(user);
    return;
  }
  stopProvisioningWatch();

  const profile = snap.data() as UserDoc;
  const stamp = typeof profile.claimsUpdatedAt === 'number' ? profile.claimsUpdatedAt : null;
  // First sighting always refreshes (the trigger set claims after sign-in, so the
  // token in hand predates them); after that, only when the stamp moves.
  const claimsChanged = lastClaimsStamp === null || stamp !== lastClaimsStamp;
  lastClaimsStamp = stamp;

  const claims = await readClaims(user, claimsChanged);
  // A newer snapshot overtook this one while the token was in flight; its result
  // is the current truth and this one is stale.
  if (seq !== snapshotSeq) return;
  emit({ phase: 'signedIn', user, profile, claims });
}

function watchUserDoc(user: User) {
  stopWatching();
  unsubDoc = onSnapshot(
    doc(db, COLLECTIONS.users, user.uid),
    // Not an async fn passed straight in: an unhandled rejection would silently
    // strand the app in `provisioning`.
    (snap) =>
      void handleSnapshot(user, snap).catch((e) => {
        console.warn('user snapshot handler failed', e);
        emit({ phase: 'provisioning', uid: user.uid });
        if (!provisioningWatched) watchProvisioning(user);
      }),
    (e) => {
      console.warn('user doc listener', (e as { code?: string }).code ?? e.message);
      emit({ phase: 'provisioning', uid: user.uid });
      if (!provisioningWatched) watchProvisioning(user);
    },
  );
}

onAuthStateChanged(auth, (user) => {
  stopWatching();
  setSentryUser(user?.uid ?? null);
  if (!user) {
    emit({ phase: 'signedOut' });
    return;
  }
  emit({ phase: 'provisioning', uid: user.uid });
  watchUserDoc(user);
  watchProvisioning(user);
});

/** Follow the session from outside React. Hears the current one at once. */
export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function useSession(): Session {
  const [s, setS] = useState<Session>(current);
  useEffect(() => onSessionChange(setS), []);
  return s;
}

/**
 * Try again, from "Still setting up your account": the whole wait over, on a
 * fresh connection to the database, so whatever held the profile back (a
 * stalled listener on a loaded machine has done it) does not carry over.
 */
export async function retryProvisioning(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  stopWatching();
  emit({ phase: 'provisioning', uid: user.uid });
  await disableNetwork(db).catch(() => undefined);
  await enableNetwork(db).catch(() => undefined);
  if (auth.currentUser !== user) return;
  watchUserDoc(user);
  watchProvisioning(user);
}

export async function signOut(): Promise<void> {
  stopWatching();
  // Notifications target the device, not the session — deregister this device
  // first (while still authenticated) so the next account on this phone/browser
  // doesn't receive the previous account's notifications.
  const uid = auth.currentUser?.uid;
  if (uid) await unregisterPush(uid).catch(() => undefined);
  // Also clear the native Google session, or the next sign-in silently reuses the
  // same account with no way to switch users.
  await googleSignOut().catch(() => undefined);
  await fbSignOut(auth);
}
