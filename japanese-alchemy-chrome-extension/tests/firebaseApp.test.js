const mockInitializeApp = jest.fn();
const mockGetAuth = jest.fn();
const mockGetFunctions = jest.fn();
const mockConnectFunctionsEmulator = jest.fn();

jest.mock('firebase/app', () => ({
  initializeApp: (...args) => mockInitializeApp(...args),
}));
jest.mock('firebase/auth/web-extension', () => ({
  getAuth: (...args) => mockGetAuth(...args),
}));
jest.mock('firebase/functions', () => ({
  getFunctions: (...args) => mockGetFunctions(...args),
  connectFunctionsEmulator: (...args) => mockConnectFunctionsEmulator(...args),
}));

describe('firebaseApp (single shared Firebase owner)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.resetModules();
    mockInitializeApp.mockReset();
    mockGetAuth.mockReset();
    mockGetFunctions.mockReset();
    mockConnectFunctionsEmulator.mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('initializes exactly one App and derives Auth/Functions from that same App', async () => {
    const appInstance = { __app: true };
    const authInstance = { __auth: true };
    const functionsInstance = { __functions: true };
    mockInitializeApp.mockReturnValue(appInstance);
    mockGetAuth.mockReturnValue(authInstance);
    mockGetFunctions.mockReturnValue(functionsInstance);
    process.env.NODE_ENV = 'production';

    const { firebaseApp, firebaseAuth, firebaseFunctions } = await import('../src/scripts/firebaseApp.js');

    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockGetAuth).toHaveBeenCalledWith(appInstance);
    expect(mockGetFunctions).toHaveBeenCalledWith(appInstance, 'us-central1');
    expect(firebaseApp).toBe(appInstance);
    expect(firebaseAuth).toBe(authInstance);
    expect(firebaseFunctions).toBe(functionsInstance);
  });

  test('connects the Functions emulator only for development builds', async () => {
    const functionsInstance = { __functions: true };
    mockInitializeApp.mockReturnValue({});
    mockGetAuth.mockReturnValue({});
    mockGetFunctions.mockReturnValue(functionsInstance);
    process.env.NODE_ENV = 'development';

    await import('../src/scripts/firebaseApp.js');

    expect(mockConnectFunctionsEmulator).toHaveBeenCalledWith(functionsInstance, '127.0.0.1', 5001);
  });

  test('keeps production builds connected to deployed Functions (no emulator wiring)', async () => {
    mockInitializeApp.mockReturnValue({});
    mockGetAuth.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});
    process.env.NODE_ENV = 'production';

    await import('../src/scripts/firebaseApp.js');

    expect(mockConnectFunctionsEmulator).not.toHaveBeenCalled();
  });
});
