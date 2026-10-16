import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PASSWORD_ACCOUNT_EMAIL } from '@sabeel/shared';
import { refusedSignIn, refusedSignUp } from '../../src/signInGate';

/**
 * The decisions behind the auth-layer gate (functions/src/signInGate.ts). The
 * gate itself, driven through the public REST API against the Auth emulator, is
 * signInGate.gate.test.ts.
 */
describe('sign-up', () => {
  it('refuses every password sign-up, the allowed address included', () => {
    // That account is made with the Admin SDK, which never reaches here.
    expect(refusedSignUp('password')).not.toBeNull();
  });

  it('lets Google sign-ups through, to onUserCreate as before', () => {
    expect(refusedSignUp('google.com')).toBeNull();
  });
});

describe('sign-in', () => {
  it('lets the one address sign in with a password', () => {
    expect(refusedSignIn('password', PASSWORD_ACCOUNT_EMAIL)).toBeNull();
    expect(refusedSignIn('password', PASSWORD_ACCOUNT_EMAIL.toUpperCase())).toBeNull();
  });

  it('refuses a password sign-in for any other address', () => {
    expect(refusedSignIn('password', 'someone@oursabeel.com')).not.toBeNull();
    expect(refusedSignIn('password', `x${PASSWORD_ACCOUNT_EMAIL}`)).not.toBeNull();
    expect(refusedSignIn('password', null)).not.toBeNull();
  });

  it('lets Google sign-ins through', () => {
    expect(refusedSignIn('google.com', 'someone@oursabeel.com')).toBeNull();
  });
});

describe('the address', () => {
  // The rules cannot import a constant, so they restate it once; this is what
  // keeps the restatement honest.
  it('is the one firestore.rules restates', () => {
    const rules = readFileSync(resolve(import.meta.dirname, '../../../firestore.rules'), 'utf8');
    const stated = [...rules.matchAll(/'([^'@\s]+@[^'\s]+)'/g)].map((m) => m[1]);
    expect(stated).toEqual([PASSWORD_ACCOUNT_EMAIL]);
  });
});
