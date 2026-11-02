import { createNavigationContainerRef, type NavigationState } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  Users: undefined;
  /** One person's account: approver, role and access. */
  UserEdit: { uid: string };
  Activities: undefined;
  /** forUid/forName: log hours on someone else's behalf (manager/approver flow). */
  ManualEntry: { forUid?: string; forName?: string } | undefined;
  /** initialPeriodKey: open anchored at a specific week (rejection resolution). */
  Timesheet: { initialPeriodKey?: string } | undefined;
  /** Rejected timesheets awaiting the owner's fix — any month, one list. */
  NeedsAttention: undefined;
  NotificationSettings: undefined;
  ReportProblem: undefined;
  EntryEdit: { entryId: string };
  Reports: undefined;
  PersonDetail: { uid: string; displayName: string };
  Approvals: undefined;
  /** Approver review of one person's period. */
  TimesheetReview: { uid: string; displayName: string; periodKey: string };
};

/** The screens the tabs open. */
export type TabRoute = 'Home' | 'Timesheet' | 'Approvals' | 'Reports';

/**
 * The stack a tab opens on, as a reset of `current`: the tab, over Today unless
 * it is Today — so Back from any tab returns to Today, and only Back from Today
 * leaves the app.
 *
 * The SAME stack, not a new one: the reset keeps the stack's key and Today's
 * route, which takes a complete state. On the web the browser's history follows the stack only while its key
 * holds (a new key reads as a page replaced, so Back left the site), and Today
 * keeps its route so its live data is not torn down and fetched again on every
 * tab press.
 */
export function tabState<K extends TabRoute>(
  current: NavigationState | undefined,
  name: K,
  params?: RootStackParamList[K],
) {
  const fresh = (route: string, routeParams?: object) => ({
    key: `${route}-${Math.random().toString(36).slice(2, 10)}`,
    name: route,
    params: routeParams,
  });
  const bottom = current?.routes[0];
  const home = bottom?.name === 'Home' ? bottom : fresh('Home');
  const routes = name === 'Home' ? [home] : [home, fresh(name, params)];
  // A COMPLETE state (`stale: false`, every route keyed): a partial one is
  // rehydrated by the router, which gives the stack a new key.
  return (current
    ? { ...current, stale: false, index: routes.length - 1, routes }
    : { index: routes.length - 1, routes }) as never;
}

/**
 * Navigation from outside the tree — specifically a notification tap, which has
 * no component to hang a useNavigation() on. See notifRouting.ts.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
