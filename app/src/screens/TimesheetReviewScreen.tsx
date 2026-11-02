import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  addDays,
  dayKeyFor,
  deviceTimeZone,
  formatDuration,
  overlappingEntryIds,
  periodRangeFor,
} from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useEntriesRange } from '../entries';
import { approveTimesheet, rejectTimesheet, reopenTimesheet, useTimesheet } from '../timesheets';
import { DayEntries, WeekStepper, stepPeriod } from '../components/WeekView';
import { Sheet } from '../components/Sheet';
import { Button, ErrorText, Field, Notice, Screen, StatusChip, sheetStatus } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * A manager's view of one person's weeks: every day of the week, entry
 * corrections (tap → edit) and adding hours on their behalf in any week not yet
 * approved, and the decision when the week is submitted — Approve, or Reject
 * with the reason they will see.
 */
export function TimesheetReviewScreen({
  reviewerUid,
  admin,
  uid,
  displayName,
  periodKey,
}: {
  reviewerUid: string;
  /** An admin may reopen an approved week, anyone's, as on their own timesheet. */
  admin: boolean;
  uid: string;
  displayName: string;
  /** Initial week; the screen steps freely from here. */
  periodKey: string;
}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [anchor, setAnchor] = useState(periodKey);
  // A second submission notification can re-target this screen (another person,
  // another week) while it is mounted — navigate() swaps the params in place.
  useEffect(() => setAnchor(periodKey), [periodKey]);
  const todayKey = dayKeyFor(Date.now(), deviceTimeZone());
  const period = periodRangeFor(anchor);
  const sheet = useTimesheet(uid, period.fromKey);
  const status = sheet === undefined ? undefined : (sheet?.status ?? 'draft');
  const entries = useEntriesRange(uid, period.fromKey, period.toKey);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const conflicts = useMemo(() => overlappingEntryIds(entries), [entries]);
  const total = useMemo(() => entries.reduce((s, e) => s + (e.durationMinutes ?? 0), 0), [entries]);

  // Every day of the week, so an empty day is visible during review.
  const days = useMemo(() => {
    const list: string[] = [];
    for (let d = period.fromKey; d <= period.toKey; d = addDays(d, 1)) list.push(d);
    return list;
  }, [period.fromKey, period.toKey]);

  const decide = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      setRejecting(false);
      nav.goBack();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = status ? sheetStatus(status) : null;
  return (
    <Screen
      title={displayName}
      subtitle={
        shown ? (
          <View style={styles.lede}>
            <StatusChip label={shown.label} tone={shown.tone} />
            <Text style={styles.ledeText}>· {formatDuration(total)} logged</Text>
          </View>
        ) : undefined
      }
      width="read"
    >
      <WeekStepper
        period={period}
        current={periodRangeFor(todayKey).fromKey === period.fromKey}
        onStep={(dir) => setAnchor(stepPeriod(period, dir))}
        onCurrent={() => setAnchor(todayKey)}
      />
      {sheet?.status === 'rejected' && sheet.rejectReason ? (
        <Notice tone="error">Rejected: {sheet.rejectReason}</Notice>
      ) : null}

      {/* The decision first, under the week it is about: the days below are
          what it rests on, and a reviewer should not have to scroll a whole
          week to find the buttons. */}
      {sheet && sheet.status === 'submitted' ? (
        <View style={styles.decision}>
          <Text style={styles.hint}>
            Check the days below, then approve the week, or reject it with a reason {displayName} will see.
          </Text>
          <Button label="Approve timesheet" onPress={() => decide(() => approveTimesheet(sheet, reviewerUid, entries))} />
          <Button label="Reject timesheet…" kind="secondary" onPress={() => setRejecting(true)} />
        </View>
      ) : null}
      {status === 'approved' && sheet ? (
        <View style={styles.decision}>
          <Text style={styles.hint}>Approved, so this week is closed. Only an admin can reopen it.</Text>
          {admin ? (
            <Button
              label="Reopen (admin)"
              kind="quiet"
              onPress={async () => {
                setError(null);
                try {
                  await reopenTimesheet(sheet);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          ) : null}
        </View>
      ) : null}

      {days.map((dayKey) => (
        <DayEntries
          key={dayKey}
          dayKey={dayKey}
          entries={entries.filter((e) => e.dayKey === dayKey)}
          conflicts={conflicts}
          onOpen={(entryId) => nav.navigate('EntryEdit', { entryId })}
        />
      ))}

      {status === 'approved' ? null : (
        <Button
          label={`Add hours for ${displayName}`}
          kind="quiet"
          onPress={() => nav.navigate('ManualEntry', { forUid: uid, forName: displayName })}
        />
      )}
      <ErrorText error={error} />

      <Sheet visible={rejecting} title="Reject timesheet" onClose={() => setRejecting(false)} closeLabel="Cancel">
        <Field
          label={`What does ${displayName} need to fix?`}
          value={reason}
          onChangeText={setReason}
          placeholder="What needs fixing?"
          multiline
        />
        <Button
          label="Reject timesheet"
          kind="danger"
          block
          disabled={reason.trim().length === 0 || !sheet}
          onPress={() => (sheet ? decide(() => rejectTimesheet(sheet, reviewerUid, reason.trim())) : undefined)}
        />
        <ErrorText error={error} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginTop: spacing(1) },
  ledeText: { fontSize: 13, color: t.text.secondary },
  decision: { gap: spacing(3), marginTop: spacing(2) },
  hint: { fontSize: 14, color: t.text.secondary },
});
