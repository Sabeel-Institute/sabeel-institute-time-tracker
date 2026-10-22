import { useEffect, useEffectEvent } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { doc, updateDoc } from 'firebase/firestore';
import { COLLECTIONS, deviceTimeZone, hasAcceptedRules } from '@sabeel/shared';
import { db } from './src/firebase';
import { registerPush, useNotifTaps } from './src/notify';
import { setNotifRoutingSession, flushNotifRoute } from './src/notifRouting';
import { NavigationContainer } from '@react-navigation/native';
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
} from './src/screens/GateScreens';
import { HomeScreen } from './src/screens/HomeScreen';
import { UsersScreen } from './src/screens/UsersScreen';
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
import { navigationRef, type RootStackParamList } from './src/nav';
import { getTheme } from './src/theme';
import { initSentry } from './src/sentry';
import { ErrorBoundary } from './src/components/ErrorBoundary';

const t = getTheme();

initSentry();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const session = useSession();

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

  let content;
  if (session.phase === 'loading') {
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
      <NavigationContainer ref={navigationRef} onReady={flushNotifRoute}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            // Ivory chrome: a nav header is a dark title on the ivory canvas,
            // not a raspberry bar (brand chrome-vs-content rule).
            headerStyle: { backgroundColor: t.bg.canvas },
            headerTintColor: t.text.primary,
            headerTitleStyle: { color: t.text.primary },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="Home">
            {() => <HomeScreen uid={user.uid} profile={profile} claims={claims} />}
          </Stack.Screen>
          <Stack.Screen
            name="ManualEntry"
            options={{
              headerShown: true,
              title: 'Add hours',
            }}
          >
            {({ route }) => {
              const p = (route.params ?? {}) as { forUid?: string; forName?: string };
              return <ManualEntryScreen uid={user.uid} forUid={p.forUid} forName={p.forName} />;
            }}
          </Stack.Screen>
          <Stack.Screen
            name="Timesheet"
            options={{
              headerShown: true,
              title: 'My timesheet',
            }}
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
            options={{
              headerShown: true,
              title: 'Needs attention',
            }}
          >
            {() => <NeedsAttentionScreen uid={user.uid} />}
          </Stack.Screen>
          <Stack.Screen
            name="NotificationSettings"
            options={{
              headerShown: true,
              title: 'Notifications',
            }}
          >
            {() => (
              <NotificationSettingsScreen uid={user.uid} profile={profile} claims={claims} />
            )}
          </Stack.Screen>
          <Stack.Screen
            name="ReportProblem"
            options={{
              headerShown: true,
              title: 'Report a problem',
            }}
          >
            {() => <ReportProblemScreen uid={user.uid} />}
          </Stack.Screen>
          <Stack.Screen
            name="EntryEdit"
            options={{
              headerShown: true,
              title: 'Edit entry',
            }}
          >
            {({ route }) => (
              <EntryEditScreen
                entryId={(route.params as { entryId: string }).entryId}
                editorUid={user.uid}
              />
            )}
          </Stack.Screen>
          {isApprover ? (
            <Stack.Screen
              name="Reports"
              options={{
                headerShown: true,
                title: 'Reports',
                  }}
            >
              {() => <ReportsScreen />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="PersonDetail"
              options={{
                headerShown: true,
                title: 'Lifetime hours',
                  }}
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
              options={{
                headerShown: true,
                title: 'Activities',
                  }}
            >
              {() => <ActivitiesScreen selfUid={user.uid} />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="Approvals"
              options={{
                headerShown: true,
                title: 'Approvals',
                  }}
            >
              {() => <ApprovalsScreen uid={user.uid} claims={claims} />}
            </Stack.Screen>
          ) : null}
          {isApprover ? (
            <Stack.Screen
              name="TimesheetReview"
              options={{
                headerShown: true,
                title: 'Review timesheet',
                  }}
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
              options={{
                headerShown: true,
                title: 'Users',
                  }}
            >
              {() => <UsersScreen selfUid={user.uid} claims={claims} />}
            </Stack.Screen>
          ) : null}
        </Stack.Navigator>
      </NavigationContainer>
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
