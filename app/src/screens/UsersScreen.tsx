import { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { type TokenClaims } from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useUsers, type UserRow } from '../users';
import { setUserAccess } from '../access';
import {
  Button,
  Collapsible,
  Empty,
  ErrorText,
  Row,
  RowList,
  Screen,
  SectionTitle,
} from '../components/ui';
import { getTheme } from '../theme';

const t = getTheme();

/** A person's role in words, as the people list and their page say it. */
export function roleWords(u: UserRow): string {
  return u.admin ? 'Admin' : u.role === 'manager' ? 'Manager' : 'Member';
}

/**
 * Everyone with an account. Accounts waiting for approval come first, with
 * Approve on the row for an admin; everyone else opens to their own page, where
 * their approver, role and access are set.
 */
export function UsersScreen({ selfUid, claims }: { selfUid: string; claims: TokenClaims }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const rows = useUsers();
  const [error, setError] = useState<string | null>(null);
  const isAdmin = claims.admin === true;
  const nameOf = useMemo(() => new Map(rows.map((u) => [u.uid, u.displayName])), [rows]);
  const byName = (a: UserRow, b: UserRow) => a.displayName.localeCompare(b.displayName);
  const pending = rows.filter((u) => u.status === 'pending').sort(byName);
  const active = rows.filter((u) => u.status === 'active').sort(byName);
  const disabled = rows.filter((u) => u.status === 'disabled').sort(byName);

  const open = (u: UserRow) => nav.navigate('UserEdit', { uid: u.uid });
  const person = (u: UserRow) => (
    <Row
      key={u.uid}
      label={u.uid === selfUid ? `${u.displayName} (you)` : u.displayName}
      detail={
        <>
          <Text style={styles.detail}>{u.email}</Text>
          {u.status === 'active' ? (
            <Text style={styles.detail}>
              {roleWords(u)} · approver: {u.approverUid ? (nameOf.get(u.approverUid) ?? 'unknown') : 'none yet'}
            </Text>
          ) : null}
        </>
      }
      accessibilityLabel={`${u.displayName}. Open their account.`}
      onPress={() => open(u)}
    />
  );

  return (
    <Screen width="read" subtitle="Open someone to set their approver, role and access.">
      {pending.length > 0 ? (
        <>
          <SectionTitle>Waiting for approval ({pending.length})</SectionTitle>
          <RowList>
            {pending.map((u) => (
              <Row
                key={u.uid}
                label={u.displayName}
                detail={u.email}
                actions={
                  isAdmin ? (
                    <Button
                      label="Approve"
                      onPress={() => {
                        setError(null);
                        return setUserAccess({ uid: u.uid, status: 'active' }).then(
                          () => undefined,
                          (e) => setError((e as Error).message),
                        );
                      }}
                    />
                  ) : null
                }
              />
            ))}
          </RowList>
          <ErrorText error={error} />
        </>
      ) : null}

      <SectionTitle>Everyone ({active.length})</SectionTitle>
      {active.length > 0 ? <RowList>{active.map(person)}</RowList> : <Empty>No one yet.</Empty>}

      {disabled.length > 0 ? (
        <Collapsible title="Disabled" count={disabled.length}>
          <RowList>{disabled.map(person)}</RowList>
        </Collapsible>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  detail: { fontSize: 13, color: t.text.secondary },
});
