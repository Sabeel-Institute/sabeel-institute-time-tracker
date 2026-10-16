import './setup';
import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { onUserCreate } from './authTrigger';
export { accountExists } from './accountExists';
export { setUserAccess } from './users';
export { exportCsv, reportTotals } from './reporting';
export { autoCloseStaleSessions } from './sessions';
export { healthCheck } from './health';
export { notifyNewUser, notifyTimesheet, weeklyReminder } from './notify';
export { onTimesheetWritten } from './timesheetAudit';
// Post-deploy index/query verification (token-guarded; see probe.ts).
export { probeQueries } from './probe';
