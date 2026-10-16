// Guard the iOS config, which is spread across files that must agree.
//
// `GoogleService-Info.plist` is downloaded from the Firebase console and
// `app/app.json` is written by hand, so nothing but this script stops them
// drifting. Each check below is a failure that surfaces only at upload, at App
// Review or at runtime, long after the build that caused it succeeded. Ported
// from the sibling kanban app, where every one of them was paid for.
//
// Run: node scripts/check-ios-config.mjs   (also `npm run check:ios`, and the
// first gate of scripts/build-ios.sh)
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const fail = (msg) => problems.push(msg);
/**
 * For things that are only wrong ON THE BUILD MACHINE. A hard failure would be
 * wrong, because this runs from any checkout; silence would be worse, because a
 * missing Sentry token skips the symbol upload without failing the build.
 */
const warnings = [];
const warn = (msg) => warnings.push(msg);

const app = JSON.parse(readFileSync(resolve(root, 'app/app.json'), 'utf8')).expo;
const ios = app.ios ?? {};
const plugins = app.plugins ?? [];
const plistPath = resolve(root, 'app/GoogleService-Info.plist');

/** <key>NAME</key><string>VALUE</string> pairs; the file is a flat dictionary. */
function readPlist(path) {
  const out = {};
  for (const m of readFileSync(path, 'utf8').matchAll(/<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

/** A plugin registered as a plain string, never as [name, options]. */
function requireBarePlugin(names, why) {
  if (names.some((n) => plugins.includes(n))) return;
  const withOptions = plugins.find((p) => Array.isArray(p) && names.includes(p[0]));
  fail(withOptions ? `"${withOptions[0]}" is configured with options. ${why.options}` : `app.json plugins is missing "${names[0]}". ${why.missing}`);
}

if (!app.platforms?.includes('ios')) {
  fail('expo.platforms does not include "ios".');
}

// 1. The plist. Without it `expo prebuild` fails late, naming a path rather
//    than the console step that was skipped.
if (!existsSync(plistPath)) {
  fail(
    'app/GoogleService-Info.plist is missing.\n' +
      '    Download it from the Firebase console: Project settings -> the iOS app.\n' +
      '    It is committed, like google-services.json: client identifiers, not secrets.',
  );
} else {
  const plist = readPlist(plistPath);

  // 2. Bundle id. A mismatch makes Google sign-in fail in ways that look like
  //    a network or credential problem.
  if (!ios.bundleIdentifier) {
    fail('app.json has no expo.ios.bundleIdentifier.');
  } else if (plist.BUNDLE_ID !== ios.bundleIdentifier) {
    fail(
      `bundle id mismatch: app.json says "${ios.bundleIdentifier}", the plist says "${plist.BUNDLE_ID}".\n` +
        '    Firebase cannot rename a bundle id: register a new iOS app on the right one.',
    );
  }

  // 3. The same Firebase PROJECT as Android and the web. An iOS app registered
  //    under a sibling project points the phone at another database, and
  //    nothing errors: it simply finds no hours.
  const gs = JSON.parse(readFileSync(resolve(root, 'app/google-services.json'), 'utf8'));
  if (plist.PROJECT_ID !== gs.project_info?.project_id) {
    fail(
      `Firebase project mismatch: the plist is for "${plist.PROJECT_ID}", google-services.json\n` +
        `    for "${gs.project_info?.project_id}". iOS and Android are two apps in ONE project.`,
    );
  }

  // 4. Google Sign-In's URL scheme. Without it Safari opens, an account is
  //    chosen, and the app never regains focus, with no error at all. Registered
  //    bare, the plugin derives the scheme from the plist's REVERSED_CLIENT_ID;
  //    given options it demands the value be copied into app.json by hand, a
  //    second copy that can drift from the file it came from.
  requireBarePlugin(['@react-native-google-signin/google-signin'], {
    options: 'Register it bare so the URL scheme comes from the plist, not a hand copy.',
    missing: 'Native Google sign-in has no URL scheme without it.',
  });
  if (!plist.REVERSED_CLIENT_ID) {
    fail(
      'the plist has no REVERSED_CLIENT_ID, so no Google Sign-In URL scheme can be derived.\n' +
        '    Enable Google sign-in in Firebase Authentication, then re-download the plist.',
    );
  }
}

// 5. Sentry, which makes an iOS crash readable. Bare, because the repo is
//    public: given `organization`/`project` the plugin writes them into
//    ios/sentry.properties, and an `authToken` option would be written into the
//    app package. Bare, all three come from the build environment
//    (scripts/load-build-env.sh). `@sentry/react-native` re-exports the expo
//    plugin, so either spelling is the same plugin.
requireBarePlugin(['@sentry/react-native', '@sentry/react-native/expo'], {
  options: 'Register it bare; supply SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN in the environment.',
  missing: 'No dSYM or source-map upload is wired, so iOS crashes arrive as raw addresses.',
});

// 6. Push. expo-notifications' plugin is what writes the aps-environment
//    entitlement. Without it the build succeeds, the permission prompt still
//    appears, and getDevicePushTokenAsync() never yields a token: the device
//    is simply never registered. Android cannot catch this, because its
//    native project is committed and never prebuilt.
requireBarePlugin(['expo-notifications'], {
  options: 'Its defaults are what this app needs; remove the options.',
  missing: 'Without it the app has no aps-environment entitlement and never gets a push token.',
});

// 7. Export compliance. Absent, every upload waits on a manual questionnaire
//    in App Store Connect before a tester can see it.
if (ios.config?.usesNonExemptEncryption !== false) {
  fail(
    'expo.ios.config.usesNonExemptEncryption must be explicitly false.\n' +
      '    Otherwise App Store Connect holds each build for an export-compliance answer.',
  );
}

// 8. ONE version string. `ios.version` would override expo.version and give
//    Apple a different number from Android and the web.
if (ios.version) {
  fail(`expo.ios.version is set ("${ios.version}"); remove it. expo.version is the one version.`);
}

// 9. The build number Apple takes once per version, each higher than the
//    last. It must be a whole number to be raised at all.
if (!/^[1-9]\d*$/.test(ios.buildNumber ?? '')) {
  fail(`expo.ios.buildNumber must be a whole number as a string; got ${JSON.stringify(ios.buildNumber)}.`);
}

// 10. The icon: 1024x1024 and no alpha channel. Apple rejects transparency at
//     UPLOAD, after the archive is built and signed. Byte 25 of the PNG header
//     is the colour type; 4 and 6 carry alpha.
const iconPath = resolve(root, 'app', (app.icon ?? './assets/icon.png').replace(/^\.\//, ''));
if (!existsSync(iconPath)) {
  fail(`expo.icon points at ${iconPath}, which does not exist.`);
} else {
  const png = readFileSync(iconPath);
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    fail(`${iconPath} is not a PNG.`);
  } else {
    const colourType = png[25];
    if (colourType === 4 || colourType === 6) {
      fail(`${iconPath} has an alpha channel (PNG colour type ${colourType}); Apple rejects it at upload.`);
    }
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    if (w !== 1024 || h !== 1024) fail(`${iconPath} is ${w}x${h}; the App Store icon must be 1024x1024.`);
  }
}

// 11. Crash reporting must be ON. app/.env.local is gitignored, so a fresh
//     clone has no DSN, and the build that results looks identical and reports
//     nothing (app/src/sentry.ts returns early without one).
const envPath = resolve(root, 'app/.env.local');
const dsn = existsSync(envPath)
  ? readFileSync(envPath, 'utf8').match(/^\s*EXPO_PUBLIC_SENTRY_DSN\s*=\s*(\S+)/m)?.[1]
  : undefined;
if (!dsn) {
  fail(
    'app/.env.local has no EXPO_PUBLIC_SENTRY_DSN, so the build would ship with crash reporting OFF.\n' +
      '    It is gitignored by design (docs/SECRETS.md); on GitHub it comes from APP_ENV_LOCAL.',
  );
} else if (!/^https:\/\/[^@]+@/.test(dsn)) {
  fail(`EXPO_PUBLIC_SENTRY_DSN does not look like a Sentry DSN ("${dsn.slice(0, 12)}...").`);
}

// 12. The Sentry build variables, needed only where the archive is made.
const missingSentry = ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN'].filter((v) => !process.env[v]);
if (missingSentry.length) {
  warn(
    `${missingSentry.join(', ')} not set in this shell. Harmless anywhere but the machine\n` +
      '    that archives; there the build succeeds and uploads no dSYMs or source maps.\n' +
      '    scripts/build-ios.sh loads them from app/.env.sentry-build-plugin.',
  );
}

// 13. The privacy manifest. Apple rejects an upload without one, by email,
//     after the archive is built. Expo writes ios/PrivacyInfo.xcprivacy from
//     this key; absent the key it writes nothing and nothing says so. The
//     collected types are also what the App Privacy answers in App Store
//     Connect must agree with (docs/STORE-RELEASE.md).
const pm = ios.privacyManifests;
if (!pm) {
  fail('app.json has no expo.ios.privacyManifests; Apple rejects the upload without one.');
} else {
  if (!Array.isArray(pm.NSPrivacyCollectedDataTypes) || pm.NSPrivacyCollectedDataTypes.length === 0) {
    fail('expo.ios.privacyManifests declares no NSPrivacyCollectedDataTypes.');
  }
  if (pm.NSPrivacyTracking !== false) {
    fail('expo.ios.privacyManifests.NSPrivacyTracking must be false: this app does not track.');
  }
  const tracks = (pm.NSPrivacyCollectedDataTypes ?? []).filter((t) => t.NSPrivacyCollectedDataTypeTracking === true);
  if (tracks.length > 0) {
    fail(`${tracks.length} collected data type(s) are marked as tracking, contradicting NSPrivacyTracking: false.`);
  }
}

if (warnings.length > 0) {
  console.warn('\niOS config warnings (build machine only)\n');
  for (const w of warnings) console.warn(`  ! ${w}\n`);
}
if (problems.length > 0) {
  console.error('\niOS config check FAILED\n');
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}
console.log(`iOS config ok (${ios.bundleIdentifier}, v${app.version} build ${ios.buildNumber})`);
