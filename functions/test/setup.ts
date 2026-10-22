// Vitest global setup for functions tests. Integration tests expect the Firebase
// emulators (`npm run test:emulator`, `sabeel-ci test-emulator`); unit tests run standalone.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-sabeel';
