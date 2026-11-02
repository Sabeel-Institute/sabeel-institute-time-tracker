import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  dayKeyFor,
  dayLabel,
  editedEntryTimes,
  entryFormTimes,
  entryTimesValid,
  tzLabelFor,
} from '@sabeel/shared';
import { useActivities } from '../activities';
import { useEntry, updateEntry, deleteEntry, explainEntryWriteError } from '../entries';
import { confirmAction } from '../confirm';
import { EntryForm } from '../components/EntryForm';
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

  const confirmRemove = async () => {
    if (await confirmAction('Delete this entry?', "Its hours come off the timesheet. This can't be undone.")) {
      await remove();
    }
  };

  const movedTo = times !== null ? dayKeyFor(times.start, entry.timeZone) : null;
  return (
    <Screen
      width="read"
      subtitle={`${entry.source === 'clock' ? 'Clocked in and out' : 'Added by hand'} · times in ${tzLabelFor(
        entry.start,
        entry.timeZone,
      )}${entry.uid !== editorUid ? ' · you are editing as a manager' : ''}`}
    >
      <EntryForm
        activities={activities}
        activityId={activityId}
        onActivity={setActivityId}
        dateKey={dateKey}
        onDate={setDateKey}
        from={from}
        onFrom={setFrom}
        to={to}
        onTo={setTo}
        span={times}
        note={note}
        onNote={setNote}
        noteLabel="Note"
      />
      {endKey !== null && endKey !== dateKey ? <Text style={styles.hint}>Ends on {dayLabel(endKey)}.</Text> : null}
      {movedTo !== null && movedTo !== entry.dayKey ? (
        <Text style={styles.hint}>This moves the entry to {dayLabel(movedTo)}.</Text>
      ) : null}

      <Button label="Save changes" onPress={save} disabled={!valid} />
      {loaded && !valid ? (
        <Text style={styles.hint}>The end has to be after the start, and at most 24 hours later.</Text>
      ) : null}
      <ErrorText error={error} />
      {/* Apart from Save, so a destructive button is never the one you hit by
          habit; and it asks once. */}
      <View style={styles.dangerZone}>
        <Button label="Delete entry" kind="danger" onPress={confirmRemove} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: t.text.secondary },
  dangerZone: { marginTop: spacing(6), paddingTop: spacing(4), borderTopWidth: 1, borderTopColor: t.border.subtle },
});
