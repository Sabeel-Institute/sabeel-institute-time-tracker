import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { type TokenClaims, type UserRole } from '@sabeel/shared';
import { confirmAction } from '../confirm';
import { approverChoices, approverItems, setApprover, useUsers } from '../users';
import { setUserAccess } from '../access';
import { SearchablePicker } from '../components/SearchablePicker';
import {
  Button,
  Empty,
  ErrorText,
  RowList,
  Screen,
  SectionTitle,
  Segmented,
  StatusChip,
  SwitchRow,
} from '../components/ui';
import { roleWords } from './UsersScreen';
import { getTheme, spacing } from '../theme';

const t = getTheme();

const STATUS = {
  pending: { label: 'Waiting for approval', tone: 'waiting' },
  active: { label: 'Active', tone: 'good' },
  disabled: { label: 'Disabled', tone: 'none' },
} as const;

/**
 * One person's account. Each control SHOWS the current value, and changing it
 * asks first, so a mistap is a visible flip you decline rather than an action
 * you discover. Admins change everything here; a manager sets the approver of a
 * non-admin and sees the rest.
 */
export function UserEditScreen({ uid, selfUid, claims }: { uid: string; selfUid: string; claims: TokenClaims }) {
  const rows = useUsers();
  const u = rows.find((r) => r.uid === uid);
  const approvers = useMemo(() => approverChoices(rows), [rows]);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = claims.admin === true;

  if (!u) return <Screen width="read">{rows.length ? <Empty>This account no longer exists.</Empty> : null}</Screen>;

  const change = async (input: Parameters<typeof setUserAccess>[0]) => {
    setError(null);
    try {
      await setUserAccess(input);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const self = u.uid === selfUid;
  const status = STATUS[u.status];

  return (
    <Screen title={self ? `${u.displayName} (you)` : u.displayName} subtitle={u.email} width="read">
      <StatusChip label={`${status.label} · ${roleWords(u)}`} tone={status.tone} />

      {u.status === 'pending' ? (
        isAdmin ? (
          <Button label="Approve account" onPress={() => change({ uid: u.uid, status: 'active' })} />
        ) : (
          <Text style={styles.hint}>An admin approves new accounts.</Text>
        )
      ) : null}

      {u.status === 'active' ? (
        <>
          <SectionTitle>Approver</SectionTitle>
          <Text style={styles.hint}>Their timesheets go to this person when they submit them.</Text>
          {isAdmin || !u.admin ? (
            <SearchablePicker
              items={approverItems(approvers, u.uid, '(self)')}
              selectedId={u.approverUid}
              onSelect={(id) => {
                setError(null);
                setApprover(u.uid, id).catch((e) => setError((e as Error).message));
              }}
              placeholder="No approver assigned"
              title={`Approver for ${u.displayName}`}
            />
          ) : (
            <Text style={styles.value}>
              {approvers.find((a) => a.uid === u.approverUid)?.displayName ?? 'None yet'}
            </Text>
          )}
        </>
      ) : null}

      {!isAdmin && u.status !== 'pending' ? (
        <Text style={styles.hint}>An admin sets roles and access.</Text>
      ) : null}
      {isAdmin && u.status !== 'pending' ? (
        <>
          <SectionTitle>Role</SectionTitle>
          <Text style={styles.hint}>Managers approve timesheets, read reports and look after activities.</Text>
          <Segmented
            value={u.role}
            options={[
              { value: 'member', label: 'Member' },
              { value: 'manager', label: 'Manager' },
            ]}
            disabled={u.status !== 'active' || (self && u.role === 'manager')}
            onChange={async (role) => {
              if (
                await confirmAction(
                  `Change role to ${role}?`,
                  `${u.displayName} will ${role === 'manager' ? 'gain' : 'lose'} manager tools (activities, reports, approvals).`,
                )
              )
                await change({ uid: u.uid, role: role as UserRole });
            }}
          />

          <SectionTitle>Access</SectionTitle>
          <RowList>
            <SwitchRow
              label="Admin"
              description="Full control: accounts, roles, and reopening approved weeks."
              on={u.admin}
              disabled={u.status !== 'active' || self}
              onChange={async (next) => {
                if (
                  await confirmAction(
                    next ? 'Grant admin access?' : 'Remove admin?',
                    next
                      ? `This is full control. ${u.displayName} will be able to approve, disable, and delete ANY user (including you), grant admin to others, change roles, and reopen approved timesheets. Only grant this to people you fully trust.`
                      : `${u.displayName} will no longer manage users or timesheets.`,
                  )
                )
                  await change({ uid: u.uid, admin: next });
              }}
            />
            <SwitchRow
              label="Active"
              description="Can sign in and log hours. Turning this off signs them out."
              on={u.status === 'active'}
              disabled={self}
              onChange={async (active) => {
                if (
                  await confirmAction(
                    active ? 'Re-activate account?' : 'Disable account?',
                    active
                      ? `${u.displayName} will regain access to the app.`
                      : `${u.displayName} will be signed out and unable to log hours.`,
                  )
                )
                  await change({ uid: u.uid, status: active ? 'active' : 'disabled' });
              }}
            />
          </RowList>
          {self ? <Text style={styles.hint}>You can't remove your own admin or disable yourself.</Text> : null}
        </>
      ) : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 14, color: t.text.secondary },
  value: { fontSize: 15, color: t.text.primary, marginTop: spacing(1) },
});
