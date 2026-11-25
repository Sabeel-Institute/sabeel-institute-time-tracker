import { entryDisplayTimeZone, timeOfDayFor } from './time';
import type { TimeEntryDoc } from './types';

/**
 * The one reporting contract, shared by the client callers (app/src/reporting.ts)
 * and the function handlers (functions/src/reporting.ts). Kept here so the wire
 * shapes can't drift between the two sides.
 */

/** Request filter for reports and CSV export. */
export interface ReportFilter {
  uid?: string;
  activityId?: string;
  /** inclusive dayKey 'YYYY-MM-DD' */
  fromKey: string;
  /** inclusive dayKey 'YYYY-MM-DD' */
  toKey: string;
  /** Official numbers are approved-timesheets-only; true adds unapproved hours (unofficial view). */
  includeUnapproved?: boolean;
}

/** Dashboard rollups over the filtered set. `byPerson` carries the display name
 *  so the UI shows people, never raw uids. */
export interface Totals {
  totalMinutes: number;
  byActivity: { activityId: string; activityName: string; minutes: number }[];
  byPerson: { uid: string; displayName: string; minutes: number }[];
}

/** The columns of the per-entry report grid, shared by the CSV export and the
 *  row projection below. Reorder/add here once. */
export const REPORT_COLUMNS = [
  'Person',
  'Email',
  'Activity',
  'Date',
  'Start',
  'End',
  'Timezone',
  'Hours',
  'Minutes',
  'Source',
  'Note',
] as const;

/**
 * Project one CLOSED entry into a report row, times rendered in the entry's own
 * timezone. `person` is pre-resolved to name + email (never a raw uid). Hours is
 * a 2-decimal number; the CSV writer stringifies it, the Sheet keeps it numeric.
 * Callers must exclude running sessions (end === null) before calling.
 */
export function reportRow(
  entry: TimeEntryDoc,
  person: { name: string; email: string },
): (string | number)[] {
  const minutes = entry.durationMinutes ?? 0;
  const zone = entryDisplayTimeZone(entry.timeZone);
  return [
    person.name,
    person.email,
    entry.activityName,
    entry.dayKey,
    timeOfDayFor(entry.start, zone),
    timeOfDayFor(entry.end as number, zone),
    zone === entry.timeZone ? zone : 'UTC (stored time zone unavailable)',
    Number((minutes / 60).toFixed(2)),
    minutes,
    entry.source,
    entry.note ?? '',
  ];
}
