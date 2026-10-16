import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  APP_NAME,
  dayKeyFor,
  deviceTimeZone,
  formatDuration,
  minutesBetween,
  periodKeyFor,
  periodLabel,
  periodRangeFor,
  PRIVACY_URL,
  timeOfDayFor,
  type TokenClaims,
  type UserDoc,
} from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { signOut } from '../session';
import { useActivities } from '../activities';
import { clockIn, clockOut, useEntry, useDayMinutes, explainEntryWriteError } from '../entries';
import { useTimesheet, useRejectedSheets, useApprovalQueue } from '../timesheets';
import { setApprover, useApproverChoices, usePendingCount } from '../users';
import { ActivityPicker } from '../components/ActivityPicker';
import { SearchablePicker } from '../components/SearchablePicker';
import { Button, ErrorText, Screen, TextLink } from '../components/ui';
import { PushNudge } from '../components/PushNudge';
import { getTheme, spacing } from '../theme';

const t = getTheme();

// Short labels — this strip shares a row with the week dates on narrow phones.
const STATUS_LABEL = {
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
} as const;

export function HomeScreen({
  uid,
  profile,
  claims,
}: {
  uid: string;
  profile: UserDoc;
  claims: TokenClaims;
}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const activities = useActivities({ includeArchived: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useEntry(profile.activeEntryId);

  // Tick once a minute while clocked in so the elapsed figure stays honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [running]);

  const tz = deviceTimeZone();
  const todayKey = dayKeyFor(Date.now(), tz);
  const todayMinutes = useDayMinutes(uid, todayKey);

  // This week's timesheet state: clock-in is locked once it's submitted/approved.
  const currentPeriod = periodRangeFor(todayKey);
  const currentSheet = useTimesheet(uid, periodKeyFor(todayKey));
  const periodLocked =
    currentSheet != null && (currentSheet.status === 'submitted' || currentSheet.status === 'approved');
  const rejectedCount = useRejectedSheets(uid).length;

  // Approver self-service (sticky; stamped at submission).
  const approvers = useApproverChoices();
  const isApprover = claims.role === 'manager' || claims.admin === true;
  const queue = useApprovalQueue(uid);
  const pendingCount = usePendingCount(isApprover);

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

  return (
    <Screen title={APP_NAME} width="content">
      <Text style={styles.greeting}>Salaam, {profile.displayName}</Text>
      <Text style={styles.today}>Today: {formatDuration(todayMinutes)}</Text>

      {rejectedCount > 0 ? (
        <Pressable style={styles.rejectedBanner} onPress={() => nav.navigate('NeedsAttention')}>
          <Text style={styles.rejectedText}>
            {rejectedCount === 1
              ? 'A timesheet was rejected — tap to review and resubmit.'
              : `${rejectedCount} timesheets were rejected — tap to review and resubmit.`}
          </Text>
        </Pressable>
      ) : null}

      {/* Top of the content, below the alert only. Same place in all three apps:
          first thing after anything that needs acting on today. It is one-time
          and dismissible, so it earns the position; a rejected timesheet still
          outranks it. */}
      <PushNudge uid={uid} />

      <Pressable style={styles.periodStrip} onPress={() => nav.navigate('Timesheet')}>
        <Text style={styles.periodLabel}>This week · {periodLabel(currentPeriod)}</Text>
        <Text
          style={[
            styles.periodStatus,
            currentSheet?.status === 'approved' && styles.statusApproved,
            currentSheet?.status === 'rejected' && styles.statusRejected,
          ]}
        >
          {currentSheet == null ? 'Not submitted' : STATUS_LABEL[currentSheet.status]}
        </Text>
      </Pressable>

      {running ? (
        <View style={styles.runningCard}>
          <Text style={styles.runningLabel}>CLOCKED IN</Text>
          <Text style={styles.runningActivity}>{running.activityName}</Text>
          <Text style={styles.runningSince}>
            since {timeOfDayFor(running.start, running.timeZone)} ·{' '}
            {formatDuration(Math.max(0, minutesBetween(running.start, Date.now())))} elapsed
          </Text>
          {minutesBetween(running.start, Date.now()) >= 8 * 60 ? (
            <Text style={styles.longWarning}>
              You've been clocked in a long time — remember to clock out. Sessions over
              12h are closed automatically.
            </Text>
          ) : null}
          <Button label="Clock out" kind="danger" onPress={onClockOut} />
        </View>
      ) : periodLocked ? (
        <View style={styles.clockCard}>
          <Text style={styles.pickLabel}>
            This week's timesheet is {currentSheet?.status}. Withdraw it from “My timesheet”
            {currentSheet?.status === 'approved' ? ' (needs an admin to reopen)' : ''} to log
            more hours this week.
          </Text>
        </View>
      ) : (
        <View style={styles.clockCard}>
          <Text style={styles.pickLabel}>What are you working on?</Text>
          <ActivityPicker
            activities={activities}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <Button label="Clock in" onPress={onClockIn} disabled={!selected} />
        </View>
      )}
      <ErrorText error={error} />

      <Button
        label="Add hours manually"
        kind="secondary"
        onPress={() => nav.navigate('ManualEntry')}
      />
      <Button label="My timesheet" kind="secondary" onPress={() => nav.navigate('Timesheet')} />

      <View style={styles.approverRow}>
        <Text style={styles.approverLabel}>My timesheet approver</Text>
        <SearchablePicker
          items={approvers
            // Managers and admins may approve their own hours (PRODUCTION-REVIEW
            // M5 — deliberate at this org size). Sorted last so picking yourself
            // stays a considered choice rather than the first thing in the list.
            .slice()
            .sort((a, b) => Number(a.uid === uid) - Number(b.uid === uid))
            .map((a) => ({
              id: a.uid,
              label: a.uid === uid ? `${a.displayName} (myself)` : a.displayName,
              sublabel: a.admin ? 'admin' : 'manager',
            }))}
          selectedId={profile.approverUid}
          onSelect={(id) => {
            setError(null);
            setApprover(uid, id).catch((e) => setError((e as Error).message));
          }}
          placeholder="Choose who approves your hours"
          title="Timesheet approver"
        />
      </View>

      <View style={styles.footer}>
        {isApprover ? (
          <Button
            label={queue.length > 0 ? `Approvals (${queue.length})` : 'Approvals'}
            onPress={() => nav.navigate('Approvals')}
          />
        ) : null}
        {isApprover ? (
          <>
            <Button label="Reports" onPress={() => nav.navigate('Reports')} />
            <Button
              label="Activities"
              kind="secondary"
              onPress={() => nav.navigate('Activities')}
            />
          </>
        ) : null}
        {claims.admin || claims.role === 'manager' ? (
          <Button
            label={pendingCount > 0 ? `Manage users (${pendingCount})` : 'Manage users'}
            onPress={() => nav.navigate('Users')}
          />
        ) : null}
        <Button
          label="Notification settings"
          kind="secondary"
          onPress={() => nav.navigate('NotificationSettings')}
        />
        {/* Where the institute's rules say it is ("on Home"): the app has no
            More tab, and this is where people look for help. */}
        <Button
          label="Report a problem"
          kind="secondary"
          onPress={() => nav.navigate('ReportProblem')}
        />
        <Button label="Sign out" kind="secondary" onPress={() => signOut()} />
        <TextLink label="Privacy policy" url={PRIVACY_URL} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 20, fontWeight: '600', color: t.text.primary },
  today: { fontSize: 14, color: t.text.secondary },
  rejectedBanner: {
    backgroundColor: t.feedback.danger,
    borderRadius: 10,
    padding: spacing(3),
  },
  rejectedText: { color: t.text.inverse, fontSize: 14, fontWeight: '600' },
  periodStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 10,
    padding: spacing(3),
    gap: spacing(2),
  },
  periodLabel: { fontSize: 13, color: t.text.secondary, flexShrink: 1 },
  periodStatus: { fontSize: 13, fontWeight: '700', color: t.text.primary },
  statusApproved: { color: t.accent.base },
  statusRejected: { color: t.feedback.danger },
  clockCard: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 14,
    padding: spacing(4),
    gap: spacing(3),
  },
  pickLabel: { fontSize: 14, color: t.text.secondary },
  runningCard: {
    backgroundColor: t.accent.base,
    borderRadius: 14,
    padding: spacing(5),
    gap: spacing(2),
  },
  // Gold on the raspberry card: true gold reads on plum (deepened gold would read
  // WORSE there — the ivory-contrast cut is for gold on ivory, not on plum).
  runningLabel: { color: t.accent.gold, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  runningActivity: { color: t.text.inverse, fontSize: 22, fontWeight: '700' },
  runningSince: { color: t.accent.onAccentMuted, fontSize: 14, marginBottom: spacing(2) },
  longWarning: {
    color: t.accent.gold,
    fontSize: 13,
    marginBottom: spacing(2),
    lineHeight: 18,
  },
  approverRow: { gap: spacing(2), marginTop: spacing(2) },
  approverLabel: { fontSize: 13, fontWeight: '700', color: t.text.secondary },
  footer: { gap: spacing(3), marginTop: spacing(4) },
});
