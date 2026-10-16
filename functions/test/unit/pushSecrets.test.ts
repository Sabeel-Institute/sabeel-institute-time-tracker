import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every function that can send a notification is given Apple's key.
 *
 * A secret that is not bound to a function reads as empty inside it, so a
 * sender added without PUSH_SECRETS would deliver to Android phones and
 * browsers and refuse every iPhone: loudly in the log (`messaging.ts` throws),
 * silently to the person who was meant to hear. Nothing else shows it: the
 * emulator never sends, and no other test reaches Apple.
 *
 * The senders are FOUND, not listed: every exported function whose body calls
 * `sendToUser`. A list would have to be remembered by whoever adds the next one,
 * which is the failure this exists to catch. Ported from the sibling LMS.
 */
const SRC = resolve(import.meta.dirname, '..', '..', 'src');

function senders(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
    let current: string | null = null;
    for (const line of readFileSync(resolve(SRC, file), 'utf8').split('\n')) {
      const start = /^export const (\w+) = /.exec(line);
      if (start) current = start[1];
      else if (/^(export )?(async )?function |^const \w+ = /.test(line)) current = null;
      if (current && /\bsendToUser\(/.test(line)) found.add(current);
    }
  }
  return [...found].sort();
}

describe('push senders', () => {
  it('are found, so the scan cannot pass by finding nothing', () => {
    // The ones that send today. A new sender joins this list by being found;
    // either way the line is updated knowingly, and the next test covers it.
    expect(senders()).toEqual(['notifyNewUser', 'notifyTimesheet', 'weeklyReminder']);
  });

  it('are each bound to APNS_KEY', async () => {
    const fns = (await import('../../src/index')) as unknown as Record<
      string,
      { __endpoint?: { secretEnvironmentVariables?: { key: string }[] } }
    >;
    for (const name of senders()) {
      const keys = fns[name]?.__endpoint?.secretEnvironmentVariables?.map((s) => s.key) ?? [];
      expect({ name, keys }).toEqual({ name, keys: expect.arrayContaining(['APNS_KEY']) });
    }
  });
});
