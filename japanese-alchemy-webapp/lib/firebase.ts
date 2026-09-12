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
 * `true` only when ALL six `NEXT_PUBLIC_FIREBASE_*` variables are present and
 * non-blank. Partial config counts as absent. Never logs or returns the values.
 *
 * Each variable is read as a static `process.env.NEXT_PUBLIC_FOO` member
 * expression — Next.js only inlines NEXT_PUBLIC_* vars into the browser
 * bundle for statically-analyzable accesses like this. A dynamic
 * `process.env[name]` lookup (the previous implementation) is NOT inlined,
 * so in the browser it falls through to an empty polyfilled `process.env`
 * and this would always report "unconfigured" client-side even with a
 * fully populated `.env.local`.
 */
export function hasFirebaseConfig(): boolean {
  const values = [
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  ];
  return values.every((value) => typeof value === 'string' && value.trim().length > 0);
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

// `NODE_ENV === 'development'` is NOT a signal that emulators are wanted —
// `next dev` sets it on every local run regardless of whether the developer
// is testing against the emulator suite or a real Firebase project (e.g. a
// B7-C-style real-Firebase smoke test). Emulator wiring is therefore gated on
// an explicit, separate opt-in flag; `next dev` against real Firebase is the
// default with no `.env.local` changes required.
const emulatorsRequested = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';

if (
  app &&
  db &&
  functions &&
  typeof window !== 'undefined' &&
  process.env.NODE_ENV === 'development' &&
  emulatorsRequested
) {
  connectDevEmulators(db, functions);
}

export default app;
