// The hours forms (add hours, edit an entry) show a date and two HH:MM times in
// the timezone the work happened in. These turn those fields into instants and
// back, for both forms alike.
import { addDays, dayKeyFor, epochFor, timeOfDayFor } from './time';

/** A form's date and its From and To times. */
export interface EntryFormTimes {
  dateKey: string;
  from: string;
  to: string;
}

/** A closed entry, as far as its times go. */
export interface ClosedEntryTimes {
  start: number;
  end: number;
  dayKey: string;
  timeZone: string;
}

/** Minutes since midnight of an 'H:MM' or 'HH:MM' wall time, or null when it is not one. */
function wallMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** A form's date and wall time as an instant in `timeZone`, or null when either is not valid. */
export function formInstant(dateKey: string, hhmm: string, timeZone: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || wallMinutes(hhmm) === null) return null;
  const ms = epochFor(dateKey, hhmm, timeZone);
  return Number.isFinite(ms) ? ms : null;
}

/** What the edit form shows of an entry when it opens, in the entry's own timezone. */
export function entryFormTimes(entry: ClosedEntryTimes): EntryFormTimes {
  return {
    dateKey: entry.dayKey,
    from: timeOfDayFor(entry.start, entry.timeZone),
    to: timeOfDayFor(entry.end, entry.timeZone),
  };
}

/**
 * The instants an edited entry's form stands for, or null when a field is not a
 * valid date or time.
 *
 * A time the form still shows as the entry has it keeps the entry's own instant,
 * to the millisecond. The form shows whole minutes and a clocked session keeps
 * its seconds, so reading both times back from the form gave a session inside
 * one minute no length at all, and moved both ends of any other down to the
 * minute on a save that changed only the note.
 *
 * To is read on the form's date. For an entry that already ends on a later day
 * than it starts (a clocked session past midnight), a To at or before From is
 * read on the next day. An entry that ends on the day it starts keeps the
 * same-day rule, so an AM/PM slip is refused rather than read as a night shift.
 */
export function editedEntryTimes(
  entry: ClosedEntryTimes,
  form: EntryFormTimes,
): { start: number; end: number } | null {
  const was = entryFormTimes(entry);
  const sameDate = form.dateKey === was.dateKey;
  const start =
    sameDate && form.from === was.from
      ? entry.start
      : formInstant(form.dateKey, form.from, entry.timeZone);
  if (start === null) return null;
  if (sameDate && form.to === was.to) return { start, end: entry.end };

  const from = wallMinutes(form.from);
  const to = wallMinutes(form.to);
  if (from === null || to === null) return null;
  const overnight = dayKeyFor(entry.end, entry.timeZone) !== entry.dayKey;
  const endKey = overnight && to <= from ? addDays(form.dateKey, 1) : form.dateKey;
  const end = formInstant(endKey, form.to, entry.timeZone);
  return end === null ? null : { start, end };
}
