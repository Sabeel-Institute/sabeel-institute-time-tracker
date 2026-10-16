import { describe, it, expect, afterEach } from 'vitest';
import { REPORT_MAIL } from '@sabeel/shared';
import { GMAIL_SEND_SCOPE, sendAsUser, TOKEN_AUDIENCE, type GoogleEndpoints } from '../../src/gmail';
import { gmailMailer } from '../../src/reportProblem';
import { closeFakeGoogles, fakeGoogle } from '../fakeGoogle';

/**
 * What the reports group is promised: the email leaves as the no-reply user,
 * by delegation, with nothing but the right to send mail, and carries exactly
 * the message that was composed. Google cannot be reached from a test, so one
 * local server stands in for its three endpoints (IAM Credentials, the token
 * endpoint, Gmail; `test/fakeGoogle.ts`), records every request, and answers
 * what Google answers.
 * The code under test is the production code, fetch and all.
 *
 * Not covered here, because only Google can say: that the Workspace admin
 * console authorises the service account for `gmail.send`, and that the
 * runtime service account holds Token Creator on it. Both were proved by
 * hand on 2026-10-16 (a test email reached apps-reports@); docs/DEPLOY.md
 * has the grant.
 */

afterEach(closeFakeGoogles);

const SA = 'report-mailer@sabeel-institute-time-tracker.iam.gserviceaccount.com';
const MESSAGE = 'From: x\r\nTo: y\r\nSubject: z\r\n\r\nBody, with Arabic: السلام عليكم\r\n';

const NOW = Date.UTC(2026, 9, 16, 20, 0, 0);
const send = (endpoints: GoogleEndpoints) =>
  sendAsUser(MESSAGE, {
    serviceAccount: SA,
    user: REPORT_MAIL.from.address,
    accessToken: async () => 'adc-token',
    endpoints,
    now: () => NOW,
  });

describe('sending as the no-reply user', () => {
  it('signs a delegation for that user, for sending mail only, with the function’s own identity', async () => {
    const google = await fakeGoogle();
    await send(google.endpoints);
    expect(google.seen.signJwt).toHaveLength(1);
    const [sign] = google.seen.signJwt;
    expect(decodeURIComponent(sign.path)).toBe(`/iam/v1/projects/-/serviceAccounts/${SA}:signJwt`);
    expect(sign.headers.authorization).toBe('Bearer adc-token');
    const claims = JSON.parse((JSON.parse(sign.body) as { payload: string }).payload) as Record<string, unknown>;
    expect(claims).toEqual({
      iss: SA,
      sub: 'apps-noreply@oursabeel.com',
      scope: GMAIL_SEND_SCOPE,
      aud: TOKEN_AUDIENCE,
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });
    expect(GMAIL_SEND_SCOPE).toBe('https://www.googleapis.com/auth/gmail.send');
    expect(TOKEN_AUDIENCE).toBe('https://oauth2.googleapis.com/token');
  });

  it('exchanges exactly the signed delegation for a token', async () => {
    const google = await fakeGoogle();
    await send(google.endpoints);
    expect(google.seen.token).toHaveLength(1);
    const [exchange] = google.seen.token;
    expect(exchange.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(exchange.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const signed = google.seen.signJwt[0];
    const payload = (JSON.parse(signed.body) as { payload: string }).payload;
    expect(form.get('assertion')).toBe(`hdr.${Buffer.from(payload).toString('base64url')}.sig`);
  });

  it('sends the message, byte for byte, with the delegated token, and answers Gmail’s id', async () => {
    const google = await fakeGoogle();
    await expect(send(google.endpoints)).resolves.toEqual({ messageId: 'msg-123' });
    expect(google.seen.gmail).toHaveLength(1);
    const [gmail] = google.seen.gmail;
    expect(gmail.headers.authorization).toBe('Bearer delegated-token');
    const raw = (JSON.parse(gmail.body) as { raw: string }).raw;
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toBe(MESSAGE);
  });

  it('the report mailer sends as apps-noreply@ and reports what Gmail answered', async () => {
    const google = await fakeGoogle();
    const mailer = gmailMailer(SA, async () => 'adc-token', google.endpoints);
    await expect(mailer({ raw: MESSAGE, subject: 'z', text: 'Body' })).resolves.toEqual({ status: 'sent', messageId: 'msg-123' });
    const claims = JSON.parse((JSON.parse(google.seen.signJwt[0].body) as { payload: string }).payload) as {
      sub: string;
    };
    expect(claims.sub).toBe(REPORT_MAIL.from.address);
  });
});

/*
 * A REFUSAL NAMES ITS STEP AND GOOGLE'S REASON, and nothing after it runs.
 * The reason is what lands on the report record (`mail.error`) and in the
 * log, so "the grant is missing" must read as that, not as a bare 403.
 */
describe('when Google refuses', () => {
  it('a missing Token Creator grant stops at signing, and says so', async () => {
    const google = await fakeGoogle({
      step: 'signJwt',
      status: 403,
      body: { error: { code: 403, message: "Permission 'iam.serviceAccounts.signJwt' denied on resource", status: 'PERMISSION_DENIED' } },
    });
    await expect(send(google.endpoints)).rejects.toThrow(
      "Signing the delegation token refused (HTTP 403): Permission 'iam.serviceAccounts.signJwt' denied on resource",
    );
    expect(google.seen.token).toHaveLength(0);
    expect(google.seen.gmail).toHaveLength(0);
  });

  it('a delegation the Workspace has not authorised stops at the exchange, and says so', async () => {
    const google = await fakeGoogle({
      step: 'token',
      status: 401,
      body: { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method.' },
    });
    await expect(send(google.endpoints)).rejects.toThrow(
      'Exchanging the delegation token refused (HTTP 401): unauthorized_client: Client is unauthorized',
    );
    expect(google.seen.gmail).toHaveLength(0);
  });

  it('a message Gmail will not send fails with Gmail’s reason', async () => {
    const google = await fakeGoogle({
      step: 'gmail',
      status: 400,
      body: { error: { code: 400, message: 'Invalid To header', status: 'INVALID_ARGUMENT' } },
    });
    await expect(send(google.endpoints)).rejects.toThrow('Sending through Gmail refused (HTTP 400): Invalid To header');
  });
});
