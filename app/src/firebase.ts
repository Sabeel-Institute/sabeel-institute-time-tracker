import { initializeApp } from 'firebase/app';
import { connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { EMULATOR_PROJECT_ID, REGION } from '@sabeel/shared';
import { firebaseConfig } from './firebase-config';
import { initAuth } from './authInit';
import { USE_EMULATORS, EMULATOR_HOST, EMULATOR_PORTS } from './env';

// Against the emulators, use the emulator's demo project id (what the emulator
// suite and tests run as) so the app reads/writes the same namespace. The real
// projectId in firebaseConfig is for production only.
export const app = initializeApp(
  USE_EMULATORS ? { ...firebaseConfig, projectId: EMULATOR_PROJECT_ID } : firebaseConfig,
);
export const auth = initAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, REGION);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:${EMULATOR_PORTS.auth}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, EMULATOR_HOST, EMULATOR_PORTS.firestore);
  connectFunctionsEmulator(functions, EMULATOR_HOST, EMULATOR_PORTS.functions);
}
