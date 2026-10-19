// The app version must stay legal on every store this could ship to — App Store
// included, which is the strictest and the least forgiving. See the
// expo-firebase-stack skill ("Version numbers are a store contract") for why
// these exact constraints exist and what they cost if you find out late.
//
// One source of truth: app/app.json → expo.version. Gradle derives versionName
// and versionCode from it (app/android/app/build.gradle), the manual and the
// release notes quote it, and gen-build-info.mjs stamps it into the app.
//
// Enforced from `npm run lint` (so CI cannot miss it), from `web:export` (a
// web-only deploy never touches Gradle), and from publish-play.mjs + release.mjs
// — the last gates before a tag and a public download exist.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every reason this string cannot be an app version. Empty = fine. */
export function versionProblems(version) {
  const problems = [];
  // Leading zeros are rejected on top of the shape: `2026.07.01` satisfies
  // \d+\.\d+\.\d+ and Apple accepts it, but 07 and 7 are the same number, so a
  // date-style scheme can produce a version that does not increase.
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    problems.push(
      `"${version}" is not three period-separated integers (X.Y.Z) without\n` +
        '    leading zeros. No pre-release suffix, no fourth component, no leading\n' +
        '    "v", no date-style components. Apple rejects the first three, and the\n' +
        '    Android versionCode is derived from exactly these three numbers.',
    );
  }
  if (version.length > 18) {
    problems.push(`"${version}" is longer than the 18 characters Apple allows.`);
  }
  // Mirrors the ceiling in build.gradle, deliberately duplicated: Gradle must
  // fail even when this script was not run, and this must fail on a web-only
  // release that never invokes Gradle.
  const [major, minor, patch] = version.split('.').map(Number);
  if (minor > 999 || patch > 999 || major > 2147) {
    problems.push(
      `"${version}" overflows the Android versionCode scheme (minor/patch max 999,\n` +
        '    major max 2147). Raise the multipliers in app/android/app/build.gradle\n' +
        '    together with this check — and only ever upward, or codes stop increasing.',
    );
  }
  return problems;
}

/**
 * A validator nobody has watched reject anything is not known to work, and this
 * one exists for a failure that surfaces months later at store submission. So
 * it proves itself on every run — microseconds, silent unless it is broken.
 */
function selfTest() {
  const mustReject = [
    '0.25.0-beta.1', // pre-release suffix — what this repo used to ship
    '1.2.3.4', // fourth component
    'v1.2.3', // leading v (fine on a git tag, never in the bundle)
    '2026.07.01', // leading zero: 07 and 7 are the same number
    '01.2.3', // ditto, in the major
    '0.1.1000', // overflows the versionCode field
    '1.2', // only two components
    '1.2.3 ', // trailing space
    '', // empty
  ];
  const mustAccept = ['0.25.0', '0.1.0', '1.0.0', '2147.999.999'];
  const broken = [
    ...mustReject.filter((v) => versionProblems(v).length === 0),
    ...mustAccept.filter((v) => versionProblems(v).length > 0),
  ];
  if (broken.length > 0) {
    console.error(`check-version SELF-TEST FAILED on: ${broken.map((v) => `"${v}"`).join(', ')}`);
    process.exit(1);
  }
}

selfTest();

// Only check app.json when run as a command. release.mjs imports the validator
// to vet the version it was handed, and must not trip over the file's contents
// at import time.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(import.meta.dirname, '..');
  const version = JSON.parse(readFileSync(resolve(root, 'app/app.json'), 'utf8')).expo.version;
  const problems = versionProblems(version);

  if (problems.length > 0) {
    console.error('\nversion check FAILED (app/app.json → expo.version)\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    process.exit(1);
  }

  const [major, minor, patch] = version.split('.').map(Number);
  console.log(
    `version ok (${version}, store-legal, versionCode ${major * 1000000 + minor * 1000 + patch})`,
  );
}
