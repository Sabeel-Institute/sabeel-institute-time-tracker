import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { entryMinutes, formatDuration } from '@sabeel/shared';
import type { Activity } from '../activities';
import { ActivityPicker } from './ActivityPicker';
import { DateTimeField } from './DateTimeField';
import { Field } from './ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * The fields of one entry — what, which day, from when to when, and a note —
 * shared by Add hours and Edit entry so the two forms cannot drift apart. The
 * screen owns the state and the action; this lays the fields out.
 */
export function EntryForm({
  activities,
  activityId,
  onActivity,
  dateKey,
  onDate,
  dateShortcuts,
  from,
  onFrom,
  to,
  onTo,
  span,
  note,
  onNote,
  noteLabel,
}: {
  activities: Activity[] | undefined;
  activityId: string | null;
  onActivity: (id: string) => void;
  dateKey: string;
  onDate: (dayKey: string) => void;
  /** Beside the date: one-tap days, as Today and Yesterday. */
  dateShortcuts?: ReactNode;
  from: string;
  onFrom: (hhmm: string) => void;
  to: string;
  onTo: (hhmm: string) => void;
  /** The instants the times read as, when valid: the duration is shown from them. */
  span: { start: number; end: number } | null;
  note: string;
  onNote: (note: string) => void;
  noteLabel: string;
}) {
  return (
    <View style={styles.form}>
      <View style={styles.group}>
        <Text style={styles.label}>Activity</Text>
        <ActivityPicker activities={activities} selectedId={activityId} onSelect={onActivity} />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Date</Text>
        {/* The date and its shortcuts share a line while there is room and wrap
            when there is not. The field grows from its natural width and never
            shrinks below it: with a zero basis it collapsed at 320px to "08". */}
        <View style={styles.dateRow}>
          <View style={styles.dateField}>
            <DateTimeField kind="date" value={dateKey} onChange={onDate} />
          </View>
          {dateShortcuts ?? null}
        </View>
      </View>

      <View style={styles.timesRow}>
        <View style={styles.grow}>
          <Text style={styles.label}>From</Text>
          <DateTimeField kind="time" value={from} onChange={onFrom} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.label}>To</Text>
          <DateTimeField kind="time" value={to} onChange={onTo} />
        </View>
      </View>
      {/* The duration as you type: it catches an AM/PM slip before saving. */}
      {span !== null && span.end > span.start ? (
        <Text style={styles.duration}>That's {formatDuration(entryMinutes(span.start, span.end))}</Text>
      ) : null}

      <Field label={noteLabel} value={note} onChangeText={onNote} multiline />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing(4) },
  group: { gap: spacing(1) },
  label: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  dateRow: { flexDirection: 'row', gap: spacing(2), alignItems: 'center', flexWrap: 'wrap' },
  dateField: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' },
  timesRow: { flexDirection: 'row', gap: spacing(3) },
  grow: { flex: 1, gap: spacing(1) },
  duration: { fontSize: 15, fontWeight: '600', color: t.text.primary, marginTop: -spacing(2) },
});
