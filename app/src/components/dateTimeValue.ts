// The native date/time pickers' value conversion, shared by both native
// presentations (DateTimeField.tsx on Android, DateTimeField.ios.tsx). The
// screens keep strings: a dayKey ('YYYY-MM-DD') for kind='date', 'HH:MM' for
// kind='time'. The web sibling needs neither: its <input> speaks those strings.
import { parseDayKey } from '@sabeel/shared';

export type DateTimeKind = 'date' | 'time';

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** The picker's starting Date for a field value; now when the value is empty. */
export function toPickerDate(kind: DateTimeKind, value: string): Date {
  if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const { y, m, d } = parseDayKey(value);
    return new Date(y, m - 1, d, 12, 0); // noon avoids DST-edge day drift
  }
  if (kind === 'time' && /^\d{1,2}:\d{2}$/.test(value)) {
    const [h, min] = value.split(':').map(Number);
    return new Date(2000, 0, 1, h, min);
  }
  return new Date();
}

/** The field value for a picked Date, read in the device's local time. */
export function fromPickerDate(kind: DateTimeKind, picked: Date): string {
  return kind === 'date'
    ? `${picked.getFullYear()}-${pad(picked.getMonth() + 1)}-${pad(picked.getDate())}`
    : `${pad(picked.getHours())}:${pad(picked.getMinutes())}`;
}
