import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The ORDER of two calls, which is the whole store exemption.
 *
 * `signInWithCredential` is the line that brings an account into existence. The
 * claim made to Apple and Google is that the phone app never reaches it for an
 * identity with no account, so what is asserted is that the call did not
 * happen, not that a message came back. A refusal shown on screen while the
 * exchange ran anyway would look right to a person and be a false declaration
 * to a store.
 *
 * Mocked at the module boundary, because the native Google SDK cannot run
 * here; the callable itself is covered by
 * functions/test/integration/accountExists.integration.test.ts.
 */

const signIn = vi.fn();
const googleSdkSignOut = vi.fn();
const signInWithCredential = vi.fn();
const accountExists = vi.fn();

vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn(() => Promise.resolve(true)),
    signIn: (...a: unknown[]) => signIn(...a),
    signOut: (...a: unknown[]) => googleSdkSignOut(...a),
  },
  statusCodes: { SIGN_IN_CANCELLED: 'CANCELLED', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'NO_PLAY' },
  isSuccessResponse: (r: { type?: string }) => r?.type === 'success',
}));
vi.mock('firebase/auth', () => ({
  signInWithCredential: (...a: unknown[]) => signInWithCredential(...a),
  GoogleAuthProvider: { credential: (t: string) => ({ token: t }) },
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => (...a: unknown[]) => accountExists(...a),
}));
vi.mock('../firebase', () => ({ auth: {}, functions: {} }));

const { signInWithGoogle, exchangeGoogleIdToken } = await import('./google');

beforeEach(() => {
  vi.clearAllMocks();
  signIn.mockResolvedValue({ type: 'success', data: { idToken: 'tok' } });
  googleSdkSignOut.mockResolvedValue(undefined);
  signInWithCredential.mockResolvedValue({});
});

describe('the native Google door', () => {
  it('never exchanges the credential when no account exists', async () => {
    accountExists.mockResolvedValue({ data: { exists: false } });

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/no-account' });

    // THE ASSERTION THE EXEMPTION RESTS ON.
    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('clears the remembered Google account on refusal, so another can be tried', async () => {
    accountExists.mockResolvedValue({ data: { exists: false } });

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/no-account' });

    expect(googleSdkSignOut).toHaveBeenCalledTimes(1);
  });

  it('asks first, then signs in, when the account exists', async () => {
    const order: string[] = [];
    accountExists.mockImplementation(async () => {
      order.push('ask');
      return { data: { exists: true } };
    });
    signInWithCredential.mockImplementation(async () => {
      order.push('exchange');
      return {};
    });

    await expect(signInWithGoogle()).resolves.toBeUndefined();

    expect(accountExists).toHaveBeenCalledWith({ idToken: 'tok' });
    expect(order).toEqual(['ask', 'exchange']);
  });

  it('does not exchange when the question itself fails', async () => {
    // An unreachable callable must not fall through to signing in: that would
    // create the account the question exists to protect.
    accountExists.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }));

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'functions/internal' });

    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('gates the dev sign-in the same way (exchangeGoogleIdToken)', async () => {
    accountExists.mockResolvedValue({ data: { exists: false } });

    await expect(exchangeGoogleIdToken('{"email":"new@oursabeel.com"}')).rejects.toMatchObject({
      code: 'auth/no-account',
    });

    expect(signInWithCredential).not.toHaveBeenCalled();
  });

  it('treats a dismissed chooser as nothing at all', async () => {
    signIn.mockResolvedValue({ type: 'cancelled' });

    await expect(signInWithGoogle()).resolves.toBeUndefined();

    expect(accountExists).not.toHaveBeenCalled();
    expect(signInWithCredential).not.toHaveBeenCalled();
  });
});
