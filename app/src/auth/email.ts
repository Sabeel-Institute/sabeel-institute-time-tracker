// Email-and-password sign-in, the same on every platform.
//
// One account may use it, an ordinary member an administrator made
// (PASSWORD_ACCOUNT_EMAIL in @sabeel/shared); the server refuses every other
// address (functions/src/signInGate.ts) and gives a password session no more
// than a member's rights. So this is sign-IN only. There is deliberately no
// sign-up and no password reset here or anywhere in the app: signing in with a
// password cannot create an account, and nothing may point at a way to make one
// (docs/STORE-RELEASE.md).
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}
