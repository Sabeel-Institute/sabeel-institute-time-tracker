import './setup';
import { initializeApp } from 'firebase-admin/app';

initializeApp();

export { onUserCreate } from './authTrigger';
export { accountExists } from './accountExists';
export { beforeSignUp, beforeSignIn } from './signInGate';
export { setUserAccess } from './users';
export { acceptRules } from './acceptRules';
export { reportProblem } from './reportProblem';
export { exportCsv, reportTotals } from './reporting';
export { autoCloseStaleSessions } from './sessions';
export { healthCheck } from './health';
export { notifyNewUser, notifyTimesheet, weeklyReminder } from './notify';
export { onTimesheetWritten } from './timesheetAudit';
// Post-deploy index/query verification (token-guarded; see probe.ts).
export { probeQueries } from './probe';
