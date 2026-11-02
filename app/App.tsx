import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { APP_NAME, COLLECTIONS, deviceTimeZone, hasAcceptedRules } from '@sabeel/shared';
import { db } from './src/firebase';
import { registerPush, useNotifTaps } from './src/notify';
import { setNotifRoutingSession, flushNotifRoute } from './src/notifRouting';
import { NavigationContainer, type LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useSession } from './src/session';
import { SignInScreen } from './src/screens/SignInScreen';
import {
  PendingScreen,
  DisabledScreen,
  ProvisioningScreen,
  NotProvisionedScreen,
  StillSettingUpScreen,
  UpdateScreen,
} from './src/screens/GateScreens';
import { useMinVersion } from './src/minVersion';
import { HomeScreen } from './src/screens/HomeScreen';
import { UsersScreen } from './src/screens/UsersScreen';
import { UserEditScreen } from './src/screens/UserEditScreen';
import { ActivitiesScreen } from './src/screens/ActivitiesScreen';
import { ManualEntryScreen } from './src/screens/ManualEntryScreen';
import { TimesheetScreen } from './src/screens/TimesheetScreen';
import { EntryEditScreen } from './src/screens/EntryEditScreen';
import { ReportsScreen } from './src/screens/ReportsScreen';
import { PersonDetailScreen } from './src/screens/PersonDetailScreen';
import { ApprovalsScreen } from './src/screens/ApprovalsScreen';
import { TimesheetReviewScreen } from './src/screens/TimesheetReviewScreen';
import { NeedsAttentionScreen } from './src/screens/NeedsAttentionScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { ReportProblemScreen } from './src/screens/ReportProblemScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { HelpFilmScreen, HelpScreen } from './src/screens/HelpScreen';
import { navigationRef, tabState, type RootStackParamList } from './src/nav';
import { AppNav, activeTab } from './src/components/AppNav';
import { MoreSheet } from './src/components/MoreSheet';
import { ScreenOwnsTopInset } from './src/components/ui';
import { useApprovalQueue } from './src/timesheets';
import { usePendingCount } from './src/users';
import { useLayout } from './src/theme/layout';
import { getTheme } from './src/theme';
import { initSentry } from './src/sentry';
import { ErrorBoundary } from './src/components/ErrorBoundary';

const t = getTheme();

initSentry();

const Stack = createNativeStackNavigator<RootStackParamList>();
type RouteName = keyof RootStackParamList;

/**
 * THE TAB ROOTS RUN WITHOUT A STACK HEADER. A header carries Back and names
 * where you are; a tab root is never pushed and names itself in its own heading,
 * so a header there is a duplicate title in a 56px bar. `Screen` pays the
 * status-bar inset instead, on exactly these screens. Pushed screens keep their
 * header: it is the only thing carrying Back.
 */
const HEADERLESS = new Set<RouteName>(['Home', 'Timesheet', 'Approvals', 'Reports']);

/**
 * A tab root also opens with no animation and no swipe-back: switching tabs is
 * not going somewhere and coming back, though it is a stack reset underneath.
 */
function screenOptions(name: RouteName, title: string) {
  const root = HEADERLESS.has(name);
  return { title, headerShown: !root, animation: root ? 'none' : 'default', gestureEnabled: !root } as const;
}

/**
 * ADDRESSES, ON THE WEB, so the browser's Back and Forward walk the screens
 * rather than leaving the site, and a reload stays where it was. Hosting answers
 * every path with the app. Params a path does not name ride in the query.
 *
 * Per role, because a manager's screens are not in a member's navigator: a path
 * the navigator has no screen for falls back to Today instead of naming one
 * that does not exist. Native gets none — Android's back button is the stack's
 * own, and the app opens no links.
 */
const MEMBER_PATHS = {
  Home: '',
  Timesheet: 'timesheet',
  ManualEntry: 'add-hours',
  EntryEdit: 'entry/:entryId',
  NeedsAttention: 'needs-attention',
  NotificationSettings: 'notifications',
  ReportProblem: 'report-a-problem',
  Help: 'help',
  HelpFilm: 'help/:id',
} as const;
const APPROVER_PATHS = {
  ...MEMBER_PATHS,
  Approvals: 'approvals',
  TimesheetReview: 'approvals/review',
  Reports: 'reports',
  PersonDetail: 'reports/person',
  Activities: 'activities',
  Users: 'people',
  UserEdit: 'people/:uid',
} as const;
// `initialRouteName`: an address opened directly (a reload, a notification)
// lands with Today beneath it, as if reached from the tab.
const linkingFor = (screens: Record<string, string>): LinkingOptions<RootStackParamList> | undefined =>
  Platform.OS === 'web' ? { prefixes: [], config: { initialRouteName: 'Home', screens } } : undefined;
