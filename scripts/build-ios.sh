#!/usr/bin/env bash
# Build the iOS app and export a signed App Store .ipa, without Xcode's UI.
#
#   bash scripts/build-ios.sh            # every gate, then archive and export
#   bash scripts/build-ios.sh --check    # every gate, build nothing
#
# Runs on the Mac and on GitHub's macOS runners (.github/workflows/ios.yml).
# It never uploads: the workflow's TestFlight job is the one way a build reaches
# Apple, and it asks first whether this is the released commit and whether the
# build number is free (scripts/testflight-check.mjs). docs/IOS-BUILD.md is the
# runbook.
#
# SIGNING IS AUTOMATIC by default: Xcode mints and fetches the distribution
# certificate and profile through the App Store Connect key, which suits a Mac
# a person keeps. With IOS_PROFILE_NAME set it is MANUAL: the app target signs
# with the Apple Distribution identity already in the keychain and that App
# Store profile, and nothing is minted. A runner needs manual, because
# automatic signing on a fresh machine creates a certificate every run and
# throws its private key away, until Apple's certificate limit stops every
# build for the team (the team's three apps share one certificate).
#
# Command line rather than the Xcode GUI: Xcode runs build phases in a
# sanitised environment, so the Sentry symbol upload cannot see its token in a
# GUI archive. The archive succeeds and uploads nothing, with no error.
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    -h | --help)
      sed -n '2,23p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

die() {
  echo "$@" >&2
  exit 1
}

# ---------------------------------------------------------------- gates

# 0. The platform. On Linux the failure would name a missing binary rather than
#    the reason.
[ "$(uname -s)" = "Darwin" ] || die "build-ios.sh needs macOS: an iOS archive cannot be made on Linux."
command -v xcodebuild >/dev/null || die "xcodebuild not found. Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
command -v pod >/dev/null || die "CocoaPods not found: brew install cocoapods"

# 0b. A release talks to production. Metro inlines every EXPO_PUBLIC_* from the
#     environment and from app/.env.local, so the dev loop's
#     EXPO_PUBLIC_USE_EMULATORS=1 in either would ship an app that talks to
#     127.0.0.1, and nothing in the archive would say so.
[ -z "${EXPO_PUBLIC_USE_EMULATORS:-}" ] || die "EXPO_PUBLIC_USE_EMULATORS is set in this shell.
A build from here would point at the local emulators. Unset it, or use a fresh terminal."
if grep -qE '^\s*EXPO_PUBLIC_USE_EMULATORS\s*=\s*\S' app/.env.local 2>/dev/null; then
  die "app/.env.local sets EXPO_PUBLIC_USE_EMULATORS. A build from here would point at the
local emulators. Remove the line; the dev loop passes the flag on the command line."
fi

# 1. The build-machine values, loaded BEFORE the gates, so check:ios does not
#    warn about values this script is about to supply.
# shellcheck source=scripts/load-build-env.sh
. scripts/load-build-env.sh

VERSION="$(node -p "require('./app/app.json').expo.version")"
BUILD_NUMBER="$(node -p "require('./app/app.json').expo.ios.buildNumber")"
BUNDLE_ID="$(node -p "require('./app/app.json').expo.ios.bundleIdentifier")"

# 2. Store-legal version, the one check shared with Android and the web.
node scripts/check-version.mjs

# 3. The iOS config itself: bundle id against the plist, the Firebase project,
#    the Google Sign-In URL scheme, the push entitlement's plugin, export
#    compliance, the icon, the privacy manifest, crash reporting.
node scripts/check-ios-config.mjs

[ -n "${IOS_TEAM_ID:-}" ] || die "IOS_TEAM_ID is not set.
Put it in app/.env.sentry-build-plugin: developer.apple.com -> Membership details -> Team ID."

missing_sentry=""
for v in SENTRY_ORG SENTRY_PROJECT SENTRY_AUTH_TOKEN; do
  [ -n "${!v:-}" ] || missing_sentry="${missing_sentry} ${v}"
done
if [ -n "$missing_sentry" ]; then
  echo "WARNING:${missing_sentry} not set: this build uploads no debug symbols or source maps," >&2
  echo "so iOS crashes will report raw addresses. See docs/SECRETS.md. Building anyway." >&2
fi

