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
 * A stored report, as the email the administrators read: an RFC 5322 message
 * in plain text, from the no-reply sender to the reports group, with Reply-To
 * set to the person who reported, so answering them is one Reply.
 *
 * Pure: no clock, no network. `gmail.ts` sends what this returns, and
 * `reportMail.test.ts` reads it back the way a mail client would.
 *
 * Everything a person can type reaches a header only through `oneLine` (no
 * line break survives, so nothing they write can start a header of its own) and
 * reaches the body only inside base64, so no line of theirs can end the
 * headers early or exceed a mail line's length.
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
 * The body, as plain text: who, when (in the administrators' time zone),
 * which app, then what the person wrote, verbatim.
 */
function reportBody(id: string, report: ReportDoc): string {
  const tz = REPORT_EMAIL_TIME_ZONE;
  const at = report.createdAt;
  const when = `${dayKeyFor(at, tz)} ${timeOfDayFor(at, tz)} ${tzLabelFor(at, tz)} (${tz})`;
  const version = report.appVersion ? `version ${report.appVersion}` : 'version not given';
  const platform = report.platform ? PLATFORM_NAMES[report.platform] : 'platform not given';
  return [
    `${report.displayName} reported a problem in ${report.app}.`,
    '',
    `Name:     ${report.displayName}`,
    `Email:    ${report.email || '(none on the account)'}`,
    `Role:     ${report.role}`,
    `User id:  ${report.uid}`,
    `When:     ${when}`,
    `App:      ${report.app}, ${version}, ${platform}`,
    '',
    'What they wrote:',
    '',
    report.text,
    '',
    `Reply to this email to answer ${report.displayName}. The report is kept in the`,
    `app's database as ${COLLECTIONS.reports}/${id}.`,
    '',
  ].join('\n');
}

/** The whole message, ready for Gmail's `raw` (base64url of exactly this). */
export function composeReportEmail(id: string, report: ReportDoc): string {
  const headers = [
    `From: ${mailbox(REPORT_MAIL.from.name, REPORT_MAIL.from.address)}`,
    `To: ${REPORT_MAIL.to}`,
    // An account always has an address; one that is not plausible gets no
    // Reply-To rather than a header that could carry something else.
    ...(ADDRESS.test(report.email) ? [`Reply-To: ${mailbox(report.displayName, report.email)}`] : []),
    `Subject: ${unstructured(reportSubject(report))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = reportBody(id, report).replace(/\r\n|\r|\n/g, CRLF);
  const encoded = (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join(CRLF);
  return `${headers.join(CRLF)}${CRLF}${CRLF}${encoded}${CRLF}`;
}
