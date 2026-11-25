import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, type Query } from 'firebase-admin/firestore';
import {
  addDays,
  isDayKey,
  REPORT_COLUMNS,
  reportRow,
  type ReportFilter,
  type Totals,
  type TimeEntryDoc,
  type TimesheetDoc,
} from '@sabeel/shared';
import { requireManagerOrAdmin } from './auth';
import { guarded, sentryDsn } from './sentry';

function validate(data: unknown): ReportFilter {
  const d = data as Partial<ReportFilter> | null;
  if (!d || !isDayKey(d.fromKey) || !isDayKey(d.toKey)) {
    throw new HttpsError('invalid-argument', 'fromKey and toKey must be YYYY-MM-DD.');
  }
  if (d.fromKey > d.toKey) {
    throw new HttpsError('invalid-argument', 'fromKey must be on or before toKey.');
  }
  return {
    fromKey: d.fromKey,
    toKey: d.toKey,
    ...(typeof d.uid === 'string' ? { uid: d.uid } : {}),
    ...(typeof d.activityId === 'string' ? { activityId: d.activityId } : {}),
    ...(d.includeUnapproved === true ? { includeUnapproved: true } : {}),
  };
}

/**
 * Ids (`${uid}_${periodKey}`) of APPROVED timesheets whose period overlaps the
 * inclusive [fromKey, toKey] dayKey range. Periods span at most 7 days, so a
 * period overlapping the range must start no earlier than fromKey-6.
 */
function approvedPeriodsQuery(fromKey: string, toKey: string): Query {
  return getFirestore()
    .collection('timesheets')
    .where('status', '==', 'approved')
    .where('periodKey', '>=', addDays(fromKey, -6))
    .where('periodKey', '<=', toKey);
}

/** Build the filtered, dayKey-ordered query shared by the CSV export and totals. */
function entriesQuery(input: ReportFilter): Query {
  let q: Query = getFirestore().collection('timeEntries');
  if (input.uid) q = q.where('uid', '==', input.uid);
  if (input.activityId) q = q.where('activityId', '==', input.activityId);
  q = q
    .where('dayKey', '>=', input.fromKey)
    .where('dayKey', '<=', input.toKey)
    .orderBy('dayKey');
  return q;
}

/**
 * Official reports read the hours and their approvals at the same point in
 * time. Otherwise a concurrent edit and approval can certify an older set.
 */
async function reportEntries(input: ReportFilter): Promise<TimeEntryDoc[]> {
  const db = getFirestore();
  const entries = entriesQuery(input);
  const closedRows = (docs: { data(): unknown }[]) => docs
    .map((doc) => doc.data() as TimeEntryDoc)
    .filter((entry) => entry.end !== null);
  if (input.includeUnapproved) return closedRows((await entries.get()).docs);

  return db.runTransaction(async (tx) => {
    const [hours, sheets] = await Promise.all([
      tx.get(entries),
      tx.get(approvedPeriodsQuery(input.fromKey, input.toKey)),
    ]);
    const approved = new Map(sheets.docs.map((doc) => [doc.id, (doc.data() as TimesheetDoc).toKey]));
    return closedRows(hours.docs).filter((entry) => {
      const toKey = approved.get(entry.uid + '_' + entry.periodKey);
      return toKey !== undefined && entry.dayKey >= entry.periodKey && entry.dayKey <= toKey;
    });
  }, { readOnly: true });
}

export function csvCell(v: string | number): string {
  let s = String(v);
  // CSV formula injection: a cell a spreadsheet reads as starting with = + - @
  // (or a leading tab/CR) is executed as a formula when the file is opened in
  // Excel. Neutralize by prefixing a single quote — this guards the downloaded
  // export. User-controlled fields: note, activity, name.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Closed entries (approved-only unless asked otherwise) → CSV, times rendered
 *  in each entry's own timezone. People show as name + email, never raw uids. */
export async function buildCsv(input: ReportFilter): Promise<string> {
  const rows = await reportEntries(input);

  const uids = [...new Set(rows.map((e) => e.uid))];
  const people = new Map<string, { name: string; email: string }>();
  await Promise.all(
    uids.map(async (uid) => {
      const u = await getFirestore().collection('users').doc(uid).get();
      people.set(uid, {
        name: (u.data()?.displayName as string) ?? uid,
        email: (u.data()?.email as string) ?? '',
      });
    }),
  );

  const lines = [REPORT_COLUMNS.map(csvCell).join(',')];
  for (const e of rows) {
    const person = people.get(e.uid) ?? { name: e.uid, email: '' };
    lines.push(reportRow(e, person).map(csvCell).join(','));
  }
  return lines.join('\n');
}

/** In-memory rollups for dashboards over the same filtered set. `byPerson` is
 *  resolved to display names here so the wire shape (shared `Totals`) is whole. */
export async function computeTotals(input: ReportFilter): Promise<Totals> {
  const rows = await reportEntries(input);

  const act = new Map<string, { activityName: string; minutes: number }>();
  const per = new Map<string, number>();
  let total = 0;
  for (const e of rows) {
    const m = e.durationMinutes ?? 0;
    total += m;
    const a = act.get(e.activityId) ?? { activityName: e.activityName, minutes: 0 };
    a.minutes += m;
    act.set(e.activityId, a);
    per.set(e.uid, (per.get(e.uid) ?? 0) + m);
  }

  // Resolve display names so the dashboard shows people, not uids.
  const names = new Map<string, string>();
  await Promise.all(
    [...per.keys()].map(async (uid) => {
      const u = await getFirestore().collection('users').doc(uid).get();
      names.set(uid, (u.data()?.displayName as string) ?? uid);
    }),
  );

  return {
    totalMinutes: total,
    byActivity: [...act.entries()]
      .map(([activityId, v]) => ({ activityId, ...v }))
      .sort((a, b) => b.minutes - a.minutes),
    byPerson: [...per.entries()]
      .map(([uid, minutes]) => ({ uid, displayName: names.get(uid) ?? uid, minutes }))
      .sort((a, b) => b.minutes - a.minutes),
  };
}

export const exportCsv = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => {
    requireManagerOrAdmin(req);
    const input = validate(req.data);
    const csv = await buildCsv(input);
    const suffix = input.includeUnapproved ? '_unofficial' : '';
    return { csv, filename: `hours_${input.fromKey}_to_${input.toKey}${suffix}.csv` };
  }),
);

export const reportTotals = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) => {
    requireManagerOrAdmin(req);
    return computeTotals(validate(req.data));
  }),
);

