import { useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  approverFor,
  dayKeyFor,
  dayLabel,
  deviceTimeZone,
  formatDuration,
  periodLabel,
  waitingState,
  type TokenClaims,
} from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useApprovalQueue, type Timesheet } from '../timesheets';
import { approverChoices, useUsers } from '../users';
import { Collapsible, Empty, Row, RowList, Screen, Segmented, Spinner } from '../components/ui';

/** The approver's queue: timesheets submitted to me (admins may view all). */
export function ApprovalsScreen({ uid, claims }: { uid: string; claims: TokenClaims }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  // Everyone's queue is an admin's; one who stops being one sees their own.
  const all = claims.admin === true && scope === 'all';
  const queue = useApprovalQueue(uid, { all });
  const users = useUsers();
  // Where a week stands is judged from every profile, so from the server's
  // list: the cache may hold only some (managers', admins' and one's own).
  const everyone = useUsers({ waitForServer: true });
  const byUid = useMemo(() => new Map((users ?? []).map((u) => [u.uid, u])), [users]);
  const profileOf = useMemo(() => new Map((everyone ?? []).map((u) => [u.uid, u])), [everyone]);
  const eligible = useMemo(() => new Set(approverChoices(everyone ?? []).map((u) => u.uid)), [everyone]);
  const tz = deviceTimeZone();
  // Everyone's queue, for an admin: weeks nobody can approve go in their own
  // folded group above the rest, each saying who had it. The fix is choosing
  // the person a new approver, from the week itself.
  const standingOf = (ts: Timesheet) => {
    const owner = profileOf.get(ts.uid);
    return waitingState(ts, owner ? approverFor(ts.uid, owner) : null, eligible);
  };
  // Where each week is can be said only once everyone's profile is in.
  const placed = all && everyone !== undefined;
  const stuck = placed ? (queue ?? []).filter((ts) => standingOf(ts).kind === 'stuck') : [];
  const rest = (queue ?? []).filter((ts) => !stuck.includes(ts));
  const row = (ts: Timesheet) => {
    const name = byUid.get(ts.uid)?.displayName ?? ts.uid;
    const standing = placed ? standingOf(ts) : undefined;
    const holder = standing ? byUid.get(standing.approverUid)?.displayName ?? 'someone' : undefined;
    const where = !standing ? ''
      : standing.kind === 'stuck' ? ` · was with ${holder}`
      : standing.kind === 'moving' ? ` · passing to ${holder}`
      : standing.approverUid === ts.uid ? ' · their own approval' : ` · with ${holder}`;
    const detail = `${periodLabel({ fromKey: ts.periodKey, toKey: ts.toKey })} · submitted ${dayLabel(dayKeyFor(ts.submittedAt, tz))}${where}`;
    return (
      <Row
        key={ts.id}
        label={name}
        detail={detail}
        value={formatDuration(ts.totalMinutes)}
        accessibilityLabel={`Review ${name}'s timesheet: ${detail}, ${formatDuration(ts.totalMinutes)}`}
        onPress={() =>
          nav.navigate('TimesheetReview', { uid: ts.uid, displayName: name, periodKey: ts.periodKey })
        }
      />
    );
  };

  return (
    <Screen
      title="Approvals"
      subtitle={
        !queue?.length
          ? undefined
          : queue.length === 1
            ? 'One timesheet is waiting for a decision.'
            : `${queue.length} timesheets are waiting for a decision.`
      }
      width="read"
    >
      {claims.admin ? (
        <Segmented
          value={scope}
          options={[
            { value: 'mine', label: 'Assigned to me' },
            { value: 'all', label: 'All submitted' },
          ]}
          onChange={setScope}
        />
      ) : null}
      {queue === undefined ? (
        <Spinner label="Loading timesheets…" />
      ) : queue.length === 0 ? (
        <Empty>
          {all
            ? 'Nothing waiting for anyone. Submitted timesheets show up here.'
            : 'Nothing waiting for you. When someone submits a timesheet to you, it shows up here.'}
        </Empty>
      ) : (
        <>
          {stuck.length > 0 ? (
            <Collapsible title="Need a new approver" count={stuck.length}>
              <RowList>{stuck.map(row)}</RowList>
            </Collapsible>
          ) : null}
          {rest.length > 0 ? <RowList>{rest.map(row)}</RowList> : null}
        </>
      )}
    </Screen>
  );
}
