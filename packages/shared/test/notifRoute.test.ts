import { describe, it, expect } from 'vitest';
import {
  decodeNotifRoute,
  encodeNotifRoute,
  notifRouteNeedsApprover,
  type NotifRoute,
} from '../src';

const routes: NotifRoute[] = [
  { screen: 'Users' },
  { screen: 'Timesheet', periodKey: '2026-07-19' },
  { screen: 'TimesheetReview', uid: 'u1', displayName: 'Alice Smith', periodKey: '2026-07-19' },
];

describe('notif route encoding', () => {
  it('round-trips every route through the flat string form', () => {
    for (const route of routes) {
      expect(decodeNotifRoute(encodeNotifRoute(route))).toEqual(route);
    }
  });

  it('encodes only strings, which is all an FCM data payload can carry', () => {
    for (const route of routes) {
      for (const v of Object.values(encodeNotifRoute(route))) {
        expect(typeof v).toBe('string');
      }
    }
  });
});

describe('decodeNotifRoute rejects anything it cannot trust', () => {
  it('returns null for junk rather than throwing', () => {
    expect(decodeNotifRoute(undefined)).toBeNull();
    expect(decodeNotifRoute(null)).toBeNull();
    expect(decodeNotifRoute('Timesheet')).toBeNull();
    expect(decodeNotifRoute({})).toBeNull();
    expect(decodeNotifRoute({ screen: 'Nope' })).toBeNull();
  });

  it('returns null when a required field is missing or empty', () => {
    expect(decodeNotifRoute({ screen: 'Timesheet' })).toBeNull();
    expect(decodeNotifRoute({ screen: 'Timesheet', periodKey: '' })).toBeNull();
    expect(decodeNotifRoute({ screen: 'TimesheetReview', uid: 'u1' })).toBeNull();
    expect(
      decodeNotifRoute({ screen: 'TimesheetReview', uid: 'u1', periodKey: '2026-07-19' }),
    ).toBeNull();
  });

  it('ignores extra keys — FCM adds its own', () => {
    expect(
      decodeNotifRoute({ screen: 'Timesheet', periodKey: '2026-07-19', google: 'x' }),
    ).toEqual({ screen: 'Timesheet', periodKey: '2026-07-19' });
  });

  it('never uses the key expo-notifications reserves', () => {
    // A data key named `body` is intercepted on Android and reinterpreted as the
    // whole JS payload, silently dropping every sibling key.
    for (const route of routes) {
      expect(Object.keys(encodeNotifRoute(route))).not.toContain('body');
    }
  });
});

describe('notifRouteNeedsApprover', () => {
  it('flags the screens a demoted member no longer has', () => {
    expect(notifRouteNeedsApprover({ screen: 'Users' })).toBe(true);
    expect(
      notifRouteNeedsApprover({
        screen: 'TimesheetReview',
        uid: 'u1',
        displayName: 'A',
        periodKey: '2026-07-19',
      }),
    ).toBe(true);
    expect(notifRouteNeedsApprover({ screen: 'Timesheet', periodKey: '2026-07-19' })).toBe(false);
  });
});
