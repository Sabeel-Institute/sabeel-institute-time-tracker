import { createNavigationContainerRef } from '@react-navigation/native';

export type RootStackParamList = {
  Home: undefined;
  Users: undefined;
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
 * Navigation from outside the tree — specifically a notification tap, which has
 * no component to hang a useNavigation() on. See notifRouting.ts.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
