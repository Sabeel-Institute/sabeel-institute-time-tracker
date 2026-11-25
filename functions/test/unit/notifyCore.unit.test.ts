import { describe, expect, it } from 'vitest';
import { decodeNotifRoute, encodeNotifRoute } from '@sabeel/shared';
import type { TimesheetDoc } from '@sabeel/shared';
import {
  approverNotice,
  inReminderWindow,
  localClock,
  prefOn,
  reminderEligible,
  reminderPeriod,
  texts,
} from '../../src/notifyCore';

describe('prefOn', () => {
  it('missing prefs or missing key mean ON; explicit false means OFF', () => {
    expect(prefOn(undefined, 'reminder')).toBe(true);
    expect(prefOn({}, 'reminder')).toBe(true);
    expect(prefOn({ reminder: false }, 'reminder')).toBe(false);
    expect(prefOn({ reminder: false }, 'rejected')).toBe(true);
  });
});

describe('reminder window (10:00 local, Tuesday through Saturday)', () => {
  // 2026-07-14 is a Tuesday. 14:30 UTC = 10:30 in New York (EDT, UTC-4).
  const tueUtc = Date.UTC(2026, 6, 14, 14, 30);
  it('hits in the timezone where it is Tuesday 10am', () => {
    expect(localClock(tueUtc, 'America/New_York')).toEqual({ weekday: 2, hour: 10 });
    expect(inReminderWindow(tueUtc, 'America/New_York')).toBe(true);
  });
  it('repeats daily: Wednesday through Saturday 10am also hit', () => {
    for (const day of [15, 16, 17, 18]) {
      expect(inReminderWindow(Date.UTC(2026, 6, day, 14, 30), 'America/New_York')).toBe(true);
    }
  });
  it('Sunday and Monday are grace days', () => {
    expect(inReminderWindow(Date.UTC(2026, 6, 19, 14, 30), 'America/New_York')).toBe(false);
    expect(inReminderWindow(Date.UTC(2026, 6, 20, 14, 30), 'America/New_York')).toBe(false);
  });
  it('misses outside the 10:00 hour at the same instant elsewhere', () => {
    expect(inReminderWindow(tueUtc, 'Asia/Singapore')).toBe(false); // 22:30 Tue
    expect(inReminderWindow(tueUtc, 'UTC')).toBe(false); // 14:30 Tue
  });
  it('Singapore gets its own window at Tuesday 10am local (02:00 UTC)', () => {
    expect(inReminderWindow(Date.UTC(2026, 6, 14, 2, 15), 'Asia/Singapore')).toBe(true);
  });
});

describe('reminderPeriod', () => {
  it('is the period before the one containing today', () => {
    // Tue 2026-07-14 sits in the 07-12..07-18 period; previous is 07-05..07-11.
    expect(reminderPeriod('2026-07-14')).toEqual({ fromKey: '2026-07-05', toKey: '2026-07-11' });
  });
  it('crosses month boundaries through the clipped weeks', () => {
    // 2026-07-01 (Wed) is in the clipped 07-01..07-04 period; previous is June's
    // final clipped period 06-28..06-30.
    expect(reminderPeriod('2026-07-01')).toEqual({ fromKey: '2026-06-28', toKey: '2026-06-30' });
  });
});

describe('reminderEligible', () => {
  it('submitted/approved sheets are done', () => {
    expect(reminderEligible('submitted', true)).toBe(false);
    expect(reminderEligible('approved', true)).toBe(false);
  });
  it('rejected always needs attention', () => {
    expect(reminderEligible('rejected', false)).toBe(true);
  });
  it('no sheet: only nag when hours were logged', () => {
    expect(reminderEligible(null, true)).toBe(true);
    expect(reminderEligible(null, false)).toBe(false);
  });
});

describe('approverNotice', () => {
  const sheet = (over: Partial<TimesheetDoc>): TimesheetDoc => ({
    uid: 'alice', periodKey: '2026-07-05', toKey: '2026-07-11', status: 'submitted', approverUid: 'mgr',
    submittedAt: 1, createdAt: 1, updatedAt: 1, totalMinutes: 0, entryCount: 0, ...over,
  });

  it('tells the approver about a submission and a resubmission', () => {
    expect(approverNotice(null, sheet({}))).toBe('submitted');
    expect(approverNotice(sheet({ status: 'rejected' }), sheet({}))).toBe('resubmitted');
  });

  it('leaves a week passed on while waiting to the hand-over, which tells once for all', () => {
    expect(approverNotice(sheet({ approverUid: 'old' }), sheet({}))).toBeNull();
  });

  it('counts the weeks passed on, and opens the oldest', () => {
    expect(texts.handedOver('u1', 'Alice', { fromKey: '2026-07-05', toKey: '2026-07-11' }, 3))
      .toMatchObject({ title: '3 timesheets passed to you', body: 'Alice · from Jul 5 – Jul 11', route: { periodKey: '2026-07-05' } });
  });

  it('says nothing for a write that leaves the approver as it was, or about their own week', () => {
    expect(approverNotice(sheet({}), sheet({ updatedAt: 2 }))).toBeNull();
    expect(approverNotice(sheet({}), sheet({ status: 'approved' }))).toBeNull();
    expect(approverNotice(null, sheet({ approverUid: 'alice' }))).toBeNull();
    expect(approverNotice(sheet({ approverUid: 'old' }), sheet({ approverUid: 'alice' }))).toBeNull();
  });
});

describe('texts', () => {
  const range = { fromKey: '2026-07-05', toKey: '2026-07-11' };

  it('reject body carries the reason; submitted flags resubmits', () => {
    expect(texts.rejected(range, 'Missing Friday hours').body).toContain('Missing Friday hours');
    expect(texts.submitted('u1', 'Alice', range, true).title).toBe('Timesheet resubmitted');
    expect(texts.submitted('u1', 'Alice', range, false).title).toBe('Timesheet submitted');
  });

  it('every notification carries a decodable destination', () => {
    const all = [
      texts.newUser('Alice', 'alice@example.com'),
      texts.submitted('u1', 'Alice', range, false),
      texts.handedOver('u1', 'Alice', range, 2),
      texts.needsApprover(range, 1, false),
      texts.approved(range),
      texts.rejected(range, 'why'),
      texts.reminder(range),
    ];
    for (const n of all) {
      expect(decodeNotifRoute(encodeNotifRoute(n.route))).toEqual(n.route);
    }
  });

  it('sends each notification where its text points', () => {
    // A signup goes to the approval queue; my own decisions go to my week; a
    // submission goes to the review screen for THAT person's week.
    expect(texts.newUser('Alice', 'a@example.com').route).toEqual({ screen: 'Users' });
    expect(texts.approved(range).route).toEqual({ screen: 'Timesheet', periodKey: '2026-07-05' });
    expect(texts.rejected(range, 'why').route).toEqual({
      screen: 'Timesheet',
      periodKey: '2026-07-05',
    });
    expect(texts.reminder(range).route).toEqual({ screen: 'Timesheet', periodKey: '2026-07-05' });
    expect(texts.submitted('u1', 'Alice', range, false).route).toEqual({
      screen: 'TimesheetReview',
      uid: 'u1',
      displayName: 'Alice',
      periodKey: '2026-07-05',
    });
  });
});
