import { getMessaging } from 'firebase-admin/messaging';
import { defineSecret, defineString } from 'firebase-functions/params';
import type { PushTokenDoc } from '@sabeel/shared';
import type { Notif } from './notifyCore';
import { DEAD_TOKEN_CODES, fcmMessage } from './fcm';
import { sendToApns, type ApnsCredentials } from './apns';
import { reportError } from './sentry';

/**
 * The one place a push leaves the server: FCM for Android phones and browsers,
 * Apple's push service for iPhones (`apns.ts`).
 *
 * A SEAM: there is no FCM or APNs emulator, so the emulated functions must not
 * send at all (`emulatorSender`), and only this file is unverified until a real
 * device confirms delivery (`npx sabeel-ci send-test-push`). Per-device failures
 * come back as results, not throws, so the caller can prune dead registrations.
 */

export interface SendOutcome {
  /** Tokens the transport rejected as never valid again: safe to delete. */
  stale: string[];
  /** How many devices the message was accepted for. */
  sent: number;
}

type Sender = (devices: PushTokenDoc[], notif: Notif) => Promise<SendOutcome>;

/** FCM's verdict that a token will never work again (`DEAD_TOKEN_CODES`, fcm.ts). */
function isDeadToken(code: string | undefined): boolean {
  return !!code && DEAD_TOKEN_CODES.has(code);
}

async function sendToFcm(tokens: string[], notif: Notif): Promise<SendOutcome> {
  if (tokens.length === 0) return { stale: [], sent: 0 };
  const res = await getMessaging().sendEachForMulticast({ tokens, ...fcmMessage(notif) });
  const stale = res.responses.flatMap((r, i) =>
    !r.success && isDeadToken((r.error as { code?: string } | undefined)?.code) ? [tokens[i]] : [],
  );
  return { stale, sent: res.successCount };
}

/**
 * Apple's key, as a Secret Manager secret, and the two ids that go with it.
 * The ids are not secret (the team's is in every signed app, and the key's is
 * useless without the key); their values are in the committed
 * `functions/.env.<project>` files, the demo project's included, so the
 * emulator never stops to ask for them.
 */
const APNS_KEY = defineSecret('APNS_KEY');
const APNS_KEY_ID = defineString('APNS_KEY_ID', {
  description: "The APNs key's id, from its file name (AuthKey_<id>.p8)",
});
const APPLE_TEAM_ID = defineString('APPLE_TEAM_ID', {
  description: 'The Apple developer team that owns the app and the APNs key',
});

/**
 * What a function must bind to send a push: every function that calls
 * `sendToUser` does, and `pushSecrets.test.ts` finds them and holds them to it.
 * A secret that is not bound reads as empty at runtime, and every iPhone would
 * be refused while Android and the web kept working.
 */
export const PUSH_SECRETS = [APNS_KEY];

function apnsCredentials(): ApnsCredentials {
  const key = APNS_KEY.value();
  if (!key) throw new Error('APNS_KEY is not bound to this function: add PUSH_SECRETS to its secrets');
  return { key, keyId: APNS_KEY_ID.value(), teamId: APPLE_TEAM_ID.value() };
}

async function sendToApple(devices: Extract<PushTokenDoc, { platform: 'ios' }>[], notif: Notif): Promise<SendOutcome> {
  if (devices.length === 0) return { stale: [], sent: 0 };
  const out = await sendToApns(
    devices.map((d) => ({ token: d.token, apnsEnvironment: d.apnsEnvironment, message: notif })),
    apnsCredentials(),
  );
  // Reasons only: a token is an address, and the log has no use for one.
  for (const f of out.failed) console.warn(`apns: not delivered (${f.reason})`);
  return { stale: out.dead, sent: out.delivered.length };
}

/**
 * Each device through its own service, both at once.
 *
 * ONE SERVICE FAILING DOES NOT UNDO THE OTHER. When neither delivered anything,
 * the first failure is thrown, as a lone FCM failure always was. When one did
 * deliver, the other's failure is reported to Sentry instead, so a retry cannot
 * tell the people who already heard it a second time.
 */
const deviceSender: Sender = async (devices, notif) => {
  const apple = devices.filter((d) => d.platform === 'ios');
  const google = devices.flatMap((d) => (d.platform === 'ios' ? [] : [d.token]));
  const settled = await Promise.allSettled([sendToFcm(google, notif), sendToApple(apple, notif)]);
  const outcomes = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failures = settled.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
  const sent = outcomes.reduce((n, o) => n + o.sent, 0);
  if (failures.length > 0 && sent === 0) throw failures[0];
  for (const e of failures) await reportError(e);
  return { stale: outcomes.flatMap((o) => o.stale), sent };
};

/**
 * Under the emulator, send nothing and prune nothing. A send from the emulated
 * functions cannot succeed (there is no FCM or APNs emulator, and APNS_KEY is a
 * placeholder there), and whatever came back would be read as a verdict on real
 * registrations and delete them.
 */
const emulatorSender: Sender = async (devices) => {
  console.log(`[emulator] push suppressed for ${devices.length} device(s)`);
  return { stale: [], sent: devices.length };
};

/**
 * Chosen once, at load. `FUNCTIONS_EMULATOR` is set to "true" by the emulator
 * alone, never in a deployed runtime; any other value is production
 * (messaging.test.ts holds both directions).
 */
const sender: Sender = process.env.FUNCTIONS_EMULATOR === 'true' ? emulatorSender : deviceSender;

export function send(devices: PushTokenDoc[], notif: Notif): Promise<SendOutcome> {
  return sender(devices, notif);
}
