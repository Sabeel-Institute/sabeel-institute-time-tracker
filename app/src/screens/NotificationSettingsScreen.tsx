import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, type NotifPrefs, type TokenClaims, type UserDoc } from '@sabeel/shared';
import { db } from '../firebase';
import { Button, Card, RowList, Screen, SectionTitle, SwitchRow } from '../components/ui';
import {
  canOpenPushSettings,
  enablePush,
  openPushSettings,
  pushPromptState,
  registerPush,
} from '../notify';
import { getTheme } from '../theme';

const t = getTheme();

type PrefKey = keyof NotifPrefs;

const ROWS: { key: PrefKey; label: string; hint?: string; who?: 'approver' | 'admin' }[] = [
  { key: 'rejected', label: 'My timesheet is rejected' },
  { key: 'approved', label: 'My timesheet is approved' },
  { key: 'submitted', label: 'A timesheet is submitted to me', who: 'approver' },
  { key: 'newUser', label: 'New account requests', who: 'admin' },
  {
    key: 'reminder',
    label: 'Weekly submit reminder',
    hint: 'Starts Tuesday when last week has unsubmitted hours, then repeats daily until you submit. Turn this off if you don’t submit every week.',
  },
];

export function NotificationSettingsScreen({
  uid,
  profile,
  claims,
}: {
  uid: string;
  profile: UserDoc;
  claims: TokenClaims;
}) {
  const prefs = profile.notifPrefs ?? {};
  const isApprover = claims.role === 'manager' || claims.admin === true;
  // What this device can be offered. Resolved on mount — never in the press
  // handler below, which may not await before asking.
  const [push, setPush] = useState<
    'checking' | 'granted' | 'denied' | 'default' | 'unsupported'
  >('checking');

  useEffect(() => {
    let live = true;
    void (async () => {
      const state = await pushPromptState();
      if (!live) return;
      if (state !== 'granted') return setPush(state);
      // Permission alone is not enough to promise delivery. Claim the token and
      // report what actually happened, or the screen says "enabled" over a
      // device with nothing registered behind it.
      const ok = await registerPush(uid);
      if (live) setPush(ok ? 'granted' : 'unsupported');
    })();
    return () => {
      live = false;
    };
  }, [uid]);

  // enablePush must be the FIRST thing this handler does — a browser only
  // honours a permission request raised directly from a press, and an await
  // before it loses that. Button calls onPress synchronously and awaits the
  // promise it returns, which keeps the chain intact. See notify.web.ts.
  const turnOnPush = () =>
    // .catch as well: Button resets its own busy state in a finally, but an
    // unhandled rejection here would still surface as a console error for a
    // path that is meant to be total.
    enablePush(uid)
      .catch(() => 'unavailable' as const)
      .then(async (result) => {
        if (result === 'granted') return setPush('granted');
        if (result === 'unavailable') return setPush('unsupported');
        // Re-read rather than assuming 'denied': a browser makes a refusal
        // stick, but a dismissed Android dialog leaves this askable, and the
        // button should come back rather than send someone to a settings screen
        // that shows nothing wrong.
        setPush(await pushPromptState());
      });

  const setPref = (key: PrefKey, on: boolean) =>
    updateDoc(doc(db, COLLECTIONS.users, uid), { notifPrefs: { ...prefs, [key]: on } });

  const rows = ROWS.filter(
    (r) =>
      r.who === undefined ||
      (r.who === 'approver' && isApprover) ||
      (r.who === 'admin' && claims.admin === true),
  );

  return (
    <Screen
      width="read"
      subtitle="Notifications arrive on every device where you have allowed them. A switch here turns that kind off everywhere."
    >
      <SectionTitle>This device</SectionTitle>
      <Card>
        {push === 'default' ? (
          <>
            <Text style={styles.deviceText}>Notifications are not enabled on this device.</Text>
            <Button label="Enable notifications" onPress={turnOnPush} />
          </>
        ) : null}
        {push === 'granted' ? <Text style={styles.deviceText}>Notifications are enabled on this device.</Text> : null}
        {push === 'denied' ? (
          <>
            <Text style={styles.deviceText}>Notifications are blocked for this app on this device.</Text>
            {/* Native can open its own settings page; a browser cannot, so there
                it is instructions or nothing — readable ones, since this is the
                only route back for someone who has blocked them. */}
            {canOpenPushSettings ? (
              <Button label="Open settings" kind="secondary" onPress={openPushSettings} />
            ) : (
              <Text style={styles.deviceHint}>
                Allow them in your browser’s site settings, then reopen this screen.
              </Text>
            )}
          </>
        ) : null}
        {push === 'unsupported' ? <Text style={styles.deviceText}>This device can’t show notifications.</Text> : null}
        {push === 'checking' ? <Text style={styles.deviceHint}>Checking this device…</Text> : null}
      </Card>

      <SectionTitle>Tell me when</SectionTitle>
      <RowList>
        {rows.map((r) => (
          <SwitchRow
            key={r.key}
            label={r.label}
            description={r.hint}
            on={prefs[r.key] !== false}
            onChange={(on) => void setPref(r.key, on)}
          />
        ))}
      </RowList>
    </Screen>
  );
}

const styles = StyleSheet.create({
  deviceText: { fontSize: 15, color: t.text.primary },
  deviceHint: { fontSize: 14, color: t.text.secondary },
});
