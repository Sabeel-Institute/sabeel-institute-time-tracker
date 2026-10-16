// PERMANENT post-deploy verification: runs every query shape the app uses
// against PROD Firestore and reports which ones the server rejects. The
// emulator does NOT enforce composite indexes, so a missing/wrong-direction
// index is invisible to the whole local test suite — this probe is the only
// way to see it before users do (learned the hard way: the dayKey indexes
// were deployed DESCENDING while every query needs ASCENDING, and all local
// tests were green — docs/POSTMORTEM-2026-07-16-stale-week.md).
//
// Run after ANY change to firestore.indexes.json or to a query shape:
//   curl "https://us-central1-<project>.cloudfunctions.net/probeQueries?token=$PROBE_TOKEN"
// Keep this file's shapes in sync with the queries in app/src and functions/src.
import { onRequest } from 'firebase-functions/v2/https';
import { Filter, getFirestore, type Query } from 'firebase-admin/firestore';

export const probeQueries = onRequest(async (req, res) => {
  if (!process.env.PROBE_TOKEN || req.query.token !== process.env.PROBE_TOKEN) {
    res.status(403).send('Forbidden.\n');
    return;
  }
  const db = getFirestore();
  const shapes: Record<string, Query> = {
    'entries uid==, dayKey range (timesheet week view)': db
      .collection('timeEntries')
      .where('uid', '==', 'probe')
      .where('dayKey', '>=', '2026-07-12')
      .where('dayKey', '<=', '2026-07-18'),
    'entries uid==, dayKey range, orderBy dayKey (reports person filter)': db
      .collection('timeEntries')
      .where('uid', '==', 'probe')
      .where('dayKey', '>=', '2026-07-01')
      .where('dayKey', '<=', '2026-07-31')
      .orderBy('dayKey'),
    'entries activityId==, dayKey range, orderBy dayKey': db
      .collection('timeEntries')
      .where('activityId', '==', 'probe')
      .where('dayKey', '>=', '2026-07-01')
      .where('dayKey', '<=', '2026-07-31')
      .orderBy('dayKey'),
    'entries uid==, activityId==, dayKey range, orderBy dayKey': db
      .collection('timeEntries')
      .where('uid', '==', 'probe')
      .where('activityId', '==', 'probe')
      .where('dayKey', '>=', '2026-07-01')
      .where('dayKey', '<=', '2026-07-31')
      .orderBy('dayKey'),
    'timesheets uid==, periodKey range (month strip)': db
      .collection('timesheets')
      .where('uid', '==', 'probe')
      .where('periodKey', '>=', '2026-07-01')
      .where('periodKey', '<=', '2026-07-31'),
    'timesheets status==approved, periodKey range (reporting)': db
      .collection('timesheets')
      .where('status', '==', 'approved')
      .where('periodKey', '>=', '2026-07-01')
      .where('periodKey', '<=', '2026-07-31'),
    'entries end==null, start<= (auto-close)': db
      .collection('timeEntries')
      .where('end', '==', null)
      .where('start', '<=', Date.now()),
    'timesheets approverUid==, status==submitted (approval queue)': db
      .collection('timesheets')
      .where('approverUid', '==', 'probe')
      .where('status', '==', 'submitted'),
    'timesheets uid==, status==rejected (needs-attention)': db
      .collection('timesheets')
      .where('uid', '==', 'probe')
      .where('status', '==', 'rejected'),
    'users approverUid== (clear pointers when eligibility is lost)': db
      .collection('users')
      .where('approverUid', '==', 'probe'),
    'users status==active (weekly reminder sweep)': db
      .collection('users')
      .where('status', '==', 'active'),
    'reports uid==, createdAt> (report a problem: five an hour)': db
      .collection('reports')
      .where('uid', '==', 'probe')
      .where('createdAt', '>', Date.now() - 60 * 60 * 1000),
    // No composite index needed (single-field OR); probed for query-shape regression.
    'users or(role==manager, admin==true) (approver choices)': db
      .collection('users')
      .where(Filter.or(Filter.where('role', '==', 'manager'), Filter.where('admin', '==', true))),
  };
  const lines: string[] = [];
  for (const [label, q] of Object.entries(shapes)) {
    try {
      await q.get();
      lines.push(`OK    ${label}`);
    } catch (e) {
      lines.push(`FAIL  ${label}\n      ${(e as Error).message}`);
    }
  }
  res.status(200).send(lines.join('\n') + '\n');
});
