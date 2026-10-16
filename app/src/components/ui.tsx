import { Children, type ReactNode, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListenerError } from '../liveQuery';
import { getTheme, spacing } from '../theme';
import {
  CONTENT_MAX_WIDTH,
  GRID_CARD_MIN_WIDTH,
  LIST_MAX_WIDTH,
  READ_MAX_WIDTH,
  useLayout,
} from '../theme/layout';

const t = getTheme();

export function Screen({
  children,
  title,
  width = 'content',
}: {
  children: ReactNode;
  title?: string;
  /**
   * How wide the content may grow on a WIDE screen (ignored on a phone, where
   * the column IS the screen). Capping-and-centring stops the phone-first layout
   * from looking like a phone screen stretched sideways on a desktop:
   *  - `read`    a narrow reading column — text, forms, detail, one-person views.
   *  - `content` the default mid column — simple pages / the dashboard.
   *  - `list`    a wide column for card GRIDS that should fill a laptop.
   *  - `full`    no cap.
   */
  width?: 'read' | 'content' | 'list' | 'full';
}) {
  // Live-data failures surface on every screen — a silently broken listener
  // must never look like "there's just no data" (see the 2026-07-16 postmortem).
  const listenerError = useListenerError();
  const { isWide } = useLayout();
  // The title clears the status bar by the same margin everywhere: 48 was
  // enough under an Android status bar and put the title into the iPhone's
  // 62pt Dynamic Island inset. The bottom keeps the last button above the
  // home indicator (and Android's navigation bar) when scrolled to the end.
  const insets = useSafeAreaInsets();

  // Cap + centre on wide only; on a phone the column is the whole screen, so a
  // maxWidth there would just add dead margin. `capStyle` is the centring cap;
  // the body column also carries the inter-item gap so it survives whether or
  // not a cap is applied.
  const maxWidth =
    !isWide || width === 'full'
      ? undefined
      : width === 'read'
        ? READ_MAX_WIDTH
        : width === 'list'
          ? LIST_MAX_WIDTH
          : CONTENT_MAX_WIDTH;
  const capStyle = maxWidth ? { maxWidth, alignSelf: 'center' as const } : null;

  // KeyboardAwareScrollView (react-native-keyboard-controller) tracks the IME
  // via WindowInsets, which is the ONLY thing that works under edge-to-edge
  // (edgeToEdgeEnabled=true) — the legacy Keyboard events don't fire there, so a
  // bottom input like the reject reason stayed hidden behind the keyboard.
  // bottomOffset keeps the focused field clear of the keyboard.
  return (
    <View style={styles.screen}>
      {title ? (
        <View style={[styles.header, { paddingTop: Math.max(spacing(12), insets.top + spacing(4)) }]}>
          {/* On wide the title aligns with the centred content column, not the
              window edge. */}
          <View style={capStyle}>
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
        </View>
      ) : null}
      {listenerError ? <Text style={styles.listenerError}>{listenerError}</Text> : null}
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.body, { paddingBottom: spacing(5) + insets.bottom }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing(6)}
      >
        <View style={[styles.bodyColumn, capStyle]}>{children}</View>
      </KeyboardAwareScrollView>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  block,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  /**
   * Force full-width in the container even on a wide screen. For buttons inside
   * a narrow, centred box (the sign-in / gate cards) where hugging the label
   * would strand the button off to one side — there the button should fill the
   * card like the fields around it, exactly as it does on a phone.
   */
  block?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { isWide } = useLayout();
  const handle = async () => {
    setBusy(true);
    try {
      await onPress();
    } finally {
      setBusy(false);
    }
  };
  const off = disabled || busy;
  return (
    <Pressable
      onPress={handle}
      disabled={off}
      style={({ pressed }) => [
        styles.btn,
        // Full-width is a good primary-action shape on a phone; on a wide screen
        // a standalone button becomes a bar, so size it to its label and sit
        // left. A button inside a Row is already content-width (a row doesn't
        // stretch its children), so this only de-stretches the column-child case.
        // `block` opts back into full-width for buttons in a narrow centred card.
        { alignSelf: block || !isWide ? 'stretch' : 'flex-start' },
        kind === 'primary' && styles.btnPrimary,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'danger' && styles.btnDanger,
        (pressed || off) && styles.btnDim,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'secondary' ? t.accent.base : t.text.inverse} />
      ) : (
        <Text style={[styles.btnLabel, kind === 'secondary' && styles.btnLabelSecondary]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A low-emphasis link out of the app (the privacy policy). Underlined accent
 * text with a 44pt touch target, the shape of PushNudge's "Not now". On the web
 * Linking opens a new tab; on a phone, the browser.
 */
export function TextLink({ label, url, align = 'left' }: { label: string; url: string; align?: 'left' | 'center' }) {
  return (
    <Pressable
      onPress={() => void Linking.openURL(url).catch(() => undefined)}
      accessibilityRole="link"
      style={[styles.textLink, align === 'center' && styles.textLinkCentre]}
    >
      <Text style={styles.textLinkText}>{label}</Text>
    </Pressable>
  );
}

/** The same low-emphasis shape as TextLink, for an action inside the app. */
export function TextButton({ label, onPress, align = 'left' }: { label: string; onPress: () => void; align?: 'left' | 'center' }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.textLink, align === 'center' && styles.textLinkCentre]}
    >
      <Text style={styles.textLinkText}>{label}</Text>
    </Pressable>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <Text style={styles.error}>{error}</Text>;
}

/**
 * A responsive grid for card-like list items (users, approvals, rejected sheets).
 * On a wide screen the cards flow into as many columns as fit; on a phone they
 * collapse to one full-width column. Each child is wrapped so callers pass their
 * cards straight in.
 */
export function CardGrid({ children }: { children: ReactNode }) {
  const { isWide } = useLayout();
  return (
    <View style={styles.grid}>
      {Children.map(children, (child) =>
        child == null || child === false ? null : (
          <View style={isWide ? styles.gridItemWide : styles.gridItemNarrow}>{child}</View>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg.canvas },
  header: {
    // Ivory chrome: the title sits on the canvas, not on a raspberry bar
    // (brand chrome-vs-content rule).
    backgroundColor: t.bg.canvas,
    paddingBottom: spacing(4),
    paddingHorizontal: spacing(5),
  },
  headerTitle: { color: t.text.primary, fontSize: 22, fontWeight: '700' },
  body: { padding: spacing(5) },
  // The content column: carries the inter-item gap (moved off `body` so it
  // survives the cap wrapper) and grows to fill within the cap.
  bodyColumn: { width: '100%', gap: spacing(3) },
  // Responsive card grid (see CardGrid). Cards grow to fill the row but stay
  // near the target width so a lone last card doesn't stretch the whole row.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(3) },
  gridItemWide: { flexGrow: 1, flexBasis: GRID_CARD_MIN_WIDTH, maxWidth: 420 },
  gridItemNarrow: { width: '100%' },
  btn: {
    borderRadius: 10,
    paddingVertical: spacing(3.5),
    paddingHorizontal: spacing(5),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  btnPrimary: { backgroundColor: t.accent.base },
  btnSecondary: {
    backgroundColor: t.bg.sage,
    borderWidth: 1,
    borderColor: t.accent.sage,
  },
  btnDanger: { backgroundColor: t.feedback.danger },
  textLink: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
  textLinkCentre: { alignSelf: 'center' },
  textLinkText: { fontSize: 14, color: t.text.accent, textDecorationLine: 'underline' },
  btnDim: { opacity: 0.6 },
  btnLabel: { color: t.text.inverse, fontSize: 16, fontWeight: '600' },
  btnLabelSecondary: { color: t.accent.base },
  error: { color: t.feedback.danger, fontSize: 14 },
  listenerError: {
    backgroundColor: t.feedback.danger,
    color: t.text.inverse,
    fontSize: 13,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(5),
  },
});
