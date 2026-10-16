// Web side of the fresh-connection seam (native sibling: freshConnection.ts).

/**
 * On the web, Try again reloads the page. Seen on 2026-10-16: a page whose
 * database connection delivered nothing at all after sign-in stayed silent
 * when the connection was closed and opened again, and was cured at once by a
 * reload. Nothing is lost: the waiting screen holds nothing, and the session
 * restores from the browser. Never resolves, so the button stays busy until
 * the page goes.
 */
export function freshConnection(): Promise<void> {
  window.location.reload();
  return new Promise<void>(() => undefined);
}
