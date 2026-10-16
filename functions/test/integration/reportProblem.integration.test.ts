import { describe, it, beforeAll, afterEach, expect } from 'vitest';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  APP_NAME,
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  PASSWORD_ACCOUNT_EMAIL,
  REPORT_MAX_LENGTH,
  REPORTS_PER_HOUR,
  type ReportDoc,
} from '@sabeel/shared';
import { gmailMailer, submitProblemReport, TOO_MANY_REPORTS, type ReportMailer } from '../../src/reportProblem';
import { closeFakeGoogles, fakeGoogle } from '../fakeGoogle';

/**
 * What "Report a problem" promises, asserted where the promise lives: in the
 * reports STORED (`reports`, counted after each call) and the emails SENT (a
 * recording mailer, which sees exactly what Gmail would be given).
 *
 *  - an account that may not report stores nothing and sends nothing;
 *  - an active account's report is stored once and emailed once, to the
 *    reports group, with Reply-To set to the person;
 *  - the sixth within an hour is refused, and nothing is stored or sent;
 *  - a failed send keeps the report, says it failed, and is not retried.
 *
 * Runs under `firebase emulators:exec` against Firestore (the first pass of
 * scripts/test-emulator.sh), driving the callable's whole decision,
 * `submitProblemReport`, with the request a callable would receive.
 */

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: EMULATOR_PROJECT_ID });
});
afterEach(closeFakeGoogles);

const freshUid = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function profile(uid: string, displayName: string, email: string) {
  await getFirestore().collection(COLLECTIONS.users).doc(uid).set({
    displayName,
    email,
    photoURL: null,
    status: 'active',
    role: 'member',
    admin: false,
    activeEntryId: null,
    approverUid: null,
    createdAt: Date.now(),
  });
}

type Provider = 'google.com' | 'password';
function caller(
  uid: string,
  email: string,
  claims: Record<string, unknown>,
  data: unknown,
  provider: Provider = 'google.com',
): CallableRequest {
  return {
    auth: { uid, token: { ...claims, email, firebase: { sign_in_provider: provider } } },
    data,
    rawRequest: {},
  } as unknown as CallableRequest;
}
const signedOut = (data: unknown) => ({ auth: undefined, data, rawRequest: {} }) as unknown as CallableRequest;

const ACTIVE = { status: 'active', role: 'member', admin: false };

/** A mailer that records what it was given and answers as Gmail does. */
function recorder(): { sent: string[]; mailer: ReportMailer } {
  const sent: string[] = [];
  return {
    sent,
    mailer: async (message) => {
      sent.push(message);
      return { status: 'sent', messageId: `msg-${sent.length}` };
    },
  };
}

const stored = async (uid: string) =>
  (await getFirestore().collection(COLLECTIONS.reports).where('uid', '==', uid).get()).docs.map(
    (d) => ({ id: d.id, ...(d.data() as ReportDoc) }),
  );

/** The headers of a composed message, unfolded. */
function headersOf(message: string): Record<string, string> {
  const head = message.slice(0, message.indexOf('\r\n\r\n')).replace(/\r\n[ \t]/g, ' ');
  return Object.fromEntries(
    head.split('\r\n').map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]),
  );
}

const TEXT = 'The note on my Tuesday entry was changed by someone else.';

