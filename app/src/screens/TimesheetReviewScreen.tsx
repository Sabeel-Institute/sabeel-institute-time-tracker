import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  addDays,
  approverFor,
  dayKeyFor,
  deviceTimeZone,
  formatDuration,
  periodRangeFor,
  recordedReviewFor,
  timesheetEntriesVersion,
  timesheetRevision,
  waitingState,
} from '@sabeel/shared';
import { leaveIfShowing, type RootStackParamList } from '../nav';
import { approveTimesheet, rejectTimesheet, reopenTimesheet, useTimesheet, weekActionMessage } from '../timesheets';
import { DayEntries, WeekStepper, openingDay, stepPeriod } from '../components/WeekView';
import { Sheet } from '../components/Sheet';
import { SearchablePicker } from '../components/SearchablePicker';
import { approverItems, setApprover, useUser } from '../users';
import { useEligibleApprovers } from '../waiting';
import { useApprovers } from '../approvers';
import { Button, ErrorText, Field, Notice, Screen, Spinner, StatusChip, sheetStatus } from '../components/ui';
import { getTheme, spacing } from '../theme';
import { useReviewConfirmation, useTimesheetReview } from '../timesheetReview';
import { reviewHighlights, TimesheetReviewPrompt } from '../components/TimesheetReviewPrompt';

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
  const todayKey = dayKeyFor(Date.now(), deviceTimeZone());
  const period = periodRangeFor(anchor);
  const sheet = useTimesheet(uid, period.fromKey);
  const status = sheet === undefined ? undefined : (sheet?.status ?? 'draft');
  // Wait for the entries before showing empty days or enabling approval.
  const { loaded, synced, entries, conflicts, needsReview, review, hasRunning } = useTimesheetReview(uid, period.fromKey, period.toKey);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A second submission notification can re-target this screen (another person,
  // another week) while it is mounted — navigate() swaps the params in place —
  // and whatever was under way for the last subject goes with it: a Reject
  // sheet left open would otherwise reject the new week with the old reason.
  useEffect(() => {
    setAnchor(periodKey);
    setRejecting(null);
    setReason('');
    setError(null);
  }, [uid, periodKey]);
  // An error is about the week it happened on; another week starts clear.
  const showWeek = (key: string) => {
    setAnchor(key);
    setRejecting(null);
    setError(null);
  };

  const recordedSubmission = recordedReviewFor(sheet?.submissionReview, sheet?.submittedAt);
  // An empty week is submitted without a review; anything flagged since then
  // is new to the member. (An older app's submission records none either, and
  // says nothing about what its member saw.)
  const submittedReview = recordedSubmission
    ?? (sheet?.status === 'submitted' && sheet.entryCount === 0 && review ? { limits: review.limits, flags: [] } : undefined);
  const shownReview = status === 'approved' ? recordedReviewFor(sheet?.approvalReview, sheet?.decidedAt) : review;
  const highlights = reviewHighlights(shownReview, status === 'submitted' ? submittedReview : undefined);
  const canApprove = loaded && synced && (!needsReview || review !== undefined) && conflicts.size === 0 && !hasRunning;
  const target = JSON.stringify([uid, period.fromKey, sheet ? timesheetRevision(sheet) : status]);
  const confirmation = useReviewConfirmation(JSON.stringify([target, canApprove, timesheetEntriesVersion(entries)]), review, setError);
  const editEntry = (entryId: string) => {
    confirmation.close();
    nav.navigate('EntryEdit', { entryId });
  };
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
      setRejecting(null);
      leaveIfShowing(nav);
    } catch (e) {
      setError(weekActionMessage(e));
    }
  };

  const approve = async () => {
    if (!sheet || sheet.status !== 'submitted' || !canApprove || saving) return;
    confirmation.close();
    setSaving(true);
    try {
      await decide(() => approveTimesheet(sheet, entries, review));
    } finally {
      setSaving(false);
    }
  };
  const startApproval = () => {
    setError(null);
    if (review?.flags.length) confirmation.open();
    else void approve();
  };

  // Who has the week. Only they or an admin may decide it; a week whose holder
  // may no longer approve waits for its person to be given a new approver,
  // which an admin (or a manager, for a non-admin) can do from here.
  const owner = useUser(uid);
  const approvers = useApprovers();
  const eligible = useEligibleApprovers();
  const holder = useUser(sheet?.status === 'submitted' ? sheet.approverUid : uid);
  const standing = sheet?.status === 'submitted' && owner && eligible
    ? waitingState(sheet, approverFor(uid, owner), new Set(eligible.keys())) : undefined;
  // undefined until the holder's profile is in: no sentence names them before.
  const holderName = sheet?.status === 'submitted' && holder?.uid === sheet.approverUid ? holder.displayName : undefined;
  // Nothing about a submitted week's decision is drawn until where it stands
  // is known, so no button appears and then moves, or appears and goes.
  const known = sheet?.status === 'submitted' && standing !== undefined
    && (standing.kind === 'moving' || holderName !== undefined);
  // The holder decides while it is theirs to: not once its person has chosen
  // someone else, nor once they may no longer approve (the server and rules
  // refuse both). An admin decides any week.
  const canDecide = known && (admin || (sheet?.approverUid === reviewerUid && standing?.kind === 'waiting'));
  // Who may set this person's approver (firestore.rules): an admin, or a
  // manager who still may approve, for a non-admin.
  const canReassign = admin || (eligible?.has(reviewerUid) === true && owner?.admin !== true);
  // A submitted week's hours are its decider's to correct (canTouchPeriod).
  // Never one's own submitted week: they withdraw it first.
  const canEdit = status !== 'approved' && (status !== 'submitted' || (canDecide && uid !== reviewerUid));
  const [reassigning, setReassigning] = useState(false);
  const reassign = async (approverUid: string) => {
    setError(null);
    setReassigning(true);
    try {
      await setApprover(uid, approverUid);
    } catch (e) {
      setError((e as { code?: string }).code === 'permission-denied'
        ? `You can no longer choose who approves ${displayName}'s timesheets.`
        : weekActionMessage(e));
    } finally {
      setReassigning(false);
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
            {loaded ? <Text style={styles.ledeText}>· {formatDuration(total)} logged</Text> : null}
          </View>
        ) : undefined
      }
      width="read"
    >
      <WeekStepper
        period={period}
        current={periodRangeFor(todayKey).fromKey === period.fromKey}
        onStep={(dir) => showWeek(stepPeriod(period, dir))}
        onCurrent={() => showWeek(todayKey)}
      />
      {sheet?.status === 'rejected' && sheet.rejectReason ? (
        <Notice tone="error">Rejected: {sheet.rejectReason}</Notice>
      ) : null}

      {/* The decision first, under the week it is about: the days below are
          what it rests on, and a reviewer should not have to scroll a whole
          week to find the buttons. */}
      {sheet?.status === 'submitted' && !known ? <Text style={styles.hint}>Checking who has this week…</Text> : null}
      {known && standing?.kind === 'stuck' ? (
        <View style={styles.decision}>
          <Notice tone="info">
            {holderName} can no longer approve timesheets, so this week is waiting for a new approver.
            {canReassign ? ` Choose who approves ${displayName}'s timesheets below.` : ' An admin can choose one for them.'}
            {admin ? ' You can also approve or reject it yourself.' : ''}
          </Notice>
          {canReassign ? (
            <SearchablePicker
              items={approverItems(approvers.list ?? [], uid, '(self)')}
              selectedId={owner?.approverUid ?? null}
              onSelect={(id) => void reassign(id)}
              placeholder="Choose an approver"
              title="Timesheet approver"
              disabled={reassigning}
            />
          ) : null}
        </View>
      ) : null}
      {known && standing?.kind === 'moving' ? (
        <Text style={styles.hint}>
          Passing to {standing.approverUid === reviewerUid ? 'you' : (eligible?.get(standing.approverUid)?.displayName ?? 'their new approver')}…
        </Text>
      ) : null}
      {known && !canDecide && standing?.kind === 'waiting' ? (
        <Text style={styles.hint}>This week is with {holderName}. Only they or an admin can approve or reject it.</Text>
      ) : null}
      {sheet && canDecide ? (
        <View style={styles.decision}>
          <Text style={styles.hint}>
            Check the days below, then approve the week, or reject it with a reason {displayName} will see.
          </Text>
          {recordedSubmission && recordedSubmission.flags.length > 0 ? (
            <Text style={styles.hint}>Member confirmed the flagged hours on {new Date(recordedSubmission.at).toLocaleDateString()}.</Text>
          ) : null}
          {loaded && !synced ? <Text style={styles.hint}>Checking for the latest hours before you can approve…</Text> : null}
          {hasRunning ? <Notice tone="info">This week still has a running timer. Wait for it to close before approving.</Notice> : null}
          {conflicts.size > 0 ? <Notice tone="error">Fix overlapping entries before approving.</Notice> : null}
          <Button
            label="Approve timesheet"
            onPress={startApproval}
            disabled={!canApprove || saving}
          />
          <Button
            label="Reject timesheet…"
            kind="secondary"
            disabled={saving}
            onPress={() => {
              setError(null);
              setRejecting(target);
            }}
          />
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
                  setError(weekActionMessage(e));
                }
              }}
            />
          ) : null}
        </View>
      ) : null}
      {/* Under the buttons it answers, not below the whole week. */}
      <ErrorText error={confirmation.visible ? null : error} />
      {highlights.days.map((message) => <Notice key={message} tone="info">{message}</Notice>)}

      {!loaded ? <Spinner label="Loading this week…" /> : null}
      {(loaded ? days : []).map((dayKey) => (
        <DayEntries
          key={dayKey}
          dayKey={dayKey}
          entries={entries.filter((e) => e.dayKey === dayKey)}
          conflicts={conflicts}
          review={highlights.entries}
          // An approver corrects entries in any week not yet approved.
          onOpen={canEdit ? editEntry : undefined}
        />
      ))}

      {!canEdit ? null : (
        <Button
          label={`Add hours for ${displayName}`}
          kind="quiet"
          onPress={() =>
            nav.navigate('ManualEntry', { forUid: uid, forName: displayName, dayKey: openingDay(period, todayKey) })
          }
        />
      )}

      <TimesheetReviewPrompt
        visible={confirmation.visible && status === 'submitted' && canApprove}
        mode="approve"
        highlights={highlights}
        entries={entries}
        busy={saving}
        error={error}
        onClose={confirmation.close}
        onConfirm={approve}
        onEdit={editEntry}
      />
      <Sheet visible={rejecting === target} title="Reject timesheet" onClose={() => setRejecting(null)} closeLabel="Cancel">
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