# 4. The App Store Connect key. Resolved for every automatic build, not only an
#    uploading one: `-allowProvisioningUpdates` MINTS AND DOWNLOADS the signing
#    assets through it, so the archive needs it. `~` is expanded here because a
#    dotenv value is a literal string.
if [ -n "${ASC_KEY_ID:-}" ]; then
  : "${ASC_KEY_PATH:=${HOME}/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"
  ASC_KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
fi

# 5. Manual signing: the named profile must be installed, be for THIS app, and
#    not have expired. Xcode says each of these too, but only after prebuild and
#    pod install. The LMS and Kanban sign with the same certificate, so their
#    profiles are the easy ones to install here by mistake.
PROFILE_PLIST=""
PROFILE_EXPIRES=""
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  PROFILE_PLIST="$(mktemp)"
  trap 'rm -f "$PROFILE_PLIST"' EXIT
  found=false
  for f in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision \
    "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision; do
    [ -f "$f" ] || continue
    security cms -D -i "$f" >"$PROFILE_PLIST" 2>/dev/null || continue
    if [ "$(plutil -extract Name raw "$PROFILE_PLIST")" = "$IOS_PROFILE_NAME" ]; then
      found=true
      break
    fi
  done
  [ "$found" = true ] || die "IOS_PROFILE_NAME is \"${IOS_PROFILE_NAME}\", and no installed provisioning profile has that name.
