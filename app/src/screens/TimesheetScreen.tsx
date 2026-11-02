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
  periodHasStarted,
  periodLabel,
  periodRangeFor,
  periodsOfMonth,
  type TokenClaims,
  type UserDoc,
} from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { confirmAction } from '../confirm';
import { copyPeriodEntries, useEntriesRange, useEntryPeriods, type TimeEntry } from '../entries';
import {
  submitTimesheet,
  resubmitTimesheet,
  withdrawTimesheet,
  reopenTimesheet,
  useMyTimesheetsRange,
  useTimesheet,
} from '../timesheets';
import { setApprover, useApproverChoices } from '../users';
import { SearchablePicker } from '../components/SearchablePicker';
import { DayEntries, MonthWeeks, type WeekState } from '../components/WeekView';
import {
  Button,
  Empty,
  ErrorText,
  IconButton,
  Notice,
  Screen,
  SectionTitle,
  StatusChip,
  sheetStatus,
} from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Timesheet: what did I log this week, and is it in? The week's days and
 * entries, then the one thing its state allows — submit, withdraw, resubmit.
 */
export function TimesheetScreen({
  uid,
  profile,
  claims,
  initialPeriodKey,
}: {
  uid: string;
  profile: UserDoc;
  claims: TokenClaims;
  /** Open anchored at this week (a rejection or a notification jumps straight there). */
  initialPeriodKey?: string;
}) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const todayKey = dayKeyFor(Date.now(), deviceTimeZone());
  const [anchor, setAnchor] = useState(initialPeriodKey ?? todayKey);
  const [error, setError] = useState<string | null>(null);

  // Re-target when the param changes under a mounted screen: navigating here
  // from a notification while already on this screen updates params rather than
  // remounting, so without this the tap would leave you on the previous week.
  useEffect(() => {
    if (initialPeriodKey) setAnchor(initialPeriodKey);
  }, [initialPeriodKey]);

  const period = periodRangeFor(anchor);
  const entries = useEntriesRange(uid, period.fromKey, period.toKey);
  const sheet = useTimesheet(uid, period.fromKey);
  const status = sheet === undefined ? undefined : (sheet?.status ?? 'draft');

  // The month around this week, for its chips: each week's sheet, and which
  // weeks have hours at all (the "in progress, not submitted" dot).
  const month = useMemo(() => periodsOfMonth(anchor), [anchor]);
  const monthSheets = useMyTimesheetsRange(uid, month[0].fromKey, month[month.length - 1].fromKey);
  const withHours = useEntryPeriods(uid, month[0].fromKey, month[month.length - 1].toKey);
  const stateOf = (periodKey: string): WeekState => {
    // The week on screen reads its own live sheet, which lands first.
    const st =
      periodKey === period.fromKey && sheet !== undefined
        ? sheet?.status
        : monthSheets.find((m) => m.periodKey === periodKey)?.status;
    return st ?? (withHours.has(periodKey) ? 'inProgress' : 'empty');
  };

  const total = useMemo(() => entries.reduce((s, e) => s + (e.durationMinutes ?? 0), 0), [entries]);
  const byDay = useMemo(() => {
    const groups = new Map<string, TimeEntry[]>();
    for (const e of entries) groups.set(e.dayKey, [...(groups.get(e.dayKey) ?? []), e]);
    return [...groups.entries()];
  }, [entries]);

  // Submission preconditions (rules enforce them too; these make the UI honest).
  const approvers = useApproverChoices();
  // Rejections come from managers/admins, whose profiles every active user may
  // read, so the name resolves from the approver list.
  const decidedBy = approvers.find((a) => a.uid === sheet?.decidedBy)?.displayName;
  const approverUid = profile.approverUid ?? (claims.admin ? uid : null);
  const hasRunningInPeriod = entries.some((e) => e.end === null);
  const started = periodHasStarted(period.fromKey, todayKey);
  const conflicts = useMemo(() => overlappingEntryIds(entries), [entries]);
  const blocked = !approverUid || hasRunningInPeriod || conflicts.size > 0;

  const act = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = status ? sheetStatus(status) : null;
  return (
    <Screen
      title="Timesheet"
      subtitle={
        shown ? (
          <View style={styles.lede}>
            <StatusChip label={shown.label} tone={shown.tone} />
            <Text style={styles.ledeText}>· {formatDuration(total)} logged</Text>
          </View>
        ) : undefined
      }
      actions={<IconButton icon="add" label="Add hours" onPress={() => nav.navigate('ManualEntry')} />}
      width="read"
    >
      <MonthWeeks period={period} todayKey={todayKey} stateOf={stateOf} onPick={setAnchor} />

      {sheet?.status === 'rejected' ? (
        <Notice tone="error">
          Rejected{decidedBy ? ` by ${decidedBy}` : ''}: {sheet.rejectReason}
          {'\n'}Fix the entries below, then resubmit it.
        </Notice>
      ) : null}

      {byDay.map(([dayKey, dayEntries]) => (
        <DayEntries
          key={dayKey}
          dayKey={dayKey}
          entries={dayEntries}
          conflicts={conflicts}
          onOpen={(entryId) => nav.navigate('EntryEdit', { entryId })}
        />
      ))}
      {entries.length === 0 ? (
        <Empty>
          {started
            ? 'Nothing logged this week yet. Clock in on Today, or add hours with the + above.'
            : "This week hasn't started yet."}
        </Empty>
      ) : null}

      {status === 'draft' && started && entries.length === 0 ? (
        <Button
          label="Copy last week's hours"
          kind="secondary"
          onPress={() =>
            act(async () => {
              const prev = periodRangeFor(addDays(period.fromKey, -1));
              if (
                !(await confirmAction(
                  'Copy last week?',
                  `Copies every entry from ${periodLabel(prev)} into this week (same days, same times). You can edit or delete them afterwards.`,
                ))
              )
                return;
              const { copied, skipped } = await copyPeriodEntries(uid, prev, period);
              if (copied === 0) throw new Error('Last week has no entries to copy.');
              if (skipped > 0)
                throw new Error(`Copied ${copied}; skipped ${skipped} that fall outside this (shorter) week.`);
            })
          }
        />
      ) : null}

      {(status === 'draft' && started) || status === 'rejected' ? (
        <>
          <SectionTitle>Approver</SectionTitle>
          <Text style={styles.hint}>Your timesheet goes to them when you submit it.</Text>
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
            onSelect={(id) => void act(() => setApprover(uid, id))}
            placeholder="Choose who approves your hours"
            title="Timesheet approver"
          />
          {!approverUid ? (
            <Text style={styles.warn}>Choose who approves your hours above, then submit.</Text>
          ) : null}
          {hasRunningInPeriod ? <Text style={styles.hint}>Clock out before you submit this week.</Text> : null}
          {conflicts.size > 0 ? (
            <Text style={styles.warn}>Some entries overlap. Fix the flagged times before you submit.</Text>
          ) : null}
          {status === 'rejected' && sheet ? (
            <Button
              label="Resubmit timesheet"
              onPress={() => act(() => resubmitTimesheet(sheet, approverUid!, entries))}
              disabled={blocked}
            />
          ) : (
            <Button
              label={total === 0 ? 'Submit timesheet (no hours)' : 'Submit timesheet'}
              onPress={() => act(() => submitTimesheet(uid, period, approverUid!, entries))}
              disabled={blocked}
            />
          )}
        </>
      ) : null}

      {sheet && sheet.status === 'submitted' ? (
        <>
          <Text style={styles.hint}>
            Submitted. It is with your approver now; withdraw it if you need to change something.
          </Text>
          <Button label="Withdraw submission" kind="quiet" onPress={() => act(() => withdrawTimesheet(sheet))} />
        </>
      ) : null}
      {sheet && sheet.status === 'approved' ? (
        <>
          <Text style={styles.hint}>Approved, so this week is closed. Only an admin can reopen it.</Text>
          {claims.admin ? (
            <Button label="Reopen (admin)" kind="quiet" onPress={() => act(() => reopenTimesheet(sheet))} />
          ) : null}
        </>
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginTop: spacing(1) },
  ledeText: { fontSize: 13, color: t.text.secondary },
  hint: { fontSize: 14, color: t.text.secondary },
  warn: { fontSize: 14, fontWeight: '600', color: t.text.danger },
});
