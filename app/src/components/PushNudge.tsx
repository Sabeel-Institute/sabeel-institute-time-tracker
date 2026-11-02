import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { usePushNudge } from '../pushNudge';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * The sign-in nudge. Renders nothing unless this device can still be asked and
 * the person has not already waved it away — see pushNudge.ts.
 *
 * "Not now" is deliberately a low-emphasis link rather than a second button:
 * this sits at the top of Home, and two equal-weight buttons both out-shouted
 * the screen's own actions and doubled the height the card steals from them.
 */
export function PushNudge({ uid }: { uid: string }) {
  const { visible, busy, failed, enable, dismiss } = usePushNudge(uid);
  if (!visible) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.text}>
        {failed
          ? 'This device can’t show notifications.'
          : 'Notifications are not enabled on this device.'}
      </Text>
      {/* No Enable button once it has failed — pressing again would do the same
          nothing. Dismissing is the only useful action left. */}
      {failed ? null : (
        // Secondary: the clock is this screen's main action, not the nudge.
        <Button label="Enable notifications" kind="secondary" disabled={busy} onPress={enable} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Not now"
        onPress={dismiss}
        style={styles.dismiss}
      >
        <Text style={styles.dismissText}>Not now</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing(2),
    backgroundColor: t.bg.surface,
    borderWidth: 1,
    borderColor: t.border.subtle,
    borderRadius: 12,
    padding: spacing(4),
  },
  text: { fontSize: 15, color: t.text.primary },
  /**
   * Left, hugging its text — NOT centred across the card. On a wide screen the
   * button above sizes to its label and sits left, so a centred dismiss floated
   * off on its own with nothing to belong to. Still a real 44pt box rather than
   * hitSlop, because neighbouring slops overlap.
   */
  dismiss: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  /**
   * Accent + underline, the link treatment. Secondary grey read as a caption
   * sitting under the button rather than as something to tap; muted (2.92:1)
   * was worse still, being the caption token AND below AA.
   */
  dismissText: { fontSize: 14, color: t.text.accent, textDecorationLine: 'underline' },
});
