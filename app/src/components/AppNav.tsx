import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../icons';
import { getTheme, spacing } from '../theme';
import { RAIL_WIDTH } from '../theme/layout';
import type { RootStackParamList } from '../nav';

const t = getTheme();
type RouteName = keyof RootStackParamList;

interface Tab {
  key: string;
  label: string;
  icon: IconName;
  /** The tab's own screen: a tab press resets the stack to it. */
  route: RouteName;
}

/**
 * THE DESTINATIONS THAT EARN A PERMANENT SLOT: the places people GO, every
 * week. Everyone logs and submits hours; managers and admins also approve them
 * and read the totals. Activities and People are visited a few times a term, so
 * they live under More with the settings.
 */
const EVERYONE: Tab[] = [
  { key: 'today', label: 'Today', icon: 'today', route: 'Home' },
  { key: 'timesheet', label: 'Timesheet', icon: 'date-range', route: 'Timesheet' },
];
const APPROVER: Tab[] = [
  { key: 'approvals', label: 'Approvals', icon: 'fact-check', route: 'Approvals' },
  { key: 'reports', label: 'Reports', icon: 'bar-chart', route: 'Reports' },
];

/** The screens More opens. While one is showing, More is the lit tab. */
const MORE_ROUTES: ReadonlySet<RouteName> = new Set<RouteName>([
  'Activities',
  'Users',
  'UserEdit',
  'NotificationSettings',
  'ReportProblem',
]);

/**
 * Which tab a screen belongs to, for the ones that belong to only one. Add hours,
 * Edit entry and Review timesheet are reached from more than one tab, so they
 * are absent here and take their tab from the screen beneath them.
 */
const TAB_OF: Partial<Record<RouteName, string>> = {
  Home: 'today',
  NeedsAttention: 'today',
  Timesheet: 'timesheet',
  Approvals: 'approvals',
  Reports: 'reports',
  PersonDetail: 'reports',
};

/**
 * The lit tab for a stack of screens, top first. A More destination lights More.
 * Otherwise a screen's own tab decides, or, for a shared screen, the tab of the
 * screen beneath it: Review timesheet is under Reports when it was opened from
 * Reports and under Approvals however else it was reached (a notification opens
 * it straight over Today).
 */
export function activeTab(stack: RouteName[]): string {
  if (stack[0] && MORE_ROUTES.has(stack[0])) return 'more';
  return tabAt(stack, 0);
}

function tabAt(stack: RouteName[], i: number): string {
  const name = stack[i];
  const own = name ? TAB_OF[name] : undefined;
  if (own) return own;
  const below = i + 1 < stack.length ? tabAt(stack, i + 1) : null;
  if (name === 'TimesheetReview') return below === 'reports' ? 'reports' : 'approvals';
  return below ?? (name === 'EntryEdit' ? 'timesheet' : 'today');
}

/**
 * The app's persistent navigation: a bar along the bottom on a phone, a rail
 * down the left on a wide screen — chosen by WIDTH, never platform. Both stay on
 * every screen, so no screen is a cul-de-sac only Back can leave.
 */
export function AppNav({
  approver,
  variant,
  active,
  waiting,
  pendingAccounts,
  onTab,
  onOpenMore,
}: {
  approver: boolean;
  variant: 'bar' | 'rail';
  /** The lit tab's key (see `activeTab`). */
  active: string;
  /** Timesheets waiting for this person's decision: the Approvals badge. */
  waiting: number;
  /** Accounts waiting for approval, for an admin: a badge on More. */
  pendingAccounts: number;
  onTab: (route: RouteName) => void;
  onOpenMore: () => void;
}) {
  const insets = useSafeAreaInsets();
  const rail = variant === 'rail';
  const tabs = approver ? [...EVERYONE, ...APPROVER] : EVERYONE;

  const items = tabs.map((tab) => (
    <NavItem
      key={tab.key}
      icon={tab.icon}
      label={tab.label}
      rail={rail}
      active={active === tab.key}
      badge={tab.key === 'approvals' ? waiting : 0}
      badgeWord="waiting"
      testID={`tab-${tab.key}`}
      onPress={() => onTab(tab.route)}
    />
  ));
  const more = (
    <NavItem
      icon="more-horiz"
      label="More"
      rail={rail}
      active={active === 'more'}
      badge={pendingAccounts}
      badgeWord="accounts waiting"
      testID="tab-more"
      onPress={onOpenMore}
    />
  );

  if (rail) {
    return (
      <View
        style={[
          styles.rail,
          {
            paddingTop: Math.max(insets.top, spacing(3)),
            paddingBottom: Math.max(insets.bottom, spacing(3)),
            paddingLeft: insets.left,
          },
        ]}
      >
        <View style={styles.railMark}>
          <Icon name="schedule" size={24} color={t.accent.base} />
        </View>
        <View style={styles.railTabs}>{items}</View>
        {more}
      </View>
    );
  }
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing(2)) }]}>
      {items}
      {more}
    </View>
  );
}

function NavItem({
  icon,
  label,
  active,
  onPress,
  rail,
  badge,
  badgeWord,
  testID,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
  rail: boolean;
  badge: number;
  badgeWord: string;
  testID: string;
}) {
  // Raspberry is spent on the active destination and nothing else in this bar.
  const tint = active ? t.accent.base : t.text.secondary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      // The count is drawn over the icon, so a screen reader hears it in the
      // name — appended, so the name still STARTS with the destination.
      accessibilityLabel={badge > 0 ? `${label}, ${badge} ${badgeWord}` : label}
      // `aria-current`: react-native-web maps no accessibilityState, and this is
      // the attribute a navigation control uses to say where you are.
      aria-current={active ? 'page' : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        rail ? styles.itemRail : styles.itemBar,
        active ? styles.itemActive : null,
        pressed ? styles.itemPressed : null,
      ]}
    >
      <View>
        <Icon name={icon} size={24} color={tint} />
        {badge > 0 ? (
          <View testID={`${testID}-badge`} style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    // Surface, not white: the chrome is ivory like everything else.
    backgroundColor: t.bg.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.border.strong,
    paddingTop: spacing(2),
    paddingHorizontal: spacing(2),
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: 'center',
    gap: spacing(1),
    backgroundColor: t.bg.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: t.border.strong,
  },
  railMark: { height: 40, justifyContent: 'center', marginBottom: spacing(2) },
  railTabs: { alignItems: 'center', gap: spacing(1), flex: 1 },
  item: { alignItems: 'center', gap: 2, borderRadius: 10, paddingVertical: spacing(2) },
  // Capped: a cell that took its full share of a 700px bar made the active pill
  // a slab. The pill and the touch target are the same box.
  itemBar: { flex: 1, paddingHorizontal: spacing(1), maxWidth: 120 },
  itemRail: { width: RAIL_WIDTH - 6, paddingHorizontal: 2 },
  itemActive: { backgroundColor: t.bg.accentSoft },
  itemPressed: { opacity: 0.6 },
  label: { fontSize: 11, fontWeight: '600' },
  // Raspberry rather than red: a waiting timesheet is work, not an error.
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent.base,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: t.accent.onAccent },
});
