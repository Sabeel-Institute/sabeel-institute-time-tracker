#!/usr/bin/env node
/**
 * May this build go to TestFlight?
 *
 *     node scripts/testflight-check.mjs <bundle-id> <version> <build-number> <commit>
 *
 * Two questions, both asked before anything is uploaded.
 *
 * 1. Is this the release? A version is spent the moment it is published
 *    (CLAUDE.md), and `scripts/release.mjs` publishes it by tagging
 *    `v<version>` on GitHub. An upload carrying that version must be built from
 *    exactly that commit, or iPhones and Android phones run different code
 *    under one number and the stamp on the sign-in screen says so.
 * 2. Is the build number free? Apple takes each once per version, each higher
 *    than the last, and says so only after an upload has run its course.
 *
 * Exit 0: both yes. 1: no, and what to do about it. 2: bad arguments, or
 * GitHub or App Store Connect did not answer.
 *
 * Authenticates with the App Store Connect API key named by ASC_KEY_ID and
 * ASC_ISSUER_ID, read from ASC_KEY_PATH, else
 * ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8. Reads only.
 */
import { execFileSync } from 'node:child_process';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const [bundleId, version, build, commit] = process.argv.slice(2);
if (!bundleId || !version || !/^\d+$/.test(build ?? '') || !/^[0-9a-f]{7,40}$/.test(commit ?? '')) {
  console.error('usage: testflight-check.mjs <bundle-id> <version> <build-number> <commit>');
  process.exit(2);
}

// 1. The release tag, read from GitHub rather than the local clone: a runner's
//    shallow checkout has no tags, and a local tag is not the published one.
//    An annotated tag lists twice, and its peeled `^{}` line is the commit.
let tagged;
try {
  const ref = `refs/tags/v${version}`;
  const lines = execFileSync('git', ['ls-remote', '--tags', 'origin', ref, `${ref}^{}`], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.split('\t'));
  tagged = (lines.find(([, r]) => r === `${ref}^{}`) ?? lines.find(([, r]) => r === ref))?.[0];
} catch (e) {
  console.error(`could not ask GitHub for the release tags: ${e.message}`);
  process.exit(2);
}
if (!tagged) {
  console.error(
    `Version ${version} has not been released: there is no v${version} tag on GitHub.\n` +
      'Cut the release first (npm run release), then build the iOS app from its tag.',
  );
  process.exit(1);
}
if (!tagged.startsWith(commit)) {
  console.error(
    `This build is commit ${commit}, but v${version} is ${tagged.slice(0, 7)}.\n` +
      `Build from the release: run the iOS workflow on the tag v${version}.`,
  );
  process.exit(1);
}
const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuer } = process.env;
if (!keyId || !issuer) {
  console.error('ASC_KEY_ID and ASC_ISSUER_ID must be set');
  process.exit(2);
}
const keyPath = process.env.ASC_KEY_PATH || `${homedir()}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;

// App Store Connect's token: ES256 over the key, at most 20 minutes long, in
// JOSE's raw r||s form (node's default DER is refused).
const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${part({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${part({ iss: issuer, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
const signature = sign('sha256', Buffer.from(unsigned), {
  key: createPrivateKey(readFileSync(keyPath)),
  dsaEncoding: 'ieee-p1363',
});
const token = `${unsigned}.${signature.toString('base64url')}`;

async function get(path) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`App Store Connect answered ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`);
    process.exit(2);
  }
  return res.json();
}

const apps = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
const app = apps.data.find((a) => a.attributes.bundleId === bundleId);
if (!app) {
  console.error(`App Store Connect has no app with bundle id ${bundleId}; create its record first.`);
  process.exit(2);
}
const builds = await get(
  `/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&fields[builds]=version&limit=200`,
);
const taken = builds.data.map((b) => Number(b.attributes.version)).filter(Number.isFinite);
const highest = taken.length ? Math.max(...taken) : 0;

if (Number(build) <= highest) {
  console.error(
    `Version ${version} already has build ${highest} on App Store Connect, so build ${build} cannot go up.\n` +
      `Raise expo.ios.buildNumber in app/app.json above ${highest}, commit, and build again.`,
  );
  process.exit(1);
}
console.log(`v${version} is ${commit}, and build ${build} is free (highest so far: ${highest || 'none'}).`);
