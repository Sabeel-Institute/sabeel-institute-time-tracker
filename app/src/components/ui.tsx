import { Children, createContext, type ReactNode, useContext, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useListenerError } from '../liveQuery';
import { Icon, type IconName } from '../icons';
import { getTheme, spacing } from '../theme';
import {
  CONTENT_MAX_WIDTH,
  LIST_MAX_WIDTH,
  READ_MAX_WIDTH,
  useLayout,
} from '../theme/layout';

const t = getTheme();

/**
 * WHETHER THIS SCREEN MUST PAY FOR THE STATUS BAR ITSELF.
 *
 * True on the tab roots, which run with no stack header (the shell in App.tsx
 * sets it). A pushed screen's header already clears the status bar and carries
 * Back; a tab root has neither, so its own heading is the top of the screen.
 */
export const ScreenOwnsTopInset = createContext(false);

/**
 * Page wrapper: the heading, the latest live-data error, and the content in a
 * keyboard-aware scroll, capped and centred on a wide screen.
 */
export function Screen({
  children,
  title,
  subtitle,
  actions,
  width = 'content',
  fill = false,
}: {
  children: ReactNode;
  /** The page's name. A pushed screen's header names it already, so leave it out there. */
  title?: string;
  /** A line under the title: who, how much, what state. */
  subtitle?: ReactNode;
  /** Icon actions beside the title — the plus that adds. */
  actions?: ReactNode;
  /**
   * How wide the content may grow on a WIDE screen (ignored on a phone, where
   * the column IS the screen). Capping-and-centring stops the phone-first layout
   * from looking like a phone screen stretched sideways on a desktop:
   *  - `read`    a narrow reading column — text, forms, detail, one-person views.
   *  - `content` the default mid column — simple pages.
   *  - `list`    a wide column for GRIDS that should fill a laptop.
   *  - `full`    no cap.
   */
  width?: 'read' | 'content' | 'list' | 'full';
  /**
   * Held still: no scrolling, and the content fills the screen, so a child with
   * `flex: 1` is exactly the room left under the heading. For a screen that
   * sizes one thing to the window: a help film has to fit, controls and all.
   */
  fill?: boolean;
}) {
  // Live-data failures surface on every screen — a silently broken listener
  // must never look like "there's just no data" (see the 2026-07-16 postmortem).
  const listenerError = useListenerError();
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();
  const ownsTopInset = useContext(ScreenOwnsTopInset);

  // Cap + centre on wide only; on a phone the column is the whole screen, so a
  // maxWidth there would just add dead margin.
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
  // bottomOffset keeps the focused field clear of the keyboard. The bottom inset
  // is the navigation bar's to pay, not the content's.
  const padding = [
    styles.body,
    isWide ? styles.bodyWide : null,
    ownsTopInset ? { paddingTop: insets.top + spacing(isWide ? 8 : 6) } : null,
  ];
  const column = (
    <View style={[styles.bodyColumn, capStyle, fill ? styles.bodyColumnFill : null]}>
      {title || subtitle || actions ? (
        <View style={styles.headRow}>
          <View style={styles.headText}>
            {title ? (
              <Text style={styles.h1} role="heading" aria-level={1}>
                {title}
              </Text>
            ) : null}
            {typeof subtitle === 'string' ? <Text style={styles.lede}>{subtitle}</Text> : (subtitle ?? null)}
          </View>
          {actions ? <View style={styles.headActions}>{actions}</View> : null}
        </View>
      ) : null}
      {listenerError ? (
        <View style={styles.listenerError} role="alert">
          <Text style={styles.listenerErrorText}>{listenerError}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
  if (fill) {
    return (
      <View style={styles.screen}>
        <View style={[padding, styles.bodyFill]}>{column}</View>
      </View>
    );
  }
  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView
        contentContainerStyle={padding}
        keyboardShouldPersistTaps="handled"
        bottomOffset={spacing(6)}
      >
        {column}
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
  /**
   * Weight follows consequence. `primary` (raspberry) is the screen's one main
   * action; `secondary` (sage) an ordinary one; `quiet` (outlined) a way out or
   * an occasional action that should not compete; `danger` deletes something
   * that matters in one press; `remove` is the quiet, outlined form of it for a
   * delete that asks first (an entry, an archived activity); `inverse`
   * is the primary drawn ON a raspberry card (ivory, with raspberry text).
   */
  kind?: 'primary' | 'secondary' | 'quiet' | 'danger' | 'remove' | 'inverse';
  disabled?: boolean;
  /**
   * Force full-width in the container even on a wide screen. For buttons inside
   * a narrow, centred box (the sign-in / gate cards, a sheet) where hugging the
   * label would strand the button off to one side.
   */
  block?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // ONE AT A TIME, decided synchronously. `busy` disables the button a render
  // late, and two taps inside that frame both ran: Save hours saved the same
  // entry twice. The ref turns the second tap away before anything renders.
  const running = useRef(false);
  const { isWide } = useLayout();
  const handle = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await onPress();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const off = disabled || busy;
  return (
    <Pressable
      onPress={handle}
      disabled={off}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        // Full-width is a good primary-action shape on a phone; on a wide screen
        // a standalone button becomes a bar, so size it to its label and sit
        // left. A button inside a Row is already content-width.
        { alignSelf: block || !isWide ? 'stretch' : 'flex-start' },
        kind === 'primary' && styles.btnPrimary,
        kind === 'secondary' && styles.btnSecondary,
        kind === 'quiet' && styles.btnQuiet,
        kind === 'danger' && styles.btnDanger,
        kind === 'remove' && styles.btnQuiet,
        kind === 'inverse' && styles.btnInverse,
        pressed && !off && styles.btnPressed,
        // Neutral rather than a faded brand fill: a washed-out raspberry block
        // still pulls the eye harder than the live control next to it.
        disabled && styles.btnDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={
            kind === 'primary' || kind === 'danger'
              ? t.accent.onAccent
              : kind === 'inverse'
                ? t.accent.base
                : t.text.primary
          }
        />
      ) : (
        // A label may wrap between words, never inside one; two lines at most.
        <Text
          style={[
            styles.btnLabel,
            kind === 'secondary' && styles.btnLabelSecondary,
            kind === 'quiet' && styles.btnLabelQuiet,
            kind === 'inverse' && styles.btnLabelInverse,
            kind === 'remove' && styles.btnLabelRemove,
            disabled && styles.btnLabelDisabled,
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * An icon-only action: the plus that adds, the arrows that step a week.
 *
 * Icon-only means the label is invisible, so `label` is required and becomes the
 * accessibility name. The square is 44pt because that is the minimum touch
 * target, whatever the glyph's size. `bare` drops the tile, for an icon inline
 * with text where a tinted square on every row would outshout the content.
 */
export function IconButton({
  icon,
  label,
  bare,
  disabled,
  onPress,
  testID,
}: {
  icon: IconName;
  /** Required: with no visible text this IS the button's name. */
  label: string;
  bare?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconBtn,
        bare ? null : styles.iconBtnTile,
        pressed && !disabled ? styles.btnPressed : null,
        disabled ? styles.iconBtnDisabled : null,
      ]}
    >
      <Icon name={icon} size={22} color={bare ? t.text.secondary : t.text.primary} />
    </Pressable>
  );
}

/** A surface holding one thing: the clock, a form. Not for lists — see `RowList`. */
export function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={styles.card}>
      {children}
    </View>
  );
}

/** A section's heading, in small capitals, with an optional action at its end. */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle} role="heading" aria-level={2}>
        {children}
      </Text>
      {action ?? null}
    </View>
  );
}

