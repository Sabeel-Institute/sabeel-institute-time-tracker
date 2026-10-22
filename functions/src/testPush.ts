import { decodeNotifRoute, type NotifRoute } from '@sabeel/shared';

/**
 * The message `sabeel-ci send-test-push` and `sabeel-ci check-push` send:
 * this app's notification, opening what the `key=value` fields name, built
 * the way a real one is (`fcm.ts`, `apns.ts`).
 *
 * The fields are a route as a push carries it (`NotifRoute` in
 * @sabeel/shared), e.g. `screen=Timesheet periodKey=2026-10-11`; none opens
 * the app where it was. Fields that do not decode to a route the app opens
 * give null, so a test push never goes out with a destination the app would
 * ignore. Imports nothing relative, so the push tools load it from source.
 */
export function testMessage(
  title: string,
  body: string,
  fields: Record<string, string>,
): { title: string; body: string; route: NotifRoute | null } | null {
  if (Object.keys(fields).length === 0) return { title, body, route: null };
  const route = decodeNotifRoute(fields);
  return route ? { title, body, route } : null;
}
