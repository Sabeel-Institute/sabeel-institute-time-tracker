#!/usr/bin/env node
/**
 * Cut an Android release in two steps, because main takes changes only by
 * pull request:
 *
 *   node scripts/release.mjs 0.29.1 --notes notes.md   # 1. open the release PR
 *   node scripts/release.mjs --ship --notes notes.md   # 2. after merging it
 *   node scripts/release.mjs 0.29.1 --dry-run          # bump in place, no commit
 *   node scripts/release.mjs --verify-only             # boot-check current APKs
 *
 * Step 1 bumps the version in app/app.json, re-renders the manual, commits
 * that on `release/v<version>` from origin/main and opens a pull request into
 * main. Step 2, on main once the pull request is merged, builds both APK
 * variants and the Play bundle from that commit, verifies the build on the AVD,
 * tags it with the GitHub release, then publishes to Play's internal testing.
 * The web deploy and the iPhone build follow (docs/DEPLOY.md).
 *
 * Encodes the rules this project keeps re-learning by hand:
 *
 *  - **Every channel ships the one verified build**: the GitHub release
 *    (APKs), Play internal testing (the bundle). Never
 *    attach an APK to chat.
 *  - **Both variants, every time.** arm64 for real phones (~36MB); universal
 *    because arm64-only crashes on an x86_64 emulator with "Unexpected CPU
 *    variant" — which is exactly what verification runs on.
 *  - **Verify the PRODUCTION build on the AVD before publishing.** The check
 *    that matters is the ABSENCE of the dev sign-in row: an emulator-mode
 *    bundle looks identical otherwise, and Metro will happily serve a cached
 *    bundle built under different EXPO_PUBLIC_* env.
 *  - **The version is X.Y.Z and lives ONLY in app/app.json.** Gradle derives
 *    versionName and versionCode from it; this script writes the derived copies
 *    nowhere. See scripts/check-version.mjs for why the shape is not negotiable.
 *  - **versionCode must increase** or the install silently refuses to upgrade.
 *    It is derived (major*1000000 + minor*1000 + patch), so a version that goes
 *    backwards is caught here rather than by a phone that won't take the update.
 *  - **The tag names the commit that was built**, passed to `gh release create`
 *    as `--target`. Without it the tag lands on the remote branch head, which
 *    is how v0.26.0 and v0.27.0 went out tagging their predecessor.
 */
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { versionProblems } from './check-version.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const DRY = flag('--dry-run');
const SHIP = flag('--ship');
const VERIFY_ONLY = flag('--verify-only');
// Anchored at both ends: an unanchored test happily accepted `1.0.0-beta.24`,
// which is exactly the shape this scheme exists to keep out.
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

const APP_JSON = join(root, 'app/app.json');
const MANUAL_MD = join(root, 'docs/USER-MANUAL.md');
const RENDER_PY = join(root, 'docs/render-manual.py');
const OUT_DIR = process.env.RELEASE_OUT_DIR ?? join(root, 'build-artifacts');

const sh = (cmd, cwd = root) =>
  execSync(cmd, { cwd, stdio: 'inherit', env: process.env });
const shOut = (cmd, cwd = root) =>
  execSync(cmd, { cwd, encoding: 'utf8', env: process.env }).trim();

const versionCodeOf = (v) => {
  const [major, minor, patch] = v.split('.').map(Number);
  return major * 1000000 + minor * 1000 + patch;
};

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

function currentVersion() {
  return JSON.parse(readFileSync(APP_JSON, 'utf8')).expo.version;
}

function mainVersion() {
  return JSON.parse(shOut('git show origin/main:app/app.json')).expo.version;
}

/** The highest version already tagged; a release must go above it. */
function highestTagged() {
  return shOut("git tag -l 'v*'")
    .split('\n')
    .map((t) => t.slice(1))
    .filter((v) => versionProblems(v).length === 0)
    .sort((a, b) => versionCodeOf(b) - versionCodeOf(a))[0];
}

function tagExists(v) {
  return Boolean(shOut(`git tag -l v${v}`) || shOut(`git ls-remote --tags origin refs/tags/v${v}`));
}

