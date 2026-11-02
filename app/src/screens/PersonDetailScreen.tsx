import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { dayKeyFor, deviceTimeZone, formatDuration, periodKeyFor } from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { fetchTotals, type Totals } from '../reporting';
import { printStatement, CAN_PRINT } from '../printStatement';
import { Button, Empty, ErrorText, Row, RowList, Screen, SectionTitle, StatTile } from '../components/ui';
import { getTheme } from '../theme';

const t = getTheme();

const LIFETIME = { fromKey: '2000-01-01', toKey: '2999-12-31' };

export function PersonDetailScreen({ uid, displayName }: { uid: string; displayName: string }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchTotals({ ...LIFETIME, uid })
      .then((t) => live && setTotals(t))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [uid]);

  const print = () => {
    if (!totals) return;
    setStatus(
      printStatement({
        displayName,
        totalLabel: formatDuration(totals.totalMinutes),
        generatedOn: new Date().toLocaleDateString(),
        rows: totals.byActivity.map((a) => ({
          activityName: a.activityName,
          hours: (a.minutes / 60).toFixed(2),
        })),
      }),
    );
  };

  return (
    <Screen title={displayName} width="read">
      <StatTile value={totals ? formatDuration(totals.totalMinutes) : '…'} caption="Lifetime approved hours" />

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
      {totals && totals.byActivity.length === 0 ? <Empty>No approved hours yet.</Empty> : null}

      <Button
        label="View timesheets"
        kind="secondary"
        onPress={() =>
          nav.navigate('TimesheetReview', {
            uid,
            displayName,
            periodKey: periodKeyFor(dayKeyFor(Date.now(), deviceTimeZone())),
          })
        }
      />
      <Button
        label={CAN_PRINT ? 'Print statement' : 'Printing is on the website'}
        kind="quiet"
        onPress={print}
        disabled={!totals}
      />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <ErrorText error={error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  status: { color: t.text.secondary, fontSize: 14 },
});
