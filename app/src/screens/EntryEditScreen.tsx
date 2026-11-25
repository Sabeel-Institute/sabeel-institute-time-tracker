import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { leaveIfShowing } from '../nav';
import {
  dayKeyFor,
  dayLabel,
  editedEntryTimes,
  entryDisplayTimeZone,
  entryFormTimes,
  entryTimesValid,
  timeEntryRevision,
  tzLabelFor,
} from '@sabeel/shared';
import { useActivities } from '../activities';
import { useEntry, updateEntry, deleteEntry, explainEntryWriteError, ENTRY_CHANGED, type TimeEntry } from '../entries';
import { confirmAction } from '../confirm';
import { EntryForm } from '../components/EntryForm';
import { Button, ErrorText, Notice, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

export function EntryEditScreen({ entryId, editorUid }: { entryId: string; editorUid: string }) {
  const nav = useNavigation();
  const latest = useEntry(entryId);
  const activities = useActivities({ includeArchived: false });

  const [activityId, setActivityId] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [entry, setEntry] = useState<TimeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (current: TimeEntry) => {
    if (current.end === null) return;
    const zone = entryDisplayTimeZone(current.timeZone);
    const day = zone === current.timeZone ? current.dayKey : dayKeyFor(current.start, zone);
    const values = entryFormTimes({ ...current, dayKey: day, timeZone: zone, end: current.end });
    setEntry(current);
    setActivityId(current.activityId);
    setDateKey(values.dateKey);
    setFrom(values.from);
    setTo(values.to);
    setNote(current.note ?? '');
    setError(null);
  };

  useEffect(() => {
    if (latest?.id === entryId && entry?.id !== entryId) load(latest);
  }, [entry?.id, entryId, latest]);

  if (!entry || entry.id !== entryId) return <Screen width="read">{null}</Screen>;
  if (!latest) return <Screen width="read"><Notice tone="info">This entry is no longer available.</Notice></Screen>;

  const stale = timeEntryRevision(latest) !== timeEntryRevision(entry);
  const timeZone = entryDisplayTimeZone(entry.timeZone);
  // A phone's timezone data can lag behind (a newer zone name an older Android
  // or iOS does not know), so "unavailable" there may mean "valid elsewhere":
  // saving would replace a real zone with UTC and move the entry's day. Only
  // the website, whose browser carries current data, repairs a stored zone.
  const zoneLocked = timeZone !== entry.timeZone && Platform.OS !== 'web';
  const originalDay = timeZone !== entry.timeZone ? dayKeyFor(entry.start, timeZone) : entry.dayKey;

  // Untouched times keep the entry's own instants (editedEntryTimes says why).
  const times =
    entry.end !== null
      ? editedEntryTimes({ ...entry, dayKey: originalDay, timeZone, end: entry.end }, { dateKey, from, to })
      : null;
  const activity = activities?.find((a) => a.id === activityId) ?? null;
  const valid = times !== null && entryTimesValid(times);
  const endKey = times ? dayKeyFor(times.end, timeZone) : null;

  const save = async () => {
    if (!valid || times === null || stale || saving || zoneLocked) return;
    setSaving(true);
    setError(null);
    try {
      await updateEntry(entry, {
        activity: activity && activity.id !== entry.activityId ? activity : undefined,
        start: times.start,
        end: times.end,
        timeZone,
        note,
        editorUid,
      });
      leaveIfShowing(nav);
    } catch (e) {
      setError(explainEntryWriteError(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await deleteEntry(entry);
      leaveIfShowing(nav);
    } catch (e) {
      setError(explainEntryWriteError(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = async () => {
    if (await confirmAction('Delete this entry?', "Its hours come off the timesheet. This can't be undone.")) {
      await remove();
    }
  };

  const movedTo = times !== null ? dayKeyFor(times.start, timeZone) : null;
  return (
    <Screen
      width="read"
      subtitle={`${entry.source === 'clock' ? 'Clocked in and out' : 'Added by hand'} · times in ${tzLabelFor(
        entry.start,
        timeZone,
      )}${entry.uid !== editorUid ? ' · you are editing as a manager' : ''}`}
    >
      {stale && !saving ? (
        <Notice tone="info" onPress={() => load(latest)}>{ENTRY_CHANGED}</Notice>
      ) : null}
      {zoneLocked ? (
        <Notice tone="info">
          This device can't show times in this entry's time zone ({entry.timeZone}), so it can't be changed here.
          Edit it on the website.
        </Notice>
      ) : timeZone !== entry.timeZone ? (
        <Notice tone="info">The stored time zone is unavailable. Saving uses UTC.</Notice>
      ) : null}
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

      <Button label="Save changes" onPress={save} disabled={!valid || stale || saving || zoneLocked} />
      {!valid ? (
        <Text style={styles.hint}>The end has to be after the start, and at most 24 hours later.</Text>
      ) : null}
      <ErrorText error={error} />
      {/* Apart from Save, so a destructive button is never the one you hit by
          habit; and it asks once. */}
      <View style={styles.dangerZone}>
        <Button label="Delete entry" kind="remove" disabled={stale || saving} onPress={confirmRemove} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: t.text.secondary },
  dangerZone: { marginTop: spacing(6), paddingTop: spacing(4), borderTopWidth: 1, borderTopColor: t.border.subtle },
});