function requireNotes() {
  const notesFile = opt('--notes');
  if (!existsSync(notesFile ?? '')) fail('--notes FILE is required — aborting before any change.');
  return notesFile;
}

function requireCleanTree() {
  if (shOut('git status --porcelain')) {
    fail('working tree is dirty — commit first so the release is reproducible');
  }
}

function bumpVersion(v) {
  const code = versionCodeOf(v);

  // The ONLY place the version is written. Gradle reads it from here.
  const aj = JSON.parse(readFileSync(APP_JSON, 'utf8'));
  aj.expo.version = v;
  writeFileSync(APP_JSON, JSON.stringify(aj, null, 2) + '\n');

  writeFileSync(
    MANUAL_MD,
    readFileSync(MANUAL_MD, 'utf8').replace(
      /\*For app version [^ ]+ ·/,
      `*For app version ${v} ·`,
    ),
  );
  writeFileSync(
    RENDER_PY,
    readFileSync(RENDER_PY, 'utf8').replace(
      /App version [^ ]+ &nbsp;/,
      `App version ${v} &nbsp;`,
    ),
  );
  console.log(`▸ version → ${v} (versionCode ${code}) in app.json, manual, renderer`);
  return code;
}

function renderManual() {
  console.log('▸ rendering USER-MANUAL.pdf');
  sh('python3 render-manual.py', join(root, 'docs'));
}

function buildApks(v) {
  mkdirSync(OUT_DIR, { recursive: true });
  const gradleDir = join(root, 'app/android');
  const built = {};
  for (const [variant, extra] of [
    ['universal', ''],
    ['arm64', '-PreactNativeArchitectures=arm64-v8a'],
  ]) {
    console.log(`▸ building ${variant} APK…`);
    sh(`./gradlew assembleRelease -q ${extra}`, gradleDir);
    const src = join(gradleDir, 'app/build/outputs/apk/release/app-release.apk');
    const dst = join(OUT_DIR, `sabeel-time-tracker-${v}-${variant}.apk`);
    sh(`cp ${src} ${dst}`);
    built[variant] = dst;
  }
  return built;
}

/**
 * The App Bundle for Google Play: every ABI in one file, from which Play cuts
 * each phone's APK. Same JS and the same key as the APKs above, so its upload
 * (`scripts/publish-play.mjs`, the last step) ships the build the AVD checked.
 */
function buildAab() {
  console.log('▸ building the Play bundle…');
  sh('./gradlew bundleRelease -q', join(root, 'app/android'));
}

/**
 * Boot the universal APK on the AVD and prove it is the PRODUCTION build of
 * this commit: scripts/check-release.mjs, the check the Android workflow runs
 * on every bundle it builds. Three cold starts must each reach the sign-in
 * screen and stay up, read `v<version> · <commit>`, show no dev sign-in row
 * (an emulator-mode bundle looks identical otherwise) and leave no crash in
 * the device log. It boots the AVD itself when none is attached.
 */
function verifyOnAvd(v, apk) {
  console.log(`▸ verifying ${v} on the AVD (production-mode check)…`);
  sh(`node ${join(root, 'scripts/check-release.mjs')} ${apk} --launches 3 --out ${join(OUT_DIR, `release-check-${v}`)}`);
}

/**
 * The commit to build and tag: main's head, as GitHub holds it.
 *
 * A release tags the commit it built, and `gh release create` can only tag a
 * commit the remote already has; the release pull request put it there. So
 * refuse anything else — a local commit, a stale checkout, another branch —
 * before a minute of building, rather than tag code GitHub has not seen.
 */
function requireMergedHead() {
  const branch = shOut('git rev-parse --abbrev-ref HEAD');
  if (branch !== 'main') fail(`refusing to ship from ${branch}: merge the release pull request, then ship from main.`);
  requireCleanTree();
  const local = shOut('git rev-parse HEAD');
  const remote = shOut('git ls-remote origin refs/heads/main').split(/\s+/)[0];
  if (local !== remote) {
    fail(
      `refusing to ship: main here is ${local.slice(0, 7)}, origin/main is ${remote.slice(0, 7)}. ` +
        'Pull (or push through a pull request) until they agree.',
    );
  }
  return local;
}

