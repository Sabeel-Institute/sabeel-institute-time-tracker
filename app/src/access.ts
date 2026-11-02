import { httpsCallable } from 'firebase/functions';
import type { UserRole, UserStatus } from '@sabeel/shared';
import { functions } from './firebase';

/** An admin's change to someone's account: approve, disable, role, admin. */
export const setUserAccess = httpsCallable<
  { uid: string; status?: UserStatus; role?: UserRole; admin?: boolean },
  { status: UserStatus; role: UserRole; admin: boolean }
>(functions, 'setUserAccess');
