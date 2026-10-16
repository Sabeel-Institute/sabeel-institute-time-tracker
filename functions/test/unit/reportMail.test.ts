import { describe, it, expect } from 'vitest';
import { APP_NAME, REPORT_MAIL, type ReportDoc } from '@sabeel/shared';
import { composeReportEmail } from '../../src/reportMail';

/**
 * What the administrators are promised: an email from the no-reply sender to
 * the reports group, that a Reply answers the person who reported, whose
 * subject names them, and whose body says who, when, from which app, and then
 * exactly what they wrote. Read back here the way a mail client reads it:
 * headers unfolded, RFC 2047 words decoded, the base64 body decoded.
 */

const CRLF = '\r\n';

/** RFC 2047: adjacent encoded-words join with no space; each decodes alone. */
function decodeWords(v: string): string {
  return v
    .replace(/(\?=)\s+(?==\?UTF-8\?B\?)/g, '$1')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
}

function read(message: string) {
  const at = message.indexOf(CRLF + CRLF);
  expect(at).toBeGreaterThan(0);
  const rawHead = message.slice(0, at);
  const lines = rawHead.replace(/\r\n[ \t]/g, ' ').split(CRLF);
  const headers = new Map<string, string[]>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    expect(colon, `not a header: ${line}`).toBeGreaterThan(0);
    const name = line.slice(0, colon).toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), decodeWords(line.slice(colon + 1).trim())]);
  }
  const one = (name: string) => {
    const v = headers.get(name.toLowerCase()) ?? [];
    expect(v, `${name} appears ${v.length} times`).toHaveLength(1);
    return v[0];
  };
  const encodedBody = message.slice(at + 4);
  const body = Buffer.from(encodedBody.replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { rawHead, headers, one, encodedBody, body };
}

const report = (over: Partial<ReportDoc> = {}): ReportDoc => ({
  app: APP_NAME,
  uid: 'uid-123',
  displayName: 'Fatima Abdul-Rahman',
  email: 'fatima@oursabeel.com',
  role: 'member',
  text: 'The note on my Tuesday entry was changed by someone else.',
  // 20:04 UTC on 16 October 2026: 15:04 in Chicago, where daylight time runs
  // until 1 November.
  createdAt: Date.UTC(2026, 9, 16, 20, 4),
  platform: 'android',
  appVersion: '0.29.0',
  mail: { status: 'pending' },
  ...over,
});

describe('the report email', () => {
  it('goes from the no-reply sender to the reports group, and a Reply answers the reporter', () => {
    const m = read(composeReportEmail('rep1', report()));
    expect(m.one('From')).toBe(`${REPORT_MAIL.from.name} <${REPORT_MAIL.from.address}>`);
    expect(m.one('From')).toBe('Sabeel Apps No Reply <apps-noreply@oursabeel.com>');
    expect(m.one('To')).toBe('apps-reports@oursabeel.com');
    expect(m.one('Reply-To')).toBe('Fatima Abdul-Rahman <fatima@oursabeel.com>');
    expect(m.one('Subject')).toBe('[Sabeel Time Tracker] Report from Fatima Abdul-Rahman');
    expect(m.one('MIME-Version')).toBe('1.0');
    expect(m.one('Content-Type')).toBe('text/plain; charset=UTF-8');
    expect(m.one('Content-Transfer-Encoding')).toBe('base64');
    // Nobody else receives it.
    expect(m.headers.has('cc')).toBe(false);
    expect(m.headers.has('bcc')).toBe(false);
  });

  it('says who, when in Chicago, which app, then the words verbatim', () => {
    const text = 'Line one.\nLine two, with “quotes” and Arabic: السلام عليكم\n\n.\nFrom here on.';
    const { body } = read(composeReportEmail('rep1', report({ text })));
    const lines = body.split(CRLF);
    expect(lines).toContain('Name:     Fatima Abdul-Rahman');
    expect(lines).toContain('Email:    fatima@oursabeel.com');
    expect(lines).toContain('Role:     member');
    expect(lines).toContain('User id:  uid-123');
    expect(lines).toContain('When:     2026-10-16 15:04 CDT (America/Chicago)');
    expect(lines).toContain('App:      Sabeel Time Tracker, version 0.29.0, Android');
    // Verbatim: every line, in order, the text's line breaks as the mail's.
    expect(body).toContain(text.replace(/\n/g, CRLF));
    expect(body).toContain('reports/rep1');
  });

  it('states Chicago standard time in winter', () => {
    const { body } = read(composeReportEmail('rep1', report({ createdAt: Date.UTC(2026, 11, 1, 18, 30) })));
    expect(body).toContain('When:     2026-12-01 12:30 CST (America/Chicago)');
  });

  it('says so when the app did not give its version or platform', () => {
    const { body } = read(composeReportEmail('rep1', report({ appVersion: undefined, platform: undefined })));
    expect(body).toContain('App:      Sabeel Time Tracker, version not given, platform not given');
  });

  it('names an iPhone and the website the way a person would', () => {
    expect(read(composeReportEmail('r', report({ platform: 'ios' }))).body).toContain(', iPhone');
    expect(read(composeReportEmail('r', report({ platform: 'web' }))).body).toContain(', the website');
  });
});