Xcode reads them from ~/Library/Developer/Xcode/UserData/Provisioning Profiles."
  PROFILE_APP="$(plutil -extract Entitlements.application-identifier raw "$PROFILE_PLIST")"
  [ "$PROFILE_APP" = "${IOS_TEAM_ID}.${BUNDLE_ID}" ] || die "Profile \"${IOS_PROFILE_NAME}\" is for ${PROFILE_APP}, not ${IOS_TEAM_ID}.${BUNDLE_ID}."
  PROFILE_EXPIRES="$(plutil -extract ExpirationDate raw "$PROFILE_PLIST")"
  [[ "$PROFILE_EXPIRES" > "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ]] || die "Profile \"${IOS_PROFILE_NAME}\" expired ${PROFILE_EXPIRES}.
docs/IOS-BUILD.md, \"Builds on GitHub\", has how to renew it."
fi

# 6. The signing keychain has to be USABLE, and the only proof is signing
#    something. On a Mac reached over ssh the login keychain is LOCKED (it
#    unlocks at GUI login; `launchctl managername` says Background, not Aqua).
#    `security find-identity` still lists valid identities, because a
#    certificate is public data, and the archive then dies at the first
#    framework it signs with `errSecInternalComponent`, twenty minutes in.
KEYCHAIN="$(security default-keychain -d user | tr -d ' "')"
UNLOCK_HELP="Unlock it in THIS session, then re-run:

  security unlock-keychain ${KEYCHAIN}

Type the password at the prompt rather than passing -p, which puts the account
password in shell history. Over ssh each login is its own security session, so
unlock in the same one that builds. It does not survive a reboot."

if ! security show-keychain-info "$KEYCHAIN" >/dev/null 2>&1; then
  die "The signing keychain is locked:
  ${KEYCHAIN}

${UNLOCK_HELP}"
fi

# Locked is the usual cause but not the only one: a private key's ACL can refuse
# a session with no window server even when the keychain is open. Signing a
# throwaway binary exercises the mechanism the archive uses, in about a second.
#
# In automatic mode no identity is not an error: -allowProvisioningUpdates
# mints one through the App Store Connect key. Manual mode signs as "Apple
# Distribution", so that identity must be here, and the profile must carry its
# certificate: a renewed certificate needs a profile made on it.
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  SIGN_ID="$(security find-identity -v -p codesigning 2>/dev/null | awk '/"Apple Distribution: / {print $2; exit}')"
  [ -n "$SIGN_ID" ] || die "IOS_PROFILE_NAME is set (manual signing), but the keychain holds no Apple Distribution identity.
Import the distribution .p12 first."
  carried=false
  n="$(plutil -extract DeveloperCertificates raw "$PROFILE_PLIST")"
  for ((i = 0; i < n; i++)); do
    sha="$(plutil -extract "DeveloperCertificates.$i" raw "$PROFILE_PLIST" | base64 --decode | shasum -a 1 | awk '{print toupper($1)}')"
    [ "$sha" != "$SIGN_ID" ] || carried=true
  done
  [ "$carried" = true ] || die "Profile \"${IOS_PROFILE_NAME}\" does not carry the certificate of the
Apple Distribution identity in the keychain (${SIGN_ID}). Make a profile on that
certificate, or import the certificate the profile was made on."
else
  SIGN_ID="$(security find-identity -v -p codesigning 2>/dev/null | awk '/^ *1\)/ {print $2}')"
fi
if [ -n "$SIGN_ID" ]; then
  PROBE_DIR="$(mktemp -d)"
  cp /bin/echo "${PROBE_DIR}/probe"
  if ! codesign --force --sign "$SIGN_ID" "${PROBE_DIR}/probe" >/dev/null 2>&1; then
    rm -rf "$PROBE_DIR"
    die "The keychain is unlocked, but codesign cannot USE the signing identity.
Signing a throwaway binary with ${SIGN_ID} failed; the archive would fail the
same way at its first framework, twenty minutes from now.

Usually the private key's ACL refuses a session with no window server:

  security set-key-partition-list -S apple-tool:,apple:,codesign: -s ${KEYCHAIN}

${UNLOCK_HELP}"
  fi
  rm -rf "$PROBE_DIR"
else
  echo "note: no codesigning identity in the keychain; automatic signing mints" >&2
  echo "one during the archive. Nothing to prove here yet." >&2
fi

echo
echo "app          Sabeel Time Tracker (${BUNDLE_ID})"
echo "version      ${VERSION}  (build ${BUILD_NUMBER})"
echo "team         ${IOS_TEAM_ID}"
echo "signing      $([ -n "${IOS_PROFILE_NAME:-}" ] && echo "manual, profile \"${IOS_PROFILE_NAME}\" (expires ${PROFILE_EXPIRES})" || echo "automatic")"
echo "symbols      ${SENTRY_PROJECT:-<none>}"
echo

if [ "$CHECK_ONLY" = true ]; then
  echo "--check: every gate passed; nothing was built."
  exit 0
fi

# ---------------------------------------------------------------- build

# 7. Stamp the commit onto the sign-in screen, immediately before the build so
#    the stamp is the commit that is built. A dirty tree's ends in "+", and the
#    workflow refuses an .ipa that carries one.
node scripts/gen-build-info.mjs

# 8. Regenerate ios/. ALWAYS --platform ios: a bare prebuild is clean by default
#    and would delete the committed app/android/. --no-install because the pods
#    are installed below, against the pinned lock.
(cd app && npx expo prebuild --platform ios --no-install)

# 9. The pods this app ships, pinned by the committed app/Podfile.lock. app/ios
#    is regenerated on every build, so without a committed lock each build
#    would resolve the third-party pods afresh and two builds of one commit
#    could ship different native code. --repo-update because a machine's local
#    specs index goes stale and cannot find a pinned version; it cannot move a
#    version, the lock decides those. Only PODS: is compared: the checksums of
#    locally generated podspecs differ per machine with the same versions.
cp app/Podfile.lock app/ios/Podfile.lock
(cd app/ios && pod install --repo-update)
pods_of() { sed -n '/^PODS:/,/^DEPENDENCIES:/p' "$1"; }
if [ "$(pods_of app/Podfile.lock)" != "$(pods_of app/ios/Podfile.lock)" ]; then
  die "pod install resolved other pods than app/Podfile.lock pins (a native dependency changed?).
If that is intended: cp app/ios/Podfile.lock app/Podfile.lock, commit it, and build again."
fi

WORKSPACE="$(find app/ios -maxdepth 1 -name '*.xcworkspace' | head -1)"
[ -n "$WORKSPACE" ] || die "no .xcworkspace under app/ios after prebuild + pod install."

# The scheme comes from the APP PROJECT, never the workspace: once pods are
# integrated the workspace has a scheme for every pod, the first alphabetically
# is `AppAuth`, and archiving a pod SUCCEEDS with no app inside it.
PROJECT="$(find app/ios -maxdepth 1 -name '*.xcodeproj' | head -1)"
[ -n "$PROJECT" ] || die "no .xcodeproj under app/ios after prebuild."
SCHEME="$(xcodebuild -project "$PROJECT" -list -json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const schemes = JSON.parse(s).project.schemes.filter((x) => !/Tests?$/.test(x));
    process.stdout.write(schemes[0] ?? "");
  });')"
