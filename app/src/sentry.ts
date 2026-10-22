// Native side of the Sentry seam (web sibling: sentry.web.ts). The DSN comes
// from gitignored app/.env.local (EXPO_PUBLIC_SENTRY_DSN_NATIVE, Android and
// iOS), inlined at bundle time; without it everything here is a no-op. Release
// builds upload their source maps (app/android/app/build.gradle's sentry.gradle,
// Xcode's Sentry phase), so their stacks read as source.
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN_NATIVE;

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({ dsn, tracesSampleRate: 0 });
}

/** Report a handled error (e.g. a rejected Firestore listener) with context tags. */
export function captureError(e: unknown, tags?: Record<string, string>): void {
  if (!dsn) return;
  Sentry.captureException(e, { tags });
}

/**
 * Attach the signed-in user's uid to events (null on sign-out). Uid only — it
 * correlates with the users collection without putting email/PII in Sentry.
 */
export function setSentryUser(uid: string | null): void {
  if (!dsn) return;
  Sentry.setUser(uid ? { id: uid } : null);
}
