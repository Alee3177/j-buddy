/* @vitest-environment jsdom */
// jsdom (not the file's previous implicit `node` default) is required so
// `typeof window !== 'undefined'` can be exercised both ways — the emulator
// auto-wiring gate below asserts the true "wires when requested" path, which
// needs a real `window` global. Every pre-existing test in this file is
// controlled by `app`/`NODE_ENV`, never by `window`, so this switch changes
// no existing outcome (see the "9." / "8/9." tests below).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spy on every Firebase SDK entrypoint so no real SDK code runs and we can
// assert exactly which init calls happen.
const initializeApp = vi.fn(() => ({ __brand: 'app' }));
const getApps = vi.fn<() => unknown[]>(() => []);
const getApp = vi.fn(() => ({ __brand: 'app' }));
const getAuth = vi.fn(() => ({ __brand: 'auth' }));
const getFirestore = vi.fn(() => ({ __brand: 'db' }));
const getFunctions = vi.fn(() => ({ __brand: 'functions' }));
const connectFirestoreEmulator = vi.fn();
const connectFunctionsEmulator = vi.fn();

vi.mock('firebase/app', () => ({ initializeApp, getApps, getApp }));
vi.mock('firebase/auth', () => ({ getAuth }));
vi.mock('firebase/firestore', () => ({ getFirestore, connectFirestoreEmulator }));
vi.mock('firebase/functions', () => ({ getFunctions, connectFunctionsEmulator }));

const ENV_NAMES = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

const FULL_ENV: Record<string, string> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'key-xxx',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'app.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'proj',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'proj.appspot.com',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '123',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:123:web:abc',
};

let saved: Record<string, string | undefined>;

function clearEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}
function setFullEnv() {
  for (const [k, v] of Object.entries(FULL_ENV)) process.env[k] = v;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  saved = {};
  for (const name of ENV_NAMES) saved[name] = process.env[name];
  clearEnv();
});

afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

async function loadFirebaseModule() {
  return import('./firebase');
}

describe('hasFirebaseConfig', () => {
  it('2. one variable missing → incomplete', async () => {
    setFullEnv();
    delete process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
    const { hasFirebaseConfig } = await loadFirebaseModule();
    expect(hasFirebaseConfig()).toBe(false);
  });

  it('3. whitespace-only variable → incomplete', async () => {
    setFullEnv();
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = '   ';
    const { hasFirebaseConfig } = await loadFirebaseModule();
    expect(hasFirebaseConfig()).toBe(false);
  });

  it('all six missing → incomplete', async () => {
    const { hasFirebaseConfig } = await loadFirebaseModule();
    expect(hasFirebaseConfig()).toBe(false);
  });

  it('4. all six present → complete', async () => {
    setFullEnv();
    const { hasFirebaseConfig } = await loadFirebaseModule();
    expect(hasFirebaseConfig()).toBe(true);
  });
});

describe('firebase module — no config', () => {
  it('1. importing does not throw when all six env vars are missing', async () => {
    await expect(loadFirebaseModule()).resolves.toBeDefined();
  });

  it('6. never calls initializeApp / getAuth / getFirestore / getFunctions', async () => {
    await loadFirebaseModule();
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getAuth).not.toHaveBeenCalled();
    expect(getFirestore).not.toHaveBeenCalled();
    expect(getFunctions).not.toHaveBeenCalled();
  });

  it('exposes null clients and firebaseConfigured === false', async () => {
    const mod = await loadFirebaseModule();
    expect(mod.auth).toBeNull();
    expect(mod.db).toBeNull();
    expect(mod.functions).toBeNull();
    expect(mod.default).toBeNull();
    expect(mod.firebaseConfigured).toBe(false);
  });

  it('9. never wires the dev emulators (server / no-init path)', async () => {
    await loadFirebaseModule();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it('5. does not log config values', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await loadFirebaseModule();
    for (const spy of [logSpy, warnSpy, errorSpy]) {
      for (const call of spy.mock.calls) {
        const text = call.map(String).join(' ');
        expect(text).not.toMatch(/key-xxx|firebaseapp\.com|1:123:web/);
      }
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('firebase module — full config', () => {
  it('4/7. initialises exactly once (getAuth / getFirestore / getFunctions each once)', async () => {
    setFullEnv();
    const mod = await loadFirebaseModule();
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(getAuth).toHaveBeenCalledTimes(1);
    expect(getFirestore).toHaveBeenCalledTimes(1);
    expect(getFunctions).toHaveBeenCalledTimes(1);
    expect(mod.auth).not.toBeNull();
    expect(mod.db).not.toBeNull();
    expect(mod.functions).not.toBeNull();
    expect(mod.firebaseConfigured).toBe(true);
  });

  it('passes the six config values to initializeApp (no empty-string fallback)', async () => {
    setFullEnv();
    await loadFirebaseModule();
    expect(initializeApp).toHaveBeenCalledWith({
      apiKey: FULL_ENV.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: FULL_ENV.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: FULL_ENV.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: FULL_ENV.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: FULL_ENV.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: FULL_ENV.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  });

  it('reuses an already-initialised app instead of calling initializeApp again', async () => {
    setFullEnv();
    getApps.mockReturnValue([{ __brand: 'app' }]);
    await loadFirebaseModule();
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getApp).toHaveBeenCalledTimes(1);
  });

  it('8/9. does not wire emulators under the test runner (NODE_ENV !== development)', async () => {
    setFullEnv();
    await loadFirebaseModule();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });
});

describe('emulator auto-wiring gate (NEXT_PUBLIC_USE_FIREBASE_EMULATORS)', () => {
  const EMULATOR_FLAG = 'NEXT_PUBLIC_USE_FIREBASE_EMULATORS';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Regression guard: `next dev` sets NODE_ENV=development on every local run
  // regardless of intent, so NODE_ENV alone must never be sufficient to wire
  // emulators — a real-Firebase `npm run dev` (no flag set) must stay on real
  // Firebase.
  it('does NOT wire emulators under NODE_ENV=development when the flag is unset', async () => {
    setFullEnv();
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env[EMULATOR_FLAG];
    await loadFirebaseModule();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it('does NOT wire emulators when the flag is set to a non-"true" value', async () => {
    setFullEnv();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(EMULATOR_FLAG, 'false');
    await loadFirebaseModule();
    expect(connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it('wires emulators under NODE_ENV=development when the flag is "true"', async () => {
    setFullEnv();
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv(EMULATOR_FLAG, 'true');
    await loadFirebaseModule();
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(expect.anything(), 'localhost', 8080);
    expect(connectFunctionsEmulator).toHaveBeenCalledWith(expect.anything(), 'localhost', 5001);
  });
});

describe('connectDevEmulators', () => {
  it('8. points Firestore + Functions at localhost when invoked', async () => {
    const { connectDevEmulators } = await loadFirebaseModule();
    const fakeDb = { __brand: 'db' } as never;
    const fakeFns = { __brand: 'functions' } as never;
    connectDevEmulators(fakeDb, fakeFns);
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(fakeDb, 'localhost', 8080);
    expect(connectFunctionsEmulator).toHaveBeenCalledWith(fakeFns, 'localhost', 5001);
  });

  it('swallows an "already connected" error', async () => {
    const { connectDevEmulators } = await loadFirebaseModule();
    connectFirestoreEmulator.mockImplementationOnce(() => {
      throw new Error('already connected');
    });
    expect(() =>
      connectDevEmulators({ __brand: 'db' } as never, { __brand: 'functions' } as never)
    ).not.toThrow();
  });
});
