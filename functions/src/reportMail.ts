import {
  COLLECTIONS,
  dayKeyFor,
  REPORT_EMAIL_TIME_ZONE,
  REPORT_MAIL,
  timeOfDayFor,
  tzLabelFor,
  type ReportDoc,
  type ReportPlatform,
} from '@sabeel/shared';

/**
 * A stored report, as the email the administrators read: an RFC 5322 message,
 * multipart/alternative (plain text and plain HTML of the same content), from
 * the no-reply sender to the reports group, with Reply-To set to the person
 * who reported, so answering them is one Reply.
 *
 * Pure: no clock, no network. `gmail.ts` sends what this returns, and
 * `reportMail.test.ts` reads it back the way a mail client would.
 *
 * Everything a person can type reaches a header only through `oneLine` (no
 * line break survives, so nothing they write can start a header of its own),
 * reaches the HTML only through `escapeHtml`, and reaches the message only
 * inside base64, so no line of theirs can end the headers or a part early.
 */

const CRLF = '\r\n';

/** Printable US-ASCII: what a header may carry without RFC 2047. */
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** An RFC 5322 phrase that needs no quotes: atoms separated by spaces. */
const PLAIN_PHRASE = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/;

/** A plausible single address: no spaces, brackets, quotes or separators. */
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/**
 * One line of header text: every control character (line breaks above all)
 * becomes a space, and runs of space become one.
 */
function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * RFC 2047 encoded-words: UTF-8, base64 (`B`), split only between characters,
 * never inside one. RFC 2047 caps a word at 75 characters and a header line
 * that holds one at 76, so each word here carries 30 bytes (52 characters) and
 * sits on its own folded line: `Reply-To: ` and a word make 62. A reader joins
 * adjacent words with no space between, which is what lets a long name span
 * several.
 */
