import './setup';
import * as functionsV1 from 'firebase-functions/v1';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { decideProvision, type ProvisionDecision } from './provision';

/**
 * The effectful half of provisioning, extracted from the trigger so it can be
 * integration-tested directly against the emulators (like `applyUserAccess`),
 * the trigger itself being thin wiring. Given a new auth user it either deletes
 * a non-org account or writes pending claims + a forced-pending user doc.
 */
export async function applyProvision(user: {
  uid: string;
  email?: string | null;
  emailVerified?: boolean;
  displayName?: string | null;
  photoURL?: string | null;
}): Promise<ProvisionDecision> {
  const decision = decideProvision(user);

  if (decision.action === 'reject') {
    functionsV1.logger.warn('Rejected sign-up outside the org domain', {
      uid: user.uid,
      email: decision.email,
    });
    await getAuth().deleteUser(user.uid);
    return decision;
  }

  const { claims, profile } = decision;
  // Claims first: the token is what rules trust. If the doc write failed after,
  // we'd have a claimless user who can do nothing (pending grants nothing) rather
  // than a doc-but-no-claims user the client would misread as approved.
  await getAuth().setCustomUserClaims(user.uid, claims);

  const now = Date.now();
  await getFirestore()
    .doc(`users/${user.uid}`)
    .set({
      displayName: profile.displayName,
      email: profile.email,
      photoURL: profile.photoURL,
      status: claims.status,
      role: claims.role,
      admin: claims.admin,
      approverUid: null,
      createdAt: now,
      claimsUpdatedAt: now,
    });

  functionsV1.logger.info('Provisioned pending account', {
    uid: user.uid,
    email: profile.email,
  });
  return decision;
}

/**
 * The SOLE provisioner of accounts. Runs on every new Firebase Auth user; the
 * client never writes its own user doc (firestore.rules: users `allow create: if
 * false`). Not a verified @oursabeel.com address → the Auth user is deleted
 * outright, leaving no trace. Valid address → pending claims + a mirrored,
 * forced-pending doc (an admin must approve). The domain gate lives once, in the
 * pure `decideProvision`.
 *
 * Gen-1 auth trigger: the blocking `beforeUserCreated` would reject before the
 * Auth user exists, but needs an Identity Platform upgrade. The window this leaves
 * open is not exploitable — a claimless account can read nothing (rules gate on
 * `status == 'active'`). Same strategy as the sibling kanban app.
 */
export const onUserCreate = functionsV1
  .region('us-central1')
  .auth.user()
  .onCreate((user) =>
    applyProvision({
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoURL: user.photoURL,
    }),
  );