describe('who may report', () => {
  it('nobody signed out, pending, disabled, or holding a password session for another address: nothing stored, nothing sent', async () => {
    const uid = freshUid('refused');
    await profile(uid, 'Refused', `${uid}@oursabeel.com`);
    const { sent, mailer } = recorder();
    const attempts: [string, CallableRequest, string][] = [
      ['signed out', signedOut({ text: TEXT }), 'unauthenticated'],
      ['pending', caller(uid, `${uid}@oursabeel.com`, { ...ACTIVE, status: 'pending' }, { text: TEXT }), 'permission-denied'],
      ['disabled', caller(uid, `${uid}@oursabeel.com`, { ...ACTIVE, status: 'disabled' }, { text: TEXT }), 'permission-denied'],
      [
        'a password session for another address',
        caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT }, 'password'),
        'unauthenticated',
      ],
    ];
    for (const [who, req, code] of attempts) {
      await expect(submitProblemReport(req, mailer), who).rejects.toMatchObject({ code });
    }
    expect(await stored(uid)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('the review account through the email door reports, as an ordinary member whatever its claims', async () => {
    const uid = freshUid('reviewer');
    await profile(uid, 'App Review', PASSWORD_ACCOUNT_EMAIL);
    const { sent, mailer } = recorder();
    const req = caller(uid, PASSWORD_ACCOUNT_EMAIL, { status: 'active', role: 'manager', admin: true }, { text: TEXT }, 'password');
    await expect(submitProblemReport(req, mailer)).resolves.toMatchObject({ mail: 'sent' });
    const [report] = await stored(uid);
    expect(report.role).toBe('member');
    expect(sent).toHaveLength(1);
  });
});

describe('an active account’s report', () => {
  it('is stored once and emailed once, to the reports group, with Reply-To the reporter', async () => {
    const uid = freshUid('member');
    const email = `${uid}@oursabeel.com`;
    await profile(uid, 'Fatima Abdul-Rahman', email);
    const { sent, mailer } = recorder();
    const before = Date.now();
    const result = await submitProblemReport(
      caller(uid, email, ACTIVE, { text: `  ${TEXT}\n`, platform: 'android', appVersion: '0.29.0' }),
      mailer,
    );

    const reports = await stored(uid);
    expect(reports).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const [report] = reports;
    expect(result).toEqual({ id: report.id, mail: 'sent' });
    expect(report).toMatchObject({
      app: APP_NAME,
      uid,
      displayName: 'Fatima Abdul-Rahman',
      email,
      role: 'member',
      text: TEXT,
      platform: 'android',
      appVersion: '0.29.0',
      mail: { status: 'sent', messageId: 'msg-1' },
    });
    expect(report.createdAt).toBeGreaterThanOrEqual(before);
    expect(report.createdAt).toBeLessThanOrEqual(Date.now());

    const h = headersOf(sent[0]);
    expect(h.to).toBe('apps-reports@oursabeel.com');
    expect(h['reply-to']).toBe(`Fatima Abdul-Rahman <${email}>`);
    expect(h.from).toBe('Sabeel Apps No Reply <apps-noreply@oursabeel.com>');
  });

  it('records what the person may do', async () => {
    const uid = freshUid('admin');
    await profile(uid, 'Admin', `${uid}@oursabeel.com`);
    const { mailer } = recorder();
    await submitProblemReport(caller(uid, `${uid}@oursabeel.com`, { status: 'active', role: 'manager', admin: true }, { text: TEXT }), mailer);
    expect((await stored(uid))[0].role).toBe('admin');
  });

  it('without platform or version (or with them null, as a callable sends an unset field) stores neither', async () => {
    const uid = freshUid('bare');
    await profile(uid, 'Bare', `${uid}@oursabeel.com`);
    const { mailer } = recorder();
    await submitProblemReport(caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT, platform: null, appVersion: null }), mailer);
    const [report] = await stored(uid);
    expect(report).not.toHaveProperty('platform');
    expect(report).not.toHaveProperty('appVersion');
  });
});

describe('a report that cannot be accepted: nothing stored, nothing sent', () => {
  it.each([
    ['empty', ''],
    ['only spaces', '   \n\t '],
    ['too long', 'x'.repeat(REPORT_MAX_LENGTH + 1)],
    ['not text', 42],
  ])('%s', async (_what, text) => {
    const uid = freshUid('invalid');
    await profile(uid, 'Invalid', `${uid}@oursabeel.com`);
    const { sent, mailer } = recorder();
    await expect(submitProblemReport(caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text }), mailer)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(await stored(uid)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('the longest allowed report is accepted', async () => {
    const uid = freshUid('longest');
    await profile(uid, 'Longest', `${uid}@oursabeel.com`);
    const { mailer } = recorder();
    await submitProblemReport(caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: 'x'.repeat(REPORT_MAX_LENGTH) }), mailer);
    expect(await stored(uid)).toHaveLength(1);
  });

  it('an unknown platform or an unreadable version', async () => {
    const uid = freshUid('context');
    await profile(uid, 'Context', `${uid}@oursabeel.com`);
    const { sent, mailer } = recorder();
    for (const data of [{ text: TEXT, platform: 'windows' }, { text: TEXT, appVersion: '1.0-beta<script>' }]) {
      await expect(submitProblemReport(caller(uid, `${uid}@oursabeel.com`, ACTIVE, data), mailer)).rejects.toMatchObject({
        code: 'invalid-argument',
      });
    }
    expect(await stored(uid)).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe(`${REPORTS_PER_HOUR} reports an hour`, () => {
  it('the sixth within an hour is refused: nothing stored, nothing sent', async () => {
    const uid = freshUid('busy');
    await profile(uid, 'Busy', `${uid}@oursabeel.com`);
    const { sent, mailer } = recorder();
    const req = caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT });
    for (let i = 0; i < REPORTS_PER_HOUR; i += 1) await submitProblemReport(req, mailer);
    expect(await stored(uid)).toHaveLength(REPORTS_PER_HOUR);

    await expect(submitProblemReport(req, mailer)).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: TOO_MANY_REPORTS,
    });
    expect(await stored(uid)).toHaveLength(REPORTS_PER_HOUR);
    expect(sent).toHaveLength(REPORTS_PER_HOUR);
  });

  it('reports older than an hour no longer count', async () => {
    const uid = freshUid('later');
    await profile(uid, 'Later', `${uid}@oursabeel.com`);
    const old = Date.now() - 61 * 60 * 1000;
    for (let i = 0; i < REPORTS_PER_HOUR; i += 1) {
      await getFirestore().collection(COLLECTIONS.reports).add({ uid, text: 'old', createdAt: old, mail: { status: 'sent', messageId: 'm' } });
    }
    const { sent, mailer } = recorder();
    await expect(submitProblemReport(caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT }), mailer)).resolves.toMatchObject({
      mail: 'sent',
    });
    expect(sent).toHaveLength(1);
  });

  it('counts each person’s own reports, not everyone’s', async () => {
    const busy = freshUid('other');
    const me = freshUid('me');
    await profile(me, 'Me', `${me}@oursabeel.com`);
    for (let i = 0; i < REPORTS_PER_HOUR; i += 1) {
      await getFirestore().collection(COLLECTIONS.reports).add({ uid: busy, text: 'x', createdAt: Date.now(), mail: { status: 'sent', messageId: 'm' } });
    }
    const { mailer } = recorder();
    await expect(submitProblemReport(caller(me, `${me}@oursabeel.com`, ACTIVE, { text: TEXT }), mailer)).resolves.toMatchObject({
      mail: 'sent',
    });
  });
});

