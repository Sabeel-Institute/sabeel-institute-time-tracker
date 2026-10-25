import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useActivities, createActivity, setActivityStatus } from '../activities';
import { Button, ErrorText, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

export function ActivitiesScreen({ selfUid }: { selfUid: string }) {
  const rows = useActivities({ includeArchived: true });
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

      {rows.map((a) => (
        <View key={a.id} style={[styles.card, a.status === 'archived' && styles.cardArchived]}>
          <View style={styles.cardText}>
            <Text style={styles.name}>{a.name}</Text>
            {a.status === 'archived' ? <Text style={styles.meta}>archived</Text> : null}
          </View>
          {a.status === 'active' ? (
            <Button label="Archive" kind="secondary" onPress={() => flip(a.id, 'archived')} />
          ) : (
            <Button label="Restore" kind="secondary" onPress={() => flip(a.id, 'active')} />
          )}
        </View>
      ))}
      {rows.length === 0 && <Text style={styles.empty}>Nothing yet — add the first one.</Text>}
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
  cardArchived: { opacity: 0.55 },
  cardText: { flexShrink: 1 },
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: { fontSize: 13, color: t.text.secondary },
  empty: { color: t.text.secondary },
});
