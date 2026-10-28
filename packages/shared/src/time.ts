// All timezone math goes through these helpers, on every surface, so buckets
// always agree. Entries are bucketed in the timezone where the work happened
// (entry.timeZone), never the viewer's. Built on Intl — no date library.

/** IANA timezone of the current device. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** 'YYYY-MM-DD' of an instant in a given IANA timezone. */
export function dayKeyFor(epochMs: number, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

/** 'HH:MM' (24h) of an instant in a given IANA timezone. */
export function timeOfDayFor(epochMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

/** Short timezone label (e.g. 'PDT', 'GMT+8') for display next to times. */
export function tzLabelFor(epochMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(new Date(epochMs));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** dayKey → {y, m, d} numbers. */
export function parseDayKey(dayKey: string): { y: number; m: number; d: number } {
  const [y, m, d] = dayKey.split('-').map(Number);
  return { y, m, d };
}

/** The dayKey n days after the given one (calendar arithmetic, tz-independent). */
export function addDays(dayKey: string, n: number): string {
  const { y, m, d } = parseDayKey(dayKey);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Monday … 6 = Sunday for a dayKey. */
export function weekdayIndex(dayKey: string): number {
  const { y, m, d } = parseDayKey(dayKey);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * The Monday-start week containing a dayKey, as an inclusive dayKey range.
 * Weeks are calendar constructs on local dates, so this needs no timezone.
 */
export function weekRange(dayKey: string): { fromKey: string; toKey: string } {
  const fromKey = addDays(dayKey, -weekdayIndex(dayKey));
  return { fromKey, toKey: addDays(fromKey, 6) };
}

/** The month containing a dayKey, as an inclusive dayKey range. */
export function monthRange(dayKey: string): { fromKey: string; toKey: string } {
  const { y, m } = parseDayKey(dayKey);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { fromKey: `${y}-${pad(m)}-01`, toKey: `${y}-${pad(m)}-${pad(lastDay)}` };
}

// Timesheet periods: calendar weeks Sunday–Saturday, CLIPPED to month boundaries,
// so the first/last period of a month may be partial and a period never crosses
// months. A period is identified by its start dayKey (the "periodKey"). Like weeks,
// periods are calendar constructs on local dates — no timezone involved; an entry
// belongs to the period containing its (work-local) dayKey.
// firestore.rules recomputes the same key independently (periodKeyOf) so a client
// cannot stamp a false periodKey to dodge a submitted/approved lock — any change
// here MUST be mirrored there.

/** 0 = Sunday … 6 = Saturday for a dayKey. */
export function sundayIndex(dayKey: string): number {
  const { y, m, d } = parseDayKey(dayKey);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The periodKey (start dayKey) of the clipped Sun–Sat period containing dayKey. */
export function periodKeyFor(dayKey: string): string {
  const sunday = addDays(dayKey, -sundayIndex(dayKey));
  const { fromKey } = monthRange(dayKey);
  return sunday < fromKey ? fromKey : sunday;
}

/** The clipped period containing dayKey, as an inclusive dayKey range. */
export function periodRangeFor(dayKey: string): { fromKey: string; toKey: string } {
  const fromKey = periodKeyFor(dayKey);
  const saturday = addDays(addDays(dayKey, -sundayIndex(dayKey)), 6);
  const { toKey: monthEnd } = monthRange(dayKey);
  return { fromKey, toKey: saturday > monthEnd ? monthEnd : saturday };
}

/** All periods of dayKey's month, in order (4–6; first/last may be partial). */
export function periodsOfMonth(dayKey: string): { fromKey: string; toKey: string }[] {
  const { toKey: monthEnd } = monthRange(dayKey);
  const periods: { fromKey: string; toKey: string }[] = [];
  let cursor = monthRange(dayKey).fromKey;
  while (cursor <= monthEnd) {
    const p = periodRangeFor(cursor);
    periods.push(p);
    cursor = addDays(p.toKey, 1);
  }
  return periods;
}

/** True once the period has begun — future periods cannot be submitted. */
export function periodHasStarted(periodKey: string, todayKey: string): boolean {
  return periodKey <= todayKey;
}

/** Human label for a period: 'Jul 5 – Jul 11' (or 'Dec 28 – Jan 3' across years). */
export function monthLabel(dayKey: string): string {
  const { y, m } = parseDayKey(dayKey);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function periodLabel(range: { fromKey: string; toKey: string }): string {
  const fmt = (dayKey: string) => {
    const { y, m, d } = parseDayKey(dayKey);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
    }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  return `${fmt(range.fromKey)} – ${fmt(range.toKey)}`;
}

/**
 * The instant corresponding to a wall-clock time in a given IANA timezone.
 * Inverse of dayKeyFor/timeOfDayFor, found by correcting a UTC guess against
 * how it formats back in that timezone (converges in ≤2 steps; DST-gap times
 * that don't exist resolve to the shifted clock).
 */
export function epochFor(dayKey: string, hhmm: string, timeZone: string): number {
  const { y, m, d } = parseDayKey(dayKey);
  const [h, min] = hhmm.split(':').map(Number);
  const wantWall = Date.UTC(y, m - 1, d) / 60000 + h * 60 + min;
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 3; i++) {
    const gotKey = parseDayKey(dayKeyFor(guess, timeZone));
    const [gh, gm] = timeOfDayFor(guess, timeZone).split(':').map(Number);
    const gotWall = Date.UTC(gotKey.y, gotKey.m - 1, gotKey.d) / 60000 + gh * 60 + gm;
    const diffMinutes = wantWall - gotWall;
    if (diffMinutes === 0) break;
    guess += diffMinutes * 60000;
  }
  return guess;
}

/** Whole minutes between two instants, rounded to the nearest minute. */
export function minutesBetween(startMs: number, endMs: number): number {
  return Math.round((endMs - startMs) / 60000);
}

/** The minutes an entry counts: its length to the nearest minute, and at least one. */
export function entryMinutes(startMs: number, endMs: number): number {
  return Math.max(1, minutesBetween(startMs, endMs));
}

/** 125 → '2h 05m'; 45 → '45m'. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${pad(m)}m`;
}
