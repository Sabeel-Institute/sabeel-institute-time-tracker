import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import type { ReportPlatform, ReportProblemInput, ReportProblemResult } from '@sabeel/shared';
import { BUILD_INFO } from './build-info';
import { functions } from './firebase';

/**
 * "Report a problem", the app's side: send the text to the reportProblem
 * callable (functions/src/reportProblem.ts), which keeps it and emails it to
 * the institute's administrators. The platform and version go with it so an
 * administrator can tell which build someone was looking at.
 */
const reportProblemFn = httpsCallable<ReportProblemInput, ReportProblemResult>(functions, 'reportProblem');

export async function sendProblemReport(text: string): Promise<ReportProblemResult['mail']> {
  const res = await reportProblemFn({
    text,
    platform: Platform.OS as ReportPlatform,
    appVersion: BUILD_INFO.version,
  });
  return res.data.mail;
}

/**
 * What the person reads after Send. A report that was kept but whose email did
 * not leave is still a report: the administrators see it in the record.
 */
export const SENT_MESSAGE = 'Sent. An administrator will reply by email within a day.';
export const KEPT_NOT_EMAILED =
  'Your report was saved but the email did not go out; it will be looked at.';

/**
 * A failed send, in a sentence. The server's refusals already are one
 * (empty, too long, five an hour, an account that is not active); anything
 * else is the connection or the server, and says so.
 */
export function explainReportError(e: unknown): string {
  const { code, message } = (e ?? {}) as { code?: string; message?: string };
  const theirs = [
    'functions/invalid-argument',
    'functions/resource-exhausted',
    'functions/permission-denied',
    'functions/unauthenticated',
  ];
  if (code && theirs.includes(code) && message) return message;
  return 'Your report could not be sent. Check your connection and try again.';
}

/**
 * The unsent draft, kept while the person goes Back and returns: the screen
 * unmounts on Back, and what they typed must not go with it. In memory for
 * this session only, and only for the account that wrote it, so the next
 * person signing in on a shared device starts with an empty field.
 */
let draft: { uid: string; text: string } | null = null;

export function readReportDraft(uid: string): string {
  return draft?.uid === uid ? draft.text : '';
}

export function keepReportDraft(uid: string, text: string): void {
  draft = text ? { uid, text } : null;
}
