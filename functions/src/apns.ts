import { connect, constants } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import { APP_ID, encodeNotifRoute, type ApnsEnvironment, type NotifRoute } from '@sabeel/shared';

/**
 * Apple's push service, spoken to directly: HTTP/2, one request per device,
 * authorised by a token the server signs with the team's push key (a `.p8`).
 *
 * NOT THROUGH FCM. The app is built on the Firebase JS SDK, which has no
 * messaging on a phone, so an iPhone registers the token expo-notifications
 * gets from Apple: Apple's own device token, which FCM cannot address. Sending
 * to Apple needs nothing but the key, and the protocol is small and stable, so
 * node's own `http2` and `crypto` speak it.
 *
 * Pure of configuration: the key, its id and the team come in as arguments, and
 * so do Apple's two addresses, which is what lets `apns.test.ts` stand local
 * servers in for Apple. `messaging.ts` supplies the real ones. Imports nothing
 * relative, so `scripts/send-test-push.mjs` and `scripts/check-push.mjs` load it
 * from source and send exactly what a notification sends.
 */

/** Apple's two services. A token from one is refused by the other. */
export const APNS_ORIGINS: Record<ApnsEnvironment, string> = {
  production: 'https://api.push.apple.com',
  development: 'https://api.sandbox.push.apple.com',
};

/** What a notification says, and where a tap on it lands (notifyCore's `Notif`). */
export interface ApnsMessage {
  title: string;
  body: string;
  route: NotifRoute | null;
}

export interface ApnsCredentials {
  /** The `.p8` file's contents: a PKCS#8 PEM P-256 private key. */
  key: string;
  /** The key's id, the ten characters in its file name (`AuthKey_<id>.p8`). */
  keyId: string;
  /** The Apple developer team that owns the key and the app. */
  teamId: string;
}

export interface ApnsDevice {
  token: string;
  apnsEnvironment: ApnsEnvironment;
}

export interface ApnsOutcome {
  delivered: string[];
  /** Tokens Apple says will never work again: safe to delete. */
  dead: string[];
  /** Neither: Apple's reason, a status, or what went wrong on the way. */
  failed: { token: string; reason: string }[];
}

/**
 * The notification as Apple carries it.
 *
 * The route goes under `body`, as a dictionary, and nowhere else: for a remote
 * notification, expo-notifications on iOS hands the app `userInfo.body` as the
 * notification's `data` and nothing beside it, and `useNotifTaps` decodes the
 * route from that `data`. A route anywhere else arrives, shows, and opens
 * nothing. Android is the other way round: there a data KEY named `body` is
 * what gets taken (`fcm.ts`). One library, two platforms, opposite rules.
 */
export function apnsPayload(message: ApnsMessage) {
  return {
    aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
    body: message.route ? encodeNotifRoute(message.route) : {},
  };
}

/**
 * Apple's answers that mean the token will never work again.
 *
 * 410: the app was removed or the token expired. The two 400s are about the
 * TOKEN (malformed, from the other service, or another app's). Every other 400
 * (`BadPayload`, `MissingTopic`, ...) is about the MESSAGE and comes back for
 * every device at once, so pruning on it would unregister everyone.
 */
export function isDeadApnsAnswer(status: number, reason: string | undefined): boolean {
  if (status === 410) return true;
  return status === 400 && (reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic');
}

/** A device token as Apple issues it: hex. Anything else never came from Apple. */
const APNS_TOKEN = /^[0-9a-f]{64,200}$/i;

/**
 * The provider token: an ES256 JWT naming the key and the team.
 *
 * Apple refuses one older than an hour and answers `TooManyProviderTokenUpdates`
 * to a server that changes it more often than every twenty minutes, so one is
 * kept and reused for fifty. The signature is JOSE's raw `r||s` pair
 * (`ieee-p1363`), not the DER node writes by default, which Apple answers with
 * `InvalidProviderToken`.
 */
const TOKEN_REUSE_MS = 50 * 60 * 1000;
let minted: { jwt: string; keyId: string; teamId: string; at: number } | null = null;

export function providerToken(creds: ApnsCredentials, now: number): string {
  if (minted && minted.keyId === creds.keyId && minted.teamId === creds.teamId && now - minted.at < TOKEN_REUSE_MS) {
    return minted.jwt;
  }
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${part({ alg: 'ES256', kid: creds.keyId })}.${part({ iss: creds.teamId, iat: Math.floor(now / 1000) })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey(creds.key),
    dsaEncoding: 'ieee-p1363',
  });
  minted = { jwt: `${unsigned}.${signature.toString('base64url')}`, keyId: creds.keyId, teamId: creds.teamId, at: now };
  return minted.jwt;
}

/** Apple refused the provider token itself: the next send mints a new one. */
const PROVIDER_TOKEN_REFUSED = new Set(['ExpiredProviderToken', 'InvalidProviderToken']);

/** Long enough for a slow answer, short enough that a hung one cannot hold a trigger. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Send one message to each device, over one connection per service. Never
 * throws for a device's sake: every device ends delivered, dead or failed, and
 * the caller decides what an outcome means (`messaging.ts`).
 */
export async function sendToApns(
  devices: ApnsDevice[],
  message: ApnsMessage,
  creds: ApnsCredentials,
  origins: Record<ApnsEnvironment, string> = APNS_ORIGINS,
  now: number = Date.now(),
): Promise<ApnsOutcome> {
  const out: ApnsOutcome = { delivered: [], dead: [], failed: [] };
  const sendable = devices.filter((d) => {
    if (APNS_TOKEN.test(d.token)) return true;
    out.dead.push(d.token);
    return false;
  });
  if (sendable.length === 0) return out;

  const jwt = providerToken(creds, now);
  const body = JSON.stringify(apnsPayload(message));
  const environments = [...new Set(sendable.map((d) => d.apnsEnvironment))];

  await Promise.all(
    environments.map(async (environment) => {
      const session = connect(origins[environment]);
      // A connection that fails fails every request on it, and each request
      // reports that itself; without a listener the session's own 'error'
      // would be an uncaught exception that takes the instance down.
      session.on('error', () => undefined);
      try {
        await Promise.all(
          sendable
            .filter((d) => d.apnsEnvironment === environment)
            .map(async (d) => {
              try {
                const { status, reason } = await post(session, d.token, jwt, body);
                if (status === 200) out.delivered.push(d.token);
                else if (isDeadApnsAnswer(status, reason)) out.dead.push(d.token);
                else out.failed.push({ token: d.token, reason: reason ?? `HTTP ${status}` });
              } catch (e) {
                out.failed.push({ token: d.token, reason: e instanceof Error ? e.message : String(e) });
              }
            }),
        );
      } finally {
        session.close();
      }
    }),
  );

  if (out.failed.some((f) => PROVIDER_TOKEN_REFUSED.has(f.reason))) minted = null;
  return out;
}

function post(
  session: ReturnType<typeof connect>,
  token: string,
  jwt: string,
  body: string,
): Promise<{ status: number; reason: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': APP_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    let status = 0;
    const chunks: Buffer[] = [];
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close(constants.NGHTTP2_CANCEL);
      reject(new Error('no answer from Apple in time'));
    });
    req.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      // Apple answers a refusal with {"reason": "..."} and a success with nothing.
      let reason: string | undefined;
      try {
        reason = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as { reason?: string }).reason : undefined;
      } catch {
        reason = undefined;
      }
      resolve({ status, reason });
    });
    req.on('error', reject);
    req.end(body);
  });
}
