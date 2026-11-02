import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  addDays,
  dayKeyFor,
  dayLabel,
  deviceTimeZone,
  formatDuration,
  parseDayKey,
  periodLabel,
  periodRangeFor,
  timeOfDayFor,
  tzLabelFor,
} from '@sabeel/shared';
import type { TimeEntry } from '../entries';
import { Empty, IconButton, Row, RowList } from './ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

type Period = { fromKey: string; toKey: string };

/** The period before or after this one (periods are weeks clipped to months). */
export function stepPeriod(period: Period, dir: 1 | -1): string {
  return periodRangeFor(dir === -1 ? addDays(period.fromKey, -1) : addDays(period.toKey, 1)).fromKey;
}

/**
 * The week being looked at, with previous and next. Under it, whether that is
 * this week, or the way back to it once you have stepped away.
 */
export function WeekStepper({
  period,
  current,
  onStep,
  onCurrent,
}: {
  period: Period;
  /** Whether `period` is the week containing today. */
  current: boolean;
  onStep: (dir: 1 | -1) => void;
  onCurrent: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <IconButton icon="chevron-left" label="Previous week" onPress={() => onStep(-1)} />
      <View style={styles.stepperMiddle}>
        <Text style={styles.stepperLabel} role="heading" aria-level={2}>
          {periodLabel(period)}
        </Text>
        {current ? (
          <Text style={styles.stepperCaption}>This week</Text>
        ) : (
          <Pressable accessibilityRole="link" onPress={onCurrent} style={styles.stepperLinkBox}>
            <Text style={styles.stepperLink}>Back to this week</Text>
          </Pressable>
        )}
      </View>
      <IconButton icon="chevron-right" label="Next week" onPress={() => onStep(1)} />
    </View>
  );
}

/** One entry as a row: what, when, and how long; a closed entry opens to edit. */
function EntryRow({
  entry,
  onPress,
  conflict = false,
}: {
  entry: TimeEntry;
  onPress?: () => void;
  /** Overlaps another entry on the same day — flagged, must be fixed. */
  conflict?: boolean;
}) {
  const foreign = entry.timeZone !== deviceTimeZone();
  const times =
    entry.end === null
      ? `${timeOfDayFor(entry.start, entry.timeZone)} – still clocked in`
      : `${timeOfDayFor(entry.start, entry.timeZone)} – ${timeOfDayFor(entry.end, entry.timeZone)}`;
  const flags = [
    foreign ? tzLabelFor(entry.start, entry.timeZone) : null,
    entry.source === 'manual' ? 'added by hand' : null,
    entry.autoClosed ? 'closed automatically' : null,
    entry.lastEditedBy ? 'corrected' : null,
  ].filter(Boolean);
  return (
    <Row
      label={entry.activityName}
      detail={
        <>
          <Text style={styles.detail}>{[times, ...flags].join(' · ')}</Text>
          {entry.note ? (
            <Text style={styles.detail} numberOfLines={1}>
              {entry.note}
            </Text>
          ) : null}
        </>
      }
      value={entry.durationMinutes != null ? formatDuration(entry.durationMinutes) : undefined}
      warn={conflict ? 'Overlaps another entry' : undefined}
      onPress={entry.end !== null ? onPress : undefined}
      accessibilityLabel={`${entry.activityName}, ${times}. Edit this entry.`}
    />
  );
}

/** A day of a week: its name and total, then its entries in one list. */
export function DayEntries({
  dayKey,
  entries,
  conflicts,
  onOpen,
}: {
  dayKey: string;
  entries: TimeEntry[];
  conflicts: Set<string>;
  onOpen: (entryId: string) => void;
}) {
  const total = entries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  return (
    <View style={styles.day}>
      <View style={styles.dayHead}>
        <Text style={styles.dayName} role="heading" aria-level={3}>
          {dayLabel(dayKey, parseDayKey(dayKeyFor(Date.now(), deviceTimeZone())).y)}
        </Text>
        <Text style={styles.dayTotal}>{formatDuration(total)}</Text>
      </View>
      {entries.length === 0 ? (
        <Empty>No hours.</Empty>
      ) : (
        <RowList>
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} conflict={conflicts.has(e.id)} onPress={() => onOpen(e.id)} />
          ))}
        </RowList>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginTop: spacing(2) },
  stepperMiddle: { flex: 1, alignItems: 'center', gap: 2 },
  stepperLabel: { fontSize: 18, fontWeight: '700', color: t.text.primary, textAlign: 'center' },
  stepperCaption: { fontSize: 13, color: t.text.secondary },
  // A link, so underlined: colour alone does not say "link".
  // A real 44pt target around a small link, not hitSlop.
  stepperLinkBox: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing(2) },
  stepperLink: { fontSize: 13, color: t.text.accent, textDecorationLine: 'underline' },
  detail: { fontSize: 13, color: t.text.secondary },
  day: { gap: spacing(2), marginTop: spacing(3) },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing(2) },
  dayName: { fontSize: 15, fontWeight: '700', color: t.text.primary },
  dayTotal: { fontSize: 14, color: t.text.secondary },
});
