/**
 * "Report a problem": what a person sends, what the server keeps, and where the
 * email goes. One contract for the app (app/src/problemReport.ts) and the
 * callable (functions/src/reportProblem.ts), so the two cannot disagree about
 * what a valid report is.
 *
 * The store decision behind it is the `sabeel-app-stores` skill's decision 4:
 * the report reaches the institute's administrators by email, who answer the
 * person directly; nobody reviews reports inside the app.
 */

/**
 * The addresses every Sabeel app's reports use. The sender is a Workspace user
 * nobody signs in to; each app's server sends as it through domain-wide
 * delegation (functions/src/gmail.ts). The recipient is a Workspace group of
 * the administrators who answer.
 */
export const REPORT_MAIL = {
  from: { name: 'Sabeel Apps No Reply', address: 'apps-noreply@oursabeel.com' },
  to: 'apps-reports@oursabeel.com',
} as const;

/**
 * The time zone a report email states its time in: where the administrators
 * who read it are. Only the email's wording; hours are never bucketed in it
 * (they keep the time zone the work happened in, and this app has no
 * organisation time zone).
 */
export const REPORT_EMAIL_TIME_ZONE = 'America/Chicago';

/** The longest report, in characters, after trimming. */
export const REPORT_MAX_LENGTH = 2000;

/** Reports one account may send in any hour; the server counts what it stored. */
export const REPORTS_PER_HOUR = 5;

export type ReportPlatform = 'android' | 'ios' | 'web';
const PLATFORMS: readonly ReportPlatform[] = ['android', 'ios', 'web'];

/** The role a report records: what the person may do in the app. */
export type ReportRole = 'admin' | 'manager' | 'member';

/** What the app sends. Platform and version are optional context. */
export interface ReportProblemInput {
  text: string;
  platform?: ReportPlatform;
  appVersion?: string;
}

/**
 * The email's fate, recorded on the report. `pending` only while the send is
 * in flight: a report left pending means the function stopped before it knew.
 * `skipped` is the emulator, which sends nothing.
 */
export type ReportMail =
  | { status: 'pending' }
  | { status: 'sent'; messageId: string }
  | { status: 'failed'; error: string }
  | { status: 'skipped' };

/** reports/{id}: written by the reportProblem callable, never by a client. */
export interface ReportDoc {
  app: string;
  uid: string;
  displayName: string;
  email: string;
  role: ReportRole;
  text: string;
  /** Epoch ms, the server's clock. */
  createdAt: number;
  platform?: ReportPlatform;
  appVersion?: string;
  mail: ReportMail;
}

/** What the callable answers: the report was kept, and whether the email left. */
export interface ReportProblemResult {
  id: string;
  mail: 'sent' | 'failed' | 'skipped';
}

/** An app version as app.json states it: three integers. */
const APP_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export const REPORT_EMPTY = 'Write what you are reporting before sending.';
export const REPORT_TOO_LONG = `A report can be at most ${REPORT_MAX_LENGTH} characters.`;

/** Whether a draft can be sent as it stands: the app's Send button. */
export function reportTextReady(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= REPORT_MAX_LENGTH;
}

/**
 * The server's reading of what the app sent: the trimmed text, and platform
 * and version only when they are well formed. A callable delivers an absent
 * optional field as `null`, so `null` is absent here. Returns a sentence for
 * the person when the report cannot be accepted.
 */
export function parseReportInput(data: unknown): { input: ReportProblemInput } | { refusal: string } {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.text !== 'string') return { refusal: REPORT_EMPTY };
  const text = d.text.trim();
  if (text.length === 0) return { refusal: REPORT_EMPTY };
  if (text.length > REPORT_MAX_LENGTH) return { refusal: REPORT_TOO_LONG };
  const input: ReportProblemInput = { text };
  if (d.platform != null) {
    if (!PLATFORMS.includes(d.platform as ReportPlatform)) return { refusal: 'The app sent an unknown platform.' };
    input.platform = d.platform as ReportPlatform;
  }
  if (d.appVersion != null) {
    if (typeof d.appVersion !== 'string' || !APP_VERSION.test(d.appVersion)) {
      return { refusal: 'The app sent an unreadable version.' };
    }
    input.appVersion = d.appVersion;
  }
  return { input };
}
