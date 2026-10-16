#!/usr/bin/env node
/**
 * Cut an Android release: bump every version file, re-render the manual,
 * build both APK variants and the Play bundle, verify the build on the AVD,
 * publish to GitHub and the download page, then to Play's internal testing.
 *
 *   node scripts/release.mjs 1.0.0-beta.12 --notes notes.md
 *   node scripts/release.mjs 1.0.0-beta.12 --notes notes.md --dry-run
 *   node scripts/release.mjs --verify-only          # boot-check current APKs
 *
 * Encodes the rules this project keeps re-learning by hand:
 *
 *  - **Distribution is ALWAYS a GitHub release.** Never attach an APK to chat.
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

function currentVersion() {
  return JSON.parse(readFileSync(APP_JSON, 'utf8')).expo.version;
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

/** Boot the universal APK on the AVD and prove it is a PRODUCTION bundle. */
function verifyOnAvd(v, apk) {
  console.log('▸ verifying on the AVD (production-mode check)…');
  const devices = shOut('adb devices').split('\n').slice(1).filter((l) => l.includes('device'));
  if (devices.length === 0) {
    console.log('  no device — starting headless emulator');
    execSync(`nohup ${join(root, 'scripts/emulator.sh')} headless >/dev/null 2>&1 &`, {
      cwd: root,
      env: process.env,
    });
    sh('adb wait-for-device');
    execSync(
      'timeout 240 bash -c \'until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\\r")" = "1" ]; do sleep 3; done\'',
      { stdio: 'inherit' },
    );
  }
  sh(`adb install -r ${apk}`);
  const pkg = 'com.sabeelinstitute.timetracker';
  sh(`adb shell monkey -p ${pkg} 1`);
  execSync('sleep 12');

  const reportedVersion = shOut(
    `adb shell dumpsys package ${pkg} | grep versionName | head -1`,
  ).split('=')[1];
  if (reportedVersion !== v) {
    throw new Error(`installed versionName ${reportedVersion} != ${v} (stale build?)`);
  }
  if (!shOut(`adb shell pidof ${pkg} || true`)) {
    throw new Error('app is not running after launch — it crashed on boot');
  }

  // The decisive production check: an emulator-mode bundle renders a dev
  // sign-in row. Its ABSENCE is what proves the right bundle shipped.
  execSync('adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true');
  const ui = shOut('adb shell cat /sdcard/ui.xml 2>/dev/null || true');
  if (/Dev: sign in/i.test(ui)) {
    throw new Error('DEV SIGN-IN ROW PRESENT — this is an emulator-mode bundle, do not publish');
  }
  if (ui && !/Sign in with Google/i.test(ui)) {
    console.warn('  (warning: could not confirm the sign-in screen; check the screenshot)');
  }
  mkdirSync(OUT_DIR, { recursive: true });
  sh(`adb exec-out screencap -p > ${join(OUT_DIR, `verify-${v}.png`)}`);
  console.log(`  ✔ ${v} boots, production bundle confirmed`);
}

/**
 * Push the release commit BEFORE creating the GitHub release.
 *
 * `gh release create` makes the tag server-side, so it can only point at a
 * commit the remote already has. Run with the release commit still local and it
 * silently tags the remote branch head instead — the commit BEFORE the release.
 * v0.26.0 and v0.27.0 both went out tagging their predecessor, and nothing
 * anywhere disagreed: the release page, the assets and the download page were
 * all correct, and only `git rev-parse v0.26.0` knew.
 *
 * Placed after verifyOnAvd and not next to the commit, deliberately: everything
 * that can still fail has failed by now, so `git reset --hard HEAD~1` stays a
 * valid recovery for every earlier step rather than becoming a force-push.
 */
function pushReleaseCommit(v) {
  const branch = shOut('git rev-parse --abbrev-ref HEAD');
  console.log(`▸ pushing ${branch} so the tag can point at this commit`);
  sh(`git push origin ${branch}`);
  // Prove it landed. A push that resolved to a different sha — a racing commit,
  // a hook rewriting it — would put the tag back on the wrong code, which is the
  // exact failure this function exists to end.
  const local = shOut('git rev-parse HEAD');
  const remote = shOut(`git ls-remote origin refs/heads/${branch}`).split(/\s+/)[0];
  if (local !== remote) {
    console.error(
      `refusing to tag v${v}: origin/${branch} is ${remote.slice(0, 7)}, ` +
        `not the release commit ${local.slice(0, 7)}.`,
    );
    process.exit(1);
  }
}

function publish(v, built, notesFile) {
  const notes = notesFile ? readFileSync(notesFile, 'utf8') : `Release ${v}.`;
  const notesPath = join(OUT_DIR, `notes-${v}.md`);
  writeFileSync(notesPath, notes);
  const assets = [built.arm64, built.universal, join(root, 'docs/USER-MANUAL.pdf')].join(' ');
  console.log('▸ publishing GitHub release (the ONLY distribution channel)');
  sh(`gh release create v${v} --title "v${v}" --notes-file ${notesPath} ${assets}`);
}

