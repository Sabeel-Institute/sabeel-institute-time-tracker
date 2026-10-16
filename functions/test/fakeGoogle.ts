import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { GoogleEndpoints } from '../src/gmail';

/**
 * A local stand-in for the three Google endpoints a report email goes
 * through (functions/src/gmail.ts): IAM Credentials' signJwt, the OAuth token
 * endpoint and Gmail's send. It records every request and answers what Google
 * answers, so the production code runs unchanged, fetch and all, against it
 * (`gmail.test.ts`, and `reportProblem.integration.test.ts` end to end).
 */

export interface Seen {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type Step = 'signJwt' | 'token' | 'gmail';

const opened: { close: () => Promise<void> }[] = [];

/** Close every stand-in a test opened; for afterEach. */
export async function closeFakeGoogles(): Promise<void> {
  await Promise.all(opened.splice(0).map((s) => s.close()));
}

/** Google, as far as these three calls go. `refuse` makes one step answer as Google refuses. */
export async function fakeGoogle(refuse?: { step: Step; status: number; body: unknown }) {
  const seen: Record<Step, Seen[]> = { signJwt: [], token: [], gmail: [] };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const path = req.url ?? '';
      const step: Step | null = /^\/iam\/v1\/projects\/-\/serviceAccounts\/[^/]+:signJwt$/.test(path)
        ? 'signJwt'
        : path === '/oauth/token'
          ? 'token'
          : path === '/gmail/gmail/v1/users/me/messages/send'
            ? 'gmail'
            : null;
      const answer = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (!step) return answer(404, { error: { message: `no such endpoint ${path}` } });
      seen[step].push({ path, headers: req.headers, body });
      if (refuse?.step === step) return answer(refuse.status, refuse.body);
      if (step === 'signJwt') {
        const payload = (JSON.parse(body) as { payload: string }).payload;
        return answer(200, { keyId: 'k1', signedJwt: `hdr.${Buffer.from(payload).toString('base64url')}.sig` });
      }
      if (step === 'token') return answer(200, { access_token: 'delegated-token', expires_in: 3599, token_type: 'Bearer' });
      return answer(200, { id: 'msg-123', threadId: 'thr-1', labelIds: ['SENT'] });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  opened.push({ close: () => new Promise<void>((r) => server.close(() => r())) });
  const endpoints: GoogleEndpoints = {
    iamCredentials: `${origin}/iam`,
    oauthToken: `${origin}/oauth/token`,
    gmail: `${origin}/gmail`,
  };
  return { seen, endpoints };
}
