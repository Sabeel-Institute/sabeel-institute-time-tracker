import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { TokenClaims } from '@sabeel/shared';
import {
  useActivities,
  createActivity,
  deleteActivity,
  setActivityStatus,
  type Activity,
} from '../activities';
import { confirmAction } from '../confirm';
import { Button, Collapsible, Empty, ErrorText, Row, RowList, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

export function ActivitiesScreen({ selfUid, claims }: { selfUid: string; claims: TokenClaims }) {
  const rows = useActivities({ includeArchived: true });
  const active = rows.filter((a) => a.status === 'active');
  // Archived activities stay reachable for Restore, below the list and closed,
  // so the ones people log against are the ones on screen.
  const archived = rows.filter((a) => a.status === 'archived');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await createActivity({ name, createdBy: selfUid });
      setName('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const flip = async (id: string, status: 'active' | 'archived') => {
    setError(null);
    try {
      await setActivityStatus(id, status);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // An admin's alone, and offered only on an archived activity, as the rules
  // require: archiving first takes it out of every picker before it goes.
  const remove = async (a: Activity) => {
    const ok = await confirmAction(
      `Delete ${a.name}?`,
      'This cannot be undone. Hours already logged under it keep its name.',
    );
    if (!ok) return;
    setError(null);
    try {
      await deleteActivity(a.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const row = (a: Activity) => (
    <Row
      key={a.id}
      label={a.name}
      actions={
        a.status === 'active' ? (
          <Button label="Archive" kind="quiet" onPress={() => flip(a.id, 'archived')} />
        ) : (
          <>
            <Button label="Restore" kind="secondary" onPress={() => flip(a.id, 'active')} />
            {claims.admin === true ? <Button label="Delete" kind="remove" onPress={() => remove(a)} /> : null}
          </>
        )
      }
    />
  );

  return (
    <Screen width="read" subtitle="What people log their hours against. Archiving one takes it out of the pickers; its hours stay.">
      <View style={styles.add}>
        <TextInput
          testID="activity-name"
          accessibilityLabel="New activity name"
          value={name}
          onChangeText={setName}
          onSubmitEditing={add}
          placeholder="New activity name"
          placeholderTextColor={t.text.muted}
          style={styles.input}
        />
        <Button label="Add" onPress={add} disabled={!name.trim()} />
      </View>
      <ErrorText error={error} />

      {active.length > 0 ? <RowList>{active.map(row)}</RowList> : null}
      {active.length === 0 ? (
        <Empty>{archived.length === 0 ? 'Nothing yet. Add the first one above.' : 'No active activities.'}</Empty>
      ) : null}
      {archived.length > 0 ? (
        <Collapsible title="Archived" count={archived.length}>
          <RowList>{archived.map(row)}</RowList>
        </Collapsible>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing(2) },
  input: {
    flexGrow: 1,
    flexBasis: 160,
    backgroundColor: t.bg.inset,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border.subtle,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(3),
    fontSize: 15,
    color: t.text.primary,
    minHeight: 44,
  },
});