/**
 * ONE SURFACE OF ROWS, divided by hairlines — how a list reads on a phone,
 * rather than a stack of separate bordered cards each with its own margin.
 */
export function RowList({ children, testID }: { children: ReactNode; testID?: string }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View testID={testID} style={styles.rowList}>
      {rows.map((row, i) => (
        <View key={i} style={i > 0 ? styles.rowDivider : null}>
          {row}
        </View>
      ))}
    </View>
  );
}

/**
 * One row of a `RowList`: a name, a line about it, and a value at the end — a
 * duration, a count. With `onPress` the whole row is the target and ends in a
 * chevron; `warn` marks a row that needs fixing.
 */
export function Row({
  label,
  detail,
  value,
  onPress,
  warn,
  actions,
  accessibilityLabel,
  testID,
}: {
  label: string;
  detail?: ReactNode;
  value?: string;
  onPress?: () => void;
  warn?: string;
  /** Buttons at the row's end — Archive, Approve. Not with `onPress`. */
  actions?: ReactNode;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const body = (
    <>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {typeof detail === 'string' ? <Text style={styles.rowDetail}>{detail}</Text> : (detail ?? null)}
        {warn ? <Text style={styles.rowWarn}>{warn}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {actions ? <View style={styles.rowActions}>{actions}</View> : null}
      {onPress ? <Icon name="chevron-right" size={22} color={t.text.muted} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, actions ? styles.rowWithActions : null, warn ? styles.rowWarnFill : null]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.row, warn ? styles.rowWarnFill : null, pressed ? styles.rowPressed : null]}
    >
      {body}
    </Pressable>
  );
}

