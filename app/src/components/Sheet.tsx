import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, IconButton } from './ui';
import { SheetKeyboard } from './SheetKeyboard';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * A centred, size-bounded dialog. Ported from the sibling LMS app (which took it
 * from Kanban), whose comments carry the reasoning. The two rules worth restating
 * here: it bounds its own height and scrolls INSIDE that bound, so it can never
 * run off a short viewport; and the backdrop is a pointer affordance with NO
 * accessibility role — react-native-web turns a role="button" into a real
 * <button> element, and nesting the panel's controls inside one makes a space
 * keypress dismiss the sheet.
 */
export function Sheet({
  visible,
  title,
  onClose,
  closeLabel = 'Close',
  closeAt = 'foot',
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  /**
   * Where the way out is. A MENU closes from a × beside its title, as menus do;
   * a sheet whose way out is one of its answers — Cancel under a form — keeps it
   * at the foot, full width.
   */
  closeAt?: 'foot' | 'corner';
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SheetKeyboard style={styles.shade}>
        {/* Neither Pressable is an accessibility element: on iOS one swallows
            everything under it, so VoiceOver (and Maestro) saw the whole sheet as
            one element. react-native-web does not forward the prop. */}
        <Pressable style={styles.backdrop} onPress={onClose} focusable={false} accessible={false}>
          {/* Absorbs taps so a press inside does not dismiss via the backdrop.
              The testID is what the layout sweep scopes to: RNW portals a Modal
              out of the app root, so a whole-document query measures the screen
              behind the sheet. */}
          <Pressable testID="sheet-panel" style={styles.panel} onPress={() => {}} accessible={false}>
            {closeAt === 'corner' ? (
              <View style={styles.titleRow}>
                <Text style={[styles.title, styles.titleInRow]} role="heading">
                  {title}
                </Text>
                <IconButton icon="close" label={closeLabel} bare onPress={onClose} />
              </View>
            ) : (
              <Text style={styles.title} role="heading">
                {title}
              </Text>
            )}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {closeAt === 'foot' ? (
              <Button label={closeLabel} kind="quiet" onPress={onClose} block />
            ) : null}
          </Pressable>
        </Pressable>
      </SheetKeyboard>
    </Modal>
  );
}

/** One row inside a Sheet: a destination in a menu. */
export function SheetOption({
  label,
  detail,
  badge,
  testID,
  onPress,
}: {
  label: string;
  detail?: string;
  /** A count beside the label — accounts waiting for approval. */
  badge?: number;
  testID?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} waiting` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed ? styles.optionPressed : null]}
    >
      <View style={styles.optionLine}>
        <Text style={styles.optionLabel}>{label}</Text>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      {detail ? <Text style={styles.optionDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

/** A quiet divider label grouping rows inside a Sheet. */
export function SheetSection({ label }: { label: string }) {
  return <Text style={styles.section}>{label.toUpperCase()}</Text>;
}

const styles = StyleSheet.create({
  // The shade, under the backdrop: the room the keyboard takes is shaded too.
  shade: { flex: 1, backgroundColor: t.effect.overlay },
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(4),
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    backgroundColor: t.bg.raised,
    borderColor: t.border.strong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: spacing(4),
    gap: spacing(2),
  },
  title: { fontSize: 18, fontWeight: '700', color: t.text.primary },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing(2) },
  titleInRow: { flexShrink: 1 },
  body: { flexGrow: 0 },
  bodyContent: { gap: spacing(1) },
  option: {
    borderRadius: 8,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(3),
    minHeight: 44,
    justifyContent: 'center',
  },
  optionPressed: { backgroundColor: t.bg.inset },
  optionLine: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  optionLabel: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  optionDetail: { fontSize: 13, color: t.text.secondary, marginTop: 2 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent.base,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: t.accent.onAccent },
  section: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: t.text.secondary,
    marginTop: spacing(3),
    marginBottom: spacing(1),
    paddingHorizontal: spacing(3),
  },
});