function publish(v, sha, built, notesFile) {
  const notes = readFileSync(notesFile, 'utf8');
  const notesPath = join(OUT_DIR, `notes-${v}.md`);
  writeFileSync(notesPath, notes);
  const assets = [built.arm64, built.universal, join(root, 'docs/USER-MANUAL.pdf')].join(' ');
  console.log(`▸ publishing the GitHub release, tagging ${sha.slice(0, 7)}`);
  sh(`gh release create v${v} --target ${sha} --title "v${v}" --notes-file ${notesPath} ${assets}`);
}

/** Step 1: the version bump, as a pull request into main. */
function prepare() {
  if (!version) {
    // Say what is wrong with what they typed rather than printing usage at them:
    // the whole point of this scheme is that `0.25.0-beta.1` LOOKS like a version.
    const attempted = args.find((a) => /^v?\d/.test(a) && args[args.indexOf(a) - 1] !== '--notes');
    if (attempted) {
      console.error(`refusing to release "${attempted}":`);
      for (const p of versionProblems(attempted)) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.error('usage: node scripts/release.mjs <X.Y.Z> --notes FILE [--dry-run]');
    console.error('       node scripts/release.mjs --ship --notes FILE');
    console.error('       node scripts/release.mjs --verify-only');
    fail('\nThe version is three integers, no suffix — see scripts/check-version.mjs.', 2);
  }
  // Shape alone is not enough: `2026.07.01` is three dot-separated integers and
  // still illegal, because 07 and 7 are the same number.
  if (versionProblems(version).length > 0) {
    console.error(`refusing to release "${version}":`);
    for (const p of versionProblems(version)) console.error(`  - ${p}`);
    process.exit(1);
  }
  requireCleanTree();
  const notesFile = DRY ? null : requireNotes();
  sh('git fetch -q origin main --tags');
  // A published versionCode is spent forever: Android refuses to install an APK
  // whose code is not greater than the installed one, so a version that goes
  // backwards produces an update nobody can take. Catch it before the tag exists.
  const prev = mainVersion();
  if (versionProblems(prev).length > 0) {
    fail(`main's app.json holds "${prev}", which is not a comparable version — fix it first.`);
  }
  if (versionCodeOf(version) <= versionCodeOf(prev)) {
    fail(
      `refusing to release ${version} (versionCode ${versionCodeOf(version)}): ` +
        `not greater than main's ${prev} (${versionCodeOf(prev)}). ` +
        'Android would refuse the upgrade.',
    );
  }
  if (tagExists(version)) fail(`tag v${version} already exists`);

  if (DRY) {
    const code = bumpVersion(version);
    renderManual();
    console.log(`\n[dry-run] stopping before the branch and commit. versionCode would be ${code}.`);
    console.log('[dry-run] revert with: git checkout -- app docs');
    process.exit(0);
  }

  const branch = `release/v${version}`;
  sh(`git switch -c ${branch} origin/main`);
  bumpVersion(version);
  renderManual();
  sh('git add -A');
  sh(`git commit -m "v${version}"`);
  sh(`git push -u origin ${branch}`);
  sh(`gh pr create --base main --head ${branch} --title "v${version}" --body-file ${notesFile}`);
  console.log(
    `\n✔ release pull request for v${version} opened. Once its checks pass, merge it, then:\n` +
      '    git switch main && git pull --ff-only\n' +
      `    npm run release -- --ship --notes ${notesFile}`,
  );
}

/** Step 2: build the merged release, verify it, tag it and publish it. */
function ship() {
  const notesFile = requireNotes();
  sh('git fetch -q origin main --tags');
  const sha = requireMergedHead();
  const v = currentVersion();
  if (versionProblems(v).length > 0) fail(`app.json holds "${v}", which is not a releasable version.`);
  if (tagExists(v)) {
    fail(`v${v} is already released; open the next version's pull request with: npm run release -- <X.Y.Z> --notes FILE`);
  }
  const last = highestTagged();
  if (last && versionCodeOf(v) <= versionCodeOf(last)) {
    fail(`refusing to ship ${v}: not above the last release, v${last}. Android would refuse the upgrade.`);
  }

  // gen-build-info stamps this merged commit; gradle/Metro bundles it in the
  // APK, and the later `firebase deploy --only hosting` regenerates it from the
  // SAME commit — so the sign-in footer shows an identical `v<version> · <hash>`
  // on the APK and the web. build-info.ts is gitignored.
  console.log(`▸ build-info → v${v} @ ${sha.slice(0, 7)}`);
  sh(`node ${join(root, 'scripts/gen-build-info.mjs')}`);

  const built = buildApks(v);
  buildAab();
  verifyOnAvd(v, built.universal);
  publish(v, sha, built, notesFile);
  console.log(`\n✔ v${v} released at ${sha.slice(0, 7)}. Now: firebase deploy --only hosting --project dev.`);
  // Last, because it is the one step that reaches every tester's phone by
  // itself. If it fails, the rest of the release stands; rerun it alone with
  // `npm run publish:play -- --internal`.
  console.log('▸ publishing the bundle to Play internal testing');
  sh(`node ${join(root, 'scripts/publish-play.mjs')} --internal`);
}

// ---------------------------------------------------------------------------
if (VERIFY_ONLY) {
  const v = currentVersion();
  verifyOnAvd(v, join(OUT_DIR, `sabeel-time-tracker-${v}-universal.apk`));
  process.exit(0);
}
if (!SHIP) {
  prepare();
  process.exit(0);
}
ship();

// Release over. The build leaves a Gradle daemon sitting on ~3.7GB, which is
// worth knowing about — but this no longer STOPS it, for two reasons established
// on 2026-08-28:
//
//   1. `./gradlew --stop` is MACHINE-WIDE. GRADLE_USER_HOME is unset in all
//      three Sabeel checkouts, so they share one daemon registry and stopping
//      "the" daemon stops the one a SIBLING session is mid-build on. It surfaces
//      there as "Gradle build daemon disappeared unexpectedly" in a repo nobody
//      touched.
//   2. The reason given here was overstated. earlyoom DOES run on this machine
//      (`-m 5 -s 5`, with qemu-system-x86, node, java and gradle all in
//      --prefer), so a preferred victim really can be killed — but only at 5%
//      free, and the box has 15GB of RAM plus a 16GB swapfile. Contention
//      therefore shows up first as thrashing; a kill is the tail case, not the
//      expected one. If something vanishes mid-build, check
//      `dmesg | grep -i earlyoom` before assuming a crash.
//
// Report it and let a human decide; TT_STOP_GRADLE=1 opts back in for when you
// know nothing else is building.
if (process.env.TT_STOP_GRADLE === '1') {
  try {
    execSync('./gradlew --stop', { cwd: join(root, 'app/android'), stdio: 'ignore' });
    console.log('▸ Gradle daemons stopped (TT_STOP_GRADLE=1 — machine-wide, all checkouts)');
  } catch {
    console.log('  (could not stop the Gradle daemon; run `./gradlew --stop` in app/android)');
  }
} else {
  try {
    // execFileSync, NOT execSync: `execSync` runs the command through `sh -c`,
    // and THAT wrapper's own command line contains the string being searched
    // for — so `pgrep -f` matches it and reports a daemon every single time,
    // including when none is running. Verified: zero real daemons, pgrep exit 0.
    // Spawning pgrep directly gives it no shell wrapper to find, and pgrep
    // already excludes its own pid.
    execFileSync('pgrep', ['-f', 'GradleDaemon'], { stdio: 'ignore' });
    console.log(
      '▸ A Gradle daemon is still running (~3.7GB). It is shared with the sibling\n' +
        '  checkouts, so this release did not stop it. If memory is tight and nothing\n' +
        '  else is building:  TT_STOP_GRADLE=1, or `./gradlew --stop` in app/android.',
    );
  } catch {
    // pgrep exits non-zero when nothing matches — no daemon, nothing to say.
  }
}
