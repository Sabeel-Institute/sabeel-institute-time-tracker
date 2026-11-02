import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { dayKeyFor, dayLabel, deviceTimeZone, formatDuration, periodLabel } from '@sabeel/shared';
import type { RootStackParamList } from '../nav';
import { useRejectedSheets } from '../timesheets';
import { useApproverChoices } from '../users';
import { Empty, Row, RowList, Screen } from '../components/ui';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * Every rejected week, any month, in one list with the reason, oldest first.
 * Tapping one opens that week on the Timesheet tab (reason, editable entries,
 * Resubmit), so fixing it uses the flow people already know.
 */
export function NeedsAttentionScreen({ uid }: { uid: string }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const sheets = useRejectedSheets(uid);
  // Rejections come from managers/admins, whose profiles every active user may
  // read — so names resolve without the manager-only users listing.
  const approvers = useApproverChoices();
  const nameOf = useMemo(() => new Map(approvers.map((a) => [a.uid, a.displayName])), [approvers]);
  const tz = deviceTimeZone();

  return (
    <Screen width="read">
      {sheets.length === 0 ? (
        <Empty>Nothing needs your attention.</Empty>
      ) : (
        <>
          <Text style={styles.intro}>
            {sheets.length === 1
              ? 'This timesheet was rejected. Open it to fix it and resubmit.'
              : 'These timesheets were rejected. Open each one to fix it and resubmit.'}
          </Text>
          <RowList>
            {sheets.map((ts) => (
              <Row
                key={ts.id}
                label={periodLabel({ fromKey: ts.periodKey, toKey: ts.toKey })}
                detail={
                  <>
                    {ts.rejectReason ? (
                      <Text style={styles.reason} numberOfLines={3}>
                        “{ts.rejectReason}”
                      </Text>
                    ) : null}
                    <Text style={styles.meta}>
                      Rejected{ts.decidedBy ? ` by ${nameOf.get(ts.decidedBy) ?? 'a manager'}` : ''}
                      {ts.decidedAt ? ` · ${dayLabel(dayKeyFor(ts.decidedAt, tz))}` : ''}
                    </Text>
                  </>
                }
                value={formatDuration(ts.totalMinutes)}
                accessibilityLabel={`Fix the timesheet for ${periodLabel({ fromKey: ts.periodKey, toKey: ts.toKey })}`}
                onPress={() =>
                  nav.reset({ index: 0, routes: [{ name: 'Timesheet', params: { initialPeriodKey: ts.periodKey } }] })
                }
              />
            ))}
          </RowList>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, color: t.text.secondary },
  reason: { fontSize: 14, color: t.text.primary },
  meta: { fontSize: 13, color: t.text.secondary },
});
