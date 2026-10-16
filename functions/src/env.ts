import { EMULATOR_PROJECT_ID } from '@sabeel/shared';

/**
 * Whether this process is running against the emulator suite.
 *
 * Keyed off the running PROJECT ID rather than an env flag on purpose: a flag
 * can be left set in a shell that then deploys, whereas the project id is
 * whatever is actually being talked to, and a deploy can never be the demo one.
 */
export function isEmulatorProject(): boolean {
  return (process.env.GCLOUD_PROJECT ?? '') === EMULATOR_PROJECT_ID;
}
