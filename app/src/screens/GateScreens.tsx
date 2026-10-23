import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { APP_ID, APP_NAME } from '@sabeel/shared';
import { BUILD_INFO } from '../build-info';
import { retryProvisioning, signOut } from '../session';
import { NOT_INSTITUTE_ACCOUNT_MESSAGE } from '../auth/signInMessage';
import { Button } from '../components/ui';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/** Brief, self-resolving: the onUserCreate trigger is creating the profile. */
export function ProvisioningScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={t.accent.base} />
      <Text style={styles.message}>Setting up your account…</Text>
    </View>
  );
}

/**
 * The account still exists, and its profile has not arrived in the whole
 * wait: a slow set-up or a stalled connection, never a refusal. Try again
 * starts the wait over on a fresh connection.
 */
export function StillSettingUpScreen({ email }: { email: string }) {
  return (
    <Gate
      title="One moment"
      message="Still setting up your account. Try again in a minute."
      email={email}
      action={{ label: 'Try again', onPress: retryProvisioning }}
    />
  );
}

/**
 * Terminal: the trigger rejected and deleted this account (not an org
 * address), which Auth confirmed (session.ts, lookUpAccount). Never shown for
 * an account that still exists, however long its set-up takes.
 */
export function NotProvisionedScreen({ email }: { email: string }) {
  return (
    <Gate
      title="Can’t sign in"
      message={NOT_INSTITUTE_ACCOUNT_MESSAGE}
      email={email}
    />
  );
}

function Gate({
  title,
  message,
  email,
  action,
}: {
  title: string;
  message: string;
  email: string;
  /** A primary action above Sign out. */
  action?: { label: string; onPress: () => Promise<void> };
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      <Text style={styles.email}>{email}</Text>
      <View style={styles.actions}>
        {action ? <Button label={action.label} onPress={action.onPress} block /> : null}
        <Button label="Sign out" kind="secondary" onPress={() => signOut()} block />
      </View>
    </View>
  );
}

export function PendingScreen({ email }: { email: string }) {
  return (
    <Gate
      title="Almost there"
      message={
        'Your account is waiting for an administrator to approve it.\n' +
        'This screen updates by itself the moment you are approved.'
      }
      email={email}
    />
  );
}

export function DisabledScreen({ email }: { email: string }) {
  return (
    <Gate
      title="Account disabled"
      message="This account has been disabled. Contact your administrator if you think that's a mistake."
      email={email}
    />
  );
}

/**
 * Where an update comes from: Play for an Android build, TestFlight (which
 * opens on the build list) for an iPhone one. The only two places this app is
 * installed from.
 */
const UPDATE = Platform.OS === 'ios'
  ? { label: 'Open TestFlight', url: 'itms-beta://' }
  : { label: 'Open Google Play', url: `https://play.google.com/store/apps/details?id=${APP_ID}` };

/**
 * A build the institute has retired (`useMinVersion`).
 *
 * Shown before sign-in, in place of the whole app, so nothing behind it runs
 * on rules it no longer matches. Sign out is offered because the person may be
 * signed in already and on a shared phone.
 */
export function UpdateScreen({ signedIn }: { signedIn: boolean }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Update needed</Text>
      <Text style={styles.message}>
        {`This version of ${APP_NAME} is out of date. Install the current one to keep using the app; nothing you have recorded is lost by updating.`}
      </Text>
      <View style={styles.actions}>
        <Button label={UPDATE.label} onPress={() => Linking.openURL(UPDATE.url).catch(() => undefined)} block />
        {signedIn ? (
          <Button label="Sign out" kind="secondary" onPress={() => signOut()} block />
        ) : null}
      </View>
      <Text style={styles.build} testID="update-build-label">
        Installed: v{BUILD_INFO.version} · {BUILD_INFO.commit}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(8),
    gap: spacing(3),
  },
  title: { fontSize: 24, fontWeight: '700', color: t.text.primary },
  // Cap the line length so this centred card stays a card on a desktop, rather
  // than stretching the two lines of copy across the whole window.
  message: {
    fontSize: 15,
    color: t.text.secondary,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 420,
  },
  email: { fontSize: 14, color: t.accent.base, fontWeight: '600' },
  actions: { marginTop: spacing(4), width: '100%', maxWidth: 240, gap: spacing(3) },
  build: { marginTop: spacing(3), fontSize: 12, color: t.text.secondary, textAlign: 'center' },
});
