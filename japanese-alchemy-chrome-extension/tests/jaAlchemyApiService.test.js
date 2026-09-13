const mockInitializeApp = jest.fn();
const mockGetFunctions = jest.fn();
const mockConnectFunctionsEmulator = jest.fn();
const mockHttpsCallable = jest.fn();

jest.mock('firebase/app', () => ({
  initializeApp: (...args) => mockInitializeApp(...args),
}));

jest.mock('firebase/functions', () => ({
  getFunctions: (...args) => mockGetFunctions(...args),
  connectFunctionsEmulator: (...args) => mockConnectFunctionsEmulator(...args),
  httpsCallable: (...args) => mockHttpsCallable(...args),
}));

import '../src/scripts/jaAlchemyApiService.js';

describe('JaAlchemyApiService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete window.firebaseApp;
    mockInitializeApp.mockReset();
    mockGetFunctions.mockReset();
    mockConnectFunctionsEmulator.mockReset();
    mockHttpsCallable.mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('connects development builds to the Functions emulator before callable use', () => {
    const functions = {};
    process.env.NODE_ENV = 'development';
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue(functions);

    new window.JaAlchemyApiService();

    expect(mockConnectFunctionsEmulator).toHaveBeenCalledWith(functions, '127.0.0.1', 5001);
  });

  test('keeps production builds connected to deployed Functions', () => {
    process.env.NODE_ENV = 'production';
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});

    new window.JaAlchemyApiService();

    expect(mockConnectFunctionsEmulator).not.toHaveBeenCalled();
  });

  test('renders callable stream chunks before completing managed-provider analysis', async () => {
    const functions = {};
    const callable = jest.fn();
    const controller = new AbortController();
    callable.stream = jest.fn(async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { content: '分' };
          yield { content: '析' };
        },
      },
      data: Promise.resolve({ success: true }),
    }));
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue(functions);
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new window.JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, onChunk, onDone, onError, { signal: controller.signal }
    );

    expect(mockHttpsCallable).toHaveBeenCalledWith(functions, 'explainStreamCallable');
    expect(callable.stream).toHaveBeenCalledWith(
      { content: 'テストです', prompt: 'v2' },
      { signal: controller.signal }
    );
    expect(onChunk).toHaveBeenNthCalledWith(1, '分', '分');
    expect(onChunk).toHaveBeenNthCalledWith(2, '析', '分析');
    expect(onDone).toHaveBeenCalledWith('分析');
    expect(onError).not.toHaveBeenCalled();
  });

  test('silently stops a managed stream cancelled before its first chunk', async () => {
    const controller = new AbortController();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          controller.abort();
          throw abortError;
        },
      },
      data: Promise.reject(abortError),
    }));
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});
    mockHttpsCallable.mockReturnValue(callable);
    const onDone = jest.fn();
    const onError = jest.fn();

    await new window.JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, jest.fn(), onDone, onError, { signal: controller.signal }
    );

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('does not finalize partial managed text after cancellation', async () => {
    const controller = new AbortController();
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { content: '分' };
          controller.abort();
          throw abortError;
        },
      },
      data: Promise.reject(abortError),
    }));
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new window.JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, onChunk, onDone, onError, { signal: controller.signal }
    );

    expect(onChunk).toHaveBeenCalledWith('分', '分');
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('reports a callable failure before managed-provider content arrives', async () => {
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {},
      },
      data: Promise.resolve({ success: false, error: 'rate limited' }),
    }));
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});
    mockHttpsCallable.mockReturnValue(callable);
    const onDone = jest.fn();
    const onError = jest.fn();

    await new window.JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, jest.fn(), onDone, onError
    );

    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('rate limited');
  });

  test('reports a provider failure after partial content without finalizing analysis', async () => {
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { content: '分' };
        },
      },
      data: Promise.resolve({ success: false, error: 'provider unavailable' }),
    }));
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new window.JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, onChunk, onDone, onError
    );

    expect(onChunk).toHaveBeenCalledWith('分', '分');
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('provider unavailable');
  });

  test('reports a transport failure after partial content without finalizing analysis', async () => {
    const transportError = new Error('network disconnected');
    const callable = jest.fn();
    callable.stream = jest.fn(async () => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          yield { content: '分' };
        },
      },
      data: Promise.reject(transportError),
    }));
    mockInitializeApp.mockReturnValue({});
    mockGetFunctions.mockReturnValue({});
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new window.JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, onChunk, onDone, onError
    );

    expect(onChunk).toHaveBeenCalledWith('分', '分');
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('network disconnected');
  });

  describe('saveAnalysis', () => {
    const baseAnalysis = () => ({
      words: [{ term: '言葉', detail: 'word' }],
      grammars: [{ point: '文法', explanation: 'grammar point' }],
      page: { rendered_markdown: '# md', structured_json: { words: [], grammars: [] } },
      is_shared: false,
      metadata: { source_text: 'テキスト', source_url: 'https://example.com', saved_at: '2026-01-01T00:00:00.000Z' },
    });

    test('calls saveItems on the correct Functions client (us-central1) with the unchanged request payload shape', async () => {
      const functionsClient = {};
      const callable = jest.fn(async () => ({
        data: { success: true, saved: { words_count: 1, grammars_count: 1 }, message: 'saved' },
      }));
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue(functionsClient);
      mockHttpsCallable.mockReturnValue(callable);

      const analysis = baseAnalysis();
      await new window.JaAlchemyApiService().saveAnalysis(analysis, 'uid-123');

      expect(mockGetFunctions).toHaveBeenCalledWith(expect.anything(), 'us-central1');
      expect(mockHttpsCallable).toHaveBeenCalledWith(functionsClient, 'saveItems');
      expect(callable).toHaveBeenCalledWith({ userId: 'uid-123', analysis });
    });

    test('maps a successful response into { success, words_count, grammars_count, message }', async () => {
      const callable = jest.fn(async () => ({
        data: { success: true, saved: { words_count: 3, grammars_count: 2 }, message: '已成功儲存分析頁面！' },
      }));
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      const result = await new window.JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123');

      expect(result).toEqual({
        success: true,
        words_count: 3,
        grammars_count: 2,
        message: '已成功儲存分析頁面！',
      });
    });

    test('defaults missing saved counts to 0 and supplies a fallback message', async () => {
      const callable = jest.fn(async () => ({ data: { success: true } }));
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      const result = await new window.JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123');

      expect(result).toEqual({
        success: true,
        words_count: 0,
        grammars_count: 0,
        message: 'Analysis saved successfully',
      });
    });

    test('shared save sends a null userId regardless of the caller-supplied id', async () => {
      const callable = jest.fn(async () => ({
        data: { success: true, saved: { words_count: 0, grammars_count: 0 }, message: 'shared' },
      }));
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      const sharedAnalysis = { ...baseAnalysis(), is_shared: true };
      await new window.JaAlchemyApiService().saveAnalysis(sharedAnalysis, null);

      expect(callable).toHaveBeenCalledWith({ userId: null, analysis: sharedAnalysis });
    });

    test('translates an unauthenticated callable error into the personal-save sign-in message', async () => {
      const authError = Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
      const callable = jest.fn(async () => { throw authError; });
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      const personalAnalysis = { ...baseAnalysis(), is_shared: false };

      await expect(
        new window.JaAlchemyApiService().saveAnalysis(personalAnalysis, null)
      ).rejects.toThrow('您必須先登入，才能將項目儲存至私人收藏。');
    });

    test('does not apply the personal-save sign-in message to a shared-save error', async () => {
      const authError = Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
      const callable = jest.fn(async () => { throw authError; });
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      const sharedAnalysis = { ...baseAnalysis(), is_shared: true };

      await expect(
        new window.JaAlchemyApiService().saveAnalysis(sharedAnalysis, null)
      ).rejects.toThrow('Firebase saveItems 函式失敗：unauthenticated');
    });

    test('throws the server-reported message when the callable resolves with success: false', async () => {
      const callable = jest.fn(async () => ({ data: { success: false, message: '儲存失敗：欄位錯誤' } }));
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      await expect(
        new window.JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123')
      ).rejects.toThrow('儲存失敗：欄位錯誤');
    });

    test('wraps a transport/unknown error with the generic saveItems failure message', async () => {
      const callable = jest.fn(async () => { throw new Error('network disconnected'); });
      mockInitializeApp.mockReturnValue({});
      mockGetFunctions.mockReturnValue({});
      mockHttpsCallable.mockReturnValue(callable);

      await expect(
        new window.JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123')
      ).rejects.toThrow('Firebase saveItems 函式失敗：network disconnected');
    });
  });
});
