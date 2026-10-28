import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { addDays, dayKeyFor, deviceTimeZone, formatDuration, monthRange } from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useActivities } from '../activities';
import { useUsers } from '../users';
import { fetchTotals, fetchCsv, type Totals } from '../reporting';
import { saveCsv } from '../saveCsv';
import { SearchablePicker } from '../components/SearchablePicker';
import { Button, ErrorText, Screen } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

type Window = 'week' | 'month' | 'year' | 'all';

function windowRange(w: Window, todayKey: string): { fromKey: string; toKey: string } {
  if (w === 'all') return { fromKey: '2000-01-01', toKey: '2999-12-31' };
  if (w === 'week') return { fromKey: addDays(todayKey, -6), toKey: todayKey };
  if (w === 'month') return monthRange(todayKey);
  const [y] = todayKey.split('-');
  return { fromKey: `${y}-01-01`, toKey: `${y}-12-31` };
}

export function ReportsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const todayKey = dayKeyFor(Date.now(), deviceTimeZone());
  const activities = useActivities({ includeArchived: true });
  const users = useUsers();

  const [window, setWindow] = useState<Window>('month');
  const [personUid, setPersonUid] = useState<string | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [includeUnapproved, setIncludeUnapproved] = useState(false);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const filter = useMemo(() => {
    const r = windowRange(window, todayKey);
    return {
      ...r,
      ...(personUid ? { uid: personUid } : {}),
      ...(activityId ? { activityId } : {}),
      ...(includeUnapproved ? { includeUnapproved: true } : {}),
    };
  }, [window, personUid, activityId, includeUnapproved, todayKey]);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchTotals(filter)
      .then((t) => live && setTotals(t))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [filter]);

  const download = async () => {
    setError(null);
    setStatus(null);
    try {
      const { csv, filename } = await fetchCsv(filter);
      setStatus(await saveCsv(filename, csv));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen width="read">
      <Text style={styles.section}>Period</Text>
      <View style={styles.chipRow}>
        {(['week', 'month', 'year', 'all'] as const).map((w) => (
          <Chip key={w} label={w} on={window === w} onPress={() => setWindow(w)} />
        ))}
      </View>

      {/* Searchable pickers, not chip walls — these lists grow with the org.
          The first row ("Everyone"/"All …") acts as the clear-filter option. */}
      <Text style={styles.section}>Person</Text>
      <SearchablePicker
        items={[
          { id: '', label: 'Everyone' },
          ...users
            .filter((u) => u.status === 'active')
            .map((u) => ({ id: u.uid, label: u.displayName, sublabel: u.email })),
        ]}
        selectedId={personUid ?? ''}
        onSelect={(id) => setPersonUid(id || null)}
        placeholder="Everyone"
        title="Filter by person"
      />

      <Text style={styles.section}>Activity</Text>
      <SearchablePicker
        items={[
          { id: '', label: 'All activities' },
          // Archived ones still have hours to report, after the active ones.
          ...activities
            .filter((a) => a.status === 'active')
            .map((a) => ({ id: a.id, label: a.name })),
          ...activities
            .filter((a) => a.status === 'archived')
            .map((a) => ({ id: a.id, label: `${a.name} (archived)` })),
        ]}
        selectedId={activityId ?? ''}
        onSelect={(id) => setActivityId(id || null)}
        placeholder="All activities"
        title="Filter by activity"
      />

      <Text style={styles.section}>Hours counted</Text>
      <View style={styles.chipRow}>
        <Chip
          label="Official (approved only)"
          on={!includeUnapproved}
          onPress={() => setIncludeUnapproved(false)}
        />
        <Chip
          label="Include unapproved"
          on={includeUnapproved}
          onPress={() => setIncludeUnapproved(true)}
        />
      </View>
      {includeUnapproved ? (
        <Text style={styles.unofficial}>
          Unofficial view — includes hours from timesheets not yet approved.
        </Text>
      ) : null}

      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>
          {totals ? formatDuration(totals.totalMinutes) : '…'}
        </Text>
      </View>

      {totals && totals.byActivity.length > 0 ? (
        <View style={styles.breakdown}>
          <Text style={styles.section}>By activity</Text>
          {totals.byActivity.map((a) => (
            <Row key={a.activityId} label={a.activityName} value={formatDuration(a.minutes)} />
          ))}
        </View>
      ) : null}

      {totals && !personUid && totals.byPerson.length > 0 ? (
        <View style={styles.breakdown}>
          <Text style={styles.section}>By person (tap for lifetime statement)</Text>
          {totals.byPerson.map((p) => (
            <Pressable
              key={p.uid}
              onPress={() => nav.navigate('PersonDetail', { uid: p.uid, displayName: p.displayName })}
            >
              <Row label={p.displayName} value={formatDuration(p.minutes)} chevron />
            </Pressable>
          ))}
        </View>
      ) : null}

      <Button label="Export CSV" onPress={download} />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{label}</Text>
    </Pressable>
  );
}

function Row({
  label,
  value,
  chevron,
}: {
  label: string;
  value: string;
  chevron?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>
        {value}
        {chevron ? '  ›' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: '700', color: t.text.secondary, marginTop: spacing(2) },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  chip: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 18,
    paddingHorizontal: spacing(3.5),
    paddingVertical: spacing(1.5),
  },
  chipOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  chipLabel: { color: t.text.secondary, fontSize: 13 },
  chipLabelOn: { color: t.text.inverse },
  totalCard: {
    backgroundColor: t.accent.base,
    borderRadius: 14,
    padding: spacing(5),
    alignItems: 'center',
    marginTop: spacing(3),
  },
  totalLabel: { color: t.accent.goldText, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  totalValue: { color: t.text.inverse, fontSize: 32, fontWeight: '700' },
  breakdown: { gap: spacing(1) },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing(2),
    borderBottomWidth: 1,
    borderBottomColor: t.border.subtle,
  },
  rowLabel: { fontSize: 15, color: t.text.primary },
  rowValue: { fontSize: 15, fontWeight: '600', color: t.accent.base },
  status: { color: t.accent.base, fontSize: 13 },
  unofficial: { color: t.feedback.danger, fontSize: 12 },
});