[ -n "$SCHEME" ] || die "could not determine the Xcode scheme from $PROJECT."
echo "scheme       ${SCHEME}"

# Manual signing for the APP TARGET ONLY, written into the regenerated project.
# On the xcodebuild command line PROVISIONING_PROFILE_SPECIFIER would reach
# every pod target too, and each fails with "does not support provisioning
# profiles". The xcodeproj gem ships with CocoaPods.
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  ruby -rxcodeproj -e '
    project = Xcodeproj::Project.open(ARGV[0])
    target = project.native_targets.find { |t| t.name == ARGV[1] } or abort("no target #{ARGV[1]} in #{ARGV[0]}")
    target.build_configurations.select { |c| c.name == "Release" }.each do |c|
      c.build_settings["CODE_SIGN_STYLE"] = "Manual"
      c.build_settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
      c.build_settings["CODE_SIGN_IDENTITY[sdk=iphoneos*]"] = "Apple Distribution"
      c.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = ARGV[2]
      c.build_settings["DEVELOPMENT_TEAM"] = ARGV[3]
    end
    attributes = (project.root_object.attributes["TargetAttributes"] ||= {})
    (attributes[target.uuid] ||= {})["ProvisioningStyle"] = "Manual"
    project.save
  ' "$PROJECT" "$SCHEME" "$IOS_PROFILE_NAME" "$IOS_TEAM_ID"
fi

ARCHIVE="build/ios/${SCHEME}-${VERSION}-${BUILD_NUMBER}.xcarchive"
EXPORT_DIR="build/ios/export"
rm -rf "$ARCHIVE" "$EXPORT_DIR"
mkdir -p build/ios

# Manual signing fetches nothing, so it takes neither the key nor
# -allowProvisioningUpdates: with either, Xcode could still mint. In automatic
# mode the key goes in whole or not at all, and its file must exist.
#
# Both arrays expand as ${A[@]+"${A[@]}"}: macOS ships bash 3.2, where an EMPTY
# array under `set -u` is "unbound" and the script would die naming a variable
# declared right here. Bash 4.4+ does not, so it cannot be reproduced elsewhere.
AUTH=()
PROVISIONING=()
if [ -z "${IOS_PROFILE_NAME:-}" ]; then
  PROVISIONING=(-allowProvisioningUpdates)
  if [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] &&
    [ -n "${ASC_KEY_PATH:-}" ] && [ -f "${ASC_KEY_PATH}" ]; then
    AUTH=(-authenticationKeyPath "${ASC_KEY_PATH}"
      -authenticationKeyID "${ASC_KEY_ID}"
      -authenticationKeyIssuerID "${ASC_ISSUER_ID}")
  fi
fi

# 10. Archive.
xcodebuild -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  ${PROVISIONING[@]+"${PROVISIONING[@]}"} \
  ${AUTH[@]+"${AUTH[@]}"} \
  DEVELOPMENT_TEAM="$IOS_TEAM_ID" \
  archive

[ -d "$ARCHIVE" ] || die "xcodebuild reported success but produced no archive at $ARCHIVE."
# An archive of a library is a valid .xcarchive with no app in it; the only
# later symptom is an export error about the `method` key.
[ -d "$ARCHIVE/Products/Applications" ] || die "archive at $ARCHIVE contains no app: scheme '$SCHEME' is not the app's."

# 11. Export a signed .ipa for App Store Connect. `destination: export` writes
#     it to disk and sends nothing anywhere.
PLIST="build/ios/ExportOptions.plist"
if [ -n "${IOS_PROFILE_NAME:-}" ]; then
  SIGNING="<key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key><dict><key>${BUNDLE_ID}</key><string>${IOS_PROFILE_NAME}</string></dict>"
else
  SIGNING="<key>signingStyle</key><string>automatic</string>"
fi
cat >"$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>teamID</key><string>${IOS_TEAM_ID}</string>
  ${SIGNING}
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLISTEOF

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$PLIST" \
  ${PROVISIONING[@]+"${PROVISIONING[@]}"} \
  ${AUTH[@]+"${AUTH[@]}"}

IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
[ -n "$IPA" ] || die "the export wrote no .ipa to ${EXPORT_DIR}."
echo
echo "Exported v${VERSION} (build ${BUILD_NUMBER}) to ${IPA}. Nothing was uploaded."
