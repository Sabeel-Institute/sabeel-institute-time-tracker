import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { decodeNotifRoute, encodeNotifRoute } from '@sabeel/shared';
import { texts, type Notif } from '../../src/notifyCore';

/**
 * The web push service worker (`app/public/firebase-messaging-sw.js`), run in
 * a fake worker scope.
 *
 * It is a classic script outside the bundle, so nothing else executes it. This
 * dispatches the events a browser would and asserts what the worker draws and
 * where a tap goes; `scripts/push-e2e.mjs` then delivers a real push of every
 * kind to it in Chromium and follows each tap to its screen.
 *
 * Every notification the server builds (`texts` in notifyCore.ts) is a case
 * here: its route has to survive the trip from FCM's data to the address the
 * worker opens and back through the app's own decoder. Here, in
 * `functions/test/unit`, because that workspace runs the repo's tests about
 * files outside any one workspace.
 */
const source = readFileSync(resolve(import.meta.dirname, '../../../app/public/firebase-messaging-sw.js'), 'utf8');

type Listener = (event: unknown) => void;
type Win = { url: string; focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };

function worker(windows: Win[] = []) {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(() => Promise.resolve());
  const matchAll = vi.fn(() => Promise.resolve(windows));
  const openWindow = vi.fn((_url: string) => Promise.resolve(null));
  const skipWaiting = vi.fn(() => Promise.resolve());
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: { showNotification },
    location: { origin: 'https://tt.example' },
    skipWaiting,
  };
  runInNewContext(source, { self, clients: { matchAll, openWindow } });
  return { listeners, showNotification, openWindow, skipWaiting };
}
const win = (url: string, focus = vi.fn(() => Promise.resolve())): Win => ({ url, focus, postMessage: vi.fn() });

/** Every notification the server sends, as `fcmMessage` carries it. */
const range = { fromKey: '2026-10-19', toKey: '2026-10-25' };
const sent: Array<[string, Notif]> = [
  ['newUser', texts.newUser('Alice Smith', 'alice@oursabeel.com')],
  ['submitted', texts.submitted('u1', 'Alice Smith', range, false)],
  ['resubmitted', texts.submitted('u1', 'Alice Smith', range, true)],
  ['approved', texts.approved(range)],
  ['rejected', texts.rejected(range, 'Missing Tuesday')],
  ['reminder', texts.reminder(range)],
];
const payload = (n: Notif) => ({ notification: { title: n.title, body: n.body }, data: encodeNotifRoute(n.route) });

function push(body: unknown) {
  const settled: Promise<unknown>[] = [];
  return { event: { data: { json: () => body }, waitUntil: (p: Promise<unknown>) => settled.push(p) }, settled };
}
function click(w: ReturnType<typeof worker>, data?: Record<string, string>) {
  const settled: Promise<unknown>[] = [];
  const notification = { close: vi.fn(), data };
  w.listeners.get('notificationclick')!({ notification, waitUntil: (p: Promise<unknown>) => settled.push(p) });
  return { notification, settled };
}

beforeEach(() => vi.clearAllMocks());

it('covers every notification the server builds', () => {
  // A new kind in notifyCore.ts must be added to `sent`, so its route is held
  // to the trip below like the rest.
  expect(Object.keys(texts).sort()).toEqual(['approved', 'newUser', 'rejected', 'reminder', 'submitted']);
});

describe('push', () => {
  it.each(sent)('shows %s, with its route as the notification data, even with a tab open', async (_, n) => {
    const w = worker([win('https://tt.example/')]);
    const { event, settled } = push(payload(n));
    w.listeners.get('push')!(event);
    await Promise.all(settled);
    expect(w.showNotification).toHaveBeenCalledWith(n.title, {
      body: n.body,
      icon: '/favicon.ico',
      tag: `${n.title}|${n.body}`,
      data: encodeNotifRoute(n.route),
    });
  });

  it('ignores a push that is not FCM JSON', () => {
    const w = worker();
    const waitUntil = vi.fn();
    w.listeners.get('push')!({ data: { json: () => { throw new SyntaxError('not json'); } }, waitUntil });
    w.listeners.get('push')!({ data: null, waitUntil });
    expect(w.showNotification).not.toHaveBeenCalled();
  });

  it('takes over at once rather than waiting for every tab to close', () => {
    const w = worker();
    w.listeners.get('install')!({});
    expect(w.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('notificationclick', () => {
  it('tells a tab of the app that is open where the notification points, and brings it forward', async () => {
    const mine = win('https://tt.example/');
    const other = win('https://elsewhere.example/');
    const w = worker([other, mine]);
    const data = encodeNotifRoute(texts.approved(range).route);
    const { notification, settled } = click(w, data);
    await Promise.all(settled);
    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(mine.postMessage).toHaveBeenCalledWith({ type: 'push-open', data });
    expect(mine.focus).toHaveBeenCalledTimes(1);
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it('still tells the tab where to go when the browser refuses to focus it', async () => {
    const mine = win('https://tt.example/', vi.fn(() => Promise.reject(new Error('not allowed'))));
    const w = worker([mine]);
    const { settled } = click(w, encodeNotifRoute(texts.reminder(range).route));
    await Promise.all(settled);
    expect(mine.postMessage).toHaveBeenCalledTimes(1);
  });

  it.each(sent)('opens %s in a new tab at an address the app decodes back to its route', async (_, n) => {
    const w = worker([]);
    const { settled } = click(w, encodeNotifRoute(n.route));
    await Promise.all(settled);
    const url = w.openWindow.mock.calls[0][0];
    expect(url.startsWith('/?')).toBe(true);
    expect(decodeNotifRoute(Object.fromEntries(new URLSearchParams(url.slice(2))))).toEqual(n.route);
  });

  it('opens the app itself for a notification with no route', async () => {
    const w = worker([]);
    const { settled } = click(w);
    await Promise.all(settled);
    expect(w.openWindow).toHaveBeenCalledWith('/');
  });
});
