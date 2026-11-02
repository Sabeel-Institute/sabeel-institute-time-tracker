// Turning a tapped notification into a screen. Both surfaces feed routes in
// here (native: the expo-notifications response listener; web: the URL query the
// service worker opened) and this module decides when it is safe to act on one.
//
// A tap on a cold start arrives before anything is navigable: the app still has
// to restore auth, load the profile and mount the navigator, which is seconds
// away and several React trees later. So a route is held until BOTH the
// navigator is ready and the session is known — and dropped if it turns out the
// destination isn't a screen this account has.
import { navigationRef, tabState } from './nav';
import { notifRouteNeedsApprover, type NotifRoute } from '@sabeel/shared';

let pending: NotifRoute | null = null;
/** null = no navigable session yet (signed out, gated, or still loading). */
let approver: boolean | null = null;

/** A notification was tapped. Navigates now if possible, otherwise waits. */
export function openNotifRoute(route: NotifRoute): void {
  pending = route;
  flush();
}

/**
 * Called by the signed-in tree as it mounts and whenever the role changes.
 * Passing null parks any pending route until there is somewhere to send it.
 */
export function setNotifRoutingSession(isApprover: boolean | null): void {
  approver = isApprover;
  flush();
}

export function flushNotifRoute(): void {
  flush();
}

function flush(): void {
  if (pending === null || approver === null || !navigationRef.isReady()) return;
  const route = pending;
  pending = null;
  // Demoted since the notification was sent: the screen isn't in the navigator
  // at all, and navigating to a name that doesn't exist throws.
  if (notifRouteNeedsApprover(route) && !approver) return;
  switch (route.screen) {
    case 'Users':
      navigationRef.navigate('Users');
      return;
    case 'Timesheet':
      // A tab's own screen: switch to the tab, at that week, rather than push a
      // second copy of it with no way back.
      navigationRef.reset(tabState(navigationRef.getRootState(), 'Timesheet', { initialPeriodKey: route.periodKey }));
      return;
    case 'TimesheetReview':
      navigationRef.navigate('TimesheetReview', {
        uid: route.uid,
        displayName: route.displayName,
        periodKey: route.periodKey,
      });
  }
}
