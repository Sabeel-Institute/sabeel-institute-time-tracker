import * as Sentry from '@sentry/node';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

/** Shared declaration — bind via `secrets: [sentryDsn]` wherever capture matters. */
export const sentryDsn = defineSecret('SENTRY_DSN');

let initialized = false;

/**
 * Initialize Sentry once, lazily, from a DSN provided at call time (Secret Manager).
 * Returns true if Sentry is ready to receive events.
 */
function ensureSentry(dsn: string | undefined): boolean {
  if (initialized) {
    return true;
  }
  if (!dsn || !dsn.startsWith('https://')) {
    return false;
  }
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: {
        request: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      },
      httpBodies: [],
      urlQueryParams: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
    },
    environment: process.env.NODE_ENV ?? 'development',
  });
  initialized = true;
  return true;
}

/**
 * Report an UNEXPECTED error. HttpsErrors are expected domain outcomes
 * (unauthenticated, invalid-argument, …) — they go to the caller, not Sentry.
 * Serverless: flush before returning or the event may never leave the instance.
 */
export async function reportError(e: unknown): Promise<void> {
  if (e instanceof HttpsError) return;
  if (ensureSentry(process.env.SENTRY_DSN)) {
    Sentry.captureException(e);
    await Sentry.flush(2000).catch(() => undefined);
  }
}

/**
 * Report a non-exception condition worth a human's attention (e.g. the health
 * canary spotting that document counts dropped). Not an error — nothing threw —
 * so `captureException` would be misleading; this raises a message at
 * error level with structured context attached.
 */
export async function reportMessage(
  message: string,
  context: Record<string, unknown> = {},
): Promise<void> {
  if (ensureSentry(process.env.SENTRY_DSN)) {
    Sentry.captureMessage(message, { level: 'error', extra: context });
    await Sentry.flush(2000).catch(() => undefined);
  }
}

/**
 * Cron check-ins for a scheduled job. Sentry alerts when a check-in does NOT
 * arrive on schedule — the only way to notice a job that has silently stopped
 * running. (A job that never runs also never reports its own failure; that blind
 * spot once hid a broken nightly sync for over a week.) The monitor config is
 * sent with each check-in, which upserts it — no console setup step.
 *
 * Two-phase by design: `start` opens the check-in, `finish` closes it, which
 * also tells Sentry how long the run took.
 */
function monitorConfig(schedule: string) {
  return {
    schedule: { type: 'crontab' as const, value: schedule },
    // Generous margins: a cold start or a slow read must not page anyone.
    checkinMargin: 60,
    maxRuntime: 10,
  };
}

/** Returns a check-in id to pass to `finishCheckIn`, or null if Sentry is off. */
export function startCheckIn(monitorSlug: string, schedule: string): string | null {
  if (!ensureSentry(process.env.SENTRY_DSN)) return null;
  return Sentry.captureCheckIn({ monitorSlug, status: 'in_progress' }, monitorConfig(schedule));
}

export async function finishCheckIn(
  checkInId: string | null,
  monitorSlug: string,
  status: 'ok' | 'error',
  schedule: string,
): Promise<void> {
  if (!checkInId) return;
  Sentry.captureCheckIn({ checkInId, monitorSlug, status }, monitorConfig(schedule));
  await Sentry.flush(2000).catch(() => undefined);
}

/** Wrap a callable handler: unexpected failures reach Sentry, then rethrow. */
export function guarded<Req, Res>(
  fn: (req: CallableRequest<Req>) => Promise<Res>,
): (req: CallableRequest<Req>) => Promise<Res> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      await reportError(e);
      throw e;
    }
  };
}
