import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { requireAdmin } from './auth';
import { guarded, sentryDsn } from './sentry';

export interface UserAccessInput {
  uid: string;
  status?: 'active' | 'disabled';
  role?: 'member' | 'manager';
  admin?: boolean;
}

function validateInput(data: unknown): UserAccessInput {
  const d = data as Partial<UserAccessInput> | null;
  if (!d || typeof d.uid !== 'string' || d.uid.length === 0) {
    throw new HttpsError('invalid-argument', 'uid is required.');
  }
  if (d.status !== undefined && d.status !== 'active' && d.status !== 'disabled') {
    throw new HttpsError('invalid-argument', 'status must be active or disabled.');
  }
  if (d.role !== undefined && d.role !== 'member' && d.role !== 'manager') {
    throw new HttpsError('invalid-argument', 'role must be member or manager.');
  }
  if (d.admin !== undefined && typeof d.admin !== 'boolean') {
    throw new HttpsError('invalid-argument', 'admin must be a boolean.');
  }
  if (d.status === undefined && d.role === undefined && d.admin === undefined) {
    throw new HttpsError('invalid-argument', 'Nothing to change.');
  }
  return { uid: d.uid, status: d.status, role: d.role, admin: d.admin };
}

interface Access {
  status: string;
  role: string;
  admin: boolean;
}

/** Who may be someone's timesheet approver — mirrors approverOk in firestore.rules. */
function isEligibleApprover(u: Access): boolean {
  return u.status === 'active' && (u.role === 'manager' || u.admin === true);
}

/**
 * Clear every users/{uid}.approverUid pointing at this account — their own
 * included, since a manager may be their own approver.
 *
 * An approver is validated when the pointer is WRITTEN and never again, so a
 * pointer that outlives the role is a real hazard: submissions keep stamping a
 * person who is no longer entitled to decide. Rules now re-check the role at
 * decide time, but a stale pointer would still strand the submitter on a sheet
 * only an admin could clear. Cheaper to have no dangling pointers at all.
 */
async function clearApproverPointers(approverUid: string): Promise<number> {
  const db = getFirestore();
  const pointing = await db.collection('users').where('approverUid', '==', approverUid).get();
  if (pointing.empty) return 0;
  const batch = db.batch();
  for (const d of pointing.docs) batch.update(d.ref, { approverUid: null });
  await batch.commit();
  return pointing.size;
}

/**
 * Core of setUserAccess, callable-independent so integration tests can drive it
 * against the emulators. Merges the requested changes into the user doc and
 * mirrors { role, status, admin } into custom claims — the doc is for UI, the
 * claims are what security rules trust.
 */
export async function applyUserAccess(callerUid: string, input: UserAccessInput) {
  const db = getFirestore();
  const auth = getAuth();

  const userRef = db.collection('users').doc(input.uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'No such user.');
  }
  const current = snap.data() as Access;

  // An admin may not strip their own admin flag or disable themselves — prevents
  // locking the org out of user management entirely.
  if (input.uid === callerUid && (input.admin === false || input.status === 'disabled')) {
    throw new HttpsError('failed-precondition', 'You cannot demote or disable yourself.');
  }

  const next = {
    status: input.status ?? current.status,
    role: input.role ?? current.role,
    admin: input.admin ?? current.admin,
  };

  // An account that signs in only with a password (PASSWORD_ACCOUNT_EMAIL in
  // @sabeel/shared) is a member and nothing more. The rules and the callables
  // already ignore a password session's roles; refusing the promotion keeps the
  // Users screen from showing one it would never get.
  if (next.role === 'manager' || next.admin === true) {
    const providers = (await auth.getUser(input.uid)).providerData.map((p) => p.providerId);
    if (providers.includes('password') && !providers.includes('google.com')) {
      throw new HttpsError(
        'failed-precondition',
        'An account that signs in with an email and password can only be a member.',
      );
    }
  }

  await auth.setCustomUserClaims(input.uid, next);

  // Epoch ms like every other timestamp in the shared types (see UserDoc).
  // claimsUpdatedAt moves on every claims change; the client watches it and
  // force-refreshes its token, so approval un-gates within a second (no poll).
  const docUpdate: Record<string, unknown> = { ...next, claimsUpdatedAt: Date.now() };
  if (current.status === 'pending' && next.status === 'active') {
    docUpdate.approvedAt = Date.now();
    docUpdate.approvedBy = callerUid;
  }
  await userRef.update(docUpdate);

  // Demotion, disabling, or losing admin can strip approver eligibility — drop
  // the pointers rather than leave them dangling. Skipped unless the account was
  // eligible before, so the common case (approving a pending signup) costs nothing.
  // No return value: the cascade is already visible to the admin who caused it
  // (the Users list's Approver column blanks live) and to the affected user (their
  // timesheet says to pick an approver before submitting).
  if (isEligibleApprover(current) && !isEligibleApprover(next)) {
    const cleared = await clearApproverPointers(input.uid);
    if (cleared > 0) {
      console.log(`applyUserAccess: ${input.uid} lost approver eligibility — cleared ${cleared}`);
    }
  }

  // Losing access must not wait for a token to expire. Rules trust the ID token,
  // which lives up to an hour, so new claims alone don't stop someone already
  // holding one. A connected client force-refreshes immediately (it watches
  // claimsUpdatedAt); revoking the refresh token closes the other case, where the
  // app is backgrounded or offline and would otherwise keep its old rights until
  // expiry. Residual window: an ID token already in hand stays valid until it
  // expires — Firestore rules cannot check revocation time.
  const lostAccess =
    (current.status === 'active' && next.status !== 'active') ||
    (current.role === 'manager' && next.role !== 'manager') ||
    (current.admin === true && next.admin !== true);
  if (lostAccess) {
    await auth.revokeRefreshTokens(input.uid);
  }

  return next;
}

/** Only admins approve/disable users or change roles (product decision). */
export const setUserAccess = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => {
    const callerUid = requireAdmin(req);
    const input = validateInput(req.data);
    return applyUserAccess(callerUid, input);
  }),
);
