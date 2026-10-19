import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The release tags the commit it actually built.
 *
 * `gh release create` makes the tag SERVER-SIDE, so it can only point at a
 * commit the remote already has. With the push left to a human afterwards — as
 * the runbook used to say — it silently tagged the remote branch head instead,
 * which is the commit BEFORE the release. v0.26.0 and v0.27.0 both shipped that
 * way. Nothing disagreed: the release page, both APK assets, the manual and the
 * public download page were all correct, and the only witness was
 * `git rev-parse v0.26.0`.
 *
 * So the push moved into the script, and this pins where. It is an ordering
 * assertion because ordering is the whole bug — every one of these calls being
 * present, in the wrong sequence, is exactly what shipped twice.
 *
 * Like `ci-coverage.test.ts`, this lives in functions/test/unit because that is
 * the only workspace here with a runner; it asserts about a repo file.
 */
const SRC = resolve(import.meta.dirname, '../../../scripts/release.mjs');

/**
 * The driver with comments stripped.
 *
 * Every name below also appears in prose above its own definition, so searching
 * the raw text would find the doc comment rather than the call and report an
 * order that has nothing to do with what runs.
 */
const stripped = (): string =>
  readFileSync(SRC, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

function callOrder(): string[] {
  const src = stripped();
  const names = ['buildApks', 'verifyOnAvd', 'pushReleaseCommit', 'publish'];
  // Call sites only — a bare `name(` that is not `function name(`.
  return [...src.matchAll(/(?<!function\s)\b([a-zA-Z]+)\s*\(/g)]
    .map((m) => m[1])
    .filter((n) => names.includes(n));
}

describe('the release driver', () => {
  it('does not publish to a personal Pages repository', () => {
    expect(stripped()).not.toMatch(/publishDownloadPage|publish-apk\.sh|github\.io/);
  });

  it('pushes after the build and the AVD check, and before the tag', () => {
    const order = callOrder();
    const at = (n: string) => order.indexOf(n);

    // Build and verify first: everything before the push is local, so a failure
    // there still recovers with `git reset --hard HEAD~1` instead of a force-push.
    expect(at('buildApks')).toBeLessThan(at('pushReleaseCommit'));
    expect(at('verifyOnAvd')).toBeLessThan(at('pushReleaseCommit'));

    // The one that shipped wrong twice.
    expect(at('pushReleaseCommit')).toBeLessThan(at('publish'));
  });

  /**
   * `publish` runs `gh release create`, and nothing else in the script may.
   * A second tag-creating call added elsewhere would sidestep the ordering
   * above entirely while every assertion here stayed green.
   */
  it('creates the tag in exactly one place', () => {
    // Stripped, like callOrder: the comments explain `gh release create` twice,
    // and counting those made the first draft of this fail for the wrong reason.
    expect(stripped().match(/gh release create/g)?.length).toBe(1);
  });

  /** The guard that catches a push which landed on a different sha. */
  it('compares the pushed head against the release commit', () => {
    const src = stripped();
    expect(src).toMatch(/git ls-remote origin refs\/heads\//);
    expect(src).toMatch(/refusing to tag/);
  });
});
