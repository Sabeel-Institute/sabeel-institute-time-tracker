import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  dayKeyFor,
  deviceTimeZone,
  formatDuration,
  minutesBetween,
  periodKeyFor,
  periodLabel,
  periodRangeFor,
  timeOfDayFor,
  type UserDoc,
} from '@sabeel/shared';
import { tabState, type RootStackParamList } from '../nav';
import { useActivities } from '../activities';
import {
  clockIn,
  clockOut,
  useEntry,
  useDayMinutes,
  useEntriesRange,
  explainEntryWriteError,
} from '../entries';
import { useTimesheet, useRejectedSheets } from '../timesheets';
import { ActivityPicker } from '../components/ActivityPicker';
import {
  Button,
  Card,
  ErrorText,
  Notice,
  Row,
  RowList,
  Screen,
  SectionTitle,
  StatusChip,
  sheetStatus,
} from '../components/ui';
import { PushNudge } from '../components/PushNudge';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Today: am I clocked in? The one main action is the clock — Clock in, or
 * Clock out — and everything else here is what follows from it: hours you forgot
 * to clock, and how today and this week stand.
 */
export function HomeScreen({ uid, profile }: { uid: string; profile: UserDoc }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const activities = useActivities({ includeArchived: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useEntry(profile.activeEntryId);

  // Tick while clocked in so the elapsed figure stays honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(timer);
  }, [running]);

  const tz = deviceTimeZone();
  const todayKey = dayKeyFor(Date.now(), tz);
  const todayMinutes = useDayMinutes(uid, todayKey);

  // This week's timesheet: clocking in is closed once it is submitted/approved.
  const week = periodRangeFor(todayKey);
  const weekEntries = useEntriesRange(uid, week.fromKey, week.toKey);
  const weekMinutes = weekEntries.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0);
  const sheet = useTimesheet(uid, periodKeyFor(todayKey));
  const weekStatus = sheetStatus(sheet?.status ?? 'draft');
  const weekLocked = sheet != null && (sheet.status === 'submitted' || sheet.status === 'approved');
  const rejectedCount = useRejectedSheets(uid).length;

  const selected = activities.find((a) => a.id === selectedId) ?? null;

  const onClockIn = async () => {
    if (!selected) return;
    setError(null);
    try {
      await clockIn(uid, selected);
    } catch (e) {
      setError(explainEntryWriteError(e));
    }
  };
  const onClockOut = async () => {
    if (!running) return;
    setError(null);
    try {
      await clockOut(uid, running);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const elapsed = running ? Math.max(0, minutesBetween(running.start, Date.now())) : 0;
  // "So far" counts the session running now too: 0m beside a card saying you
  // have been clocked in for an hour reads as a fault. Finished entries are
  // the stored ones; the running one is added from its start.
  const runningToday = running && running.dayKey === todayKey ? elapsed : 0;
  const runningThisWeek =
    running && running.dayKey >= week.fromKey && running.dayKey <= week.toKey ? elapsed : 0;

  return (
    <Screen title="Today" subtitle={`Salaam, ${profile.displayName}`} width="read">
      {rejectedCount > 0 ? (
        <Notice tone="error" onPress={() => nav.navigate('NeedsAttention')}>
          {rejectedCount === 1
            ? 'A timesheet was rejected. Open it to fix it and send it again.'
            : `${rejectedCount} timesheets were rejected. Open them to fix them and send them again.`}
        </Notice>
      ) : null}

      {/* First after anything that needs acting on: one-time and dismissible,
          so it earns the position; a rejected timesheet still outranks it. */}
      <PushNudge uid={uid} />

      {running ? (
        <View style={styles.running} testID="clocked-in">
          <Text style={styles.runningLabel}>CLOCKED IN</Text>
          <Text style={styles.runningActivity}>{running.activityName}</Text>
          <Text style={styles.runningSince}>
            Since {timeOfDayFor(running.start, running.timeZone)} · {formatDuration(elapsed)} so far
          </Text>
          {elapsed >= 8 * 60 ? (
            <Text style={styles.longWarning}>
              That's a long session. Remember to clock out: anything over 12 hours is closed
              automatically.
            </Text>
          ) : null}
          <Button label="Clock out" kind="inverse" onPress={onClockOut} />
        </View>
      ) : weekLocked ? (
        <Card>
          <Text style={styles.cardText}>
            {sheet?.status === 'approved'
              ? 'This week is approved, so it is closed for new hours. Only an admin can reopen it.'
              : 'This week is submitted, so it is closed for new hours. To add more, withdraw it on the Timesheet tab.'}
          </Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.cardLabel}>What are you working on?</Text>
          <ActivityPicker activities={activities} selectedId={selectedId} onSelect={setSelectedId} />
          <Button label="Clock in" onPress={onClockIn} disabled={!selected} />
        </Card>
      )}
      <ErrorText error={error} />

      <Button label="Add hours" kind="secondary" onPress={() => nav.navigate('ManualEntry')} />

      <SectionTitle>So far</SectionTitle>
      <RowList>
        <Row label="Today" value={formatDuration(todayMinutes + runningToday)} />
        <Row
          label={`This week · ${periodLabel(week)}`}
          detail={<StatusChip label={weekStatus.label} tone={weekStatus.tone} />}
          value={formatDuration(weekMinutes + runningThisWeek)}
          accessibilityLabel={`This week, ${weekStatus.label}, ${formatDuration(weekMinutes + runningThisWeek)}. Open the timesheet.`}
          onPress={() => nav.reset(tabState(nav.getState(), 'Timesheet'))}
        />
      </RowList>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardLabel: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  cardText: { fontSize: 15, color: t.text.secondary, lineHeight: 21 },
  // The one raspberry surface in the app: the thing that is running right now.
  running: {
    backgroundColor: t.accent.base,
    borderRadius: 12,
    padding: spacing(5),
    gap: spacing(2),
  },
  // True gold on the plum: the ivory-contrast cut that deepens gold is for gold
  // on ivory; on raspberry the deepened tone reads worse.
  runningLabel: { color: t.accent.gold, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  runningActivity: { color: t.text.inverse, fontSize: 22, fontWeight: '700' },
  runningSince: { color: t.accent.onAccentMuted, fontSize: 14, marginBottom: spacing(2) },
  longWarning: { color: t.text.inverse, fontSize: 13, lineHeight: 18, marginBottom: spacing(2) },
});
