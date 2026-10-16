import { describe, it, expect } from 'vitest';
import { APP_NAME, REPORT_MAIL, type ReportDoc } from '@sabeel/shared';
import { composeReportEmail } from '../../src/reportMail';

/**
 * What the administrators are promised: an email from the no-reply sender to
 * the reports group, that a Reply answers the person who reported, whose
 * subject names them, and which says who, when, from which app, and then
 * exactly what they wrote, in plain text and in plain HTML that say the same
 * thing. Read back here the way a mail client reads it: headers unfolded,
 * RFC 2047 words decoded, the multipart split, each base64 part decoded.
 */

const CRLF = '\r\n';

/** RFC 2047: adjacent encoded-words join with no space; each decodes alone. */
function decodeWords(v: string): string {
  return v
    .replace(/(\?=)\s+(?==\?UTF-8\?B\?)/g, '$1')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
}

function headerMap(rawHead: string) {
  const headers = new Map<string, string[]>();
  for (const line of rawHead.replace(/\r\n[ \t]/g, ' ').split(CRLF)) {
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
  return { headers, one };
}

/** A part: its headers, its base64 as sent, and its decoded text. */
function readPart(raw: string) {
  const at = raw.indexOf(CRLF + CRLF);
  const { one } = headerMap(raw.slice(0, at));
  const encoded = raw.slice(at + 4).replace(/\r\n$/, '');
  return { one, encoded, body: Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

function read(message: string) {
  const at = message.indexOf(CRLF + CRLF);
  expect(at).toBeGreaterThan(0);
  const rawHead = message.slice(0, at);
  const { headers, one } = headerMap(rawHead);
  const boundary = /boundary="([^"]+)"/.exec(one('Content-Type'))?.[1];
  expect(boundary).toBeTruthy();
  const body = message.slice(at + 4);
  // Exactly two parts, and the closing delimiter after them.
  const chunks = body.split(`--${boundary}`);
  expect(chunks).toHaveLength(4);
  expect(chunks[0]).toBe('');
  expect(chunks[3]).toBe(`--${CRLF}`);
  const [plain, html] = [chunks[1], chunks[2]].map((c) => readPart(c.replace(/^\r\n/, '')));
  // The HTML read as markup, its CRLFs (MIME's line ends, not the content's) as \n.
  return { rawHead, headers, one, plain, html: { ...html, body: html.body.replace(/\r\n/g, '\n') } };
}

/** HTML text back to text: tags out, `<br>` as a line break, entities decoded. */
function htmlText(fragment: string): string {
  return fragment
    .replace(/<br>\n?/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The facts table, as {label: value}, read from the HTML part. */
function htmlFacts(html: string): Record<string, string> {
  return Object.fromEntries(
    [...html.matchAll(/<tr><th[^>]*>(.*?)<\/th><td>(.*?)<\/td><\/tr>/g)].map((m) => [htmlText(m[1]), htmlText(m[2])]),
  );
}

/** The facts, as {label: value}, read from the plain part's "Label: value" lines. */
function plainFacts(plain: string, labels: string[]): Record<string, string> {
  const lines = plain.split(CRLF);
  return Object.fromEntries(
    labels.map((label) => {
      const line = lines.find((l) => l.startsWith(`${label}: `));
      return [label, line ? line.slice(label.length + 2) : '(missing)'];
    }),
  );
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

const FACTS = {
  Name: 'Fatima Abdul-Rahman',
  Email: 'fatima@oursabeel.com',
  Role: 'member',
  'User id': 'uid-123',
  When: '2026-10-16 15:04 CDT (America/Chicago)',
  App: 'Sabeel Time Tracker, version 0.29.0, Android',
};

describe('the report email', () => {
  it('goes from the no-reply sender to the reports group, and a Reply answers the reporter', () => {
    const m = read(composeReportEmail('rep1', report()).raw);
    expect(m.one('From')).toBe(`${REPORT_MAIL.from.name} <${REPORT_MAIL.from.address}>`);
    expect(m.one('From')).toBe('Sabeel Apps No Reply <apps-noreply@oursabeel.com>');
    expect(m.one('To')).toBe('apps-reports@oursabeel.com');
    expect(m.one('Reply-To')).toBe('Fatima Abdul-Rahman <fatima@oursabeel.com>');
    expect(m.one('Subject')).toBe('[Sabeel Time Tracker] Report from Fatima Abdul-Rahman');
    expect(m.one('MIME-Version')).toBe('1.0');
    // Nobody else receives it.
    expect(m.headers.has('cc')).toBe(false);
    expect(m.headers.has('bcc')).toBe(false);
  });

  it('is plain text and plain HTML of one message, the text first, both UTF-8 in base64', () => {
    const m = read(composeReportEmail('rep1', report()).raw);
    expect(m.one('Content-Type')).toMatch(/^multipart\/alternative; boundary="[^"]+"$/);
    expect(m.plain.one('Content-Type')).toBe('text/plain; charset=UTF-8');
    expect(m.html.one('Content-Type')).toBe('text/html; charset=UTF-8');
    for (const p of [m.plain, m.html]) {
      expect(p.one('Content-Transfer-Encoding')).toBe('base64');
      for (const line of p.encoded.split(CRLF)) expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it('the plain text has one line per paragraph: no sentence is broken at a fixed width', () => {
    const { plain } = read(composeReportEmail('rep1', report()).raw);
    expect(plain.body.split(CRLF)).toEqual([
      'Fatima Abdul-Rahman reported a problem in Sabeel Time Tracker.',
      '',
      'Name: Fatima Abdul-Rahman',
      'Email: fatima@oursabeel.com',
      'Role: member',
      'User id: uid-123',
      'When: 2026-10-16 15:04 CDT (America/Chicago)',
      'App: Sabeel Time Tracker, version 0.29.0, Android',
      '',
      'What they wrote:',
      '',
      'The note on my Tuesday entry was changed by someone else.',
      '',
      "Reply to this email to answer Fatima Abdul-Rahman. The report is kept in the app's database as reports/rep1.",
      '',
    ]);
  });

  it('both parts carry the same facts, the same words and the same closing', () => {
    const text = 'Line one.\nLine two, with “quotes” and Arabic: السلام عليكم\n\n.\nFrom here on.';
    const { plain, html } = read(composeReportEmail('rep1', report({ text })).raw);
    const labels = Object.keys(FACTS);
    expect(plainFacts(plain.body, labels)).toEqual(FACTS);
    expect(htmlFacts(html.body)).toEqual(FACTS);
    // The words verbatim in both: the text's line breaks as the mail's in the
    // plain part, as <br> in the HTML.
    expect(plain.body).toContain(text.replace(/\n/g, CRLF));
    expect(htmlText(html.body)).toContain(text);
    for (const sentence of [
      'Fatima Abdul-Rahman reported a problem in Sabeel Time Tracker.',
      "Reply to this email to answer Fatima Abdul-Rahman. The report is kept in the app's database as reports/rep1.",
    ]) {
      expect(plain.body).toContain(sentence);
      expect(htmlText(html.body)).toContain(sentence);
    }
  });

  it('states Chicago standard time in winter', () => {
    const { plain, html } = read(composeReportEmail('rep1', report({ createdAt: Date.UTC(2026, 11, 1, 18, 30) })).raw);
    expect(plain.body).toContain('When: 2026-12-01 12:30 CST (America/Chicago)');
    expect(htmlFacts(html.body).When).toBe('2026-12-01 12:30 CST (America/Chicago)');
  });

  it('says so when the app did not give its version or platform', () => {
    const { plain } = read(composeReportEmail('rep1', report({ appVersion: undefined, platform: undefined })).raw);
    expect(plain.body).toContain('App: Sabeel Time Tracker, version not given, platform not given');
  });

  it('names an iPhone and the website the way a person would', () => {
    expect(read(composeReportEmail('r', report({ platform: 'ios' })).raw).plain.body).toContain(', iPhone');
    expect(read(composeReportEmail('r', report({ platform: 'web' })).raw).plain.body).toContain(', the website');
  });

  it('answers its subject and plain text beside the message, for a log', () => {
    const email = composeReportEmail('rep1', report());
    expect(email.subject).toBe('[Sabeel Time Tracker] Report from Fatima Abdul-Rahman');
    expect(email.text.replace(/\n/g, CRLF)).toBe(read(email.raw).plain.body);
  });
});

/*
 * THE HTML IS THE INSTITUTE'S, NOT THE REPORTER'S. Anything a person types is
 * text in the administrators' inbox: it cannot add a tag, an attribute, an
 * image, a link or a script, and it reads back exactly as they wrote it.
 */
describe('what a person types cannot become HTML', () => {
  const ALLOWED_TAGS = new Set(['!doctype', 'html', 'head', 'meta', 'body', 'p', 'table', 'tr', 'th', 'td', 'a', 'br', 'strong']);
  const HOSTILE =
    '<script>alert(1)</script><img src=x onerror="alert(2)"> </p></body>' +
    '<a href="https://evil.example/">click</a> & "quoted" \'single\' &amp; <b>bold</b>\nsecond line';
  const NAME = '<b onmouseover="x()">Eve</b> & "Co"';

  it('the HTML holds only the institute’s own tags, and one link, mailto: the reporter', () => {
    const { html } = read(composeReportEmail('rep1', report({ text: HOSTILE, displayName: NAME })).raw);
    const tags = [...html.body.matchAll(/<\/?\s*([!a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1].toLowerCase());
    expect(tags.length).toBeGreaterThan(10);
    expect(tags.filter((t) => !ALLOWED_TAGS.has(t))).toEqual([]);
    const hrefs = [...html.body.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['mailto:fatima@oursabeel.com']);
    // No tag carries an event handler; the words "onerror" survive only as text.
    const markup = html.body.match(/<[^>]*>/g) ?? [];
    expect(markup.filter((m) => /\son\w+\s*=|<script|<img/i.test(m))).toEqual([]);
  });

  it('and reads back exactly as they wrote it, line breaks kept', () => {
    const { html } = read(composeReportEmail('rep1', report({ text: HOSTILE, displayName: NAME })).raw);
    const words = /<p><strong>What they wrote:<\/strong><\/p>\n<p>([\s\S]*?)<\/p>\n<p>Reply to/.exec(html.body)?.[1];
    expect(words).toBeDefined();
    expect(htmlText(words ?? '')).toBe(HOSTILE);
    expect(words).toContain('<br>');
    expect(htmlFacts(html.body).Name).toBe(NAME);
  });

  it('a `?` or `&` in the address cannot add headers to the mail the link opens', () => {
    const { html } = read(composeReportEmail('rep1', report({ email: 'a?cc=x&body=y@oursabeel.com' })).raw);
    const [href] = [...html.body.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(href).toBe('mailto:a%3Fcc%3Dx%26body%3Dy@oursabeel.com');
  });

  it('no link at all for an address that is not one plain address', () => {
    const { html } = read(composeReportEmail('rep1', report({ email: 'a@b.com, everyone@example.com' })).raw);
    expect(html.body).not.toContain('href=');
  });
});

describe('names and words outside ASCII', () => {
  it('a name outside ASCII is encoded (RFC 2047) in Subject and Reply-To, and reads back unchanged', () => {
    const name = 'Fāṭima ʿAbd al-Raḥmān';
    const m = read(composeReportEmail('rep1', report({ displayName: name })).raw);
    expect(m.one('Subject')).toBe(`[Sabeel Time Tracker] Report from ${name}`);
    expect(m.one('Reply-To')).toBe(`${name} <fatima@oursabeel.com>`);
    // The header section itself is plain ASCII, as RFC 5322 requires.
    expect(m.rawHead).toMatch(/^[\x20-\x7e\r\n]*$/);
  });

  it('a long name is split into words, never inside a character, on lines RFC 2047 allows', () => {
    const name = 'عبد الرحمن بن محمد بن عبد الله الأنصاري '.repeat(3).trim();
    const m = read(composeReportEmail('rep1', report({ displayName: name })).raw);
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

  it('both parts are UTF-8 in base64 lines of at most 76 characters', () => {
    const text = 'ع'.repeat(1500);
    const m = read(composeReportEmail('rep1', report({ text })).raw);
    for (const p of [m.plain, m.html]) {
      for (const line of p.encoded.split(CRLF)) expect(line.length).toBeLessThanOrEqual(76);
      expect(p.body).toContain(text);
    }
  });
});

describe('what a person types cannot become a header', () => {
  it('a line break in a name starts no header of its own', () => {
    const m = read(
      composeReportEmail('rep1', report({ displayName: 'Eve\r\nBcc: everyone@example.com\nX-Evil: 1' })).raw,
    );
    expect(m.headers.has('bcc')).toBe(false);
    expect(m.headers.has('x-evil')).toBe(false);
    expect(m.one('Subject')).toBe('[Sabeel Time Tracker] Report from Eve Bcc: everyone@example.com X-Evil: 1');
  });

  it('a name with quotes or commas is quoted, so it stays one address', () => {
    const m = read(composeReportEmail('rep1', report({ displayName: 'Rahman, "Abdur" \\ Jr' })).raw);
    expect(m.one('Reply-To')).toBe('"Rahman, \\"Abdur\\" \\\\ Jr" <fatima@oursabeel.com>');
  });

  it('the text can never end the headers or a part early: it travels inside base64', () => {
    const text = 'x\r\n\r\nBcc: everyone@example.com\r\n--=_report_rep1--\r\n';
    const m = read(composeReportEmail('rep1', report({ text })).raw);
    expect(m.headers.has('bcc')).toBe(false);
    expect(m.plain.encoded).not.toContain('Bcc');
    expect(m.plain.body).toContain('Bcc: everyone@example.com');
  });

  it('an address that is not one plain address gets no Reply-To', () => {
    const m = read(composeReportEmail('rep1', report({ email: 'a@b.com, everyone@example.com' })).raw);
    expect(m.headers.has('reply-to')).toBe(false);
  });
});
