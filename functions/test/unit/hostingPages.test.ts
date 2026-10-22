import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRIVACY_URL, SUPPORT_URL, WEB_APP_ORIGIN } from '@sabeel/shared';

/**
 * The pages a store reviewer reads, and the ways they break silently.
 *
 * The catch-all (`!/_expo/**`) sends every other path to the SPA, so a
 * `/privacy` rewrite listed after it, or one pointing at a file nobody wrote,
 * answers 200 with the app shell: a reviewer finds no policy and nothing here
 * looks broken. And the app's link has to agree with the rewrite.
 *
 * Plus the one rule the support page exists to keep out of the app: it tells a
 * newcomer to sign in on the website first, which the app itself may not say
 * (docs/STORE-RELEASE.md), so nothing in the app links to it.
 *
 * Like ci-coverage.test.ts this lives in functions/test/unit because that is
 * the workspace with a runner; it asserts about repo files.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const hosting = JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf8')).hosting as {
  rewrites: { source: string; destination: string }[];
};

const PAGES = [
  { url: PRIVACY_URL, file: 'privacy.html' },
  { url: SUPPORT_URL, file: 'support.html' },
];

/** Source with block and line comments removed, so prose cannot satisfy or trip a check. */
const code = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('the static pages the stores need', () => {
  const catchAll = hosting.rewrites.findIndex((r) => r.destination === '/index.html');

  for (const { url, file } of PAGES) {
    const path = url.slice(WEB_APP_ORIGIN.length);

    it(`${path} is rewritten to ${file}, ahead of the SPA catch-all`, () => {
      expect(url.startsWith(`${WEB_APP_ORIGIN}/`)).toBe(true);
      const at = hosting.rewrites.findIndex((r) => r.source === path);
      expect(at, `${path} has no rewrite`).toBeGreaterThan(-1);
      expect(catchAll).toBeGreaterThan(-1);
      expect(at, `${path} is behind the catch-all, so it serves the app shell`).toBeLessThan(catchAll);
      expect(hosting.rewrites[at].destination).toBe(`/${file}`);
    });

    it(`${file} exists and is static: no script, so a crawler reads it as served`, () => {
      const html = resolve(ROOT, 'app/public', file);
      expect(existsSync(html)).toBe(true);
      expect(readFileSync(html, 'utf8')).not.toMatch(/<script/i);
    });
  }

  it('the privacy policy, which the app links to, links to nothing but mail', () => {
    const links = [...readFileSync(resolve(ROOT, 'app/public/privacy.html'), 'utf8').matchAll(/href="([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(href).toMatch(/^mailto:/);
  });

  it('the app links to the privacy policy, and never to the support page', () => {
    const sources = filesUnder(resolve(ROOT, 'app/src')).map((f) => ({ f, src: code(f) }));
    expect(sources.some(({ src }) => /\bPRIVACY_URL\b/.test(src))).toBe(true);
    const offenders = sources.filter(({ src }) => /\bSUPPORT_URL\b|\/support\b/.test(src)).map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});
