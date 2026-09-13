// P7.3-F: proves the fix for the P7.3-E root cause. authService.js and
// jaAlchemyApiService.js now both import their Firebase App/Auth/Functions
// instances from the single shared src/scripts/firebaseApp.js module instead
// of each independently calling initializeApp()/getAuth()/getFunctions(). As
// of the webpack.config.js change in this same phase, they are also only
// ever bundled together as part of the single `sidepanel` entry — so testing
// them here in the SAME Jest module registry (both dynamically imported
// under one shared jest.resetModules() scope, not in separate
// jest.isolateModules blocks) accurately models that "one bundle" reality.
// See tests/firebaseAppModuleIsolation.test.js for the underlying mechanism
// (kept as permanent documentation of why cross-bundle sharing failed).
// saveAnalysis / explain / explainStreamCallable request contracts are
// covered by tests/jaAlchemyApiService.test.js and are unaffected by this
// change — not duplicated here.

const mockInitializeApp = jest.fn();
const mockGetAuth = jest.fn();
const mockGetFunctions = jest.fn();

jest.mock('firebase/app', () => ({
  initializeApp: (...args) => mockInitializeApp(...args),
}));
jest.mock('firebase/auth', () => ({
  getAuth: (...args) => mockGetAuth(...args),
  signInWithCredential: jest.fn(),
  GoogleAuthProvider: class {
    static credential() { return {}; }
  },
  setPersistence: jest.fn(),
  browserSessionPersistence: {},
}));
jest.mock('firebase/functions', () => ({
  getFunctions: (...args) => mockGetFunctions(...args),
  connectFunctionsEmulator: jest.fn(),
  httpsCallable: jest.fn(),
}));

describe('authService + jaAlchemyApiService share one Firebase App/Auth/Functions instance (P7.3-F)', () => {
  let appInstance;
  let authInstance;
  let functionsInstance;

  beforeEach(() => {
    jest.resetModules();
    mockInitializeApp.mockReset();
    mockGetAuth.mockReset();
    mockGetFunctions.mockReset();

    appInstance = { __app: true };
    authInstance = { currentUser: null };
    functionsInstance = { __functions: true };
    mockInitializeApp.mockReturnValue(appInstance);
    mockGetAuth.mockReturnValue(authInstance);
    mockGetFunctions.mockReturnValue(functionsInstance);

    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
      },
      runtime: { onMessage: { addListener: jest.fn(), removeListener: jest.fn() } },
    };
  });

  test('requirement 1: initializeApp is called exactly once across the whole authService + jaAlchemyApiService module graph', async () => {
    await import('../src/scripts/authService.js');
    const { default: JaAlchemyApiService } = await import('../src/scripts/jaAlchemyApiService.js');
    new JaAlchemyApiService();

    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockGetAuth).toHaveBeenCalledTimes(1);
    expect(mockGetFunctions).toHaveBeenCalledTimes(1);
  });

  test('requirement 2: authService and a new JaAlchemyApiService instance reference the identical Firebase App/Auth objects', async () => {
    const { default: authService } = await import('../src/scripts/authService.js');
    const { default: JaAlchemyApiService } = await import('../src/scripts/jaAlchemyApiService.js');
    const apiService = new JaAlchemyApiService();

    expect(authService.getAppInstance()).toBe(appInstance);
    expect(apiService.app).toBe(appInstance);
    expect(authService.getAuthInstance()).toBe(authInstance);
  });

  test('requirement 3: a currentUser established on authService\'s Auth instance is visible through the Functions-side shared app context', async () => {
    const { default: authService } = await import('../src/scripts/authService.js');
    const { default: JaAlchemyApiService } = await import('../src/scripts/jaAlchemyApiService.js');
    const apiService = new JaAlchemyApiService();

    // Simulate what signInWithCredential does internally: populate
    // currentUser on the Auth instance.
    authService.getAuthInstance().currentUser = { uid: 'shared-uid' };

    // jaAlchemyApiService's own `app` is the SAME object authService's Auth
    // lives on (requirement 2), so httpsCallable's ambient auto-attachment —
    // which reads getAuth(app).currentUser internally — sees this exact
    // mutation. Proven here by object identity, without touching any real
    // token value.
    expect(apiService.app).toBe(authService.getAppInstance());
    expect(authService.getAuthInstance().currentUser).toEqual({ uid: 'shared-uid' });
  });
});
