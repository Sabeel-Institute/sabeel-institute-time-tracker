import { describe, it, expect } from 'vitest';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { PASSWORD_ACCOUNT_EMAIL } from '@sabeel/shared';
import { requireAuth, requireActive, requireManagerOrAdmin, requireAdmin } from '../../src/auth';

function req(auth: { uid: string; token: Record<string, unknown> } | null): CallableRequest {
  return { auth: auth ?? undefined, data: {}, rawRequest: {} } as unknown as CallableRequest;
}

const activeMember = { uid: 'u1', token: { status: 'active', role: 'member' } };
const activeManager = { uid: 'u2', token: { status: 'active', role: 'manager' } };
const activeAdmin = { uid: 'u3', token: { status: 'active', role: 'manager', admin: true } };
const pending = { uid: 'u4', token: { status: 'pending', role: 'member' } };
// Admin who is NOT a manager (role member) — the case M3 unlocks.
const adminNonManager = { uid: 'u5', token: { status: 'active', role: 'member', admin: true } };

describe('auth guards', () => {
  it('requireAuth rejects anonymous, passes any signed-in user', () => {
    expect(() => requireAuth(req(null))).toThrow(/Sign in required/);
    expect(requireAuth(req(pending))).toBe('u4');
  });

  it('requireActive rejects pending users', () => {
    expect(() => requireActive(req(pending))).toThrow(/not active/);
    expect(requireActive(req(activeMember))).toBe('u1');
  });

  it('requireManagerOrAdmin: rejects plain members, allows managers AND admin-non-managers', () => {
    expect(() => requireManagerOrAdmin(req(activeMember))).toThrow(/Manager or admin/);
    expect(requireManagerOrAdmin(req(activeManager))).toBe('u2');
    // The M3 case: an admin who isn't a manager can still run reports/activities.
    expect(requireManagerOrAdmin(req(adminNonManager))).toBe('u5');
  });

  it('requireAdmin rejects plain managers — only admins approve users', () => {
    expect(() => requireAdmin(req(activeManager))).toThrow(/Admin required/);
    expect(requireAdmin(req(activeAdmin))).toBe('u3');
  });
});

/**
 * The two server locks on the one email-and-password account
 * (PASSWORD_ACCOUNT_EMAIL), as the callables apply them. The rules apply the
 * same two (rules.users.test.ts).
 */
describe('password sessions', () => {
  const password = (email: string, claims: Record<string, unknown>) => ({
    uid: 'p1',
    token: { ...claims, email, firebase: { sign_in_provider: 'password' } },
  });
  const google = (claims: Record<string, unknown>) => ({
    uid: 'g1',
    token: { ...claims, email: 'someone@oursabeel.com', firebase: { sign_in_provider: 'google.com' } },
  });

  it('are a session only for the one allowed address', () => {
    expect(requireActive(req(password(PASSWORD_ACCOUNT_EMAIL, { status: 'active', role: 'member' })))).toBe('p1');
    expect(() => requireAuth(req(password('someone-else@oursabeel.com', { status: 'active' })))).toThrow(
      /Sign in required/,
    );
  });

  it('are never a manager or an admin, whatever the claims say', () => {
    const promoted = password(PASSWORD_ACCOUNT_EMAIL, { status: 'active', role: 'manager', admin: true });
    expect(() => requireManagerOrAdmin(req(promoted))).toThrow(/Manager or admin/);
    expect(() => requireAdmin(req(promoted))).toThrow(/Admin required/);
  });

  it('leave a Google session with the same claims alone', () => {
    expect(requireAdmin(req(google({ status: 'active', role: 'manager', admin: true })))).toBe('g1');
  });
});

