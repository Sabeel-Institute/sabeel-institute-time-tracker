import { CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import { PASSWORD_ACCOUNT_EMAIL } from '@sabeel/shared';

interface Claims {
  role?: 'member' | 'manager';
  status?: 'pending' | 'active' | 'disabled';
  admin?: boolean;
  email?: string;
  firebase?: { sign_in_provider?: string };
}

/** Signed in with an email and a password rather than Google. */
function isPasswordSession(claims: Claims): boolean {
  return claims.firebase?.sign_in_provider === 'password';
}

/**
 * The same two locks firestore.rules applies (see PASSWORD_ACCOUNT_EMAIL): a
 * password session for any address but the one allowed is no session at all,
 * and a password session is never a manager or an admin, whatever its claims.
 */
export function requireAuth(req: CallableRequest): string {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  const claims = req.auth.token as Claims;
  if (isPasswordSession(claims) && claims.email?.toLowerCase() !== PASSWORD_ACCOUNT_EMAIL) {
    throw new HttpsError('unauthenticated', 'Sign in required.');
  }
  return req.auth.uid;
}

export function requireActive(req: CallableRequest): string {
  const uid = requireAuth(req);
  const claims = (req.auth?.token ?? {}) as Claims;
  if (claims.status !== 'active') {
    throw new HttpsError('permission-denied', 'Account is not active.');
  }
  return uid;
}

/** A manager or an admin by claims, and never a password session. */
function hasRole(claims: Claims, role: 'manager' | 'admin'): boolean {
  if (isPasswordSession(claims)) return false;
  return role === 'admin' ? claims.admin === true : claims.role === 'manager';
}

/** What the caller may do, as one word: the highest role the locks above allow. */
export function roleOf(req: CallableRequest): 'admin' | 'manager' | 'member' {
  const claims = (req.auth?.token ?? {}) as Claims;
  if (hasRole(claims, 'admin')) return 'admin';
  if (hasRole(claims, 'manager')) return 'manager';
  return 'member';
}

/**
 * Reports and CSV export require an operational or administrative
 * role. Admin implies full access (an admin who isn't also a manager still gets
 * in), so admin-only accounts aren't locked out of reports/activities.
 */
export function requireManagerOrAdmin(req: CallableRequest): string {
  const uid = requireActive(req);
  const claims = (req.auth?.token ?? {}) as Claims;
  if (!hasRole(claims, 'manager') && !hasRole(claims, 'admin')) {
    throw new HttpsError('permission-denied', 'Manager or admin role required.');
  }
  return uid;
}

/** Only admins approve/disable users and change roles (Faisal's decision). */
export function requireAdmin(req: CallableRequest): string {
  const uid = requireActive(req);
  const claims = (req.auth?.token ?? {}) as Claims;
  if (!hasRole(claims, 'admin')) {
    throw new HttpsError('permission-denied', 'Admin required.');
  }
  return uid;
}
