import { describe, it, expect } from 'vitest';
import { editedEntryTimes, entryFormTimes, formInstant } from '../src/entryForm';
import { entryMinutes } from '../src/time';
import { entryTimesValid } from '../src/validate';

// UTC+3 all year, so the instants below read plainly.
const tz = 'Asia/Riyadh';
const at = (iso: string) => Date.parse(`${iso}+03:00`);
const clocked = (start: string, end: string, dayKey = start.slice(0, 10)) => ({
  start: at(start),
  end: at(end),
  dayKey,
  timeZone: tz,
});

/** The form as it opens, with some fields changed. */
const edit = (entry: ReturnType<typeof clocked>, changes: Partial<ReturnType<typeof entryFormTimes>> = {}) =>
  editedEntryTimes(entry, { ...entryFormTimes(entry), ...changes });

describe('editedEntryTimes — a form whose times are untouched keeps the entry exactly', () => {
  // Each of these is a clocked session as clock-out stores it, with its seconds.
  const cases = {
    'inside one minute (20 s)': clocked('2026-10-28T23:20:10', '2026-10-28T23:20:30'),
    'under a minute, across a minute boundary': clocked('2026-10-28T23:25:50', '2026-10-28T23:26:10'),
    'over a minute (4 m 30 s)': clocked('2026-10-28T23:30:15', '2026-10-28T23:34:45'),
    'across midnight': clocked('2026-10-28T23:59:30', '2026-10-29T00:01:30'),
    'a 12-hour session closed the next morning': clocked('2026-10-28T20:00:05', '2026-10-29T08:00:05'),
  };
  for (const [name, entry] of Object.entries(cases)) {
    it(name, () => {
      const times = edit(entry);
      expect(times).toEqual({ start: entry.start, end: entry.end });
      expect(entryTimesValid(times!)).toBe(true);
    });
  }

  it('so a note-only save stores the minutes clock-out stored', () => {
    const entry = cases['over a minute (4 m 30 s)'];
    const times = edit(entry)!;
    expect(entryMinutes(times.start, times.end)).toBe(entryMinutes(entry.start, entry.end));
    expect(entryMinutes(entry.start, entry.end)).toBe(5);
  });

  it('and a session inside one minute counts one', () => {
    const times = edit(cases['inside one minute (20 s)'])!;
    expect(entryMinutes(times.start, times.end)).toBe(1);
  });
});

describe('editedEntryTimes — changed fields are read from the form', () => {
  const entry = clocked('2026-10-28T09:00:40', '2026-10-28T10:30:20');

  it('a changed From moves the start to that minute and keeps the end', () => {
    expect(edit(entry, { from: '08:45' })).toEqual({ start: at('2026-10-28T08:45:00'), end: entry.end });
  });

  it('a changed To moves the end to that minute and keeps the start', () => {
    expect(edit(entry, { to: '11:00' })).toEqual({ start: entry.start, end: at('2026-10-28T11:00:00') });
  });

  it('a changed date reads both times on the new date', () => {
    expect(edit(entry, { dateKey: '2026-10-27' })).toEqual({
      start: at('2026-10-27T09:00:00'),
      end: at('2026-10-27T10:30:00'),
    });
  });

  it('on an entry that ends the day it starts, a To before From is refused, not a night shift', () => {
    const times = edit(entry, { to: '05:00' })!;
    expect(times.end).toBe(at('2026-10-28T05:00:00'));
    expect(entryTimesValid(times)).toBe(false);
  });

  it('a field that is not a time is no times at all', () => {
    expect(edit(entry, { from: '' })).toBeNull();
    expect(edit(entry, { to: '24:00' })).toBeNull();
    expect(edit(entry, { dateKey: '28/10/2026' })).toBeNull();
  });
});

describe('editedEntryTimes — an entry that already crosses midnight', () => {
  const entry = clocked('2026-10-28T23:30:10', '2026-10-29T00:20:40');

  it('opens with its date and both clock times', () => {
    expect(entryFormTimes(entry)).toEqual({ dateKey: '2026-10-28', from: '23:30', to: '00:20' });
  });

  it('reads a To at or before From on the next day', () => {
    expect(edit(entry, { to: '00:45' })).toEqual({ start: entry.start, end: at('2026-10-29T00:45:00') });
  });

  it('reads a To after From on the same day, so it can be shortened to end before midnight', () => {
    expect(edit(entry, { to: '23:50' })).toEqual({ start: entry.start, end: at('2026-10-28T23:50:00') });
  });

  it('moved to another date, still ends the day after it', () => {
    expect(edit(entry, { dateKey: '2026-10-26' })).toEqual({
      start: at('2026-10-26T23:30:00'),
      end: at('2026-10-27T00:20:00'),
    });
  });
});

describe('editedEntryTimes — the hour the clocks go back', () => {
  // America/Chicago, 2026-11-01: 01:50 CDT, then 20 minutes later 01:10 CST.
  // The wall clock runs backwards, so the form shows To before From.
  const entry = {
    start: Date.parse('2026-11-01T06:50:00Z'),
    end: Date.parse('2026-11-01T07:10:00Z'),
    dayKey: '2026-11-01',
    timeZone: 'America/Chicago',
  };

  it('keeps the 20 minutes when the times are untouched', () => {
    expect(entryFormTimes(entry)).toMatchObject({ from: '01:50', to: '01:10' });
    const times = edit(entry)!;
    expect(times).toEqual({ start: entry.start, end: entry.end });
    expect(entryMinutes(times.start, times.end)).toBe(20);
  });
});

describe('formInstant', () => {
  it('reads a date and time in the given timezone', () => {
    expect(formInstant('2026-10-28', '9:05', tz)).toBe(at('2026-10-28T09:05:00'));
  });

  it('refuses what is not a date or a 24-hour time', () => {
    expect(formInstant('2026-10-28', '9:5', tz)).toBeNull();
    expect(formInstant('2026-10-28', '12:60', tz)).toBeNull();
    expect(formInstant('2026-1-28', '09:00', tz)).toBeNull();
  });
});
