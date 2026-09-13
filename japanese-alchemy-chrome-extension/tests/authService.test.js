// authService owns the extension-side half of the Google popup sign-in
// handshake: it receives the offscreen document's relayed postMessage and
// must turn it into a real Firebase Auth `currentUser` on the SAME app
// instance jaAlchemyApiService's `httpsCallable` calls use, so that Functions
// requests automatically carry a valid `request.auth`. These tests pin that
// contract at the authService boundary (the popup page itself is inline HTML,
// not an importable module, so its output shape is exercised here as the
// message authService consumes, not tested at its own source).

const mockInitializeApp = jest.fn();
const mockGetAuth = jest.fn();
const mockSignInWithCredential = jest.fn();
const mockCredential = jest.fn();

class MockGoogleAuthProvider {
  static credential(...args) {
    return mockCredential(...args);
  }
}

jest.mock('firebase/app', () => ({
  initializeApp: (...args) => mockInitializeApp(...args),
}));

jest.mock('firebase/auth', () => ({
  getAuth: (...args) => mockGetAuth(...args),
  signInWithCredential: (...args) => mockSignInWithCredential(...args),
  GoogleAuthProvider: MockGoogleAuthProvider,
  setPersistence: jest.fn(),
  browserSessionPersistence: {},
}));

describe('authService Google sign-in credential handshake', () => {
  let chromeMessageListener;
  let mockAuthInstance;

  beforeEach(async () => {
    jest.resetModules();
    mockInitializeApp.mockReset();
    mockGetAuth.mockReset();
    mockSignInWithCredential.mockReset().mockResolvedValue(undefined);
    mockCredential.mockReset().mockImplementation((idToken, accessToken) => ({
      __mockCredential: true,
      idToken,
      accessToken,
    }));

    mockAuthInstance = { currentUser: null };
    mockInitializeApp.mockReturnValue({});
    mockGetAuth.mockReturnValue(mockAuthInstance);

    chromeMessageListener = null;
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async () => ({})),
          set: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
      },
      runtime: {
        getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`),
        getContexts: jest.fn(async () => [{ /* pretend one already exists */ }]),
        sendMessage: jest.fn(),
        onMessage: {
          addListener: jest.fn((listener) => {
            chromeMessageListener = listener;
          }),
          removeListener: jest.fn(),
        },
      },
      offscreen: {
        createDocument: jest.fn(async () => undefined),
      },
    };
    global.window = { authService: undefined };
  });

  async function loadAuthService() {
    const mod = await import('../src/scripts/authService.js');
    return mod.default;
  }

  // signInWithGoogle() resolves ensureOffscreenDocumentReady() (itself
  // multi-await) before it registers the onMessage listener. Poll microtasks
  // until the listener shows up rather than guessing a fixed number of awaits.
  async function waitForMessageListener() {
    for (let i = 0; i < 50 && !chromeMessageListener; i += 1) {
      await Promise.resolve();
    }
    if (!chromeMessageListener) {
      throw new Error('chrome.runtime.onMessage listener was never registered');
    }
  }

  test('requirement 1+2: a well-formed popup credential ({idToken, accessToken}) is turned into a GoogleAuthProvider credential and passed to signInWithCredential', async () => {
    const authService = await loadAuthService();
    await Promise.resolve();

    const signInPromise = authService.signInWithGoogle();
    await waitForMessageListener();

    chromeMessageListener({
      success: true,
      user: { uid: 'uid-1', email: 'user@example.com', displayName: 'User', photoURL: '' },
      credential: { providerId: 'google.com', signInMethod: 'google.com', idToken: 'ID_TOKEN', accessToken: 'ACCESS_TOKEN' },
    });

    await signInPromise;

    expect(mockCredential).toHaveBeenCalledWith('ID_TOKEN', 'ACCESS_TOKEN');
    expect(mockSignInWithCredential).toHaveBeenCalledWith(
      mockAuthInstance,
      expect.objectContaining({ idToken: 'ID_TOKEN', accessToken: 'ACCESS_TOKEN' })
    );
  });

  test('requirement 2 (access-token-only): a credential with only accessToken (matching what the live popup page can realistically provide) still establishes a session', async () => {
    const authService = await loadAuthService();
    await Promise.resolve();

    const signInPromise = authService.signInWithGoogle();
    await waitForMessageListener();

    chromeMessageListener({
      success: true,
      user: { uid: 'uid-2', email: 'user2@example.com', displayName: 'User Two', photoURL: '' },
      credential: { providerId: 'google.com', signInMethod: 'google.com', accessToken: 'ACCESS_TOKEN_ONLY' },
    });

    await signInPromise;

    expect(mockCredential).toHaveBeenCalledWith(null, 'ACCESS_TOKEN_ONLY');
    expect(mockSignInWithCredential).toHaveBeenCalled();
  });

  test('requirement 5: no credential in the popup message (today\'s live sign-in-with-popup.html shape) skips signInWithCredential entirely and never throws', async () => {
    const authService = await loadAuthService();
    await Promise.resolve();

    const signInPromise = authService.signInWithGoogle();
    await waitForMessageListener();

    chromeMessageListener({
      success: true,
      user: { uid: 'uid-3', email: 'user3@example.com', displayName: 'User Three', photoURL: '' },
      // No `credential` field at all — this is exactly what the currently-deployed
      // public/sign-in-with-popup.html inline script sends today.
    });

    const resolvedUser = await signInPromise;

    expect(resolvedUser.uid).toBe('uid-3');
    expect(mockCredential).not.toHaveBeenCalled();
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  test('requirement 3+4: getToken() returns currentUser.getIdToken() once a currentUser is present on the shared Auth instance', async () => {
    const authService = await loadAuthService();
    await Promise.resolve();

    const signInPromise = authService.signInWithGoogle();
    await waitForMessageListener();

    // Simulate signInWithCredential succeeding and Firebase Auth populating currentUser
    // (real Firebase Auth does this internally; the mock does it explicitly here).
    mockSignInWithCredential.mockImplementation(async () => {
      mockAuthInstance.currentUser = { getIdToken: jest.fn(async () => 'REAL_FIREBASE_ID_TOKEN') };
    });

    chromeMessageListener({
      success: true,
      user: { uid: 'uid-4', email: 'user4@example.com', displayName: 'User Four', photoURL: '' },
      credential: { idToken: 'ID_TOKEN', accessToken: 'ACCESS_TOKEN' },
    });

    await signInPromise;

    const token = await authService.getToken();
    expect(token).toBe('REAL_FIREBASE_ID_TOKEN');
  });

  test('requirement 5 (fallback characterization): getToken() falls back to the raw uid when no currentUser is signed in on the Auth instance', async () => {
    const authService = await loadAuthService();
    await Promise.resolve();

    const signInPromise = authService.signInWithGoogle();
    await waitForMessageListener();

    // No credential at all -> signInWithCredential is never called -> currentUser stays null.
    chromeMessageListener({
      success: true,
      user: { uid: 'uid-5', email: 'user5@example.com', displayName: 'User Five', photoURL: '' },
    });

    await signInPromise;

    expect(mockAuthInstance.currentUser).toBeNull();
    const token = await authService.getToken();
    expect(token).toBe('uid-5');
  });
});
