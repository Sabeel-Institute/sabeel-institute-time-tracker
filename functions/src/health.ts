import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@sabeel/shared';
import { finishCheckIn, reportError, reportMessage, sentryDsn, startCheckIn } from './sentry';

/**
 * The anomaly canary.
 *
 * Backups retain 14 weeks (Firestore's maximum), but retention only helps if the
 * problem is noticed while a good backup still exists. The bad case is a
 * corruption just before a quiet period — every later backup faithfully captures
 * the already-broken state, and by the time anyone looks the last good one has
 * aged out. Detection is the cheap lever: notice in days and 14 weeks is ample.
 *
 * So once a day this counts documents per collection, compares against the
 * previous run, and raises to Sentry when a count drops more than that
 * collection tolerates. It also sends a Sentry cron check-in, so the job going
 * SILENT is itself an alert — the failure mode that hid a broken nightly sync
 * for over a week.
 *
 * Deliberately not a UI feature: "timeEntries fell 40%" is an operator signal,
 * not something an admin in the app can act on.
 */

/** Daily at 03:15 UTC — quiet, and clear of the Monday backup window. */
const HEALTH_SCHEDULE = '15 3 * * *';
const MONITOR_SLUG = 'firestore-health';
const HEALTH_DOC = 'meta/health';

/**
 * How much of a drop each collection tolerates between runs.
 *
 * `zeroTolerance` — any decrease at all is suspicious:
 *  - `activities` are never deleted (firestore.rules: `allow delete: if false`);
 *  - `users` are removed only by a deliberate admin-SDK operation;
 *  - `reports` are never deleted: no client may touch them and no function
 *    removes one, so a report that disappears is the record being lost.
 *
 * The rest shrink in normal use (people delete their own entries; withdrawing or
 * reopening a timesheet deletes its doc), so they alert on a drop bigger than
 * `max(minDrop, fraction × previous)`. The floor keeps a tiny dataset from
 * alerting on routine tidying; the fraction keeps it meaningful as data grows.
 */
interface DropRule {
  zeroTolerance?: boolean;
  minDrop?: number;
  fraction?: number;
}
const DROP_RULES: Record<string, DropRule> = {
  [COLLECTIONS.users]: { zeroTolerance: true },
  [COLLECTIONS.activities]: { zeroTolerance: true },
  [COLLECTIONS.reports]: { zeroTolerance: true },
  [COLLECTIONS.timeEntries]: { minDrop: 5, fraction: 0.2 },
  [COLLECTIONS.timesheets]: { minDrop: 5, fraction: 0.2 },
};

export type Counts = Record<string, number>;

export interface Finding {
  collection: string;
  previous: number;
  current: number;
  dropped: number;
  /** The drop that would have been tolerated for this collection. */
  allowed: number;
}

/**
 * Pure comparison — no I/O, so the alerting policy is exhaustively unit-testable.
 * Returns one finding per collection whose drop exceeds its tolerance. A missing
 * previous count (first ever run, or a newly added collection) yields nothing:
 * there is no baseline to judge against, and inventing one would cry wolf.
 */
export function evaluateCounts(previous: Counts | null, current: Counts): Finding[] {
  if (!previous) return [];
  const findings: Finding[] = [];
  for (const [collection, now] of Object.entries(current)) {
    const before = previous[collection];
    if (typeof before !== 'number') continue;
    const dropped = before - now;
    if (dropped <= 0) continue;

    const rule = DROP_RULES[collection] ?? { minDrop: 5, fraction: 0.2 };
    const allowed = rule.zeroTolerance
      ? 0
      : Math.max(rule.minDrop ?? 5, Math.floor(before * (rule.fraction ?? 0.2)));
    if (dropped > allowed) {
      findings.push({ collection, previous: before, current: now, dropped, allowed });
    }
  }
  return findings;
}

/** Count documents per collection using the count() aggregation — one cheap
 *  aggregation query each, never a full document read. */
async function currentCounts(): Promise<Counts> {
  const db = getFirestore();
  const names = Object.values(COLLECTIONS);
  const counts: Counts = {};
  await Promise.all(
    names.map(async (name) => {
      const snap = await db.collection(name).count().get();
      counts[name] = snap.data().count;
    }),
  );
  return counts;
}

/**
 * Core of the canary, callable directly so integration tests drive it against
 * the emulators. Reads the previous snapshot, counts, compares, stores the new
 * snapshot, and returns what it found.
 */
export async function runHealthCheck(now: number): Promise<{
  counts: Counts;
  findings: Finding[];
}> {
  const db = getFirestore();
  const ref = db.doc(HEALTH_DOC);
  const prevSnap = await ref.get();
  const previous = prevSnap.exists ? ((prevSnap.data()?.counts as Counts) ?? null) : null;

  const counts = await currentCounts();
  const findings = evaluateCounts(previous, counts);

  // Always record the new baseline — including when something looked wrong.
  // Otherwise a single bad day would re-alert forever against a frozen baseline.
  await ref.set({ checkedAt: now, counts, previousCounts: previous ?? null });

  return { counts, findings };
}

export const healthCheck = onSchedule(
  { schedule: HEALTH_SCHEDULE, secrets: [sentryDsn] },
  async () => {
    const checkInId = startCheckIn(MONITOR_SLUG, HEALTH_SCHEDULE);
    try {
      const { counts, findings } = await runHealthCheck(Date.now());
      if (findings.length > 0) {
        await reportMessage(
          `Firestore health: ${findings.length} collection(s) shrank unexpectedly`,
          { findings, counts },
        );
      }
      console.log(
        `healthCheck: ${JSON.stringify(counts)}${findings.length ? ` — ${findings.length} finding(s)` : ''}`,
      );
      await finishCheckIn(checkInId, MONITOR_SLUG, 'ok', HEALTH_SCHEDULE);
    } catch (e) {
      await reportError(e);
      await finishCheckIn(checkInId, MONITOR_SLUG, 'error', HEALTH_SCHEDULE);
      throw e;
    }
  },
);
