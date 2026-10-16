#!/usr/bin/env bash
# Source me. Exports the iOS build-machine values from app/.env.sentry-build-plugin.
#
#   . scripts/load-build-env.sh
#
# WHY THIS EXISTS. The iOS archive needs values that are not the app's: the
# Sentry org, project and auth token for the symbol and source-map upload, the
# Apple team id, and the App Store Connect key id and issuer. `xcodebuild` and
# the Sentry build phase read the process environment. Neither reads
# `app/.env.local`, which is Expo's, for inlining EXPO_PUBLIC_* into the bundle.
#
# Keeping them in one gitignored file instead of shell exports means they
# survive a new terminal, stay out of shell history, and cannot be committed by
# accident, which matters because this repo is PUBLIC. On GitHub the file is
# written from the IOS_BUILD_ENV secret (.github/workflows/ios.yml).
#
# Android does not use this file: its Sentry upload reads the gitignored
# app/android/sentry.properties (app/android/app/build.gradle).
#
# Parsed rather than `source`d: a dotenv file is not shell, and sourcing one
# executes whatever is in it. Values keep any `=` they contain; comments and
# blank lines are skipped.
_lb_env_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/app/.env.sentry-build-plugin"

if [ -f "$_lb_env_file" ]; then
  while IFS='=' read -r _lb_key _lb_val || [ -n "$_lb_key" ]; do
    _lb_key="${_lb_key#"${_lb_key%%[![:space:]]*}"}" # ltrim
    case "$_lb_key" in '' | '#'*) continue ;; esac
    _lb_val="${_lb_val%$'\r'}"
    # An empty value is not a value, and an existing environment variable WINS:
    # `IOS_TEAM_ID=... bash scripts/build-ios.sh` must not be overwritten by a
    # blank placeholder in the file.
    [ -n "$_lb_val" ] || continue
    [ -z "${!_lb_key:-}" ] || continue
    export "$_lb_key=$_lb_val"
  done <"$_lb_env_file"
  unset _lb_key _lb_val
fi
unset _lb_env_file
