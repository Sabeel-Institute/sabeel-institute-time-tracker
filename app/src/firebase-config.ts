// Firebase WEB APP client config — NOT a secret (it ships in every client bundle).
// From Firebase console → Project settings → Your apps → Web app.
// In emulator mode (EXPO_PUBLIC_USE_EMULATORS=1) firebase.ts overrides projectId to
// the emulator's demo project, so this real config is only used against production.
export const firebaseConfig = {
  apiKey: 'AIzaSyBw-htGUNKD_wIY5p6d_HTTJMzES5axWMI',
  // The hosting domain, NOT firebaseapp.com: hosting serves /__/auth/* itself,
  // keeping the whole sign-in redirect same-origin — required for storage-
  // partitioned browsers (in-app webviews) where the cross-domain helper dies
  // with "missing initial state". Redirect URI registered on the OAuth client
  // 2026-07-17.
  authDomain: 'sabeel-institute-time-tracker.web.app',
  projectId: 'sabeel-institute-time-tracker',
  storageBucket: 'sabeel-institute-time-tracker.firebasestorage.app',
  messagingSenderId: '858585609550',
  appId: '1:858585609550:web:eb1b0c69cee5248d145a1f',
};

/**
 * The WEB PUSH public key (VAPID), from Firebase console → Project settings →
 * Cloud Messaging → Web Push certificates.
 *
 * Not a secret, in the same way `apiKey` above is not: it is the PUBLIC half of
 * the pair, and shipping it in every client bundle is precisely its job — the
 * browser needs it to subscribe. The private half never leaves Google.
 * `sabeel-ci check-web-push` checks every web build carries it.
 */
export const VAPID_PUBLIC_KEY =
  'BEHhiUdRj6h8QYcQ6O4yMWKV5M_DE_vEEuF59aB8nN3fcMJryvrcCNkaNHN1iBz-3H2jzYe0neZPg2RUCaeAJUU';
