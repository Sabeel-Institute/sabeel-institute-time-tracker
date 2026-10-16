import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { APP_NAME } from '@sabeel/shared';
import { acceptRules } from '../institutionRules';
import { signOut } from '../session';
import { Button, ErrorText, Screen } from '../components/ui';
import { getTheme } from '../theme';

const t = getTheme();

/**
 * The institute's rules, accepted once per account (the `sabeel-app-stores`
 * skill, decision 4; docs/STORE-RELEASE.md). App.tsx shows this to an active
 * account that has not accepted the current RULES_VERSION, before the
 * navigator exists, so no screen where anything can be posted is reachable
 * from here, and a notification tapped meanwhile waits (notifRouting.ts).
 *
 * The words are the institute's, shared by every Sabeel app; only the app's
 * name, who it is for, who sees what is posted and where Report a problem is
 * are this app's. No minimum age is stated, deliberately: a stated age above
 * Apple's calculated rating would force the rating up.
 */
export function RulesScreen() {
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    setError(null);
    try {
      await acceptRules();
    } catch {
      setError('Your agreement could not be saved. Check your connection and try again.');
    }
  };

  return (
    <Screen title="Before you continue" width="read">
      <Text style={styles.body}>
        {APP_NAME} is for Sabeel Institute’s staff and volunteers, and what you post is seen
        only by members of your team.
      </Text>
      <Text style={styles.body}>
        By continuing you agree to the institute’s rules: post only what belongs to your work,
        post nothing abusive, harassing, hateful, sexual or otherwise objectionable, and never
        abuse another member. The institute tolerates neither. Administrators may remove content
        and suspend accounts that break these rules.
      </Text>
      <Text style={styles.body}>
        To report something or someone, use <Text style={styles.strong}>Report a problem</Text>{' '}
        on Home; administrators respond within 24 hours.
      </Text>
      <Button label="I agree" onPress={agree} />
      <ErrorText error={error} />
      <Button label="Sign out" kind="secondary" onPress={() => signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: t.text.primary },
  strong: { fontWeight: '700' },
});
