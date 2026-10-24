// Web side of the Sentry seam (native sibling: sentry.ts). The DSN comes from
// gitignored app/.env.local (EXPO_PUBLIC_SENTRY_DSN_WEB), inlined at bundle
// time; without it everything here is a no-op. Deploy Web uploads the export's
// source maps, matched to its scripts by the debug ids app/metro.config.js adds.
//
// Named imports, not `import * as Sentry`: the export is tree-shaken
// (`sabeel-ci build-web`), and only these leave the rest of the SDK, session
// replay and the feedback widget among it, out of the bundle.
import { captureException, init, setUser } from '@sentry/react';
import { USE_EMULATORS } from './env';

// Off for a build pointed at the emulators: the browser suites build with the
// DSN from .env.local, and would otherwise file every test error into the
// production project.
const dsn = USE_EMULATORS ? undefined : process.env.EXPO_PUBLIC_SENTRY_DSN_WEB;

export function initSentry(): void {
  if (!dsn) return;
  init({ dsn, tracesSampleRate: 0 });
}

/** Report a handled error (e.g. a rejected Firestore listener) with context tags. */
export function captureError(e: unknown, tags?: Record<string, string>): void {
  if (!dsn) return;
  captureException(e, { tags });
}

/**
 * Attach the signed-in user's uid to events (null on sign-out). Uid only — it
 * correlates with the users collection without putting email/PII in Sentry.
 */
export function setSentryUser(uid: string | null): void {
  if (!dsn) return;
  setUser(uid ? { id: uid } : null);
}
