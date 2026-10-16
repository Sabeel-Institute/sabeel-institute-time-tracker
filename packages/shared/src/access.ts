import { RULES_VERSION } from './constants';
import type { UserDoc, UserRole, UserStatus } from './types';

/**
 * What a brand-new account gets, as custom claims. Never active — the
 * `onUserCreate` trigger sets these, and an admin must approve to move `status`
 * to 'active'. Kept here as a single source so the trigger and any test agree.
 */
export const NEW_USER_ACCESS: { status: UserStatus; role: UserRole; admin: boolean } = {
  status: 'pending',
  role: 'member',
  admin: false,
};

/**
 * Whether this person has accepted the current version of the institute's
 * rules. Until they have, the app shows the rules screen before anything else
 * (app/App.tsx), so nothing can be posted first.
 */
export function hasAcceptedRules(profile: Pick<UserDoc, 'rulesVersion'>): boolean {
  return (profile.rulesVersion ?? 0) >= RULES_VERSION;
}