/**
 * The public download page (GitHub Pages) is how the TEAM actually installs the
 * app — this repo is private, so its releases are not publicly downloadable.
 *
 * The APK is a **Release asset**, never a committed blob: it uploads to the
 * pages repo's fixed rolling tag `timetracker-latest` (permanent URL) and only
 * the version LABEL on the page is committed. `scripts/publish-apk.sh` does all
 * of it and asserts the pages repo holds zero .apk blobs. (Per-release APK
 * commits once bloated that history and had to be rewritten out — see CLAUDE.md.)
 */
function publishDownloadPage(apkPath) {
  console.log('▸ publishing the public download page (Release asset, not a commit)');
  sh(`bash ${join(root, 'scripts/publish-apk.sh')} ${apkPath}`);
  console.log(
    `  verify (Pages lags ~1 min):\n` +
      `    curl -s "https://faisal-shah.github.io/sabeel-time-tracker/?cb=$RANDOM" \\\n` +
      `      -H 'Cache-Control: no-cache' | grep -o 'v[0-9][^<]*'`,
  );
}

// ---------------------------------------------------------------------------
if (VERIFY_ONLY) {
  const v = currentVersion();
  verifyOnAvd(v, join(OUT_DIR, `sabeel-time-tracker-${v}-universal.apk`));
  process.exit(0);
}

if (!version) {
  // Say what is wrong with what they typed rather than printing usage at them:
  // the whole point of this scheme is that `0.25.0-beta.1` LOOKS like a version.
  const attempted = args.find((a) => /^v?\d/.test(a) && args[args.indexOf(a) - 1] !== '--notes');
  if (attempted) {
    console.error(`refusing to release "${attempted}":`);
    for (const p of versionProblems(attempted)) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.error('usage: node scripts/release.mjs <X.Y.Z> [--notes FILE] [--dry-run]');
  console.error('       node scripts/release.mjs --verify-only');
  console.error('\nThe version is three integers, no suffix — see scripts/check-version.mjs.');
  process.exit(2);
}
// Shape alone is not enough: `2026.07.01` is three dot-separated integers and
// still illegal, because 07 and 7 are the same number.
if (versionProblems(version).length > 0) {
  console.error(`refusing to release "${version}":`);
  for (const p of versionProblems(version)) console.error(`  - ${p}`);
  process.exit(1);
}
// A published versionCode is spent forever: Android refuses to install an APK
// whose code is not greater than the installed one, so a version that goes
// backwards produces an update nobody can take. Catch it before the tag exists.
{
  const prev = currentVersion();
  if (versionProblems(prev).length > 0) {
    console.error(`app.json holds "${prev}", which is not a comparable version — fix it first.`);
    process.exit(1);
  }
  if (versionCodeOf(version) <= versionCodeOf(prev)) {
    console.error(
      `refusing to release ${version} (versionCode ${versionCodeOf(version)}): ` +
        `not greater than the current ${prev} (${versionCodeOf(prev)}). ` +
        'Android would refuse the upgrade.',
    );
    process.exit(1);
  }
}
if (shOut('git status --porcelain')) {
  console.error('working tree is dirty — commit first so the release is reproducible');
  process.exit(1);
}
if (shOut(`git tag -l v${version}`)) {
  console.error(`tag v${version} already exists`);
  process.exit(1);
}

// Require notes up front: this release COMMITS the bump before building, so we
// must not get halfway and discover we can't publish.
const notesFile = opt('--notes');
if (!DRY && !existsSync(notesFile ?? '')) {
  console.error('--notes FILE is required to publish — aborting before any commit or build.');
  process.exit(1);
}

const code = bumpVersion(version);
renderManual();
if (DRY) {
  console.log(`\n[dry-run] stopping before commit/build/publish. versionCode would be ${code}.`);
  console.log('[dry-run] revert with: git checkout -- app docs');
  process.exit(0);
}

// Commit the bump BEFORE building. gen-build-info then stamps this release commit,
// and gradle/Metro bundles it in the APK; the later `firebase deploy --only
// hosting` regenerates build-info from the SAME commit — so the sign-in footer
// shows an identical `v<version> · <hash>` on the APK and the web. build-info.ts is
// gitignored, so it is not part of this commit. (If the build or the AVD check
// fails, recover with `git reset --hard HEAD~1` — everything up to that point is
// local. Past pushReleaseCommit it is published, so fix forward instead.)
sh('git add -A');
sh(`git commit -m "v${version}"`);
console.log(`▸ build-info → v${version} @ ${shOut('git rev-parse --short HEAD')}`);
sh(`node ${join(root, 'scripts/gen-build-info.mjs')}`);

const built = buildApks(version);
buildAab();
verifyOnAvd(version, built.universal);
pushReleaseCommit(version);
publish(version, built, notesFile);
console.log(`\n✔ v${version} released, committed and pushed. Now: firebase deploy --only hosting.`);
// Push the just-built, just-verified arm64 APK to the public download page as a
// Release asset (never a commit). Same artifact, same run — provenance is tight.
publishDownloadPage(built.arm64);
// Last, because it is the one step that reaches every tester's phone by
// itself. If it fails, the rest of the release stands; rerun it alone with
// `npm run publish:play -- --internal`.
console.log('▸ publishing the bundle to Play internal testing');
sh(`node ${join(root, 'scripts/publish-play.mjs')} --internal`);

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