describe('names and words outside ASCII', () => {
  it('a name outside ASCII is encoded (RFC 2047) in Subject and Reply-To, and reads back unchanged', () => {
    const name = 'Fāṭima ʿAbd al-Raḥmān';
    const m = read(composeReportEmail('rep1', report({ displayName: name })));
    expect(m.one('Subject')).toBe(`[Sabeel Time Tracker] Report from ${name}`);
    expect(m.one('Reply-To')).toBe(`${name} <fatima@oursabeel.com>`);
    // The header section itself is plain ASCII, as RFC 5322 requires.
    expect(m.rawHead).toMatch(/^[\x20-\x7e\r\n]*$/);
  });

  it('a long name is split into words, never inside a character, on lines RFC 2047 allows', () => {
    const name = 'عبد الرحمن بن محمد بن عبد الله الأنصاري '.repeat(3).trim();
    const m = read(composeReportEmail('rep1', report({ displayName: name })));
    expect(m.one('Subject')).toBe(`[Sabeel Time Tracker] Report from ${name}`);
    const words = m.rawHead.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? [];
    expect(words.length).toBeGreaterThan(2);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      // Each word decodes alone to valid UTF-8: no replacement character.
      expect(decodeWords(w)).not.toContain('�');
    }
    // A header line that holds an encoded-word is at most 76 characters.
    for (const line of m.rawHead.split(CRLF)) {
      if (line.includes('=?UTF-8?B?')) expect(line.length, line).toBeLessThanOrEqual(76);
    }
  });

  it('the body is UTF-8 in base64 lines of at most 76 characters', () => {
    const text = 'ع'.repeat(1500);
    const m = read(composeReportEmail('rep1', report({ text })));
    for (const line of m.encodedBody.split(CRLF)) expect(line.length).toBeLessThanOrEqual(76);
    expect(m.body).toContain(text);
  });
});

describe('what a person types cannot become a header', () => {
  it('a line break in a name starts no header of its own', () => {
    const m = read(
      composeReportEmail('rep1', report({ displayName: 'Eve\r\nBcc: everyone@example.com\nX-Evil: 1' })),
    );
    expect(m.headers.has('bcc')).toBe(false);
    expect(m.headers.has('x-evil')).toBe(false);
    expect(m.one('Subject')).toBe('[Sabeel Time Tracker] Report from Eve Bcc: everyone@example.com X-Evil: 1');
  });

  it('a name with quotes or commas is quoted, so it stays one address', () => {
    const m = read(composeReportEmail('rep1', report({ displayName: 'Rahman, "Abdur" \\ Jr' })));
    expect(m.one('Reply-To')).toBe('"Rahman, \\"Abdur\\" \\\\ Jr" <fatima@oursabeel.com>');
  });

  it('the text can never end the headers early: it travels inside base64', () => {
    const text = 'x\r\n\r\nBcc: everyone@example.com';
    const m = read(composeReportEmail('rep1', report({ text })));
    expect(m.headers.has('bcc')).toBe(false);
    expect(m.encodedBody).not.toContain('Bcc');
    expect(m.body).toContain(text);
  });

  it('an address that is not one plain address gets no Reply-To', () => {
    const m = read(composeReportEmail('rep1', report({ email: 'a@b.com, everyone@example.com' })));
    expect(m.headers.has('reply-to')).toBe(false);
  });
});
