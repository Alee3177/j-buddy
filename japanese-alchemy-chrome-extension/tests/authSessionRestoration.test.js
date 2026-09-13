// P7.3-H: session-restoration regression coverage.
//
// Observed production symptom: after a Chrome extension reload,
// chrome.storage.local still has the cached profile from before the reload
// (it's disk-backed and survives), but the sidepanel gets a brand-new
// Firebase Auth instance whose currentUser starts null and is only populated
// once its own persisted-session restore completes — and if that restore
// doesn't actually find a session (root cause: fixed in this same phase by
// switching to 'firebase/auth/web-extension', see firebaseApp.js), it stays
// null forever, silently leaving the UI "looks signed in" while every
// personal saveItems call fails 401 unauthenticated.
//
// Session model under test (authService.js): firebaseAuth.currentUser (via
// authStateReady()/onAuthStateChanged) is the ONLY source of truth for
// isLoggedIn(). chrome.storage.local is a display cache only — a stored
// uid/email never satisfies authenticated state on its own.

const mockSignInWithCredential = jest.fn();
const mockOnAuthStateChanged = jest.fn();
const mockCredential = jest.fn();
let mockAuthInstance;
let mockFirebaseAppInstance;

class MockGoogleAuthProvider {
  static credential(...args) {
    return mockCredential(...args);
  }
}

jest.mock('../src/scripts/firebaseApp.js', () => ({
  firebaseApp: mockFirebaseAppInstance,
  firebaseAuth: mockAuthInstance,
}));

jest.mock('firebase/auth/web-extension', () => ({
  signInWithCredential: (...args) => mockSignInWithCredential(...args),
  onAuthStateChanged: (...args) => mockOnAuthStateChanged(...args),
  GoogleAuthProvider: MockGoogleAuthProvider,
}));

