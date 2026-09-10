import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import {
  getFunctions,
  connectFunctionsEmulator,
  type Functions,
} from 'firebase/functions';

/**
 * The six client config variables the webapp needs to talk to Firebase. They
 * are public (`NEXT_PUBLIC_*`) — client config, not server secrets — but the
 * webapp must still build and render deterministically when they are ABSENT
 * (e.g. a CI static export with no `.env.local`). See P4.2.
 */
const REQUIRED_FIREBASE_ENV = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

/**
 * `true` only when ALL six `NEXT_PUBLIC_FIREBASE_*` variables are present and
 * non-blank. Partial config counts as absent. Never logs or returns the values.
 */
export function hasFirebaseConfig(): boolean {
  return REQUIRED_FIREBASE_ENV.every((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

/** Whether Firebase was actually initialised for this runtime. */
export const firebaseConfigured = hasFirebaseConfig();

const app: FirebaseApp | null = firebaseConfigured
  ? getApps().length
    ? getApp()
    : initializeApp({
        apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      })
  : null;

// When config is absent every client is `null`. `getAuth` / `getFirestore` /
// `getFunctions` are NEVER called against a blank config — that is exactly the
// call (`getAuth`) that used to throw `auth/invalid-api-key` and break the
// static export.
export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;
export const functions: Functions | null = app ? getFunctions(app) : null;

/**
 * Point Firestore + Functions at the local emulators. Exported so it can be
 * unit-tested directly; the module only calls it in a browser + development +
 * initialised context (never on the server / prerender path). Auth emulator
 * wiring is intentionally NOT added here (out of P4.2 scope).
 */
export function connectDevEmulators(firestore: Firestore, fns: Functions): void {
  try {
    connectFirestoreEmulator(firestore, 'localhost', 8080);
    connectFunctionsEmulator(fns, 'localhost', 5001);
  } catch {
    // Already connected (e.g. Fast Refresh re-evaluated this module).
  }
}

if (
  app &&
  db &&
  functions &&
  typeof window !== 'undefined' &&
  process.env.NODE_ENV === 'development'
) {
  connectDevEmulators(db, functions);
}

export default app;
