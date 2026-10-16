import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleAuth } from 'google-auth-library';
import {
  APP_NAME,
  COLLECTIONS,
  parseReportInput,
  REPORT_MAIL,
  REPORTS_PER_HOUR,
  type ReportDoc,
  type ReportMail,
  type ReportProblemResult,
  type UserDoc,
} from '@sabeel/shared';
import { requireActive, roleOf } from './auth';
import { composeReportEmail, type ReportEmail } from './reportMail';
import { sendAsUser, type GoogleEndpoints } from './gmail';
import { guarded, reportError, sentryDsn } from './sentry';

/**
 * "Report a problem" (the `sabeel-app-stores` skill, decision 4): what a
 * person writes reaches the institute's administrators by email, from
 * `apps-noreply@` to `apps-reports@` with Reply-To set to them, and is kept as
 * `reports/{id}`. Nobody reviews reports inside the app; the administrators
 * answer by email and act through the app's ordinary admin screens.
 *
 * The order is the promise: an account that may not report stores nothing and
 * sends nothing; a report is stored BEFORE the email is tried, so a failed
 * send still leaves the record (`mail.status: 'failed'`) and the person is told
 * so; nothing retries by itself, so nobody is emailed twice.
 */

/** What a send did. A mailer throws when the email did not go out. */
export type MailOutcome = { status: 'sent'; messageId: string } | { status: 'skipped' };
export type ReportMailer = (email: ReportEmail) => Promise<MailOutcome>;

const HOUR_MS = 60 * 60 * 1000;

export const TOO_MANY_REPORTS =
  `You have sent ${REPORTS_PER_HOUR} reports in the last hour, which is as many as the app ` +
  'takes in an hour. Please try again later.';

/**
 * The callable's whole decision, with the mailer passed in: the integration
 * tests drive this with a recording mailer, or with the real Gmail mailer
 * pointed at a local stand-in for Google.
 */
export async function submitProblemReport(req: CallableRequest, mailer: ReportMailer): Promise<ReportProblemResult> {
  // Signed in, active, and (for a password session) the one allowed address.
  // Pending, disabled and refused accounts stop here, before anything is read.
  const uid = requireActive(req);
  const parsed = parseReportInput(req.data);
  if ('refusal' in parsed) throw new HttpsError('invalid-argument', parsed.refusal);

  const db = getFirestore();
  const token = (req.auth?.token ?? {}) as { email?: string; name?: string };
  const profile = (await db.collection(COLLECTIONS.users).doc(uid).get()).data() as UserDoc | undefined;
  const now = Date.now();
  const report: ReportDoc = {
    app: APP_NAME,
    uid,
    displayName: profile?.displayName || token.name || '(no name)',
    email: token.email ?? profile?.email ?? '',
    role: roleOf(req),
    text: parsed.input.text,
    createdAt: now,
    ...(parsed.input.platform ? { platform: parsed.input.platform } : {}),
    ...(parsed.input.appVersion ? { appVersion: parsed.input.appVersion } : {}),
    mail: { status: 'pending' },
  };

  // Counted from what is stored, and in the same transaction as the write: a
  // count read outside it would let two reports sent together both see four.
  const ref = db.collection(COLLECTIONS.reports).doc();
  await db.runTransaction(async (tx) => {
    const lastHour = await tx.get(
      db.collection(COLLECTIONS.reports).where('uid', '==', uid).where('createdAt', '>', now - HOUR_MS),
    );
    if (lastHour.size >= REPORTS_PER_HOUR) throw new HttpsError('resource-exhausted', TOO_MANY_REPORTS);
    tx.create(ref, report);
  });

  let mail: Exclude<ReportMail, { status: 'pending' }>;
  try {
    mail = await mailer(composeReportEmail(ref.id, report));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`reportProblem: the email for ${COLLECTIONS.reports}/${ref.id} did not go out: ${error}`);
    mail = { status: 'failed', error };
    await reportError(e);
  }
  await ref.update({ mail });
  return { id: ref.id, mail: mail.status };
}

/** The production mailer: Gmail, as the no-reply user, by domain-wide delegation. */
export function gmailMailer(
  serviceAccount: string,
  accessToken: () => Promise<string>,
  endpoints?: GoogleEndpoints,
): ReportMailer {
  return async (email) => {
    const { messageId } = await sendAsUser(email.raw, {
      serviceAccount,
      user: REPORT_MAIL.from.address,
      accessToken,
      endpoints,
    });
    return { status: 'sent', messageId };
  };
}

/**
 * Under the emulator, send nothing: the record says `skipped`, and the subject
 * and the plain text go to the emulator's log for anyone checking what would
 * have been sent.
 */
const emulatorMailer: ReportMailer = async (email) => {
  console.log(`[emulator] report email not sent: ${email.subject}\n${email.text}`);
  return { status: 'skipped' };
};

/**
 * The service account that signs the delegation: a per-project parameter in
 * the committed `functions/.env.<project>` (the demo project's file has a
 * stand-in, never used, so the emulator never stops to ask).
 */
const REPORT_MAILER_SA = defineString('REPORT_MAILER_SA', {
  description: 'The service account that signs report emails’ delegation (report-mailer@<project>)',
});

/** The function's own identity (its runtime service account), for step 1 of the delegation. */
const adc = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
async function adcToken(): Promise<string> {
  const token = await adc.getAccessToken();
  if (!token) throw new Error('No access token from Application Default Credentials');
  return token;
}

export const reportProblem = onCall(
  { secrets: [sentryDsn] },
  guarded(async (req) =>
    submitProblemReport(
      req,
      // `FUNCTIONS_EMULATOR` is "true" under the emulator alone, never in a
      // deployed runtime (as messaging.ts chooses its push sender).
      process.env.FUNCTIONS_EMULATOR === 'true' ? emulatorMailer : gmailMailer(REPORT_MAILER_SA.value(), adcToken),
    ),
  ),
);
