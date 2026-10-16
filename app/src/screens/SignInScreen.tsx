import { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { PRIVACY_URL } from '@sabeel/shared';
import { signInWithGoogle, REAL_GOOGLE_AVAILABLE } from '../auth/google';
import { devSignInAsGoogle } from '../auth/devSignIn';
import { signInMessage } from '../auth/signInMessage';
import { USE_EMULATORS } from '../env';
import { Button, ErrorText, TextLink } from '../components/ui';
import { captureError } from '../sentry';
import { getTheme, spacing } from '../theme';
import { BUILD_INFO } from '../build-info';

const t = getTheme();

// Static asset import (Metro resolves images; lint forbids inline require()).
// The black-and-gold original on the ivory canvas — no plate, no tint (a flat
// tintColor throws the gold away). Sign-in is an ivory screen per the brand's
// chrome-vs-content rule; the reverse ivory+gold mark is not used here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../assets/logo.png');

export function SignInScreen() {
  const [error, setError] = useState<string | null>(null);
  // Dev sign-in must use an org-domain address — the same domain gate that
  // production enforces (auth trigger + rules) applies against the emulator too.
  const [devEmail, setDevEmail] = useState('volunteer@oursabeel.com');

  // Cancellations never get here — both auth seams swallow them. What does is
  // either an answer (the phone app's refusal of an identity with no account)
  // or a real failure; signInMessage says which, and what to show.
  const fail = (e: unknown, source: string) => {
    const { text, report } = signInMessage(e);
    if (report) captureError(e, { source });
    setError(text);
  };

  const google = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      fail(e, 'signInWithGoogle');
    }
  };

  const dev = async () => {
    setError(null);
    try {
      const name = devEmail
        .split('@')[0]
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      await devSignInAsGoogle(devEmail.trim(), name);
    } catch (e) {
      setError(signInMessage(e).text);
    }
  };

  return (
    <View style={styles.container}>
      <Image
        source={logo}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="Sabeel Institute"
      />
      <View style={styles.card}>
        <Text style={styles.title}>Time Tracker</Text>
        {(REAL_GOOGLE_AVAILABLE || !USE_EMULATORS) && (
          <Button label="Sign in with Google" onPress={google} block />
        )}
        {USE_EMULATORS && (
          <>
            <Text style={styles.devLabel}>Dev (emulator) sign-in</Text>
            <TextInput
              value={devEmail}
              onChangeText={setDevEmail}
              autoCapitalize="none"
              inputMode="email"
              style={styles.input}
              placeholder="email"
            />
            <Button label="Dev: sign in" kind="secondary" onPress={dev} block />
          </>
        )}
        <ErrorText error={error} />
      </View>
      {/* Reachable before signing in, because an App Store reviewer reads it
          from here (guideline 5.1.1(i)); it is also linked from Home. */}
      <TextLink label="Privacy policy" url={PRIVACY_URL} align="center" />
      {/* Which build is running — so "what version are you on?" is answerable
          from the screen everyone sees. Stamped at build time by
          scripts/gen-build-info.mjs. */}
      <Text style={styles.build}>
        v{BUILD_INFO.version} · {BUILD_INFO.commit}
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
    padding: spacing(6),
    gap: spacing(2),
  },
  title: {
    color: t.accent.base,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing(2),
  },
  card: {
    backgroundColor: t.bg.surface,
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 14,
    padding: spacing(5),
    gap: spacing(3),
    width: '100%',
    maxWidth: 380,
  },
  logo: { width: '82%', height: 150, marginBottom: spacing(2) },
  build: { color: t.text.muted, fontSize: 12, textAlign: 'center' },
  devLabel: { color: t.text.muted, fontSize: 12, marginTop: spacing(2) },
  input: {
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 8,
    padding: spacing(3),
    fontSize: 15,
  },
});
