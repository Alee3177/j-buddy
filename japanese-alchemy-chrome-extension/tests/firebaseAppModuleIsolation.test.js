// P7.3-E mechanism proof (no mocking — uses the real @firebase/app package).
// Corroborates, at the module-registry level, what grepping the actual
// production bundles already proved directly: dist/scripts/authService.bundle.js
// and dist/scripts/jaAlchemyApiService.bundle.js each independently embed
// @firebase/app's internal registry code (both contain the "already exists
// with different" duplicate-app error string, "No Firebase App" error
// string, and 7 occurrences each of the internal `registerVersion` call) —
// because webpack.config.js has no optimization.splitChunks/shared vendor
// chunk across its entries, so `authService` and `jaAlchemyApiService` are
// built as two fully independent module graphs.
describe('firebase/app module-registry isolation (mechanism proof, real SDK)', () => {
  test('two independently-loaded module graphs given IDENTICAL config do not share an App object', () => {
    const config = {
      apiKey: 'test-key',
      authDomain: 'test.firebaseapp.com',
      projectId: 'test-project',
      storageBucket: 'test.firebasestorage.app',
      messagingSenderId: '000',
      appId: '1:000:web:test',
    };

    let appFromIsolatedGraphA;
    jest.isolateModules(() => {
      const { initializeApp } = require('firebase/app');
      appFromIsolatedGraphA = initializeApp(config);
    });

    let appFromIsolatedGraphB;
    jest.isolateModules(() => {
      const { initializeApp } = require('firebase/app');
      appFromIsolatedGraphB = initializeApp(config);
    });

    expect(appFromIsolatedGraphA).toBeDefined();
    expect(appFromIsolatedGraphB).toBeDefined();
    // @firebase/app's own dedup-by-deepEqual logic (see
    // node_modules/@firebase/app/dist/index.cjs.js:621-622) only applies
    // WITHIN one module instance's private `_apps` registry. Across two
    // isolated instances — exactly what two separate webpack entry bundles
    // are — identical config still yields two distinct App objects.
    expect(appFromIsolatedGraphA).not.toBe(appFromIsolatedGraphB);
  });
});
