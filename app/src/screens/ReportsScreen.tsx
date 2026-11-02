import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { addDays, dayKeyFor, deviceTimeZone, formatDuration, monthRange } from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useActivities } from '../activities';
import { useUsers } from '../users';
import { fetchTotals, fetchCsv, type Totals } from '../reporting';
import { saveCsv } from '../saveCsv';
import { SearchablePicker } from '../components/SearchablePicker';
import {
  Button,
  Chips,
  Empty,
  ErrorText,
  Notice,
  Row,
  RowList,
  Screen,
  SectionTitle,
  Segmented,
  StatTile,
} from '../components/ui';
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

  const periodWords = PERIODS.find((p) => p.value === window)!.words;
  const who = personUid ? (users.find((u) => u.uid === personUid)?.displayName ?? 'one person') : 'everyone';
  const what = activityId ? (activities.find((a) => a.id === activityId)?.name ?? 'one activity') : 'all activities';
  return (
    <Screen
      title="Reports"
      subtitle="Hours logged, by period, person and activity."
      width="read"
    >
      <Chips label="Period" value={window} options={PERIODS} onChange={setWindow} />

      {/* Searchable pickers, not chip walls — these lists grow with the org.
          The first row ("Everyone"/"All …") acts as the clear-filter option. */}
      <View style={styles.filters}>
        <View style={styles.filter}>
          <Text style={styles.label}>Person</Text>
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
        </View>
        <View style={styles.filter}>
          <Text style={styles.label}>Activity</Text>
          <SearchablePicker
            items={[
              { id: '', label: 'All activities' },
              // Archived ones still have hours to report, after the active ones.
              ...activities.filter((a) => a.status === 'active').map((a) => ({ id: a.id, label: a.name })),
              ...activities
                .filter((a) => a.status === 'archived')
                .map((a) => ({ id: a.id, label: `${a.name} (archived)` })),
            ]}
            selectedId={activityId ?? ''}
            onSelect={(id) => setActivityId(id || null)}
            placeholder="All activities"
            title="Filter by activity"
          />
        </View>
      </View>

      <Segmented
        value={includeUnapproved ? 'all' : 'approved'}
        options={[
          { value: 'approved', label: 'Approved hours' },
          { value: 'all', label: 'Include unapproved' },
        ]}
        onChange={(v) => setIncludeUnapproved(v === 'all')}
      />
      {includeUnapproved ? (
        <Notice tone="info">Not official: this includes hours from timesheets nobody has approved yet.</Notice>
      ) : null}

      <StatTile
        value={totals ? formatDuration(totals.totalMinutes) : '…'}
        caption={`${includeUnapproved ? 'All hours' : 'Approved hours'}, ${periodWords}, ${who}, ${what}`}
      />

      {totals && totals.byActivity.length > 0 ? (
        <>
          <SectionTitle>By activity</SectionTitle>
          <RowList>
            {totals.byActivity.map((a) => (
              <Row key={a.activityId} label={a.activityName} value={formatDuration(a.minutes)} />
            ))}
          </RowList>
        </>
      ) : null}

      {totals && !personUid && totals.byPerson.length > 0 ? (
        <>
          <SectionTitle>By person</SectionTitle>
          <Text style={styles.hint}>Open someone for their lifetime hours and a statement to print.</Text>
          <RowList>
            {totals.byPerson.map((p) => (
              <Row
                key={p.uid}
                label={p.displayName}
                value={formatDuration(p.minutes)}
                accessibilityLabel={`${p.displayName}, ${formatDuration(p.minutes)}. Open their lifetime hours.`}
                onPress={() => nav.navigate('PersonDetail', { uid: p.uid, displayName: p.displayName })}
              />
            ))}
          </RowList>
        </>
      ) : null}
      {totals && totals.byActivity.length === 0 ? <Empty>No hours in this period.</Empty> : null}

      <Button label="Export CSV" kind="secondary" onPress={download} />
      {status ? <Text style={styles.hint}>{status}</Text> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const PERIODS: { value: Window; label: string; words: string }[] = [
  { value: 'week', label: 'Last 7 days', words: 'the last 7 days' },
  { value: 'month', label: 'This month', words: 'this month' },
  { value: 'year', label: 'This year', words: 'this year' },
  { value: 'all', label: 'All time', words: 'all time' },
];

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
  filter: { flexGrow: 1, flexBasis: 220, gap: spacing(1) },
  label: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  hint: { fontSize: 14, color: t.text.secondary },
});
