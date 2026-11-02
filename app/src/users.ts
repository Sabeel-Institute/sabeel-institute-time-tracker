import { collection, doc, or, query, updateDoc, where } from 'firebase/firestore';
import { COLLECTIONS, type UserDoc } from '@sabeel/shared';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';

export type UserRow = UserDoc & { uid: string };

/**
 * Point a user's sticky timesheet approver at an active manager/admin (or clear
 * it). Rules scope who may call this for whom: self always; managers for any
 * non-admin; admins for anyone. Affects future submissions only.
 */
export function setApprover(uid: string, approverUid: string | null): Promise<void> {
  return updateDoc(doc(db, COLLECTIONS.users, uid), { approverUid });
}

/**
 * Live view of one user's profile. Readable for yourself always, and for anyone
 * by a manager/admin (firestore.rules /users read) — which is exactly the pair of
 * cases that need it: logging hours for yourself, or on someone else's behalf.
 */
export function useUser(uid: string): UserRow | null {
  return useLiveDoc(
    () => doc(db, COLLECTIONS.users, uid),
    [uid],
    {
      label: 'useUser',
      map: (snap) => (snap.exists() ? { uid: snap.id, ...(snap.data() as UserDoc) } : null),
      empty: null,
    },
  );
}

/** The active managers/admins a user may pick as their approver. */
export function approverChoices(users: UserRow[]): UserRow[] {
  return users.filter((u) => u.status === 'active' && (u.role === 'manager' || u.admin));
}

/**
 * The approver picker's rows for one person's approver: everyone who may
 * approve, the person themself LAST — managers and admins may approve their
 * own hours (PRODUCTION-REVIEW M5, deliberate at this org size), and listing
 * them last keeps choosing yourself a considered choice, not the first row.
 * `selfLabel` is how that row reads: "(myself)" to the person, "(self)" to an
 * admin setting it for them.
 */
export function approverItems(
  approvers: UserRow[],
  forUid: string,
  selfLabel: '(myself)' | '(self)',
): { id: string; label: string; sublabel: string }[] {
  return approvers
    .slice()
    .sort((a, b) => Number(a.uid === forUid) - Number(b.uid === forUid))
    .map((a) => ({
      id: a.uid,
      label: a.uid === forUid ? `${a.displayName} ${selfLabel}` : a.displayName,
      sublabel: a.admin ? 'admin' : 'manager',
    }));
}

/**
 * Live list of possible approvers (active managers/admins). Unlike useUsers,
 * this query is readable by every active user — rules open manager/admin
 * profiles to all so people can pick their own approver.
 */
export function useApproverChoices(): UserRow[] {
  return useLiveQuery(
    () =>
      query(
        collection(db, COLLECTIONS.users),
        or(where('role', '==', 'manager'), where('admin', '==', true)),
      ),
    [],
    {
      label: 'useApproverChoices',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as UserDoc) }));
        return approverChoices(list).sort((a, b) => a.displayName.localeCompare(b.displayName));
      },
      empty: [],
    },
  );
}

/**
 * Live count of accounts awaiting approval — badges the "Manage users" button.
 * Only managers/admins may query non-manager profiles, so pass `enabled` from
 * the caller's role to skip the query (and its permission error) for members.
 */
export function usePendingCount(enabled: boolean): number {
  return useLiveQuery(
    () =>
      enabled
        ? query(collection(db, COLLECTIONS.users), where('status', '==', 'pending'))
        : null,
    [enabled],
    {
      label: 'usePendingCount',
      map: (snap) => snap.size,
      empty: 0,
    },
  );
}

/**
 * Live list of all users — managers use it for report filters and person detail.
 * undefined = still loading (or the listen failed, which the banner says).
 */
export function useUsers(): UserRow[] | undefined {
  return useLiveQuery<UserRow[] | undefined>(
    () => query(collection(db, COLLECTIONS.users)),
    [],
    {
      label: 'useUsers',
      map: (snap) => {
        const list = snap.docs.map((d) => ({ uid: d.id, ...(d.data() as UserDoc) }));
        list.sort((a, b) => a.displayName.localeCompare(b.displayName));
        return list;
      },
      empty: undefined,
    },
  );
}
