import { describe, it, expect, vi, afterEach } from 'vitest';
import { PUSH_CHANNEL_ID, WEB_APP_ORIGIN } from '@sabeel/shared';

/**
 * The one place a push leaves the server (functions/src/messaging.ts): which
 * sender it picks, where each device goes, and what it calls dead.
 *
 * Every way of getting this wrong is silent. Suppressing in production stops
 * every notification with nothing failing; sending under the emulator reads a
 * credential-less answer as a verdict on real registrations; an iPhone sent to
 * FCM, or an FCM token sent to Apple, is refused for that phone only; and a
 * dead-token verdict on a MESSAGE error unregisters everyone at once.
 *
 * The sender is chosen at module load, so each case re-imports with the
 * environment stubbed.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.doUnmock('firebase-admin/messaging');
  vi.doUnmock('../../src/apns');
  vi.doUnmock('../../src/sentry');
});

const NOTIF = {
  title: 'Timesheet approved',
  body: 'Oct 11 – Oct 17 was approved.',
  route: { screen: 'Timesheet', periodKey: '2026-10-11' } as const,
};
const android = (token: string) => ({ token, platform: 'android' as const, updatedAt: 1 });
const web = (token: string) => ({ token, platform: 'web' as const, updatedAt: 1 });
const ios = (token: string, apnsEnvironment: 'development' | 'production') => ({
  token,
  platform: 'ios' as const,
  apnsEnvironment,
  updatedAt: 1,
});

type FcmResponse = { success: boolean; error?: { code: string } };

/** A production module with FCM and Apple both stood in for. */
async function live(opts: {
  fcm?: (tokens: string[]) => FcmResponse[] | Error;
  apple?: (tokens: string[]) => { delivered: string[]; dead: string[]; failed: { token: string; reason: string }[] } | Error;
} = {}) {
  vi.stubEnv('FUNCTIONS_EMULATOR', '');
  vi.stubEnv('APNS_KEY', 'the-p8');
  vi.stubEnv('APNS_KEY_ID', 'KEY1234567');
  vi.stubEnv('APPLE_TEAM_ID', 'TEAM123456');
  const sendEachForMulticast = vi.fn(async (message: { tokens: string[] }) => {
    const r = opts.fcm?.(message.tokens) ?? message.tokens.map(() => ({ success: true }));
    if (r instanceof Error) throw r;
    return { responses: r, successCount: r.filter((x) => x.success).length };
  });
  const sendToApns = vi.fn(async (devices: { token: string }[]) => {
    const tokens = devices.map((d) => d.token);
    const r = opts.apple?.(tokens) ?? { delivered: tokens, dead: [], failed: [] };
    if (r instanceof Error) throw r;
    return r;
  });
  const reportError = vi.fn(async () => undefined);
  vi.doMock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEachForMulticast }) }));
  vi.doMock('../../src/apns', () => ({ sendToApns }));
  vi.doMock('../../src/sentry', () => ({ reportError }));
  vi.resetModules();
  const mod = await import('../../src/messaging');
  return { ...mod, sendEachForMulticast, sendToApns, reportError };
}

describe('sender selection', () => {
  it('suppresses the send under the emulator, pruning nothing', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.resetModules();
    const { send } = await import('../../src/messaging');
    await expect(send([android('a'), ios('i'.repeat(64), 'development')], NOTIF)).resolves.toEqual({
      stale: [],
      sent: 2,
    });
  });

  it('uses the real sender when the emulator variable is not exactly "true"', async () => {
    for (const value of ['', '1', 'false', 'TRUE']) {
      vi.stubEnv('FUNCTIONS_EMULATOR', value);
      vi.resetModules();
      const { send } = await import('../../src/messaging');
      // No Admin app in this process, so the real path throws at getMessaging():
      // reaching that throw is the proof the production branch was taken.
      await expect(send([android('a')], NOTIF)).rejects.toThrow();
    }
  });
});

describe('where each device goes', () => {
  it('sends iPhones to Apple, at the service that issued each token, and the rest to FCM', async () => {
    const m = await live();
    const out = await m.send(
      [android('a'), web('w'), ios('i1', 'development'), ios('i2', 'production')],
      NOTIF,
    );
    expect(out).toEqual({ stale: [], sent: 4 });
    expect(m.sendEachForMulticast.mock.calls[0][0].tokens).toEqual(['a', 'w']);
    // One send per iPhone, each with the message.
    expect(m.sendToApns.mock.calls[0][0]).toEqual([
      { token: 'i1', apnsEnvironment: 'development', message: NOTIF },
      { token: 'i2', apnsEnvironment: 'production', message: NOTIF },
    ]);
    // The key and the two ids come from the bound secret and the params.
    expect(m.sendToApns.mock.calls[0][1]).toEqual({ key: 'the-p8', keyId: 'KEY1234567', teamId: 'TEAM123456' });
  });

  it('addresses the shared Android channel, and carries the route to both FCM surfaces', async () => {
    const m = await live();
    await m.send([android('a')], NOTIF);
    const message = m.sendEachForMulticast.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(message).toMatchObject({
      android: { notification: { channelId: PUSH_CHANNEL_ID } },
      data: { screen: 'Timesheet', periodKey: '2026-10-11' },
    });
    expect(String((message.webpush as { fcmOptions: { link: string } }).fcmOptions.link)).toMatch(
      new RegExp(`^${WEB_APP_ORIGIN}`),
    );
    // Not a data key named `body`: expo-notifications on Android takes that as
    // the whole payload.
    expect(Object.keys(message.data as object)).not.toContain('body');
  });

  it('skips a service with nobody to send to', async () => {
    const m = await live();
    await m.send([ios('i1', 'production')], NOTIF);
    expect(m.sendEachForMulticast).not.toHaveBeenCalled();
    await m.send([android('a')], NOTIF);
    expect(m.sendToApns).toHaveBeenCalledTimes(1);
  });
});

describe('one service failing', () => {
  it('does not undo the other: what was delivered stands, and the failure is reported', async () => {
    const m = await live({ fcm: () => new Error('FCM is down') });
    await expect(m.send([android('a'), ios('i1', 'production')], NOTIF)).resolves.toEqual({ stale: [], sent: 1 });
    expect(m.reportError).toHaveBeenCalledTimes(1);
  });

  it('throws when nothing was delivered at all', async () => {
    const m = await live({ fcm: () => new Error('FCM is down'), apple: () => new Error('Apple is down') });
    await expect(m.send([android('a'), ios('i1', 'production')], NOTIF)).rejects.toThrow('FCM is down');
  });
});

describe('what is pruned', () => {
  it('prunes the tokens each service calls dead, and only those', async () => {
    const m = await live({
      fcm: (tokens) =>
        tokens.map((t) =>
          t === 'gone' ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true },
        ),
      apple: (tokens) => ({ delivered: tokens.filter((t) => t !== 'i-gone'), dead: ['i-gone'], failed: [] }),
    });
    const out = await m.send([android('a'), android('gone'), ios('i1', 'production'), ios('i-gone', 'production')], NOTIF);
    expect(out.stale.sort()).toEqual(['gone', 'i-gone']);
  });

  it('never prunes on invalid-argument, which FCM also returns for a bad MESSAGE', async () => {
    const m = await live({
      fcm: (tokens) => tokens.map(() => ({ success: false, error: { code: 'messaging/invalid-argument' } })),
    });
    const out = await m.send([android('a'), android('b')], NOTIF).catch(() => ({ stale: [] as string[] }));
    expect(out.stale).toEqual([]);
  });
});
