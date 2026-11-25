import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  EMULATOR_PROJECT_ID,
  periodRangeFor,
  timesheetEntriesVersion,
  timesheetReviewVersion,
  timesheetRevision,
  type TimesheetDoc,
  type UserDoc,
} from '@sabeel/shared';
import { handOverWaitingWeeks } from '../../src/handOver';
import { followProfileChange } from '../../src/approverHandoff';
import { approveReviewed } from '../../src/timesheetActions';
import { clearIneligibleApproverPointers } from '../../src/users';

const owner = 'member';
const weeks = ['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26'].map((d) => periodRangeFor(d));
const sheet = (i: number, status: TimesheetDoc['status'], approverUid = 'old'): TimesheetDoc => ({
  uid: owner, status, periodKey: weeks[i].fromKey, toKey: weeks[i].toKey, approverUid,
  submittedAt: 2, createdAt: 2, updatedAt: 2, totalMinutes: 0, entryCount: 0,
  ...(status === 'submitted' ? {} : { decidedAt: 3, decidedBy: approverUid }),
  ...(status === 'rejected' ? { rejectReason: 'Check Friday' } : {}),
});
const ref = (i: number) => getFirestore().collection('timesheets').doc(owner + '_' + weeks[i].fromKey);
const user = (uid: string) => getFirestore().collection('users').doc(uid);
const holder = async (i: number) => (await ref(i).get()).data() as TimesheetDoc;

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});

beforeEach(async () => {
  const db = getFirestore();
  await Promise.all(['timesheets', 'users'].map(async (name) => {
    const docs = (await db.collection(name).get()).docs;
    await Promise.all(docs.map((doc) => doc.ref.delete()));
  }));
  await Promise.all([
    user('old').set({ status: 'active', role: 'manager', admin: false, approverUid: null }),
    user('new').set({ status: 'active', role: 'manager', admin: false, approverUid: null }),
    user(owner).set({ status: 'active', role: 'member', admin: false, approverUid: 'new' }),
    ref(0).set(sheet(0, 'submitted')),
    ref(1).set(sheet(1, 'submitted')),
    ref(2).set(sheet(2, 'approved')),
    ref(3).set(sheet(3, 'rejected')),
  ]);
});

describe('waiting weeks follow the current approver', () => {
  it('moves every waiting week to the chosen approver and leaves decided weeks alone', async () => {
    expect((await handOverWaitingWeeks(owner, { now: 50 })).moved.map((w) => w.id)).toEqual([ref(0).id, ref(1).id]);
    expect(await holder(0)).toMatchObject({ status: 'submitted', approverUid: 'new', heldSince: 50, updatedAt: 50, submittedAt: 2 });
    expect(await holder(1)).toMatchObject({ approverUid: 'new' });
    expect(await holder(2)).toEqual(sheet(2, 'approved'));
    expect(await holder(3)).toEqual(sheet(3, 'rejected'));
  });

  it('is safe to repeat: a second run moves nothing and leaves the revision alone', async () => {
    await handOverWaitingWeeks(owner, { now: 50 });
    expect((await handOverWaitingWeeks(owner, { now: 60 })).moved).toEqual([]);
    expect((await holder(0)).updatedAt).toBe(50);
  });

  it('ends at the latest choice even when it runs once, after several changes', async () => {
    await user('third').set({ status: 'active', role: 'manager', admin: false, approverUid: null });
    await user(owner).update({ approverUid: 'third' });
    await handOverWaitingWeeks(owner);
    expect((await holder(0)).approverUid).toBe('third');
  });

  it('leaves the week where it is when nobody is chosen', async () => {
    await user(owner).update({ approverUid: null });
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(0);
    expect(await holder(0)).toEqual(sheet(0, 'submitted'));
  });

  it('never passes a week to someone who may not approve', async () => {
    await user('new').update({ role: 'member' });
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(0);
    await user('new').update({ role: 'manager', status: 'disabled' });
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(0);
    await user(owner).update({ approverUid: 'nobody-by-this-id' });
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(0);
    expect((await holder(0)).approverUid).toBe('old');
  });

  it("gives an admin's waiting weeks to themself when they chose nobody", async () => {
    await user(owner).update({ approverUid: null, admin: true });
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(2);
    expect((await holder(0)).approverUid).toBe(owner);
  });

  it('a former approver losing the role leaves the weeks with them, to be chosen again', async () => {
    await user(owner).update({ approverUid: 'old' });
    await handOverWaitingWeeks(owner);
    await user('old').update({ role: 'member' });
    await clearIneligibleApproverPointers('old');
    expect((await user(owner).get()).data()?.approverUid).toBeNull();
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(0);
    expect((await holder(0)).approverUid).toBe('old');
    await user(owner).update({ approverUid: 'new' });
    expect((await handOverWaitingWeeks(owner)).moved).toHaveLength(2);
    expect((await holder(0)).approverUid).toBe('new');
  });

  it('a week is either approved by the old approver or moved, never both', async () => {
    const waiting = sheet(0, 'submitted');
    const approval = approveReviewed({
      uid: owner, periodKey: waiting.periodKey, sheetVersion: timesheetRevision(waiting),
      entriesVersion: timesheetEntriesVersion([]), reviewVersion: timesheetReviewVersion(undefined),
    }, 'old', 'manager');
    const [approved] = await Promise.allSettled([approval, handOverWaitingWeeks(owner)]);
    const after = await holder(0);
    if (approved.status === 'fulfilled') {
      expect(after).toMatchObject({ status: 'approved', decidedBy: 'old', approverUid: 'old' });
    } else {
      expect(after).toMatchObject({ status: 'submitted', approverUid: 'new' });
      expect(approved.reason).toMatchObject({ message: 'This timesheet is now with another approver.' });
    }
  });

  it('the one who has a week cannot approve it once its person has chosen someone else', async () => {
    const waiting = sheet(0, 'submitted');
    const approve = () => approveReviewed({
      uid: owner, periodKey: waiting.periodKey, sheetVersion: timesheetRevision(waiting),
      entriesVersion: timesheetEntriesVersion([]), reviewVersion: timesheetReviewVersion(undefined),
    }, 'old', 'manager');
    await expect(approve()).rejects.toMatchObject({ message: 'This timesheet is now with another approver.' });
    await user(owner).update({ approverUid: null });
    await approve();
    expect(await holder(0)).toMatchObject({ status: 'approved', decidedBy: 'old' });
  });

  it('reports the weeks left with someone who may no longer approve them', async () => {
    await user('old').update({ role: 'member' });
    await user(owner).update({ approverUid: null });
    const result = await handOverWaitingWeeks(owner);
    expect(result).toMatchObject({ to: null, moved: [] });
    expect(result.stuck.map((w) => w.id)).toEqual([ref(0).id, ref(1).id]);
  });
});

