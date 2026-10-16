import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_ID, FIREBASE_PROJECT_ID } from '@sabeel/shared';

/**
 * One app, one project, stated in many files that must agree.
 *
 * The app id is the iOS bundle id, the Android package and the topic of every
 * push sent to Apple (functions/src/apns.ts). Apple refuses a push whose topic
 * is not the bundle the token was issued to, and a plist registered on another
 * bundle id makes Google sign-in fail in ways that look like credentials. The
 * project id names the Firebase config every surface talks to, and the
 * functions' committed parameter file (`.env.<project>`). Each mismatch below is
 * silent where it happens.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const plistString = (xml: string, key: string) =>
  new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1];

describe('the app id', () => {
  const app = JSON.parse(read('app/app.json')).expo;
  it('is the iOS bundle id and the Android package', () => {
    expect(app.ios.bundleIdentifier).toBe(APP_ID);
    expect(app.android.package).toBe(APP_ID);
  });

  it('is what both Firebase config files were registered on', () => {
    expect(plistString(read('app/GoogleService-Info.plist'), 'BUNDLE_ID')).toBe(APP_ID);
    for (const file of ['app/google-services.json', 'app/android/app/google-services.json']) {
      const packages = (JSON.parse(read(file)).client as { client_info: { android_client_info: { package_name: string } } }[]).map(
        (c) => c.client_info.android_client_info.package_name,
      );
      expect(packages, file).toContain(APP_ID);
    }
  });
});

describe('the project id', () => {
  it('is the one every config file names', () => {
    expect(JSON.parse(read('.firebaserc')).projects.dev).toBe(FIREBASE_PROJECT_ID);
    expect(plistString(read('app/GoogleService-Info.plist'), 'PROJECT_ID')).toBe(FIREBASE_PROJECT_ID);
    expect(JSON.parse(read('app/google-services.json')).project_info.project_id).toBe(FIREBASE_PROJECT_ID);
    expect(read('app/src/firebase-config.ts')).toContain(`projectId: '${FIREBASE_PROJECT_ID}'`);
  });

  it('has the functions parameter file a deploy reads, with the APNs ids', () => {
    const file = `functions/.env.${FIREBASE_PROJECT_ID}`;
    expect(existsSync(resolve(ROOT, file)), file).toBe(true);
    expect(read(file)).toMatch(/^APNS_KEY_ID=[A-Z0-9]{10}$/m);
    expect(read(file)).toMatch(/^APPLE_TEAM_ID=[A-Z0-9]{10}$/m);
  });
});
