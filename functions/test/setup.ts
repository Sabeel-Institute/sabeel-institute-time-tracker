// Vitest global setup for functions tests. Integration tests expect the Firebase
// emulators (`npm run test:emulator`, `sabeel-ci test-emulator`); unit tests run standalone.
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT ?? EMULATOR_PROJECT_ID;
