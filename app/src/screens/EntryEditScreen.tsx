import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  dayKeyFor,
  editedEntryTimes,
  entryFormTimes,
  entryMinutes,
  entryTimesValid,
  formatDuration,
  tzLabelFor,
} from '@sabeel/shared';
import { useActivities } from '../activities';
import { useEntry, updateEntry, deleteEntry, explainEntryWriteError } from '../entries';
import { ActivityPicker } from '../components/ActivityPicker';
import { DateTimeField } from '../components/DateTimeField';
import { Button, ErrorText, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

export function EntryEditScreen({ entryId, editorUid }: { entryId: string; editorUid: string }) {
  const nav = useNavigation();
  const entry = useEntry(entryId);
  const activities = useActivities({ includeArchived: false });

  const [activityId, setActivityId] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form once from the live entry (times shown in the entry's own tz).
  useEffect(() => {
    if (entry && entry.end !== null && !loaded) {
      const seed = entryFormTimes({ ...entry, end: entry.end });
      setActivityId(entry.activityId);
      setDateKey(seed.dateKey);
      setFrom(seed.from);
      setTo(seed.to);
      setNote(entry.note ?? '');
      setLoaded(true);
    }
  }, [entry, loaded]);

  if (!entry) return <Screen width="read">{null}</Screen>;

  // Untouched times keep the entry's own instants (editedEntryTimes says why).
  const times =
    loaded && entry.end !== null
      ? editedEntryTimes({ ...entry, end: entry.end }, { dateKey, from, to })
      : null;
  const activity = activities.find((a) => a.id === activityId) ?? null;
  const valid = times !== null && entryTimesValid(times);
  const endKey = times ? dayKeyFor(times.end, entry.timeZone) : null;

  const save = async () => {
    if (!valid || times === null) return;
    setError(null);
    try {
      await updateEntry(entry, {
        activity: activity && activity.id !== entry.activityId ? activity : undefined,
        start: times.start,
        end: times.end,
        note,
        editorUid,
      });
      nav.goBack();
    } catch (e) {
      setError(explainEntryWriteError(e));
    }
  };

  const remove = async () => {
    setError(null);
    try {
      await deleteEntry(entry.id);
      nav.goBack();
    } catch (e) {
      setError(explainEntryWriteError(e));
    }
  };

  return (
    <Screen width="read">
      <Text style={styles.meta}>
        {entry.source === 'clock' ? 'Clocked session' : 'Manual entry'} · times in{' '}
        {tzLabelFor(entry.start, entry.timeZone)}
        {entry.uid !== editorUid ? ' · editing as manager' : ''}
      </Text>

      <Text style={styles.label}>Activity</Text>
      <ActivityPicker activities={activities} selectedId={activityId} onSelect={setActivityId} />

      <Text style={styles.label}>Date</Text>
      <DateTimeField kind="date" value={dateKey} onChange={setDateKey} />

      <View style={styles.timesRow}>
        <View style={styles.grow}>
          <Text style={styles.label}>From</Text>
          <DateTimeField kind="time" value={from} onChange={setFrom} />
        </View>
        <View style={styles.grow}>
          <Text style={styles.label}>To</Text>
          <DateTimeField kind="time" value={to} onChange={setTo} />
        </View>
      </View>
      {/* Live duration echo — catches AM/PM slips before saving. */}
      {times !== null && times.end > times.start ? (
        <Text style={styles.durationPreview}>
          = {formatDuration(entryMinutes(times.start, times.end))}
        </Text>
      ) : null}
      {endKey !== null && endKey !== dateKey ? (
        <Text style={styles.hint}>Ends on {endKey}.</Text>
      ) : null}

      <Text style={styles.label}>Note</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[styles.input, styles.noteInput]}
        multiline
      />

      <Button label="Save changes" onPress={save} disabled={!valid} />
      {loaded && !valid ? (
        <Text style={styles.hint}>Times must be HH:MM, end after start, at most 24h.</Text>
      ) : null}
      <Button label="Delete entry" kind="danger" onPress={remove} />
      <ErrorText error={error} />
      {times !== null && dayKeyFor(times.start, entry.timeZone) !== entry.dayKey ? (
        <Text style={styles.hint}>
          This moves the entry to {dayKeyFor(times.start, entry.timeZone)}.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 13, color: t.text.secondary },
  durationPreview: { fontSize: 15, fontWeight: '700', color: t.accent.base, textAlign: 'right' },
  label: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2) },
  input: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(3),
    fontSize: 15,
  },
  noteInput: { minHeight: 72, textAlignVertical: 'top' },
  timesRow: { flexDirection: 'row', gap: spacing(3) },
  grow: { flex: 1 },
  hint: { fontSize: 12, color: t.text.muted },
});
