#!/usr/bin/env bash
set -euo pipefail

# The Firebase emulators require JDK 21+. Locally we keep JDK 17 as the default (for the
# Android/Gradle build) and point only the emulators at a user-local JDK 21.
# Resolution order: explicit ST_JDK21_HOME → user-local ~/opt/jdk-21 → whatever java is
# already on PATH (CI provides JDK 21 via setup-java).
if [ -n "${ST_JDK21_HOME:-}" ]; then
  export JAVA_HOME="$ST_JDK21_HOME"
elif [ -d "$HOME/opt/jdk-21" ]; then
  export JAVA_HOME="$HOME/opt/jdk-21"
fi

if [ -n "${JAVA_HOME:-}" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi

bash "$(dirname "$0")/free-emulator-ports.sh"

# Pass 1: rules and integration tests, against Firestore and Auth alone. They
# call the functions' cores directly, and no trigger may run behind them.
integration=0
firebase emulators:exec \
  --project demo-sabeel \
  --only firestore,auth \
  "npm run test:integration -w functions" || integration=$?

# Pass 2: the auth-layer sign-in gate, which only exists when the Functions
# emulator runs the blocking functions for the Auth emulator to call
# (functions/test/gate). The functions emulator loads the BUILT bundle.
gate=0
npm run build -w functions >/dev/null
bash "$(dirname "$0")/free-emulator-ports.sh"
firebase emulators:exec \
  --project demo-sabeel \
  --only firestore,auth,functions \
  "npm run test:gate -w functions" || gate=$?

if [ "$integration" -ne 0 ] || [ "$gate" -ne 0 ]; then
  echo "test:emulator failed: integration pass exit $integration, gate pass exit $gate" >&2
  exit 1
fi
