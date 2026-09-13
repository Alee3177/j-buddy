// Single Firebase App/Auth/Functions owner for the sidepanel context.
//
// authService.js and jaAlchemyApiService.js each used to call
// initializeApp()/getAuth()/getFunctions() independently. That worked in a
// single shared module registry (e.g. Node/Jest), but webpack built
// `authService`, `jaAlchemyApiService`, and `sidepanel` as separate entry
// bundles with no shared vendor chunk — each got its OWN independent copy of
// @firebase/app's internal module registry, so identical config still
// produced genuinely different App/Auth instances at runtime (proven in
// P7.3-E via dist bundle inspection + regression tests). The sign-in UI
// authenticated one instance; every httpsCallable (including saveItems) ran
// through a different, never-authenticated one, so personal saves always
// failed with `unauthenticated`.
//
// This module is now the ONLY call site for initializeApp()/getAuth()/
// getFunctions(). Both authService.js and jaAlchemyApiService.js import the
// already-created instances from here instead of creating their own — and,
// as of the P7.3-F webpack change, both are only ever bundled as part of the
// single `sidepanel` entry, so there is exactly one evaluation of this
// module and exactly one Firebase App/Auth/Functions instance in that
// context.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import firebaseConfig from './firebaseConfig.js';

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseFunctions = getFunctions(firebaseApp, 'us-central1');

if (process.env.NODE_ENV === 'development') {
  connectFunctionsEmulator(firebaseFunctions, '127.0.0.1', 5001);
}
