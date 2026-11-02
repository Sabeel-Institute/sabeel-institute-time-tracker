import { Linking, StyleSheet, Text, View } from 'react-native';
import { APP_NAME, PRIVACY_URL } from '@sabeel/shared';
import { Sheet, SheetOption, SheetSection } from './Sheet';
import { signOut } from '../session';
import { BUILD_INFO } from '../build-info';
import { getTheme, spacing } from '../theme';
import type { RootStackParamList } from '../nav';

const t = getTheme();

/**
 * Everything behind "More": what you need occasionally rather than every week.
 *
 * RENDERED BY THE SHELL, not by the bar: an overlay is not part of the control
 * that opens it, and the bar sits after the content in reading order on a phone
 * while the rail sits before it on a wide screen. Held inside the bar, crossing
 * the breakpoint would unmount the sheet and close it.
 *
 * `onNavigate` closes the sheet itself. The rows that leave the app — the
 * privacy policy, signing out — close it first, because those go nowhere the
 * shell knows about.
 */
export function MoreSheet({
  visible,
  approver,
  admin,
  pendingAccounts,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  approver: boolean;
  admin: boolean;
  /** Accounts waiting for approval, counted for an admin only (0 otherwise). */
  pendingAccounts: number;
  onClose: () => void;
  /** Always a push: a More destination is somewhere you come back from. */
  onNavigate: (route: keyof RootStackParamList) => void;
}) {
  return (
    <Sheet visible={visible} title="More" onClose={onClose} closeAt="corner">
      {approver ? (
        <>
          <SheetSection label="Institute" />
          <SheetOption
            label="People"
            detail={admin ? 'Approve new accounts, set roles and approvers' : 'Everyone here, and who approves their hours'}
            badge={pendingAccounts}
            testID="more-people"
            onPress={() => onNavigate('Users')}
          />
          <SheetOption
            label="Activities"
            detail="What people can log their hours against"
            testID="more-activities"
            onPress={() => onNavigate('Activities')}
          />
          {/* A label only when there is another section to tell it from. */}
          <SheetSection label="You" />
        </>
      ) : null}
      <SheetOption
        label="Notifications"
        detail="Choose which messages this device gets"
        testID="more-notifications"
        onPress={() => onNavigate('NotificationSettings')}
      />
      <SheetOption
        label="Help"
        detail="Short films of how to use the app"
        testID="more-help"
        onPress={() => onNavigate('Help')}
      />
      {/* Where the institute's rules say it is: the one way to tell the
          administrators about something or someone in the app. */}
      <SheetOption
        label="Report a problem"
        detail="Tell the administrators about something or someone"
        testID="more-report"
        onPress={() => onNavigate('ReportProblem')}
      />
      {/* Required to be reachable inside the app, not just in store metadata —
          Apple 5.1.1(i). */}
      <SheetOption
        label="Privacy policy"
        testID="more-privacy"
        onPress={() => {
          onClose();
          void Linking.openURL(PRIVACY_URL).catch(() => undefined);
        }}
      />
      <SheetOption
        label="Sign out"
        testID="more-sign-out"
        onPress={() => {
          onClose();
          void signOut();
        }}
      />
      {/* The running build, so "is that fixed for you?" is answerable once
          signed in, not only on the sign-in screen. */}
      <View style={styles.build}>
        <Text style={styles.buildText}>
          {APP_NAME} · v{BUILD_INFO.version} · {BUILD_INFO.commit}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  build: { alignItems: 'center', paddingTop: spacing(3) },
  buildText: { fontSize: 11, color: t.text.muted },
});