// Built once, not per render: the container treats `linking` as an input.
const MEMBER_LINKING = linkingFor(MEMBER_PATHS);
const APPROVER_LINKING = linkingFor(APPROVER_PATHS);

// Chrome is ivory with a dark title, deliberately not a raspberry app bar.
const navTheme = {
  dark: false,
  colors: {
    primary: t.accent.base,
    background: t.bg.canvas,
    card: t.bg.canvas,
    text: t.text.primary,
    border: t.border.subtle,
    notification: t.accent.base,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '900' as const },
  },
};

export default function App() {
  const session = useSession();
  // The institute's floor for phone builds, read before anything else: a
  // retired build shows the update screen whether or not anyone is signed in.
  const { outdated } = useMinVersion();

  // Once per active sign-in: register this device for push and record the
  // last-seen timezone (the weekly reminder fires at local Tuesday 10:00).
  //
  // registerPush never prompts, on any platform. On the web a permission request
  // is only honoured straight from a press, and an effect is not one — asking
  // here is what left web push silently dead on every new browser. On an iPhone
  // the prompt can be shown once, and a "Don't Allow" given at sign-in leaves
  // push dead until Settings. The ask lives on the Home card and the
  // notification settings screen, from a press: enablePush in notify(.web).ts.
  const activeUid =
    session.phase === 'signedIn' && session.claims.status === 'active'
      ? session.user.uid
      : null;
  //
  // The timezone is compared with the profile as it stands at sign-in, read
  // through an effect event so the effect keys on who is signed in alone. Keyed
  // on the profile too, two devices in different zones signed in at once would
  // each write its own zone back whenever the other's arrived, forever.
  const knownTz = session.phase === 'signedIn' ? session.profile.timeZone : null;
  const recordTimeZone = useEffectEvent((uid: string) => {
    const tz = deviceTimeZone();
    if (knownTz !== tz) {
      updateDoc(doc(db, COLLECTIONS.users, uid), { timeZone: tz }).catch(() => undefined);
    }
  });
  useEffect(() => {
    if (!activeUid) return;
    void registerPush(activeUid);
    recordTimeZone(activeUid);
  }, [activeUid]);

  // Notification taps are collected unconditionally — one can land during the
  // sign-in gate or before the navigator exists — and released to the navigator
  // only once there is an active session to route within. null parks them.
  useNotifTaps();
  const isApprover =
    session.phase === 'signedIn' &&
    (session.claims.role === 'manager' || session.claims.admin === true);
  const routingApprover = activeUid ? isApprover : null;
  useEffect(() => {
    setNotifRoutingSession(routingApprover);
  }, [routingApprover]);

  // Inside the navigator the browser tab is named by the screen; anywhere else
  // (signed out, a gate, the rules) it is the app, not the last screen shown.
  const navigating =
    !outdated &&
    session.phase === 'signedIn' &&
    session.claims.status === 'active' &&
    hasAcceptedRules(session.profile);
  useEffect(() => {
    if (Platform.OS === 'web' && !navigating) document.title = APP_NAME;
  }, [navigating]);

  let content;
  if (outdated) {
    content = <UpdateScreen signedIn={session.phase === 'signedIn'} />;
  } else if (session.phase === 'loading') {
    content = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={t.accent.base} />
      </View>
    );
  } else if (session.phase === 'signedOut') {
    content = <SignInScreen />;
  } else if (session.phase === 'provisioning') {
    // Signed in; the trigger is creating the profile (or about to reject it).
    content = <ProvisioningScreen />;
  } else if (session.phase === 'provisioningSlow') {
    // No profile in the whole wait, and the account still exists.
    content = <StillSettingUpScreen email={session.email} />;
  } else if (session.phase === 'notProvisioned') {
    // The trigger rejected and deleted the account — a non-org address.
    content = <NotProvisionedScreen email={session.email} />;
  } else if (session.claims.status !== 'active') {
    // Signed in with a profile, but not (yet) an active member.
    const email = session.user.email ?? '';
    content =
      session.profile.status === 'disabled' ? (
        <DisabledScreen email={email} />
      ) : (
        <PendingScreen email={email} />
      );
  } else if (!hasAcceptedRules(session.profile)) {
    // Active, but the institute's rules are not yet accepted (once per account,
    // recorded server-side). Before the navigator exists, so no screen where
    // anything can be posted is reachable until they are.
    content = <RulesScreen />;
  } else {
    const { profile, claims, user } = session;
    content = (
      <Shell uid={user.uid} approver={isApprover} admin={claims.admin === true}>
        <Navigator linking={isApprover ? APPROVER_LINKING : MEMBER_LINKING}>
        <Stack.Navigator
          screenOptions={{
            headerTintColor: t.text.primary,
            headerShadowVisible: false,
            // iOS labels Back with the previous screen's title; a chevron alone,
            // as Android and the web draw it.
            headerBackButtonDisplayMode: Platform.OS === 'ios' ? 'minimal' : undefined,
          }}
          // Per screen, from its own route: a screen beneath the top one keeps
          // its inset rather than shifting while it is covered.
          screenLayout={({ route, children }) => (
            <ScreenOwnsTopInset.Provider value={HEADERLESS.has(route.name)}>
              {children}
            </ScreenOwnsTopInset.Provider>
          )}
        >
          <Stack.Screen name="Home" options={screenOptions('Home', 'Today')}>
            {() => <HomeScreen uid={user.uid} profile={profile} />}
          </Stack.Screen>
          <Stack.Screen
            name="ManualEntry"
            options={screenOptions('ManualEntry', 'Add hours')}
          >
            {({ route }) => {
              const p = (route.params ?? {}) as { forUid?: string; forName?: string; dayKey?: string };
              return <ManualEntryScreen uid={user.uid} forUid={p.forUid} forName={p.forName} dayKey={p.dayKey} />;
            }}
          </Stack.Screen>
          <Stack.Screen
            name="Timesheet"
            options={screenOptions('Timesheet', 'Timesheet')}
          >
            {({ route }) => (
              <TimesheetScreen
                uid={user.uid}
                profile={profile}
                claims={claims}
                initialPeriodKey={
                  (route.params as { initialPeriodKey?: string } | undefined)?.initialPeriodKey
                }
              />
            )}
          </Stack.Screen>
          <Stack.Screen
            name="NeedsAttention"
            options={screenOptions('NeedsAttention', 'Needs attention')}
          >
            {() => <NeedsAttentionScreen uid={user.uid} />}
          </Stack.Screen>
          <Stack.Screen
            name="NotificationSettings"
            options={screenOptions('NotificationSettings', 'Notifications')}
          >
            {() => (
              <NotificationSettingsScreen uid={user.uid} profile={profile} claims={claims} />
            )}
          </Stack.Screen>
          <Stack.Screen
            name="ReportProblem"
            options={screenOptions('ReportProblem', 'Report a problem')}
          >
            {() => <ReportProblemScreen uid={user.uid} />}
          </Stack.Screen>
          <Stack.Screen
            name="EntryEdit"
            options={screenOptions('EntryEdit', 'Edit entry')}
          >
            {({ route }) => (
              <EntryEditScreen
                entryId={(route.params as { entryId: string }).entryId}
                editorUid={user.uid}
              />
            )}
          </Stack.Screen>
          <Stack.Screen name="Help" options={screenOptions('Help', 'Help')}>
            {() => <HelpScreen />}
          </Stack.Screen>
          <Stack.Screen name="HelpFilm" options={screenOptions('HelpFilm', 'Help')}>
            {({ route }) => <HelpFilmScreen id={(route.params as { id: string }).id} />}
          </Stack.Screen>
          {isApprover ? (
            <Stack.Screen
              name="Reports"
              options={screenOptions('Reports', 'Reports')}
            >
              {() => <ReportsScreen />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="PersonDetail"
              options={screenOptions('PersonDetail', 'Lifetime hours')}
            >
              {({ route }) => {
                const p = route.params as { uid: string; displayName: string };
                return <PersonDetailScreen uid={p.uid} displayName={p.displayName} />;
              }}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="Activities"
              options={screenOptions('Activities', 'Activities')}
            >
              {() => <ActivitiesScreen selfUid={user.uid} claims={claims} />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="Approvals"
              options={screenOptions('Approvals', 'Approvals')}
            >
              {() => <ApprovalsScreen uid={user.uid} claims={claims} />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="TimesheetReview"
              options={screenOptions('TimesheetReview', 'Review timesheet')}
            >
              {({ route }) => {
                const p = route.params as {
                  uid: string;
                  displayName: string;
                  periodKey: string;
                };
                return (
                  <TimesheetReviewScreen
                    reviewerUid={user.uid}
                    admin={claims.admin === true}
                    uid={p.uid}
                    displayName={p.displayName}
                    periodKey={p.periodKey}
                  />
                );
              }}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="Users"
              options={screenOptions('Users', 'People')}
            >
              {() => <UsersScreen selfUid={user.uid} claims={claims} />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen name="UserEdit" options={screenOptions('UserEdit', 'Person')}>
              {({ route }) => (
                <UserEditScreen
                  uid={(route.params as { uid: string }).uid}
                  selfUid={user.uid}
                  claims={claims}
                />
              )}
            </Stack.Screen>
          ) : null}
        </Stack.Navigator>
        </Navigator>
      </Shell>
    );
  }

  return (
    <ErrorBoundary>
      {/* The insets every Screen pads by: the iPhone's status bar and Dynamic
          Island at the top and its home indicator at the bottom, Android's
          system bars under edge-to-edge, and zero on the web. */}
      <SafeAreaProvider>
        <KeyboardProvider>
          {content}
          {/* Dark icons — the app is ivory-topped everywhere (ivory chrome). */}
          <StatusBar style="dark" />
        </KeyboardProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

/** Lets the NavigationContainer report state changes up to the Shell above it. */
const NavStateContext = createContext<() => void>(() => {});

/**
 * The container, split out only so it can read the Shell's callback out of
 * context — a provider cannot consume its own value.
 */
function Navigator({
  linking,
  children,
}: {
  linking: LinkingOptions<RootStackParamList> | undefined;
  children: ReactNode;
}) {
  const onStateChange = useContext(NavStateContext);
  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      linking={linking}
      // The browser tab names the app as well as the screen.
      documentTitle={{ formatter: (options, route) => `${options?.title ?? route?.name} · ${APP_NAME}` }}
      onReady={() => {
        onStateChange();
        flushNotifRoute();
      }}
      onStateChange={onStateChange}
    >
      {children}
    </NavigationContainer>
  );
}

/**
 * THE PERSISTENT CHROME — what stays put while screens come and go: the bar on a
 * phone, the rail on a wide screen, and the More sheet.
 *
 * Composition rather than React Navigation's tab navigator, as in the sibling
 * LMS: a tab navigator draws its bar inside each screen, so it can never become
 * a left column, and the rail has to be a SIBLING of the whole stack.
 *
 * TABS RESET, MORE ITEMS PUSH. Switching tabs replaces the stack, or Back from
 * Reports would walk through every tab visited before it — but onto Today, as a
 * phone's tabs do: Back from any tab returns to Today, and only Back from Today
 * leaves. A More destination is somewhere you go and come back from, so it is
 * pushed.
 */
function Shell({
  uid,
  approver,
  admin,
  children,
}: {
  uid: string;
  approver: boolean;
  admin: boolean;
  children: ReactNode;
}) {
  const { isWide } = useLayout();
  // The same queries the screens behind the badges read, so a badge cannot
  // disagree with the screen it opens.
  const waiting = useApprovalQueue(uid).length;
  const pendingAccounts = usePendingCount(admin);
  // The stack's route names, top first: the lit tab follows from it.
  const [stack, setStack] = useState<RouteName[]>(['Home']);
  const onStateChange = useCallback(() => {
    const state = navigationRef.isReady() ? navigationRef.getRootState() : undefined;
    if (state) setStack(state.routes.map((r) => r.name as RouteName).reverse());
  }, []);

  const [moreOpen, setMoreOpen] = useState(false);
  // A screen changing under the sheet — the browser's Back, a notification —
  // takes the sheet with it rather than leaving it over a screen it was not
  // opened from.
  useEffect(() => setMoreOpen(false), [stack]);
  const nav = (
    <AppNav
      approver={approver}
      variant={isWide ? 'rail' : 'bar'}
      active={activeTab(stack)}
      waiting={approver ? waiting : 0}
      pendingAccounts={pendingAccounts}
      onTab={(name) => {
        if (navigationRef.isReady()) navigationRef.reset(tabState(navigationRef.getRootState(), name));
      }}
      onOpenMore={() => setMoreOpen(true)}
    />
  );
  return (
    <NavStateContext.Provider value={onStateChange}>
        {/* Reading order decides which side of the content the chrome sits on:
            a rail before it, a bar after it — what a screen reader and the Tab
            key follow. */}
        <View style={[styles.shell, isWide ? styles.shellWide : null]}>
          {isWide ? nav : null}
          <View style={styles.stack}>{children}</View>
          {isWide ? null : nav}
        </View>
        <MoreSheet
          visible={moreOpen}
          approver={approver}
          admin={admin}
          pendingAccounts={pendingAccounts}
          onClose={() => setMoreOpen(false)}
          onNavigate={(name) => {
            setMoreOpen(false);
            if (navigationRef.isReady()) (navigationRef.navigate as (n: RouteName) => void)(name);
          }}
        />
    </NavStateContext.Provider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'column', backgroundColor: t.bg.canvas },
  shellWide: { flexDirection: 'row' },
  stack: { flex: 1 },
});
