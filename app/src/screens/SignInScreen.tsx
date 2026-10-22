import { useRef, useState } from 'react';
import { Image, Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { PRIVACY_URL } from '@sabeel/shared';
import { signInWithGoogle, REAL_GOOGLE_AVAILABLE } from '../auth/google';
import { devSignInAsGoogle } from '../auth/devSignIn';
import { signInWithEmail } from '../auth/email';
import { signInMessage } from '../auth/signInMessage';
import { USE_EMULATORS } from '../env';
import { Button, ErrorText, TextButton, TextLink } from '../components/ui';
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
  // Email and password: a plain alternative to Google, closed until asked for.
  // There is no sign-up and no password reset behind it (see auth/email.ts).
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // The keyboard's Next takes the email field to the password field, and its
  // Go signs in, so nobody has to reach the button under the keyboard.
  const passwordField = useRef<TextInput>(null);

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

  const emailSignIn = async () => {
    // Down first: on a phone the error lands under the button, which the
    // keyboard would otherwise still be covering.
    Keyboard.dismiss();
    setError(null);
    try {
      await signInWithEmail(email, password);
    } catch (e) {
      fail(e, 'signInWithEmail');
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

  // Keyboard-aware, because the card sits mid-screen and a phone's keyboard
  // would otherwise rise over the password field and the button under it.
  return (
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      bottomOffset={spacing(6)}
    >
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
        {emailOpen ? (
          <>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              textContentType="username"
              inputMode="email"
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={t.text.muted}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordField.current?.focus()}
            />
            <TextInput
              ref={passwordField}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={t.text.muted}
              returnKeyType="go"
              onSubmitEditing={() => void emailSignIn()}
            />
            <Button
              label="Sign in"
              kind="secondary"
              onPress={emailSignIn}
              disabled={!email.trim() || !password}
              block
            />
          </>
        ) : (
          <TextButton label="Sign in with email" onPress={() => setEmailOpen(true)} align="center" />
        )}
        {USE_EMULATORS && (
          <>
            <Text style={styles.devLabel} testID="dev-sign-in">
              Dev sign-in (emulator only)
            </Text>
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
          `sabeel-ci build-info`. */}
      <Text style={styles.build}>
        v{BUILD_INFO.version} · {BUILD_INFO.commit}
      </Text>
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg.canvas },
  container: {
    flexGrow: 1,
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
    color: t.text.primary,
  },
});
