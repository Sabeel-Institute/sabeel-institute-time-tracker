import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TokenClaims } from '@sabeel/shared';
import {
  useActivities,
  createActivity,
  deleteActivity,
  setActivityStatus,
  type Activity,
} from '../activities';
import { confirmAction } from '../confirm';
import { Button, Collapsible, ErrorText, Screen } from '../components/ui';
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

  const card = (a: Activity) => (
    <View key={a.id} style={[styles.card, a.status === 'archived' && styles.cardWrap]}>
      <Text style={[styles.name, styles.cardText, a.status === 'archived' && styles.nameWrap]}>
        {a.name}
      </Text>
      {a.status === 'active' ? (
        <Button label="Archive" kind="secondary" onPress={() => flip(a.id, 'archived')} />
      ) : (
        <View style={styles.actions}>
          <Button label="Restore" kind="secondary" onPress={() => flip(a.id, 'active')} />
          {claims.admin === true ? (
            <Button label="Delete" kind="danger" onPress={() => remove(a)} />
          ) : null}
        </View>
      )}
    </View>
  );

  return (
    <Screen width="read">
      <View style={styles.form}>
        <TextInput
          testID="activity-name"
          value={name}
          onChangeText={setName}
          placeholder="New activity name"
          style={styles.input}
        />
        <Button label="Add" onPress={add} disabled={!name.trim()} />
        <ErrorText error={error} />
      </View>

      {active.map(card)}
      {active.length === 0 ? (
        <Text style={styles.empty}>
          {archived.length === 0 ? 'Nothing yet — add the first one.' : 'No active activities.'}
        </Text>
      ) : null}
      {archived.length > 0 ? (
        <Collapsible title="Archived" count={archived.length}>
          {archived.map(card)}
        </Collapsible>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing(2), marginBottom: spacing(2) },
  input: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(3),
    fontSize: 15,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 12,
    padding: spacing(3.5),
    gap: spacing(3),
  },
  cardText: { flexShrink: 1 },
  // Two buttons do not fit beside a long name on a small phone: they move
  // under it instead of running off the edge.
  cardWrap: { flexWrap: 'wrap' },
  nameWrap: { flexGrow: 1, flexBasis: 160 },
  actions: { flexDirection: 'row', gap: spacing(2) },
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  empty: { color: t.text.secondary },
});
