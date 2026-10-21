import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The release tags the commit it actually built.
 *
 * `gh release create` makes the tag SERVER-SIDE. Given no target, it tags the
 * remote branch head, whatever that is; with the push left to a human
 * afterwards that was the commit BEFORE the release, and v0.26.0 and v0.27.0
 * both shipped that way. Nothing disagreed: the release page, both APK assets,
 * the manual and the public download page were all correct, and the only
 * witness was `git rev-parse v0.26.0`.
 *
 * Main now takes changes only by pull request, so the version bump reaches
 * GitHub through one, and `--ship` builds main's head after the merge. These
 * pin the order that keeps the tag on the built commit. It is an ordering
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
  const names = ['requireMergedHead', 'buildApks', 'verifyOnAvd', 'publish'];
  // Call sites only — a bare `name(` that is not `function name(`.
  return [...src.matchAll(/(?<!function\s)\b([a-zA-Z]+)\s*\(/g)]
    .map((m) => m[1])
    .filter((n) => names.includes(n));
}

describe('the release driver', () => {
  it('does not publish to a personal Pages repository', () => {
    expect(stripped()).not.toMatch(/publishDownloadPage|publish-apk\.sh|github\.io/);
  });

  it('checks the merged head, then builds and verifies, before the tag', () => {
    const order = callOrder();
    const at = (n: string) => order.indexOf(n);

    // Nothing is built from a commit GitHub does not hold.
    expect(at('requireMergedHead')).toBeGreaterThanOrEqual(0);
    expect(at('requireMergedHead')).toBeLessThan(at('buildApks'));
    // A build that fails the AVD check never gets a tag.
    expect(at('buildApks')).toBeLessThan(at('publish'));
    expect(at('verifyOnAvd')).toBeLessThan(at('publish'));
  });

  /**
   * `publish` runs `gh release create`, and nothing else in the script may.
   * A second tag-creating call added elsewhere would sidestep the ordering
   * above entirely while every assertion here stayed green.
   */
  it('creates the tag in exactly one place, on the built commit', () => {
    // Stripped, like callOrder: the comments explain `gh release create` twice,
    // and counting those made the first draft of this fail for the wrong reason.
    const creates = stripped().match(/gh release create[^`]*/g) ?? [];
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatch(/--target \$\{sha\}/);
  });

  /** The guard that refuses a head GitHub does not hold. */
  it('compares main against origin before building', () => {
    const src = stripped();
    expect(src).toMatch(/git ls-remote origin refs\/heads\/main/);
    expect(src).toMatch(/refusing to ship/);
  });

  /** main takes changes only by pull request; the only push is the release branch. */
  it('pushes nothing but the release branch', () => {
    const pushes = stripped().match(/git push[^`]*/g) ?? [];
    expect(pushes).toEqual(['git push -u origin ${branch}']);
    expect(stripped()).toMatch(/const branch = `release\/v\$\{version\}`/);
  });
});
