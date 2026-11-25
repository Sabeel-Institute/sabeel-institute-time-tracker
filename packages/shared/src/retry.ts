/**
 * A Firestore transaction whose commit response is lost (UNAVAILABLE,
 * DEADLINE_EXCEEDED, …) is retried by the SDK, client and Admin alike, and the
 * retry reads the state its own first attempt committed. A callback that checks
 * a revision must recognize that state as success, or a write that went through
 * is reported as having failed. Each patch carries a fresh timestamp, so its
 * values identify this write.
 */
export function patchApplied(current: object | undefined, patch: Record<string, unknown>): boolean {
  if (!current) return false;
  const fields = current as Record<string, unknown>;
  return Object.entries(patch).every(([key, value]) => fields[key] === value);
}
