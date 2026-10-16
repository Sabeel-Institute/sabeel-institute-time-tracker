import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/**
 * Accept the institute's rules. The server records it on the person's profile
 * (functions/src/acceptRules.ts); the client cannot write that record itself
 * (firestore.rules). The profile listener in session.ts sees the record land,
 * and App.tsx moves on from the rules screen to Home.
 */
const acceptRulesFn = httpsCallable<void, { rulesVersion: number }>(functions, 'acceptRules');

export async function acceptRules(): Promise<void> {
  await acceptRulesFn();
}