/**
 * What a status colour means, decided once. Waiting is gold (someone has to
 * act), done is green, needing a fix is red, and nothing yet is taupe. The dot
 * carries the colour; the word stays readable text.
 */
export type Tone = 'good' | 'waiting' | 'fix' | 'none';
const TONE_COLOUR: Record<Tone, string> = {
  good: t.feedback.success,
  waiting: t.feedback.warning,
  fix: t.feedback.danger,
  none: t.text.muted,
};

/** The colour a tone is drawn in: for a dot that stands beside a word. */
export function toneColour(tone: Tone): string {
  return TONE_COLOUR[tone];
}

/** A timesheet's state, in the same words and colours on every screen. */
export function sheetStatus(status: 'draft' | 'submitted' | 'approved' | 'rejected'): { label: string; tone: Tone } {
  return {
    draft: { label: 'Not submitted', tone: 'none' as const },
    submitted: { label: 'Submitted', tone: 'waiting' as const },
    approved: { label: 'Approved', tone: 'good' as const },
    rejected: { label: 'Rejected', tone: 'fix' as const },
  }[status];
}

/** A status word with its coloured dot. */
export function StatusChip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <View style={styles.chip}>
      <View style={[styles.chipDot, { backgroundColor: TONE_COLOUR[tone] }]} />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/**
 * An inline message. `tone` picks the functional colour, never a brand hue. With
 * `onPress` it is the way to what it is about, and says so with a chevron.
 */
export function Notice({
  tone,
  children,
  onPress,
}: {
  tone: 'info' | 'error' | 'success';
  children: ReactNode;
  onPress?: () => void;
}) {
  const bg = tone === 'error' ? t.bg.dangerSoft : tone === 'success' ? t.bg.sage : t.bg.goldSoft;
  const fg = tone === 'error' ? t.text.danger : tone === 'success' ? t.text.primary : t.text.secondary;
  const text = <Text style={[styles.noticeText, { color: fg }]}>{children}</Text>;
  if (!onPress) {
    return (
      <View role={tone === 'error' ? 'alert' : undefined} style={[styles.notice, { backgroundColor: bg }]}>
        {text}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.notice, styles.noticeLink, { backgroundColor: bg }, pressed ? styles.btnPressed : null]}
    >
      {text}
      <Icon name="chevron-right" size={22} color={fg} />
    </Pressable>
  );
}

/**
 * A labelled text box. The label is above the box and names it for a screen
 * reader too; a `multiline` field is a paragraph, not a value, and grows.
 */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.text.muted}
        multiline={multiline}
        numberOfLines={multiline ? 4 : undefined}
        textAlignVertical={multiline ? 'top' : undefined}
      />
    </View>
  );
}

/**
 * Filter pills — one of N, always exactly one chosen. A radio group, which is
 * what the control is; they narrow what a screen shows without changing what
 * the screen is about.
 */
export function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** What the group chooses, for a screen reader. */
  label: string;
}) {
  return (
    <View style={styles.pills} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            aria-checked={on}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.pill, on ? styles.pillOn : null, pressed ? styles.btnPressed : null]}
          >
            <Text style={[styles.pillText, on ? styles.pillTextOn : null]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The one number a screen is about — a total — large, with what it counts in
 * words under it. On the plain surface, not a raspberry block: the number is
 * the emphasis, and raspberry is kept for the main action.
 */
export function StatTile({ value, caption }: { value: string; caption: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statCaption}>{caption}</Text>
    </View>
  );
}

/**
 * A labelled on/off row — the settings control. NOT React Native's `Switch`: on
 * the web that is a browser control whose colours are only partly reachable, so
 * it arrived in system teal. Two Views give the same affordance in the brand's
 * colours on every surface, and the WHOLE row is the target.
 */
