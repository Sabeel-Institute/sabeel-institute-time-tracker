import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { leaveIfShowing } from '../nav';
import {
  addDays,
  dayKeyFor,
  deviceTimeZone,
  entryTimesValid,
  formInstant,
  tzLabelFor,
} from '@sabeel/shared';
import { useActivities } from '../activities';
import { createManualEntry, explainEntryWriteError } from '../entries';
import { useUser } from '../users';
import { EntryForm } from '../components/EntryForm';
import { Button, Chips, ErrorText, Notice, Screen } from '../components/ui';
import { getTheme } from '../theme';

const t = getTheme();

export function ManualEntryScreen({
  uid,
  forUid,
  forName,
  dayKey,
}: {
  /** The signed-in user (the writer). */
  uid: string;
  /** When set, hours are logged on this user's behalf (manager/approver flow). */
  forUid?: string;
  forName?: string;
  /** The day to open on; today when absent. */
  dayKey?: string;
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
  const [dateKey, setDateKey] = useState(dayKey ?? todayKey);
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
      leaveIfShowing(nav);
    } catch (e) {
      setError(explainEntryWriteError(e));
    }
  };

  const yesterdayKey = addDays(todayKey, -1);
  return (
    <Screen width="read">
      {onBehalf ? (
        <Notice tone="info">
          Adding hours for {forName ?? forUid}
          {/* Which clock these times are read against is not guessable — say it,
              but only when it differs from the one this device would have used. */}
          {tz !== deviceTimeZone() ? `. Times are ${tzLabelFor(Date.now(), tz)}.` : '.'}
        </Notice>
      ) : null}
      <EntryForm
        activities={activities}
        activityId={activityId}
        onActivity={setActivityId}
        dateKey={dateKey}
        onDate={setDateKey}
        dateShortcuts={
          <Chips
            label="Day"
            value={dateKey === todayKey ? 'today' : dateKey === yesterdayKey ? 'yesterday' : 'other'}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'yesterday', label: 'Yesterday' },
            ]}
            onChange={(day) => setDateKey(day === 'today' ? todayKey : yesterdayKey)}
          />
        }
        from={from}
        onFrom={setFrom}
        to={to}
        onTo={setTo}
        span={start !== null && end !== null ? { start, end } : null}
        note={note}
        onNote={setNote}
        noteLabel="What did you work on? (optional)"
      />

      <Button label="Save hours" onPress={save} disabled={!valid} />
      {!valid && activity ? (
        <Text style={styles.hint}>The end has to be after the start, on the same day, and at most 24 hours later.</Text>
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: t.text.secondary },
});
