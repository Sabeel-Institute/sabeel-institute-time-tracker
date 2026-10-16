import { describe, expect, it } from 'vitest';
import { NO_ACCOUNT_MESSAGE, signInMessage } from './signInMessage';

describe('signInMessage', () => {
  it('turns the phone app’s refusal into the refusal copy, unreported', () => {
    expect(signInMessage({ code: 'auth/no-account', message: 'No account for that sign-in.' })).toEqual({
      text: NO_ACCOUNT_MESSAGE,
      report: false,
    });
  });

  it('names no website and no way to get an account', () => {
    // The store exemption rests on the app pointing at no account-creation
    // flow (docs/STORE-RELEASE.md). The refusal is the one sentence tempted to.
    expect(NO_ACCOUNT_MESSAGE).not.toMatch(/web|site|\.app|http|sign ?up|register|create/i);
  });

  it('never shows the functions SDK’s bare "internal"', () => {
    const { text } = signInMessage({ code: 'functions/internal', message: 'internal' });
    expect(text).not.toBe('internal');
  });

  it('passes any other failure through, reported', () => {
    expect(signInMessage(new Error('Google sign-in returned no ID token.'))).toEqual({
      text: 'Google sign-in returned no ID token.',
      report: true,
    });
  });
});
