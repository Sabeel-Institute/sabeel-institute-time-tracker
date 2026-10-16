/**
 * Send one email as a Workspace user, with no password and no key: Google's
 * domain-wide delegation, signed by a service account the function may act as.
 *
 * 1. The function's own credentials (`accessToken`, Application Default
 *    Credentials in production) ask IAM Credentials to sign a JWT as the
 *    sender service account, naming the Workspace user as its subject and
 *    `gmail.send` as its only scope. That needs
 *    `roles/iam.serviceAccountTokenCreator` on the service account
 *    (docs/DEPLOY.md); the Workspace admin console authorises the service
 *    account's client id for that scope.
 * 2. Google's token endpoint exchanges the signed JWT for an access token
 *    that acts as the user.
 * 3. Gmail sends the message as that user.
 *
 * Pure of configuration: the service account, the user and the three
 * addresses come in as arguments, which is what lets `gmail.test.ts` stand a
 * local server in for all three of Google's endpoints and run this exact code.
 * Each step that Google refuses throws, naming the step and Google's reason.
 */

export interface GoogleEndpoints {
  iamCredentials: string;
  oauthToken: string;
  gmail: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  iamCredentials: 'https://iamcredentials.googleapis.com',
  oauthToken: 'https://oauth2.googleapis.com/token',
  gmail: 'https://gmail.googleapis.com',
};

/**
 * The JWT's audience is Google's token endpoint by name, wherever the exchange
 * is actually posted: it is a claim Google checks, not an address.
 */
export const TOKEN_AUDIENCE = 'https://oauth2.googleapis.com/token';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export interface DelegatedSender {
  /** The service account that signs, e.g. `report-mailer@<project>.iam.gserviceaccount.com`. */
  serviceAccount: string;
  /** The Workspace user the mail is sent as. */
  user: string;
  /** An access token for the caller's own identity, allowed to sign as `serviceAccount`. */
  accessToken: () => Promise<string>;
  endpoints?: GoogleEndpoints;
  now?: () => number;
}

/** Long enough for a slow answer, short enough that a hung one cannot hold the callable. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Google's reason for a refusal, from whichever error shape the endpoint uses. */
async function refusal(step: string, res: Response): Promise<Error> {
  const text = await res.text().catch(() => '');
  let reason = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string }; error_description?: string };
    if (typeof body.error === 'object' && body.error?.message) reason = body.error.message;
    else if (body.error_description) reason = `${body.error}: ${body.error_description}`;
    else if (typeof body.error === 'string') reason = body.error;
  } catch {
    // Not JSON: the text is the reason.
  }
  return new Error(`${step} refused (HTTP ${res.status}): ${reason}`);
}

async function post(step: string, url: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw await refusal(step, res);
  return res.json();
}

/** Sends `message` (an RFC 5322 message) and answers Gmail's id for it. */
export async function sendAsUser(message: string, s: DelegatedSender): Promise<{ messageId: string }> {
  const endpoints = s.endpoints ?? GOOGLE_ENDPOINTS;
  const iat = Math.floor((s.now ?? Date.now)() / 1000);

  // 1. A JWT, signed by the service account, that says "act as this user".
  const claims = {
    iss: s.serviceAccount,
    sub: s.user,
    scope: GMAIL_SEND_SCOPE,
    aud: TOKEN_AUDIENCE,
    iat,
    exp: iat + 3600,
  };
  const signed = (await post(
    'Signing the delegation token',
    `${endpoints.iamCredentials}/v1/projects/-/serviceAccounts/${encodeURIComponent(s.serviceAccount)}:signJwt`,
    {
      headers: { authorization: `Bearer ${await s.accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: JSON.stringify(claims) }),
    },
  )) as { signedJwt?: string };
  if (!signed.signedJwt) throw new Error('Signing the delegation token answered no signedJwt');

  // 2. That JWT, exchanged for an access token acting as the user.
  const token = (await post('Exchanging the delegation token', endpoints.oauthToken, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signed.signedJwt,
    }).toString(),
  })) as { access_token?: string };
  if (!token.access_token) throw new Error('Exchanging the delegation token answered no access_token');

  // 3. The message, sent as the user.
  const sent = (await post('Sending through Gmail', `${endpoints.gmail}/gmail/v1/users/me/messages/send`, {
    headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(message, 'utf8').toString('base64url') }),
  })) as { id?: string };
  if (!sent.id) throw new Error('Sending through Gmail answered no message id');
  return { messageId: sent.id };
}