export function SwitchRow({
  label,
  description,
  on,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      aria-checked={on}
      aria-disabled={disabled}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!on)}
      style={({ pressed }) => [styles.switchRow, pressed ? styles.rowPressed : null, disabled ? styles.switchOff : null]}
    >
      <View style={styles.rowText}>
        <Text style={styles.switchLabel}>{label}</Text>
        {description ? <Text style={styles.rowDetail}>{description}</Text> : null}
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.track, on ? styles.trackOn : null]}
      >
        <View style={[styles.knob, on ? styles.knobOn : null]} />
      </View>
    </Pressable>
  );
}

/**
 * A two-way switch between views of the same list ("Assigned to me / All
 * submitted"). Not navigation: it does not push and gets no Back.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.segmented, disabled ? styles.switchOff : null]} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            aria-selected={on}
            aria-disabled={disabled}
            accessibilityLabel={o.label}
            disabled={disabled || on}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => [styles.segment, on ? styles.segmentOn : null, pressed ? styles.btnPressed : null]}
          >
            <Text style={[styles.segmentText, on ? styles.segmentTextOn : null]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** What an empty list says: what is (not) there, and what to do next. */
export function Empty({ children }: { children: ReactNode }) {
  // secondary, not muted: an empty-state message conveys information.
  return <Text style={styles.empty}>{children}</Text>;
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
 * A section that starts closed: for rows that must stay reachable without being
 * in the way, like archived activities.
 *
 * Closed content is UNMOUNTED, not hidden. A hidden row still matches a test's
 * text locator and takes the click meant for whatever is drawn over it.
 *
 * `aria-expanded`, not `accessibilityState`: react-native-web has no mapping for
 * accessibilityState, so the control would announce no state on the web.
 */
export function Collapsible({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const label = `${title} (${count})`;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`${open ? 'Hide' : 'Show'} ${label}`}
        onPress={() => setOpen((v) => !v)}
        style={styles.collapseHead}
      >
        <Icon name={open ? 'expand-more' : 'chevron-right'} size={20} color={t.text.secondary} />
        <Text style={styles.collapseTitle}>{label}</Text>
      </Pressable>
      {open ? children : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: t.bg.canvas },
  body: { padding: spacing(5), paddingBottom: spacing(10) },
  bodyWide: { paddingHorizontal: spacing(8), paddingTop: spacing(7) },
  // Held still, the content is the screen's height, and its foot needs only a
  // margin: the room a scrolling page leaves at its end is not wanted.
  bodyFill: { flex: 1, paddingBottom: spacing(5) },
  bodyColumnFill: { flex: 1 },
  // Ivory chrome: the title sits on the canvas, never on a raspberry bar
  // (brand chrome-vs-content rule).
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing(3),
    marginBottom: spacing(2),
  },
  // The title gives way and wraps; the icons beside it do not move.
  headText: { flex: 1, minWidth: 0 },
  headActions: { flexDirection: 'row', gap: spacing(2), flexShrink: 0 },
  h1: { fontSize: 26, fontWeight: '700', color: t.text.primary },
  lede: { fontSize: 15, color: t.text.secondary, marginTop: spacing(1) },
  // The content column: carries the inter-item gap (moved off `body` so it
  // survives the cap wrapper) and grows to fill within the cap.
  bodyColumn: { width: '100%', gap: spacing(3) },
  btn: {
    borderRadius: 8,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(5),
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 120,
  },
  btnPrimary: { backgroundColor: t.accent.base },
  btnSecondary: { backgroundColor: t.bg.sage },
  btnQuiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: t.border.strong },
  btnDanger: { backgroundColor: t.feedback.danger },
  btnInverse: { backgroundColor: t.accent.onAccent },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { backgroundColor: t.bg.inset, borderWidth: 0 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  iconBtnTile: { backgroundColor: t.bg.sage },
  iconBtnDisabled: { opacity: 0.4 },
  textLink: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' },
  textLinkCentre: { alignSelf: 'center' },
  textLinkText: { fontSize: 14, color: t.text.accent, textDecorationLine: 'underline' },
  // textAlign, so a label that wraps stays centred line by line.
  btnLabel: { color: t.accent.onAccent, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  btnLabelSecondary: { color: t.text.primary },
  btnLabelQuiet: { color: t.text.secondary },
  btnLabelInverse: { color: t.accent.base },
  btnLabelRemove: { color: t.text.danger },
  // Secondary, not muted: a disabled primary is what a person reads to find out
  // what the form is FOR, so its label still has to be readable.
  btnLabelDisabled: { color: t.text.secondary },
  error: { color: t.feedback.danger, fontSize: 14 },
  collapseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(2),
    minHeight: 44,
    marginTop: spacing(3),
  },
  collapseTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
  },
  card: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.subtle,
    padding: spacing(4),
    gap: spacing(3),
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
    marginTop: spacing(4),
    minHeight: 24,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: t.text.secondary,
  },
  rowList: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.subtle,
    overflow: 'hidden',
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border.subtle },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
    minHeight: 52,
    paddingVertical: spacing(3),
    paddingLeft: spacing(4),
    paddingRight: spacing(3),
  },
  rowPressed: { backgroundColor: t.bg.inset },
  rowWarnFill: { backgroundColor: t.bg.dangerSoft },
  rowText: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0, gap: 2 },
  rowLabel: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  rowDetail: { fontSize: 13, color: t.text.secondary },
  rowWarn: { fontSize: 13, fontWeight: '600', color: t.text.danger },
  // A total never wraps ("5h / 30m"); the label beside it gives way instead.
  rowValue: { fontSize: 15, fontWeight: '600', color: t.text.primary, flexShrink: 0 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing(2), flexShrink: 0 },
  // A row with buttons WRAPS rather than squeezes: a long name keeps a readable
  // width and the buttons move under it, still at the right-hand end.
  rowWithActions: { flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 13, color: t.text.secondary },
  notice: { borderRadius: 8, padding: spacing(3) },
  noticeLink: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  noticeText: { flex: 1, fontSize: 14 },
  empty: { fontSize: 14, color: t.text.secondary, paddingVertical: spacing(2) },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  pill: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing(4),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.border.strong,
  },
  pillOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  pillText: { fontSize: 14, fontWeight: '600', color: t.text.secondary },
  pillTextOn: { color: t.accent.onAccent },
  stat: {
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border.subtle,
    paddingVertical: spacing(5),
    paddingHorizontal: spacing(4),
    alignItems: 'center',
    gap: spacing(1),
  },
  statValue: { fontSize: 36, fontWeight: '700', color: t.text.primary },
  statCaption: { fontSize: 14, color: t.text.secondary, textAlign: 'center' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(4),
    minHeight: 52,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(4),
  },
  switchOff: { opacity: 0.5 },
  switchLabel: { fontSize: 15, fontWeight: '600', color: t.text.primary },
  track: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.bg.inset,
    borderWidth: 1,
    borderColor: t.border.strong,
    padding: 3,
    justifyContent: 'center',
  },
  // Raspberry on, recessed ivory off: the same pair the app uses for selected.
  trackOn: { backgroundColor: t.accent.base, borderColor: t.accent.base },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: t.bg.raised, transform: [{ translateX: 0 }] },
  knobOn: { transform: [{ translateX: 20 }] },
  // Never wider than its column: at 320px two long labels wrap inside their
  // segments rather than running the switch off the screen.
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 2,
    padding: 3,
    borderRadius: 9,
    backgroundColor: t.bg.inset,
  },
  segment: {
    flexShrink: 1,
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(4),
    borderRadius: 7,
    minHeight: 44,
    justifyContent: 'center',
  },
  // A raised thumb you can see, with the label in the accent: a view switch,
  // not the brand's loudest control.
  segmentOn: { backgroundColor: t.bg.surface, borderWidth: 1, borderColor: t.border.strong },
  segmentText: { fontSize: 14, fontWeight: '600', color: t.text.secondary, textAlign: 'center' },
  segmentTextOn: { color: t.text.accent, fontWeight: '700' },
  field: { gap: spacing(1) },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  input: {
    backgroundColor: t.bg.inset,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border.subtle,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(3),
    fontSize: 15,
    color: t.text.primary,
    minHeight: 44,
  },
  inputMultiline: { minHeight: 110, lineHeight: 21 },
  listenerError: {
    backgroundColor: t.bg.dangerSoft,
    borderRadius: 8,
    padding: spacing(3),
  },
  listenerErrorText: { fontSize: 13, color: t.text.danger },
});