describe('when the email does not go out', () => {
  it('the report is kept, marked failed with the reason, and the person is told; nothing retries', async () => {
    const uid = freshUid('unsent');
    await profile(uid, 'Unsent', `${uid}@oursabeel.com`);
    let attempts = 0;
    const failing: ReportMailer = async () => {
      attempts += 1;
      throw new Error('Sending through Gmail refused (HTTP 503): Backend Error');
    };
    const result = await submitProblemReport(caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT }), failing);
    expect(result.mail).toBe('failed');
    const reports = await stored(uid);
    expect(reports).toHaveLength(1);
    expect(reports[0].mail).toEqual({ status: 'failed', error: 'Sending through Gmail refused (HTTP 503): Backend Error' });
    expect(attempts).toBe(1);
  });
});

/*
 * THE REAL SEND PATH, end to end: the production mailer, fetch and all,
 * against a local stand-in for Google's three endpoints (test/fakeGoogle.ts).
 */
describe('through the Gmail mailer, against a local Google', () => {
  const SA = 'report-mailer@demo.iam.gserviceaccount.com';

  it('records Gmail’s message id, and Gmail is given the composed report', async () => {
    const uid = freshUid('gmail');
    await profile(uid, 'Gmail Path', `${uid}@oursabeel.com`);
    const google = await fakeGoogle();
    const result = await submitProblemReport(
      caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT }),
      gmailMailer(SA, async () => 'adc-token', google.endpoints),
    );
    expect(result.mail).toBe('sent');
    const [report] = await stored(uid);
    expect(report.mail).toEqual({ status: 'sent', messageId: 'msg-123' });
    expect(google.seen.gmail).toHaveLength(1);
    const raw = Buffer.from((JSON.parse(google.seen.gmail[0].body) as { raw: string }).raw, 'base64url').toString('utf8');
    expect(headersOf(raw)['reply-to']).toBe(`Gmail Path <${uid}@oursabeel.com>`);
  });

  it('a missing grant leaves the report failed with Google’s reason, and nothing else sent', async () => {
    const uid = freshUid('nogrant');
    await profile(uid, 'No Grant', `${uid}@oursabeel.com`);
    const google = await fakeGoogle({
      step: 'signJwt',
      status: 403,
      body: { error: { code: 403, message: "Permission 'iam.serviceAccounts.signJwt' denied", status: 'PERMISSION_DENIED' } },
    });
    const result = await submitProblemReport(
      caller(uid, `${uid}@oursabeel.com`, ACTIVE, { text: TEXT }),
      gmailMailer(SA, async () => 'adc-token', google.endpoints),
    );
    expect(result.mail).toBe('failed');
    const [report] = await stored(uid);
    expect(report.mail).toEqual({
      status: 'failed',
      error: "Signing the delegation token refused (HTTP 403): Permission 'iam.serviceAccounts.signJwt' denied",
    });
    expect(google.seen.gmail).toHaveLength(0);
  });
});
