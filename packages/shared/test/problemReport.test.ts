import { describe, it, expect } from 'vitest';
import {
  hasAcceptedRules,
  parseReportInput,
  REPORT_EMPTY,
  REPORT_MAX_LENGTH,
  REPORT_TOO_LONG,
  reportTextReady,
  RULES_VERSION,
} from '../src';

/**
 * The report contract both sides read: the app's Send button
 * (`reportTextReady`) and the server's acceptance (`parseReportInput`) must
 * agree on what a sendable report is, or a person is offered Send for text the
 * server refuses.
 */
describe('what a report may say', () => {
  it('is trimmed, and must be 1 to REPORT_MAX_LENGTH characters', () => {
    expect(parseReportInput({ text: '  hello \n' })).toEqual({ input: { text: 'hello' } });
    expect(parseReportInput({ text: '' })).toEqual({ refusal: REPORT_EMPTY });
    expect(parseReportInput({ text: ' \n\t ' })).toEqual({ refusal: REPORT_EMPTY });
    expect(parseReportInput({ text: 'x'.repeat(REPORT_MAX_LENGTH) })).toHaveProperty('input');
    expect(parseReportInput({ text: 'x'.repeat(REPORT_MAX_LENGTH + 1) })).toEqual({ refusal: REPORT_TOO_LONG });
    // Surrounding space does not count against the limit.
    expect(parseReportInput({ text: ` ${'x'.repeat(REPORT_MAX_LENGTH)} ` })).toHaveProperty('input');
  });

  it('refuses what is not text', () => {
    for (const data of [null, undefined, {}, { text: 42 }, { text: ['a'] }]) {
      expect(parseReportInput(data)).toEqual({ refusal: REPORT_EMPTY });
    }
  });

  it('the Send button agrees with the server on every boundary', () => {
    for (const text of ['', ' ', 'a', ' a ', 'x'.repeat(REPORT_MAX_LENGTH), 'x'.repeat(REPORT_MAX_LENGTH + 1)]) {
      expect(reportTextReady(text), JSON.stringify(text.slice(0, 5))).toBe('input' in parseReportInput({ text }));
    }
  });

  it('keeps a known platform and a three-part version, and treats null as absent', () => {
    expect(parseReportInput({ text: 'a', platform: 'ios', appVersion: '0.29.0' })).toEqual({
      input: { text: 'a', platform: 'ios', appVersion: '0.29.0' },
    });
    expect(parseReportInput({ text: 'a', platform: null, appVersion: null })).toEqual({ input: { text: 'a' } });
  });

  it('refuses an unknown platform or an unreadable version', () => {
    expect(parseReportInput({ text: 'a', platform: 'windows' })).toHaveProperty('refusal');
    expect(parseReportInput({ text: 'a', appVersion: '1.0' })).toHaveProperty('refusal');
    expect(parseReportInput({ text: 'a', appVersion: '1.0.0\r\nBcc: x' })).toHaveProperty('refusal');
    expect(parseReportInput({ text: 'a', appVersion: 29 })).toHaveProperty('refusal');
  });
});

describe('the institute’s rules, accepted', () => {
  it('is the current version or later, and nothing before it', () => {
    expect(RULES_VERSION).toBeGreaterThanOrEqual(1);
    expect(hasAcceptedRules({})).toBe(false);
    expect(hasAcceptedRules({ rulesVersion: RULES_VERSION - 1 })).toBe(false);
    expect(hasAcceptedRules({ rulesVersion: RULES_VERSION })).toBe(true);
  });
});
