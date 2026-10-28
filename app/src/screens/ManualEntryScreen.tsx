import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  addDays,
  dayKeyFor,
  deviceTimeZone,
  entryMinutes,
  entryTimesValid,
  formatDuration,
  formInstant,
  tzLabelFor,
} from '@sabeel/shared';
import { useActivities } from '../activities';
import { createManualEntry, explainEntryWriteError } from '../entries';
import { useUser } from '../users';
import { ActivityPicker } from '../components/ActivityPicker';
import { DateTimeField } from '../components/DateTimeField';
import { Button, ErrorText, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

export function ManualEntryScreen({
  uid,
  forUid,
  forName,
}: {
  /** The signed-in user (the writer). */
  uid: string;
  /** When set, hours are logged on this user's behalf (manager/approver flow). */
  forUid?: string;
  forName?: string;
}) {
  const nav = useNavigation();
  const activities = useActivities({ includeArchived: false });
  const targetUid = forUid ?? uid;
  // The work's timezone is the TARGET user's last-seen one (App.tsx keeps it
  // current on every active sign-in), never the writer's. Falls back to this
  // device only while the profile is loading or for an account that has not
  // opened the app since timezones were recorded.
  const target = useUser(targetUid);
  const tz = target?.timeZone ?? deviceTimeZone();
  const onBehalf = forUid !== undefined && forUid !== uid;
  const todayKey = dayKeyFor(Date.now(), tz);

  const [activityId, setActivityId] = useState<string | null>(null);
  const [dateKey, setDateKey] = useState(todayKey);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('17:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activity = activities.find((a) => a.id === activityId) ?? null;
  // Read in the timezone the WORK happened in, which is not the writer's when a
  // manager logs hours on someone else's behalf.
  const start = formInstant(dateKey, from, tz);
  const end = formInstant(dateKey, to, tz);
  const valid =
    activity && start !== null && end !== null && entryTimesValid({ start, end });

  const save = async () => {
    if (!valid || !activity || start === null || end === null) return;
    setError(null);
    try {
      await createManualEntry({
        uid: targetUid,
        activity,
        start,
        end,
        note,
        timeZone: tz,
        creatorUid: uid,
      });
      nav.goBack();
    } catch (e) {
      setError(explainEntryWriteError(e));
    }
  };

  return (
    <Screen width="read">
      {onBehalf ? (
        <Text style={styles.onBehalf}>
          Adding hours for {forName ?? forUid}
          {/* Which clock these times are read against is not guessable — say it,
              but only when it differs from the one this device would have used. */}
          {tz !== deviceTimeZone() ? ` · times are ${tzLabelFor(Date.now(), tz)}` : ''}
        </Text>
      ) : null}
      <Text style={styles.label}>Activity</Text>
      <ActivityPicker activities={activities} selectedId={activityId} onSelect={setActivityId} />

      <Text style={styles.label}>Date</Text>
      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <DateTimeField kind="date" value={dateKey} onChange={setDateKey} />
        </View>
        <Button label="Today" kind="secondary" onPress={() => setDateKey(todayKey)} />
        <Button
          label="Yesterday"
          kind="secondary"
          onPress={() => setDateKey(addDays(todayKey, -1))}
        />
      </View>

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
      {start !== null && end !== null && end > start ? (
        <Text style={styles.durationPreview}>= {formatDuration(entryMinutes(start, end))}</Text>
      ) : null}

      <Text style={styles.label}>What did you work on? (optional)</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        style={[styles.input, styles.noteInput]}
        multiline
        placeholder="Notes…"
      />

      <Button label="Save hours" onPress={save} disabled={!valid} />
      {!valid && activity ? (
        <Text style={styles.hint}>
          Times must be HH:MM on the same day, end after start, at most 24h.
        </Text>
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  onBehalf: { fontSize: 14, fontWeight: '700', color: t.accent.base },
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
  // The date and its two shortcuts share a line while there is room and WRAP
  // when there is not. `flex: 1` here (as the times row below uses) sets
  // flexBasis to 0 and lets the field collapse instead — at 320px that left the
  // date input showing "08". Growing from its natural width, and refusing to
  // shrink below it, is what makes the row give way at the gap rather than
  // inside the field.
  dateRow: { flexDirection: 'row', gap: spacing(2), alignItems: 'center', flexWrap: 'wrap' },
  dateField: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' },
  timesRow: { flexDirection: 'row', gap: spacing(3) },
  grow: { flex: 1 },
  hint: { fontSize: 12, color: t.text.muted },
});
