import { useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  dayKeyFor,
  dayLabel,
  deviceTimeZone,
  formatDuration,
  periodLabel,
  type TokenClaims,
} from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useApprovalQueue } from '../timesheets';
import { useUsers } from '../users';
import { Empty, Row, RowList, Screen, Segmented, Spinner } from '../components/ui';

/** The approver's queue: timesheets submitted to me (admins may view all). */
export function ApprovalsScreen({ uid, claims }: { uid: string; claims: TokenClaims }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const queue = useApprovalQueue(uid, { all: claims.admin === true && scope === 'all' });
  const users = useUsers();
  const nameOf = useMemo(() => new Map((users ?? []).map((u) => [u.uid, u.displayName])), [users]);
  const tz = deviceTimeZone();

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
          {scope === 'all'
            ? 'Nothing waiting for anyone. Submitted timesheets show up here.'
            : 'Nothing waiting for you. When someone submits a timesheet to you, it shows up here.'}
        </Empty>
      ) : (
        <RowList>
          {queue.map((ts) => {
            const name = nameOf.get(ts.uid) ?? ts.uid;
            return (
              <Row
                key={ts.id}
                label={name}
                detail={`${periodLabel({ fromKey: ts.periodKey, toKey: ts.toKey })} · submitted ${dayLabel(dayKeyFor(ts.submittedAt, tz))}`}
                value={formatDuration(ts.totalMinutes)}
                accessibilityLabel={`Review ${name}'s timesheet`}
                onPress={() =>
                  nav.navigate('TimesheetReview', { uid: ts.uid, displayName: name, periodKey: ts.periodKey })
                }
              />
            );
          })}
        </RowList>
      )}
    </Screen>
  );
}
