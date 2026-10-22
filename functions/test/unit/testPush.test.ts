import { describe, it, expect } from 'vitest';
import { testMessage } from '../../src/testPush';

/**
 * What `sabeel-ci send-test-push` sends for the `key=value` pairs it is
 * given, and what `sabeel-ci check-push` probes with (no pairs). A pair the
 * app cannot open must stop the push rather than send one that opens nothing.
 */
describe('testMessage', () => {
  it('opens the app where it was when no fields are given', () => {
    expect(testMessage('Test push', 'Safe to dismiss.', {})).toEqual({
      title: 'Test push',
      body: 'Safe to dismiss.',
      route: null,
    });
  });

  it('opens the route the fields name', () => {
    expect(testMessage('t', 'b', { screen: 'Timesheet', periodKey: '2026-10-04' })).toEqual({
      title: 't',
      body: 'b',
      route: { screen: 'Timesheet', periodKey: '2026-10-04' },
    });
    expect(testMessage('t', 'b', { screen: 'Users' })?.route).toEqual({ screen: 'Users' });
    expect(
      testMessage('t', 'b', { screen: 'TimesheetReview', uid: 'u1', displayName: 'A member', periodKey: '2026-10-04' })
        ?.route,
    ).toEqual({ screen: 'TimesheetReview', uid: 'u1', displayName: 'A member', periodKey: '2026-10-04' });
  });

  it('refuses fields that are not a route the app opens', () => {
    expect(testMessage('t', 'b', { screen: 'Nowhere' })).toBeNull();
    // A known screen missing what it needs.
    expect(testMessage('t', 'b', { screen: 'Timesheet' })).toBeNull();
    expect(testMessage('t', 'b', { periodKey: '2026-10-04' })).toBeNull();
  });
});