function encodedWords(s: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const ch of s) {
    // 30 bytes encode to 40 base64 characters: 52 with the `=?UTF-8?B?…?=`.
    if (chunk && Buffer.byteLength(chunk + ch, 'utf8') > 30) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

/** An unstructured header value (the Subject): as is when ASCII, else encoded. */
function unstructured(s: string): string {
  const v = oneLine(s);
  return PRINTABLE_ASCII.test(v) ? v : encodedWords(v);
}

/** `Name <address>`, with the name quoted or encoded as RFC 5322 and 2047 require. */
function mailbox(name: string, address: string): string {
  const n = oneLine(name);
  if (!n) return `<${address}>`;
  // The address on a line of its own, so the last word's line stays short.
  if (!PRINTABLE_ASCII.test(n)) return `${encodedWords(n)}${CRLF} <${address}>`;
  if (PLAIN_PHRASE.test(n)) return `${n} <${address}>`;
  return `"${n.replace(/(["\\])/g, '\\$1')}" <${address}>`;
}

const PLATFORM_NAMES: Record<ReportPlatform, string> = {
  android: 'Android',
  ios: 'iPhone',
  web: 'the website',
};

/** The subject administrators see in their inbox. */
function reportSubject(report: Pick<ReportDoc, 'app' | 'displayName'>): string {
  return `[${report.app}] Report from ${oneLine(report.displayName)}`;
}

/**
 * What the email says, once, for both of its parts: an opening, the facts
 * (who, when in the administrators' time zone, which app), the person's words
 * verbatim, and how to answer. The plain and HTML parts are two renderings of
 * this and nothing else, so they cannot disagree.
 */
interface ReportContent {
  opening: string;
  facts: [label: string, value: string][];
  /** The reply address, when it is one plain address (it is linked in HTML). */
  replyTo: string | null;
  text: string;
  closing: string;
}

function reportContent(id: string, report: ReportDoc): ReportContent {
  const tz = REPORT_EMAIL_TIME_ZONE;
  const at = report.createdAt;
  const version = report.appVersion ? `version ${report.appVersion}` : 'version not given';
  const platform = report.platform ? PLATFORM_NAMES[report.platform] : 'platform not given';
  return {
    opening: `${report.displayName} reported a problem in ${report.app}.`,
    facts: [
      ['Name', report.displayName],
      ['Email', report.email || '(none on the account)'],
      ['Role', report.role],
      ['User id', report.uid],
      ['When', `${dayKeyFor(at, tz)} ${timeOfDayFor(at, tz)} ${tzLabelFor(at, tz)} (${tz})`],
      ['App', `${report.app}, ${version}, ${platform}`],
    ],
    replyTo: ADDRESS.test(report.email) ? report.email : null,
    text: report.text.replace(/\r\n|\r/g, '\n'),
    closing:
      `Reply to this email to answer ${report.displayName}. ` +
      `The report is kept in the app's database as ${COLLECTIONS.reports}/${id}.`,
  };
}

/**
 * Plain text, one line per paragraph: a mail client wraps it to the screen it
 * is read on, where a line broken at a fixed width breaks twice on a phone.
 * The person's own line breaks are theirs, and kept.
 */
function plainBody(c: ReportContent): string {
  return [
    c.opening,
    '',
    ...c.facts.map(([label, value]) => `${label}: ${value}`),
    '',
    'What they wrote:',
    '',
    c.text,
    '',
    c.closing,
    '',
  ].join('\n');
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text as HTML text: every character that could start markup or end an attribute, escaped. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * The same content as plain HTML: paragraphs, the facts as a two-column
 * table, the person's words escaped with their line breaks as `<br>`. No
 * images, no styles, no script, and one link only: `mailto:` the reporter.
 * Nothing the person typed reaches the markup unescaped.
 */
function htmlBody(c: ReportContent): string {
  const row = ([label, value]: [string, string]) => {
    const cell =
      label === 'Email' && c.replyTo
        ? // The address percent-encoded first, so a `?` or `&` in it cannot add
          // headers (a cc, a body) to the mail a click opens.
          `<a href="mailto:${escapeHtml(encodeURIComponent(c.replyTo).replace(/%40/g, '@'))}">${escapeHtml(value)}</a>`
        : escapeHtml(value);
    return `<tr><th align="left" valign="top">${escapeHtml(label)}</th><td>${cell}</td></tr>`;
  };
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head><meta charset="utf-8"></head>',
    '<body>',
    `<p>${escapeHtml(c.opening)}</p>`,
    '<table cellpadding="4" cellspacing="0">',
    ...c.facts.map(row),
    '</table>',
    '<p><strong>What they wrote:</strong></p>',
    `<p>${c.text.split('\n').map(escapeHtml).join('<br>\n')}</p>`,
    `<p>${escapeHtml(c.closing)}</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** One MIME part: UTF-8, base64 in lines of 76, CRLF line ends throughout. */
function part(contentType: string, body: string): string {
  const crlf = body.replace(/\r\n|\r|\n/g, CRLF);
  const encoded = (Buffer.from(crlf, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);
  return [`Content-Type: ${contentType}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', encoded].join(CRLF);
}

/** A composed report email: `raw` for Gmail, and its subject and text for a log. */
export interface ReportEmail {
  /** The whole RFC 5322 message, ready for Gmail's `raw` (base64url of exactly this). */
  raw: string;
  subject: string;
  text: string;
}

/**
 * The whole message: multipart/alternative, the plain text first and the HTML
 * last (a client shows the last part it can render). The boundary cannot
 * occur inside a part, which is base64 and so never contains a `-`.
 */
export function composeReportEmail(id: string, report: ReportDoc): ReportEmail {
  const content = reportContent(id, report);
  const subject = reportSubject(report);
  const text = plainBody(content);
  const boundary = `=_report_${id.replace(/[^A-Za-z0-9]/g, '')}`;
  const headers = [
    `From: ${mailbox(REPORT_MAIL.from.name, REPORT_MAIL.from.address)}`,
    `To: ${REPORT_MAIL.to}`,
    // An account always has an address; one that is not plausible gets no
    // Reply-To rather than a header that could carry something else.
    ...(content.replyTo ? [`Reply-To: ${mailbox(report.displayName, content.replyTo)}`] : []),
    `Subject: ${unstructured(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const raw = [
    headers.join(CRLF),
    '',
    `--${boundary}`,
    part('text/plain', text),
    `--${boundary}`,
    part('text/html', htmlBody(content)),
    `--${boundary}--`,
    '',
  ].join(CRLF);
  return { raw, subject, text };
}
