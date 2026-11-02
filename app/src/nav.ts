import { createNavigationContainerRef } from '@react-navigation/native';

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

/**
 * The stack a tab opens on: the tab, over Today unless it is Today — so Back
 * from any tab returns to Today, and only Back from Today leaves the app.
 */
/** The screens the tabs open. */
export type TabRoute = 'Home' | 'Timesheet' | 'Approvals' | 'Reports';

export function tabState<K extends TabRoute>(
  name: K,
  params?: RootStackParamList[K],
) {
  const tab = { name, params } as never;
  return name === 'Home'
    ? { index: 0, routes: [tab] }
    : { index: 1, routes: [{ name: 'Home' } as never, tab] };
}

/**
 * Navigation from outside the tree — specifically a notification tap, which has
 * no component to hang a useNavigation() on. See notifRouting.ts.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
