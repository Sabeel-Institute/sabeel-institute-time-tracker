// The ONE way to subscribe to live Firestore data from a hook. Every live hook
// in the app goes through here — never hand-roll onSnapshot state in a hook.
//
// Invariants (born of a real bug — see docs/POSTMORTEM-2026-07-16-stale-week.md):
//  1. State RESETS to `empty` the moment the subscription inputs change. React
//     state otherwise persists across dependency changes, so query A's results
//     would stay on screen while query B's first snapshot is in flight — on a
//     slow connection that showed one week's entries under another week.
//  2. Listener errors also reset to `empty`: an empty screen plus a console
//     warning beats silently-wrong data that never corrects itself.
import { useEffect, useState } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { captureError } from './sentry';

// ---- Listener-error visibility -------------------------------------------
// A server-rejected listen used to die as a console.warn nobody sees on a
// phone; the 2026-07-16 index-direction incident hid behind exactly that.
// Every screen shows the latest live-data error via useListenerError (the
// Screen component renders it); a later success from the same source clears it.
const errorWatchers = new Set<(msg: string | null) => void>();
let lastListenerError: string | null = null;

function reportListenerError(label: string, e: { code?: string; message: string }) {
  lastListenerError = `Live data error (${label}): ${e.code ?? e.message}`;
  errorWatchers.forEach((w) => w(lastListenerError));
  console.warn(`${label} listener`, e.code ?? e.message);
  // Off-device visibility: the 2026-07-16 index incident sat invisible in a
  // phone console for a day; with Sentry wired it is one dashboard event.
  captureError(e, { source: label });
}

function reportListenerSuccess(label: string) {
  if (lastListenerError?.includes(`(${label})`)) {
    lastListenerError = null;
    errorWatchers.forEach((w) => w(null));
  }
}

/** Latest live-listener failure, app-wide; null when healthy. */
export function useListenerError(): string | null {
  const [err, setErr] = useState(lastListenerError);
  useEffect(() => {
    errorWatchers.add(setErr);
    return () => {
      errorWatchers.delete(setErr);
    };
  }, []);
  return err;
}
// ---------------------------------------------------------------------------

/** How a live hook names, maps and empties what it subscribes to. */
interface LiveOptions<S, T> {
  /** Names the listener in the error banner and in Sentry. */
  label: string;
  map: (snap: S) => T;
  /** The value while loading, on error, and when `make` returns null. */
  empty: T;
}

/**
 * Live query results. `make`/`map` are called fresh per (re)subscription;
 * a null query means "not subscribed" (e.g. role-gated queries) → `empty`.
 *
 * ARGUMENT ORDER IS LOAD-BEARING. `make` first and `deps` second is the only
 * shape `react-hooks/exhaustive-deps` can read (eslint.config.mjs), and that
 * rule is what mechanically proves every live screen resubscribes when its
 * inputs change. Everything else is options so these two stay where the rule
 * looks: move them and the check goes quiet without failing.
 */
export function useLiveQuery<T>(
  make: () => Query | null,
  deps: readonly unknown[],
  { label, map, empty }: LiveOptions<QuerySnapshot, T>,
): T {
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    setValue(empty);
    const q = make();
    if (!q) return;
    return onSnapshot(
      q,
      (snap) => {
        setValue(map(snap));
        reportListenerSuccess(label);
      },
      (e) => {
        setValue(empty);
        reportListenerError(label, e);
      },
    );
    // deps are the caller's subscription inputs; make/map/empty are per-render
    // closures over exactly those inputs. This hook's contract IS a
    // caller-supplied dep list, so the rule cannot check it here; obeying it
    // would add make/map/empty, rebuilt every render, and re-open the listener
    // on every render of every live screen. Callers get no exemption: the rule
    // holds their `deps` to everything their `make` reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Live single document; argument order as useLiveQuery's, for the same rule. */
export function useLiveDoc<T>(
  make: () => DocumentReference | null,
  deps: readonly unknown[],
  { label, map, empty }: LiveOptions<DocumentSnapshot, T>,
): T {
  const [value, setValue] = useState<T>(empty);
  useEffect(() => {
    setValue(empty);
    const ref = make();
    if (!ref) return;
    return onSnapshot(
      ref,
      (snap) => {
        setValue(map(snap));
        reportListenerSuccess(label);
      },
      (e) => {
        setValue(empty);
        reportListenerError(label, e);
      },
    );
    // As in useLiveQuery: the caller's deps, which the rule checks at the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
