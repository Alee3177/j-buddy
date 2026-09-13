// jaAlchemyApiService.js no longer calls initializeApp()/getFunctions()
// itself — it imports the already-created shared instances from
// firebaseApp.js (see P7.3-F). Emulator-wiring behavior now lives in, and is
// tested by, firebaseApp.test.js.
//
// The mock factories below must be fully self-contained (no references to
// outer-scope consts): babel hoists the static `import` below above any
// plain `const` declarations in this file, so a factory closing over an
// outer variable would see it as still-unassigned at call time. Instead,
// the factories return their own literal objects, and jest.requireMock()
// retrieves the SAME cached instances afterwards for assertions.
jest.mock('../src/scripts/firebaseApp.js', () => ({
  firebaseApp: { __app: true },
  firebaseFunctions: { __functions: true },
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(),
}));

import JaAlchemyApiService from '../src/scripts/jaAlchemyApiService.js';

const { firebaseApp: mockAppInstance, firebaseFunctions: mockFunctionsInstance } =
  jest.requireMock('../src/scripts/firebaseApp.js');
const { httpsCallable: mockHttpsCallable } = jest.requireMock('firebase/functions');

describe('JaAlchemyApiService', () => {
  beforeEach(() => {
    mockHttpsCallable.mockReset();
  });

  test('reuses the shared Firebase App/Functions instances from firebaseApp.js', () => {
    const service = new JaAlchemyApiService();

    expect(service.app).toBe(mockAppInstance);
    expect(service.functions).toBe(mockFunctionsInstance);
  });

  test('renders callable stream chunks before completing managed-provider analysis', async () => {
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
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new JaAlchemyApiService().generateResponseStream(
      'テストです', 'v2', undefined, onChunk, onDone, onError, { signal: controller.signal }
    );

    expect(mockHttpsCallable).toHaveBeenCalledWith(mockFunctionsInstance, 'explainStreamCallable');
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
    mockHttpsCallable.mockReturnValue(callable);
    const onDone = jest.fn();
    const onError = jest.fn();

    await new JaAlchemyApiService().generateResponseStream(
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
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new JaAlchemyApiService().generateResponseStream(
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
    mockHttpsCallable.mockReturnValue(callable);
    const onDone = jest.fn();
    const onError = jest.fn();

    await new JaAlchemyApiService().generateResponseStream(
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
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new JaAlchemyApiService().generateResponseStream(
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
    mockHttpsCallable.mockReturnValue(callable);
    const onChunk = jest.fn();
    const onDone = jest.fn();
    const onError = jest.fn();

    await new JaAlchemyApiService().generateResponseStream(
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

    test('calls saveItems on the shared Functions instance with the unchanged request payload shape', async () => {
      const callable = jest.fn(async () => ({
        data: { success: true, saved: { words_count: 1, grammars_count: 1 }, message: 'saved' },
      }));
      mockHttpsCallable.mockReturnValue(callable);

      const analysis = baseAnalysis();
      await new JaAlchemyApiService().saveAnalysis(analysis, 'uid-123');

      expect(mockHttpsCallable).toHaveBeenCalledWith(mockFunctionsInstance, 'saveItems');
      expect(callable).toHaveBeenCalledWith({ userId: 'uid-123', analysis });
    });

    test('maps a successful response into { success, words_count, grammars_count, message }', async () => {
      const callable = jest.fn(async () => ({
        data: { success: true, saved: { words_count: 3, grammars_count: 2 }, message: '已成功儲存分析頁面！' },
      }));
      mockHttpsCallable.mockReturnValue(callable);

      const result = await new JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123');

      expect(result).toEqual({
        success: true,
        words_count: 3,
        grammars_count: 2,
        message: '已成功儲存分析頁面！',
      });
    });

    test('defaults missing saved counts to 0 and supplies a fallback message', async () => {
      const callable = jest.fn(async () => ({ data: { success: true } }));
      mockHttpsCallable.mockReturnValue(callable);

      const result = await new JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123');

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
      mockHttpsCallable.mockReturnValue(callable);

      const sharedAnalysis = { ...baseAnalysis(), is_shared: true };
      await new JaAlchemyApiService().saveAnalysis(sharedAnalysis, null);

      expect(callable).toHaveBeenCalledWith({ userId: null, analysis: sharedAnalysis });
    });

    test('translates an unauthenticated callable error into the personal-save sign-in message', async () => {
      const authError = Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
      const callable = jest.fn(async () => { throw authError; });
      mockHttpsCallable.mockReturnValue(callable);

      const personalAnalysis = { ...baseAnalysis(), is_shared: false };

      await expect(
        new JaAlchemyApiService().saveAnalysis(personalAnalysis, null)
      ).rejects.toThrow('您必須先登入，才能將項目儲存至私人收藏。');
    });

    test('does not apply the personal-save sign-in message to a shared-save error', async () => {
      const authError = Object.assign(new Error('unauthenticated'), { code: 'unauthenticated' });
      const callable = jest.fn(async () => { throw authError; });
      mockHttpsCallable.mockReturnValue(callable);

      const sharedAnalysis = { ...baseAnalysis(), is_shared: true };

      await expect(
        new JaAlchemyApiService().saveAnalysis(sharedAnalysis, null)
      ).rejects.toThrow('Firebase saveItems 函式失敗：unauthenticated');
    });

    test('throws the server-reported message when the callable resolves with success: false', async () => {
      const callable = jest.fn(async () => ({ data: { success: false, message: '儲存失敗：欄位錯誤' } }));
      mockHttpsCallable.mockReturnValue(callable);

      await expect(
        new JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123')
      ).rejects.toThrow('儲存失敗：欄位錯誤');
    });

    test('wraps a transport/unknown error with the generic saveItems failure message', async () => {
      const callable = jest.fn(async () => { throw new Error('network disconnected'); });
      mockHttpsCallable.mockReturnValue(callable);

      await expect(
        new JaAlchemyApiService().saveAnalysis(baseAnalysis(), 'uid-123')
      ).rejects.toThrow('Firebase saveItems 函式失敗：network disconnected');
    });
  });
});