describe('what a profile change sets off', () => {
  const profile = async (uid: string) => (await user(uid).get()).data() as UserDoc;
  /** Change a profile and follow it, as the trigger does, at event time `at`. */
  async function change(uid: string, fields: Partial<UserDoc>, at: number) {
    const before = await profile(uid);
    await user(uid).update(fields);
    return followProfileChange(uid, before, await profile(uid), at);
  }

  it('one push to the new approver for all the weeks passed to them', async () => {
    await user(owner).update({ approverUid: 'old', displayName: 'Member' });
    const pushes = await change(owner, { approverUid: 'new' }, 100);
    expect(pushes).toEqual([{ to: 'new', notif: expect.objectContaining({ title: '2 timesheets passed to you' }) }]);
    expect((await holder(1)).approverUid).toBe('new');
  });

  it('a retry of the same event still sends the push its first attempt committed', async () => {
    await handOverWaitingWeeks(owner, { now: 100 });
    const before = await profile(owner);
    const pushes = await followProfileChange(owner, { ...before, approverUid: 'old' }, before, 100);
    expect(pushes).toEqual([{ to: 'new', notif: expect.objectContaining({ title: '2 timesheets passed to you' }) }]);
    expect(await followProfileChange(owner, { ...before, approverUid: 'old' }, before, 200)).toEqual([]);
  });

  it('nothing for a change that leaves the choice and the roles alone', async () => {
    expect(await change(owner, { timeZone: 'UTC' }, 100)).toEqual([]);
    expect((await holder(0)).approverUid).toBe('old');
  });

  it('tells the person once, when their weeks become ones nobody can approve', async () => {
    await user('old').update({ role: 'member' });
    expect(await change(owner, { approverUid: null }, 100))
      .toEqual([{ to: owner, notif: expect.objectContaining({ title: 'Choose a new approver' }) }]);
    expect(await change(owner, { role: 'manager' }, 200)).toEqual([]);
    expect((await holder(0)).stuckSince).toBe(100);
  });

  it('tells the person when the one who has their week loses the role, whoever they chose', async () => {
    await user(owner).update({ approverUid: null });
    expect(await change('old', { role: 'member' }, 100))
      .toEqual([{ to: owner, notif: expect.objectContaining({ title: 'Choose a new approver' }) }]);
  });

  it('tells an admin whose own weeks nobody can approve once they stop being one', async () => {
    await user(owner).update({ admin: true, approverUid: null });
    await handOverWaitingWeeks(owner);
    expect(await change(owner, { admin: false }, 100))
      .toEqual([{ to: owner, notif: expect.objectContaining({ title: 'Choose a new approver' }) }]);
  });

  it('a week approvable again loses its mark, so a later episode is told anew', async () => {
    await user('old').update({ role: 'member' });
    await change(owner, { approverUid: null }, 100);
    await change('old', { role: 'manager' }, 200);
    expect((await holder(0)).stuckSince).toBeUndefined();
    expect(await change('old', { role: 'member' }, 300)).toHaveLength(1);
  });

  it("an admin's own weeks come back to them when they are enabled again", async () => {
    await user(owner).update({ admin: true, approverUid: null, status: 'disabled' });
    await user('old').update({ role: 'member' });
    expect((await handOverWaitingWeeks(owner)).moved).toEqual([]);
    await change(owner, { status: 'active' }, 100);
    expect((await holder(0)).approverUid).toBe(owner);
  });

  it('weeks of those who chose someone follow them when they may approve again', async () => {
    await user('new').update({ role: 'member' });
    expect((await handOverWaitingWeeks(owner)).moved).toEqual([]);
    await change('new', { role: 'manager' }, 100);
    expect((await holder(0)).approverUid).toBe('new');
  });
});