describe('auth session restoration after extension reload (P7.3-H)', () => {
  let storedUser;

  beforeEach(() => {
    jest.resetModules();
    mockSignInWithCredential.mockReset().mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockReset();
    mockCredential.mockReset().mockImplementation((idToken, accessToken) => ({ idToken, accessToken }));

    mockFirebaseAppInstance = { __app: true };
    // What a prior session left in chrome.storage.local before the reload —
    // this alone must never be treated as proof of authentication.
    storedUser = { uid: 'stale-uid', email: 'stale@example.com', displayName: 'Stale User', photoURL: '' };

    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async () => ({ user: storedUser })),
          set: jest.fn(async () => undefined),
          remove: jest.fn(async () => undefined),
        },
      },
      runtime: {
        getURL: jest.fn((path) => `chrome-extension://mock-id/${path}`),
        getContexts: jest.fn(async () => [{}]),
        sendMessage: jest.fn(),
        onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
      },
      offscreen: { createDocument: jest.fn(async () => undefined) },
    };
  });

  async function loadAuthService() {
    const mod = await import('../src/scripts/authService.js');
    // The constructor's own init() call is fire-and-forget; awaiting a
    // second, directly-referenced call gives a deterministic completion
    // point for its (idempotent) async chain — loadUserFromStorage() →
    // authStateReady() → syncAuthenticatedStateFromFirebase().
    await mod.default.init();
    return mod.default;
  }

  test('requirement 1: a stored profile with a null firebaseAuth.currentUser is NOT authenticated (Case 2 — session did not survive reload)', async () => {
    mockAuthInstance = { currentUser: null, authStateReady: jest.fn(async () => {}) };
    const authService = await loadAuthService();

    expect(authService.isLoggedIn()).toBe(false);
    expect(authService.getUser()).toBeNull();
    // The stale cache must not linger and imply authenticated on a later read.
    expect(global.chrome.storage.local.remove).toHaveBeenCalledWith('user');
  });

  test('requirement 2: a restored firebaseAuth.currentUser IS authenticated (Case 1 — session survived reload)', async () => {
    const restoredUser = { uid: 'restored-uid', email: 'restored@example.com', displayName: 'Restored User', photoURL: '' };
    mockAuthInstance = { currentUser: restoredUser, authStateReady: jest.fn(async () => {}) };
    const authService = await loadAuthService();

    expect(authService.isLoggedIn()).toBe(true);
    expect(authService.getUser()).toEqual(restoredUser);
    // No Google popup required — this reflects a genuinely restored session.
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  test('requirement 3: fresh sign-in still works after a reload where the prior session did not restore', async () => {
    mockAuthInstance = { currentUser: null, authStateReady: jest.fn(async () => {}) };
    const authService = await loadAuthService();
    expect(authService.isLoggedIn()).toBe(false);

    let messageListener;
    global.chrome.runtime.onMessage.addListener.mockImplementation((listener) => {
      messageListener = listener;
    });
    mockSignInWithCredential.mockImplementation(async () => {
      mockAuthInstance.currentUser = { uid: 'fresh-uid', email: 'fresh@example.com', displayName: 'Fresh User', photoURL: '' };
    });

    const signInPromise = authService.signInWithGoogle();
    for (let i = 0; i < 50 && !messageListener; i += 1) await Promise.resolve();

    messageListener({
      success: true,
      user: { uid: 'fresh-uid', email: 'fresh@example.com', displayName: 'Fresh User', photoURL: '' },
      credential: { idToken: 'ID_TOKEN', accessToken: 'ACCESS_TOKEN' },
    });
    await signInPromise;

    expect(authService.isLoggedIn()).toBe(true);
  });

  test('requirement 4: the personal-save userId gate (mirroring sidepanel.js\'s own logic) only resolves a uid when a real Firebase Auth session exists', async () => {
    // Mirrors sidepanel.js's handleSaveForLater(): `if (isLoggedIn && user && !isShared) userId = user.uid;`
    function resolvePersonalSaveUserId(authService, isShared) {
      const isLoggedIn = authService.isLoggedIn();
      const user = authService.getUser();
      return (isLoggedIn && user && !isShared) ? user.uid : null;
    }

    // Case 2: stored profile, no real session -> gate must stay null, so
    // saveAnalysis() takes the shared/unauthenticated path rather than
    // sending a doomed personal request.
    mockAuthInstance = { currentUser: null, authStateReady: jest.fn(async () => {}) };
    const notRestored = await loadAuthService();
    expect(resolvePersonalSaveUserId(notRestored, false)).toBeNull();

    // Case 1: real restored session -> gate resolves the real uid.
    jest.resetModules();
    const restoredUser = { uid: 'restored-uid', email: 'r@example.com', displayName: 'R', photoURL: '' };
    mockAuthInstance = { currentUser: restoredUser, authStateReady: jest.fn(async () => {}) };
    const restored = await loadAuthService();
    expect(resolvePersonalSaveUserId(restored, false)).toBe('restored-uid');
  });

  test('requirement 5: no raw ID token is ever written to chrome.storage.local', async () => {
    const restoredUser = {
      uid: 'restored-uid',
      email: 'restored@example.com',
      displayName: 'Restored User',
      photoURL: '',
      getIdToken: jest.fn(async () => 'RAW_ID_TOKEN_SHOULD_NEVER_BE_STORED'),
      stsTokenManager: { accessToken: 'RAW_ID_TOKEN_SHOULD_NEVER_BE_STORED' },
    };
    mockAuthInstance = { currentUser: restoredUser, authStateReady: jest.fn(async () => {}) };
    await loadAuthService();

    const storedCalls = global.chrome.storage.local.set.mock.calls;
    expect(storedCalls.length).toBeGreaterThan(0);
    for (const [payload] of storedCalls) {
      expect(JSON.stringify(payload)).not.toContain('RAW_ID_TOKEN_SHOULD_NEVER_BE_STORED');
      expect(payload.user).not.toHaveProperty('getIdToken');
      expect(payload.user).not.toHaveProperty('stsTokenManager');
      expect(payload.user).not.toHaveProperty('accessToken');
      expect(payload.user).not.toHaveProperty('idToken');
      // Only the display-safe fields authService.syncAuthenticatedStateFromFirebase() copies.
      expect(Object.keys(payload.user).sort()).toEqual(['displayName', 'email', 'photoURL', 'uid']);
    }
  });
});
