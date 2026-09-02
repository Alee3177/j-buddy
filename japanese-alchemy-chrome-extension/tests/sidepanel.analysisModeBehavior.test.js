import {
  analizingSelectedText,
  handleCancelAnalysis,
  handleSaveForLater,
  handleAnalysisModeChange,
  handleSidepanelStorageChanges,
  isValidSelection,
  setSidepanelElementsForTesting,
} from '../src/sidepanel/sidepanel.js';
import { buildContextCacheKey } from '../src/scripts/surroundingContext.js';

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add: jest.fn((name) => classes.add(name)),
    remove: jest.fn((name) => classes.delete(name)),
    toggle: jest.fn((name, force) => {
      if (force === undefined) {
        if (classes.has(name)) {
          classes.delete(name);
          return false;
        }
        classes.add(name);
        return true;
      }
      if (force) classes.add(name);
      else classes.delete(name);
      return force;
    }),
    contains: (name) => classes.has(name),
  };
}

function createButton(variant, selected = false) {
  return {
    dataset: { promptVariant: variant },
    classList: createClassList(selected ? ['selected'] : []),
    attributes: {},
    setAttribute: jest.fn(function setAttribute(name, value) {
      this.attributes[name] = value;
    }),
  };
}

function setupElements() {
  const prose = { innerHTML: 'stale result' };
  const loadingMessage = { textContent: 'AIによる分析中です。しばらくお待ちください...' };
  const result = {
    classList: createClassList(['show']),
    querySelector: jest.fn(() => prose),
  };
  const loading = {
    classList: createClassList(),
    querySelector: jest.fn((selector) => (selector === '.loading-message' ? loadingMessage : null)),
  };
  const alertMessage = {
    innerHTML: '',
    textContent: '',
    classList: createClassList(),
  };
  const compactButton = createButton('v1');
  const usageButton = createButton('v2', true);
  const copyButton = { disabled: true };
  const saveAsBtn = { disabled: true };
  const saveForLaterBtn = { disabled: true, classList: createClassList() };
  const cancelAnalysisButton = { hidden: true };
  const pendingSelectionStatus = {
    textContent: '',
    classList: createClassList(['show']),
  };
  const analyzeButton = { disabled: true };
  const elements = {
    alertMessage,
    analysisModeButtons: [compactButton, usageButton],
    analyzeButton,
    cancelAnalysisButton,
    copyButton,
    pendingSelectionStatus,
    prose,
    result,
    saveAsBtn,
    saveForLaterBtn,
  };

  document.getElementById = jest.fn((id) => {
    if (id === 'result') return result;
    if (id === 'loading') return loading;
    if (id === 'alertMessage') return alertMessage;
    if (id === 'pendingSelectionStatus') return pendingSelectionStatus;
    if (id === 'analyzeButton') return analyzeButton;
    return null;
  });

  setSidepanelElementsForTesting(elements);
  return {
    alertMessage,
    analyzeButton,
    compactButton,
    cancelAnalysisButton,
    copyButton,
    elements,
    loading,
    loadingMessage,
    pendingSelectionStatus,
    prose,
    result,
    saveAsBtn,
    saveForLaterBtn,
    usageButton,
  };
}

function setupStorage(initial = {}) {
  const store = { ...initial };
  global.chrome.storage.local.get = jest.fn(async (key) => {
    if (key === null) return { ...store };
    if (Array.isArray(key)) {
      return key.reduce((acc, item) => {
        acc[item] = store[item];
        return acc;
      }, {});
    }
    return { [key]: store[key] };
  });
  global.chrome.storage.local.set = jest.fn(async (obj) => {
    Object.assign(store, obj);
  });
  return store;
}

function setupLocalStorage(initial = {}) {
  const store = { ...initial };
  global.localStorage.getItem = jest.fn((key) => store[key] ?? null);
  global.localStorage.setItem = jest.fn((key, value) => {
    store[key] = value;
  });
  return store;
}

function completedProjection(cacheKey, overrides = {}) {
  return JSON.stringify({
    version: 1,
    cacheKey,
    response: '### 單字分析\n#### <單字>成長\ngrowth',
    html: '<h3>單字分析</h3><h4><input type="checkbox" name="words" value="成長">成長</h4><p>growth</p>',
    json: {
      words: [{ term: '成長', detail: 'growth' }],
      grammars: [],
    },
    ...overrides,
  });
}

function setupDeferredApi() {
  const calls = [];
  global.JaAlchemyApiService = class JaAlchemyApiService {
    async generateResponseStream(selectedText, promptVariant, context, onChunk, onDone, onError, options) {
      return new Promise((resolve) => {
        calls.push({
          selectedText,
          promptVariant,
          context,
          onChunk,
          onDone,
          onError,
          options,
          resolve,
        });
      });
    }
  };
  return calls;
}

async function flushMicrotasks(cycles = 10) {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
}

describe('sidepanel analysis-mode behavior', () => {
  beforeEach(() => {
    jest.useRealTimers();
    setupElements();
    setupStorage({ promptVariant: 'v2' });
    setupLocalStorage();
    setupDeferredApi();
  });

  test('validates the documented inclusive 2-500 character selection range', () => {
    expect(isValidSelection('あ')).toBe(false);
    expect(isValidSelection('あい')).toBe(true);
    expect(isValidSelection('あ'.repeat(500))).toBe(true);
    expect(isValidSelection('あ'.repeat(501))).toBe(false);
  });

  test('shows the pending selected text before analysis is confirmed', async () => {
    const { pendingSelectionStatus } = setupElements();
    const selectedText = '日'.repeat(500);
    setupStorage({
      selectedText,
      contextBefore: '私は',
      contextAfter: '毎日続けています。',
    });

    await handleSidepanelStorageChanges({ selectedText: { newValue: selectedText } });

    expect(pendingSelectionStatus.textContent).toContain(selectedText);
    expect(pendingSelectionStatus.textContent).toContain('開始分析');
  });

  test('includes the parsed structured analysis in a page save payload', async () => {
    const cacheKey = buildContextCacheKey({ selectedText: '成長', promptVariant: 'v2' });
    setupLocalStorage({ lastAnalysisResult: completedProjection(cacheKey) });
    setupElements();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/article' }]) };
    const saved = [];
    global.JaAlchemyApiService = class JaAlchemyApiService {
      async saveAnalysis(analysis) {
        saved.push(analysis);
        return { success: true };
      }
    };

    await analizingSelectedText('成長', {}, { promptVariant: 'v2' });
    await handleSaveForLater();

    expect(saved).toHaveLength(1);
    expect(saved[0].page.structured_json).toEqual({
      words: [{ term: '成長', detail: 'growth' }],
      grammars: [],
    });
  });

  test('mode switch persists v1 without starting analysis for the current selection', async () => {
    const text = '成長を後押しする';
    const context = { before: '制度が', after: 'という。' };
    const cachedV2Key = buildContextCacheKey({
      selectedText: text,
      context,
      promptVariant: 'v2',
    });
    setupLocalStorage({
      lastAnalysisKey: cachedV2Key,
      lastResponse: '# cached v2 response',
    });
    const apiCalls = setupDeferredApi();
    const { compactButton, prose, result, usageButton } = setupElements();
    const storage = setupStorage({ promptVariant: 'v2' });

    await analizingSelectedText(text, context, { promptVariant: 'v2' });
    expect(prose.innerHTML).toContain('cached v2 response');

    const changePromise = handleAnalysisModeChange(
      { alertMessage: { classList: createClassList(), innerHTML: '' }, analysisModeButtons: [compactButton, usageButton] },
      'v1'
    );
    await flushMicrotasks();

    expect(storage.promptVariant).toBe('v1');
    expect(compactButton.classList.contains('selected')).toBe(true);
    expect(usageButton.classList.contains('selected')).toBe(false);
    expect(result.classList.contains('show')).toBe(true);
    expect(prose.innerHTML).toContain('cached v2 response');
    expect(apiCalls).toHaveLength(0);
    await changePromise;
  });

  test('persists a versioned completed-result projection and restores it without another stream', async () => {
    const text = '成長を後押しする';
    const context = { before: '制度が', after: 'という。' };
    const apiCalls = setupDeferredApi();
    const initialRequest = analizingSelectedText(text, context, { promptVariant: 'v2' });
    await flushMicrotasks();

    apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
    apiCalls[0].resolve();
    await initialRequest;

    const cachedProjection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(cachedProjection).toEqual(expect.objectContaining({
      version: 1,
      cacheKey: global.localStorage.getItem('lastAnalysisKey'),
      response: expect.stringContaining('成長'),
      json: expect.objectContaining({
        words: [{ term: '成長', detail: 'growth' }],
      }),
    }));

    const { copyButton, prose, result, saveAsBtn, saveForLaterBtn } = setupElements();
    await analizingSelectedText(text, context, { promptVariant: 'v2' });

    expect(apiCalls).toHaveLength(1);
    expect(prose.innerHTML).toContain('成長');
    expect(result.classList.contains('show')).toBe(true);
    expect(copyButton.disabled).toBe(false);
    expect(saveAsBtn.disabled).toBe(false);
    expect(saveForLaterBtn.disabled).toBe(false);
  });

  test('a malformed completed-result projection falls back to matching canonical markdown', async () => {
    const text = '成長を後押しする';
    const context = { before: '制度が', after: 'という。' };
    const cacheKey = buildContextCacheKey({ selectedText: text, context, promptVariant: 'v2' });
    const apiCalls = setupDeferredApi();
    setupLocalStorage({
      lastAnalysisKey: cacheKey,
      lastResponse: '### 單字分析\n#### <單字>成長\ngrowth',
      lastAnalysisResult: '{not valid JSON',
    });
    const { prose } = setupElements();

    await analizingSelectedText(text, context, { promptVariant: 'v2' });

    expect(apiCalls).toHaveLength(0);
    expect(prose.innerHTML).toContain('成長');
    expect(JSON.parse(global.localStorage.getItem('lastAnalysisResult'))).toEqual(expect.objectContaining({
      version: 1,
      cacheKey,
    }));
  });

  test('restores a valid word-only projection without canonical markdown fallback', async () => {
    const text = '成長を後押しする';
    const cacheKey = buildContextCacheKey({ selectedText: text, promptVariant: 'v2' });
    const apiCalls = setupDeferredApi();
    setupLocalStorage({ lastAnalysisResult: completedProjection(cacheKey) });
    const { prose, result } = setupElements();

    await analizingSelectedText(text, {}, { promptVariant: 'v2' });

    expect(apiCalls).toHaveLength(0);
    expect(prose.innerHTML).toContain('成長');
    expect(result.classList.contains('show')).toBe(true);
  });

  test('a matching cache key without a valid projection or canonical result clears stale output and streams', async () => {
    const text = '成長を後押しする';
    const cacheKey = buildContextCacheKey({ selectedText: text, promptVariant: 'v2' });
    const apiCalls = setupDeferredApi();
    setupLocalStorage({
      lastAnalysisKey: cacheKey,
      lastAnalysisResult: '{not valid JSON',
    });
    const { loading, prose, result } = setupElements();

    const request = analizingSelectedText(text, {}, { promptVariant: 'v2' });
    await flushMicrotasks();

    expect(apiCalls).toHaveLength(1);
    expect(prose.innerHTML).toBe('');
    expect(result.classList.contains('show')).toBe(false);
    expect(loading.classList.contains('show')).toBe(true);

    apiCalls[0].onError('unavailable');
    apiCalls[0].resolve();
    await request;
  });

  test('manually stops an active analysis before the first chunk without creating a result', async () => {
    const apiCalls = setupDeferredApi();
    const {
      cancelAnalysisButton,
      copyButton,
      elements,
      loading,
      result,
      saveAsBtn,
      saveForLaterBtn,
    } = setupElements();

    const request = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
    await flushMicrotasks();

    expect(cancelAnalysisButton.hidden).toBe(false);
    expect(loading.classList.contains('show')).toBe(true);

    handleCancelAnalysis(elements);

    expect(apiCalls[0].options.signal.aborted).toBe(true);
    expect(cancelAnalysisButton.hidden).toBe(true);
    expect(loading.classList.contains('show')).toBe(false);
    expect(result.classList.contains('show')).toBe(false);
    expect(copyButton.disabled).toBe(true);
    expect(saveAsBtn.disabled).toBe(true);
    expect(saveForLaterBtn.disabled).toBe(true);
    expect(global.localStorage.getItem('lastAnalysisResult')).toBeNull();

    apiCalls[0].onDone('# stale response');
    apiCalls[0].resolve();
    await request;
  });

  test('a cache-only provider storage update does not cancel active analysis', async () => {
    const apiCalls = setupDeferredApi();
    const { elements } = setupElements();
    const request = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
    await flushMicrotasks();

    await handleSidepanelStorageChanges({
      'personalProviderModelCatalog:3': { oldValue: null, newValue: { version: 1 } },
    }, 'local', elements);

    expect(apiCalls[0].options.signal.aborted).toBe(false);
    apiCalls[0].onDone('# completed response');
    apiCalls[0].resolve();
    await request;
  });

  test('manually stops an active personal-provider request before its first chunk', async () => {
    setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 2,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1', apiKey: 'key', model: 'model',
      },
    });
    global.chrome.permissions.contains = jest.fn(async () => true);
    let requestSignal;
    global.fetch = jest.fn((_url, options) => new Promise((resolve, reject) => {
      requestSignal = options.signal;
      options.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }));
    const { cancelAnalysisButton, elements, loading, result } = setupElements();

    const request = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
    await flushMicrotasks();

    expect(cancelAnalysisButton.hidden).toBe(false);
    handleCancelAnalysis(elements);
    await request;

    expect(requestSignal.aborted).toBe(true);
    expect(loading.classList.contains('show')).toBe(false);
    expect(result.classList.contains('show')).toBe(false);
    expect(global.localStorage.getItem('lastAnalysisResult')).toBeNull();
  });

  test('keeps a clearly marked but non-completable preview when manually stopped after streamed text', async () => {
    const apiCalls = setupDeferredApi();
    const {
      alertMessage,
      cancelAnalysisButton,
      copyButton,
      elements,
      prose,
      result,
      saveAsBtn,
      saveForLaterBtn,
    } = setupElements();

    const request = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onChunk('途中', '# 途中の分析');

    handleCancelAnalysis(elements);

    expect(apiCalls[0].options.signal.aborted).toBe(true);
    expect(cancelAnalysisButton.hidden).toBe(true);
    expect(result.classList.contains('show')).toBe(true);
    expect(prose.innerHTML).toContain('途中の分析');
    expect(alertMessage.textContent).toContain('未完成');
    expect(alertMessage.classList.contains('show')).toBe(true);
    expect(copyButton.disabled).toBe(true);
    expect(saveAsBtn.disabled).toBe(true);
    expect(saveForLaterBtn.disabled).toBe(true);
    expect(global.localStorage.getItem('lastAnalysisResult')).toBeNull();

    apiCalls[0].onDone('# stale response');
    apiCalls[0].resolve();
    await request;
  });

  test('a failed replacement clears its preview without replacing the completed cache', async () => {
    const text = '成長を後押しする';
    const oldKey = buildContextCacheKey({ selectedText: text, promptVariant: 'v2' });
    const oldResponse = '### 單字分析\n#### <單字>成長\ngrowth';
    const oldProjection = completedProjection(oldKey, { response: oldResponse });
    const apiCalls = setupDeferredApi();
    setupLocalStorage({
      lastAnalysisKey: oldKey,
      lastResponse: oldResponse,
      lastAnalysisResult: oldProjection,
    });
    const { prose, result } = setupElements();

    const request = analizingSelectedText('最新の選択', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onChunk('途中', '途中の分析');
    apiCalls[0].onError('unavailable');
    apiCalls[0].resolve();
    await request;

    expect(prose.innerHTML).toBe('');
    expect(result.classList.contains('show')).toBe(false);
    expect(global.localStorage.getItem('lastAnalysisKey')).toBe(oldKey);
    expect(global.localStorage.getItem('lastResponse')).toBe(oldResponse);
    expect(global.localStorage.getItem('lastAnalysisResult')).toBe(oldProjection);
  });

  test('does not pair an interrupted legacy cache write with another projection', async () => {
    const oldText = '以前の選択';
    const newText = '新しい選択';
    const oldKey = buildContextCacheKey({ selectedText: oldText, promptVariant: 'v2' });
    const newKey = buildContextCacheKey({ selectedText: newText, promptVariant: 'v2' });
    const apiCalls = setupDeferredApi();
    setupLocalStorage({
      lastAnalysisKey: oldKey,
      lastResponse: 'new response written before the legacy key failed',
      lastAnalysisResult: completedProjection(newKey, {
        response: 'new response written atomically in the projection',
      }),
    });

    const request = analizingSelectedText(oldText, {}, { promptVariant: 'v2' });
    await flushMicrotasks();

    expect(apiCalls).toHaveLength(1);
    apiCalls[0].onError('unavailable');
    apiCalls[0].resolve();
    await request;
  });

  test('stale stream callbacks and queued previews cannot overwrite the latest mode result', async () => {
    jest.useFakeTimers();
    const text = '成長を後押しする';
    const context = { before: '制度が', after: 'という。' };
    const apiCalls = setupDeferredApi();
    const { prose } = setupElements();

    const oldRequest = analizingSelectedText(text, context, {
      force: true,
      promptVariant: 'v2',
    });
    await flushMicrotasks();
    apiCalls[0].onChunk('', '# old preview');

    const newRequest = analizingSelectedText(text, context, {
      force: true,
      promptVariant: 'v1',
    });
    await flushMicrotasks();
    expect(apiCalls[0].options.signal.aborted).toBe(true);
    apiCalls[1].onDone('# latest v1 response');
    apiCalls[1].resolve();
    await newRequest;

    jest.advanceTimersByTime(100);
    apiCalls[0].onDone('# stale v2 response');
    apiCalls[0].resolve();
    await oldRequest;

    expect(prose.innerHTML).toContain('latest v1 response');
    expect(prose.innerHTML).not.toContain('old preview');
    expect(prose.innerHTML).not.toContain('stale v2 response');
    expect(global.localStorage.getItem('lastResponse')).toContain('latest v1 response');
  });

  test('aborts a managed stream before replacement setup finishes', async () => {
    const apiCalls = setupDeferredApi();
    const { prose } = setupElements();
    const older = analizingSelectedText('成長を後押しする', {}, {
      force: true,
      promptVariant: 'v2',
    });
    await flushMicrotasks();

    const getStorage = global.chrome.storage.local.get;
    let resolvePromptVariant;
    global.chrome.storage.local.get = jest.fn((key) => {
      if (key === 'promptVariant') {
        return new Promise((resolve) => {
          resolvePromptVariant = resolve;
        });
      }
      return getStorage(key);
    });

    const newer = analizingSelectedText('最新の選択', {}, { force: true });

    expect(apiCalls[0].options.signal.aborted).toBe(true);
    apiCalls[0].onDone('# stale response');
    apiCalls[0].resolve();
    await older;
    expect(prose.innerHTML).not.toContain('stale response');

    resolvePromptVariant({ promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[1].onDone('# latest response');
    apiCalls[1].resolve();
    await newer;

    expect(prose.innerHTML).toContain('latest response');
  });

  test('keeps the active managed stream for a duplicate non-forced selection', async () => {
    const apiCalls = setupDeferredApi();
    const text = '成長を後押しする';
    const context = { before: '制度が', after: 'という。' };
    const firstRequest = analizingSelectedText(text, context, { promptVariant: 'v2' });
    await flushMicrotasks();

    await analizingSelectedText(text, context, { promptVariant: 'v2' });

    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0].options.signal.aborted).toBe(false);
    apiCalls[0].onDone('# completed response');
    apiCalls[0].resolve();
    await firstRequest;
  });

  test('allows retrying a selection after asynchronous setup fails', async () => {
    const apiCalls = setupDeferredApi();
    const { alertMessage, loading, prose, result } = setupElements();
    const text = '成長を後押しする';
    const context = { before: '制度が', after: 'という。' };
    global.chrome.storage.local.get.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(analizingSelectedText(text, context)).resolves.toBeUndefined();
    expect(loading.classList.contains('show')).toBe(false);
    expect(prose.innerHTML).toBe('');
    expect(result.classList.contains('show')).toBe(false);
    expect(alertMessage.classList.contains('show')).toBe(true);

    const retry = analizingSelectedText(text, context, { promptVariant: 'v2' });
    await flushMicrotasks();
    expect(apiCalls).toHaveLength(1);
    apiCalls[0].onDone('# retry response');
    apiCalls[0].resolve();
    await retry;
  });

  test('updates the loading message after receiving the first response chunk', async () => {
    const text = '成長を後押しする';
    const apiCalls = setupDeferredApi();
    const { loading, loadingMessage } = setupElements();

    const request = analizingSelectedText(text, {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onChunk('解析', '解析');

    expect(loadingMessage.textContent).toBe('已收到分析結果，正在整理版面…');
    expect(loading.classList.contains('show')).toBe(true);

    apiCalls[0].onDone('解析');
    apiCalls[0].resolve();
    await request;
  });

  test('a 429 resets loading and offers no alternate-provider retry', async () => {
    const apiCalls = setupDeferredApi();
    const { alertMessage, loading } = setupElements();

    const request = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onError('Stream request failed: 429 Too many requests');
    apiCalls[0].resolve();
    await request;

    expect(apiCalls).toHaveLength(1);
    expect(loading.classList.contains('show')).toBe(false);
    expect(alertMessage.innerHTML).not.toContain('Retry with ZAI');
    expect(alertMessage.innerHTML).not.toContain('retryWithZaiBtn');
  });

  test('personal mode calls the configured provider directly and keeps its cache separate', async () => {
    const text = '成長を後押しする';
    const storage = setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 4,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1',
        apiKey: 'personal-secret-key',
        model: 'learner-model',
      },
    });
    global.chrome.permissions.contains = jest.fn(async () => true);
    const managedService = jest.fn();
    global.JaAlchemyApiService = managedService;
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        choices: [{ message: { content: '### 單字分析\n#### <單字>成長' }, finish_reason: 'stop' }],
      }),
    }));
    const { prose } = setupElements();

    await analizingSelectedText(text, {}, { promptVariant: 'v2' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://llm.example/v1/chat/completions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer personal-secret-key' }) })
    );
    expect(prose.innerHTML).toContain('成長');
    expect(global.localStorage.getItem('lastAnalysisKey')).toContain('personal:4');
    expect(global.localStorage.getItem('lastAnalysisKey')).not.toContain('personal-secret-key');
    expect(storage.analysisProviderMode).toBe('personal');
    expect(managedService).not.toHaveBeenCalled();
  });

  test('a manually configured Responses-compatible provider completes analysis through the existing sidepanel flow', async () => {
    const text = '成長を後押しする';
    setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 5,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1',
        apiKey: 'personal-secret-key',
        model: 'manual-responses-model',
        protocol: 'responses',
      },
    });
    global.chrome.permissions.contains = jest.fn(async () => true);
    const managedService = jest.fn();
    global.JaAlchemyApiService = managedService;
    global.fetch = jest.fn(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        status: 'completed',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '### 單字分析\n#### <單字>成長' }],
        }],
      }),
    }));
    const { prose } = setupElements();

    await analizingSelectedText(text, {}, { promptVariant: 'v2' });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://llm.example/v1/responses',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer personal-secret-key' }) })
    );
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      store: false,
      stream: true,
    }));
    expect(prose.innerHTML).toContain('成長');
    expect(global.localStorage.getItem('lastAnalysisKey')).toContain('personal:5');
    expect(managedService).not.toHaveBeenCalled();
  });

  test('a ready personal-provider cache hit is sanitized before it renders and never calls Firebase', async () => {
    const text = '成長を後押しする';
    const cacheKey = buildContextCacheKey({
      selectedText: text,
      promptVariant: 'v2',
      sourceIdentity: 'personal:4',
    });
    setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 4,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1', apiKey: 'personal-secret-key', model: 'learner-model',
      },
    });
    setupLocalStorage({
      lastAnalysisKey: cacheKey,
      lastResponse: '#### <單字>安全\n<img src=x onerror="alert(1)"><script>alert(1)</script>',
    });
    global.chrome.permissions.contains = jest.fn(async () => true);
    const managedService = jest.fn();
    global.JaAlchemyApiService = managedService;
    global.fetch = jest.fn();
    const { prose } = setupElements();

    await analizingSelectedText(text, {}, { promptVariant: 'v2' });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(managedService).not.toHaveBeenCalled();
    expect(prose.innerHTML).toContain('安全');
    expect(prose.innerHTML).not.toContain('<script');
    expect(prose.innerHTML).not.toContain('onerror=');
  });

  test('revoked personal-provider access cannot render a matching cached result', async () => {
    const text = '成長を後押しする';
    const cacheKey = buildContextCacheKey({
      selectedText: text,
      promptVariant: 'v2',
      sourceIdentity: 'personal:4',
    });
    setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 4,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1', apiKey: 'personal-secret-key', model: 'learner-model',
      },
    });
    setupLocalStorage({
      lastAnalysisKey: cacheKey,
      lastResponse: '### 單字分析\n#### <單字>stale cached result',
    });
    global.chrome.permissions.contains = jest.fn(async () => false);
    global.fetch = jest.fn();
    const { alertMessage, prose, result } = setupElements();

    await analizingSelectedText(text, {}, { promptVariant: 'v2' });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(prose.innerHTML).toBe('');
    expect(result.classList.contains('show')).toBe(false);
    expect(alertMessage.textContent).toContain('請先允許存取此提供者');
  });

  test('a personal-provider failure stays personal and never caches a partial result', async () => {
    const storage = setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 2,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1', apiKey: 'key', model: 'model',
      },
    });
    global.chrome.permissions.contains = jest.fn(async () => true);
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => '<b>rate limited</b>',
    }));
    const { alertMessage, prose } = setupElements();

    await analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(storage.analysisProviderMode).toBe('personal');
    expect(global.localStorage.getItem('lastAnalysisKey')).toBeNull();
    expect(global.localStorage.getItem('lastResponse')).toBeNull();
    expect(alertMessage.textContent).toContain('個人提供者');
    expect(alertMessage.textContent).not.toContain('<b>');
    expect(prose.innerHTML).toBe('');
  });

  test('a newer personal analysis aborts the older direct stream without showing an error', async () => {
    const storage = setupStorage({
      promptVariant: 'v2',
      analysisProviderMode: 'personal',
      personalProviderRevision: 2,
      personalProviderProfile: {
        apiUrl: 'https://llm.example/v1', apiKey: 'key', model: 'model',
      },
    });
    global.chrome.permissions.contains = jest.fn(async () => true);
    const requestSignals = [];
    global.fetch = jest.fn((_url, options) => {
      requestSignals.push(options.signal);
      if (requestSignals.length === 1) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted.');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        });
      }
      return Promise.resolve({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{ message: { content: '### 單字分析\n#### <單字>最新' }, finish_reason: 'stop' }],
        }),
      });
    });
    const { alertMessage, prose } = setupElements();

    const older = analizingSelectedText('成長を後押しする', {}, { force: true, promptVariant: 'v2' });
    await flushMicrotasks();
    const newer = analizingSelectedText('最新の選択', {}, { force: true, promptVariant: 'v2' });
    await newer;
    await older;

    expect(requestSignals).toHaveLength(2);
    expect(requestSignals[0].aborted).toBe(true);
    expect(storage.analysisProviderMode).toBe('personal');
    expect(alertMessage.classList.contains('show')).toBe(false);
    expect(prose.innerHTML).toContain('最新');
  });

  test('rapid mode clicks keep the last requested mode when storage reads finish out of order', async () => {
    const { compactButton, elements, usageButton } = setupElements();
    const getResolvers = [];
    const storage = setupStorage({ promptVariant: 'v2' });
    global.chrome.storage.local.get = jest.fn(
      () => new Promise((resolve) => getResolvers.push(resolve))
    );

    const firstClick = handleAnalysisModeChange(elements, 'v1');
    await Promise.resolve();
    const secondClick = handleAnalysisModeChange(elements, 'v2');
    await Promise.resolve();

    getResolvers[1]({ promptVariant: 'v2' });
    await secondClick;
    getResolvers[0]({ promptVariant: 'v2' });
    await firstClick;

    expect(storage.promptVariant).toBe('v2');
    expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    expect(compactButton.classList.contains('selected')).toBe(false);
    expect(usageButton.classList.contains('selected')).toBe(true);
  });

  test('mode switch without a valid selection updates preference without calling the API', async () => {
    const apiCalls = setupDeferredApi();
    const { elements, result } = setupElements();
    const storage = setupStorage({ promptVariant: 'v2' });

    await analizingSelectedText('', {}, { promptVariant: 'v2' });
    await handleAnalysisModeChange(elements, 'v1');

    expect(storage.promptVariant).toBe('v1');
    expect(apiCalls).toHaveLength(0);
    expect(result.classList.contains('show')).toBe(false);
  });
});

describe('sidepanel analysis-mode behavior — v0.2 Phase 1B ruby-contract finalize wiring', () => {
  beforeEach(() => {
    jest.useRealTimers();
    setupElements();
    setupStorage({ promptVariant: 'v2' });
    setupLocalStorage();
    setupDeferredApi();
  });

  test('A/F: the completed analysis normalizes duplicated-surface ruby before render + store', async () => {
    const apiCalls = setupDeferredApi();
    const { prose } = setupElements();

    const request = analizingSelectedText('3日以降の天気', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone('3{日|みっか}以降{以降|いこう}');
    apiCalls[0].resolve();
    await request;

    // canonical markdown (Copy / Save-As / save payload source) is repaired
    expect(global.localStorage.getItem('lastResponse')).toBe('3{日|みっか}{以降|いこう}');
    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.response).toBe('3{日|みっか}{以降|いこう}');
    // rendered panel carries no leftover plain-text duplicate
    expect(prose.innerHTML).toContain('<rb>以降</rb>');
    expect(prose.innerHTML).not.toContain('以降<ruby>');
  });

  test('F: Save For Later persists the normalized markdown in page.rendered_markdown', async () => {
    const calls = [];
    const saved = [];
    global.JaAlchemyApiService = class {
      async generateResponseStream(selectedText, promptVariant, context, onChunk, onDone, onError, options) {
        return new Promise((resolve) => { calls.push({ onDone, onError, options, resolve }); });
      }
      async saveAnalysis(analysis) { saved.push(analysis); return { success: true }; }
    };
    setupElements();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/a' }]) };

    const request = analizingSelectedText('3日以降について', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone('3{日|みっか}以降{以降|いこう}について{解説|かいせつ}する');
    calls[0].resolve();
    await request;

    await handleSaveForLater();

    expect(saved).toHaveLength(1);
    expect(saved[0].page.rendered_markdown).toBe('3{日|みっか}{以降|いこう}について{解説|かいせつ}する');
    expect(saved[0].page.rendered_markdown).not.toContain('以降{以降');
  });

  test('C/D: ambiguous malformed ruby is left byte-for-byte unchanged and does not block completion', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { result, saveForLaterBtn, copyButton } = setupElements();

      const request = analizingSelectedText('川が流れ込む地域', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('{流|なが}れ込|こ}み');
      apiCalls[0].resolve();
      await request;

      // source untouched
      expect(global.localStorage.getItem('lastResponse')).toBe('{流|なが}れ込|こ}み');
      expect(JSON.parse(global.localStorage.getItem('lastAnalysisResult')).response)
        .toBe('{流|なが}れ込|こ}み');
      // still completes: result shown, completion-only actions enabled
      expect(result.classList.contains('show')).toBe(true);
      expect(saveForLaterBtn.disabled).toBe(false);
      expect(copyButton.disabled).toBe(false);

      // exactly one aggregated developer warning, issue codes only, no secrets
      const rubyWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[ruby-contract]'));
      expect(rubyWarns).toHaveLength(1);
      expect(rubyWarns[0][0]).toContain('MISSING_OPEN_BRACE');
      expect(rubyWarns[0][0]).toContain('UNBALANCED_BRACE');
      expect(rubyWarns[0][0]).not.toMatch(/apiKey|Bearer|Authorization/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('D: a semantic reading warning (3{日|にち}) is reported but the reading is never rewritten', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();

      const request = analizingSelectedText('3日以降の予報', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('3{日|にち}{以降|いこう}');
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe('3{日|にち}{以降|いこう}');
      const rubyWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('[ruby-contract]'));
      expect(rubyWarns).toHaveLength(1);
      expect(rubyWarns[0][0]).toContain('SUSPECT_COUNTER_READING');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('E: valid completed output is unchanged and logs no ruby-contract warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('{台風|たいふう}が{接近|せっきん}する');
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe('{台風|たいふう}が{接近|せっきん}する');
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('[ruby-contract]'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('sidepanel analysis-mode behavior — v0.2 Phase 2B-1 reading-contract separation', () => {
  const readingFence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';
  const validContract = {
    reading_contract_version: 1,
    source_text: '3日以降',
    tokens: [
      { text: '3', reading: null },
      { text: '日', reading: 'みっか' },
      { text: '以降', reading: 'いこう' },
    ],
  };

  beforeEach(() => {
    jest.useRealTimers();
    setupElements();
    setupStorage({ promptVariant: 'v2' });
    setupLocalStorage();
    setupDeferredApi();
  });

  test('A: a valid final reading contract is stripped from the rendered panel and the stored response', async () => {
    const apiCalls = setupDeferredApi();
    const { prose } = setupElements();
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';
    const groundedContract = {
      reading_contract_version: 1,
      source_text: '台風が接近する',
      tokens: [
        { text: '台風', reading: 'たいふう' },
        { text: 'が', reading: null },
        { text: '接近', reading: 'せっきん' },
        { text: 'する', reading: null },
      ],
    };

    const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(`${human}\n\n${readingFence(groundedContract)}`);
    apiCalls[0].resolve();
    await request;

    expect(prose.innerHTML).not.toContain('reading_contract_version');
    expect(global.localStorage.getItem('lastResponse')).toBe(human);
    expect(global.localStorage.getItem('lastResponse')).not.toContain('reading_contract_version');
    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.response).toBe(human);
    expect(projection.html).not.toContain('reading_contract_version');
    // projection top-level schema/version unchanged (v0.3 reading data, when
    // persisted, rides INSIDE json.reading — never as a new top-level field)
    expect(Object.keys(projection).sort()).toEqual(['cacheKey', 'html', 'json', 'response', 'version']);
  });

  test('B: page.rendered_markdown saved later contains no reading contract', async () => {
    const calls = [];
    const saved = [];
    global.JaAlchemyApiService = class {
      async generateResponseStream(selectedText, promptVariant, context, onChunk, onDone, onError, options) {
        return new Promise((resolve) => { calls.push({ onDone, resolve }); });
      }
      async saveAnalysis(analysis) { saved.push(analysis); return { success: true }; }
    };
    setupElements();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/a' }]) };
    const human = '### 原句\n  - {沖縄|おきなわ}に{最接近|さいせっきん}\n\n### 單字分析\n#### <單字>{最接近|さいせっきん}する\n  - 解釋：x';

    const request = analizingSelectedText('沖縄に最接近', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence({
      reading_contract_version: 1,
      source_text: '沖縄に最接近',
      tokens: [
        { text: '沖縄', reading: 'おきなわ' },
        { text: 'に', reading: null },
        { text: '最接近', reading: 'さいせっきん' },
      ],
    })}`);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    expect(saved).toHaveLength(1);
    expect(saved[0].page.rendered_markdown).toBe(human);
    expect(saved[0].page.rendered_markdown).not.toContain('reading_contract_version');
    expect(saved[0].page.rendered_markdown).not.toContain('```');
  });

  test('C: safe ruby repair still runs AFTER the contract is stripped (order: separate → reconcile → repair)', async () => {
    const apiCalls = setupDeferredApi();
    setupElements();
    // duplicated-surface ruby in the ### 原句 line + a grounded trailing contract
    const human = '### 原句\n  - 3{日|みっか}以降{以降|いこう}\n\n### 文法分析\n（無）';

    const request = analizingSelectedText('3日以降', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(`${human}\n\n${readingFence(validContract)}`);
    apiCalls[0].resolve();
    await request;

    // contract gone AND the duplicated surface resolved (by reconcile, then a
    // repairRuby no-op) — final source line is canonical
    const response = global.localStorage.getItem('lastResponse');
    expect(response).toContain('  - 3{日|みっか}{以降|いこう}');
    expect(response).not.toContain('以降{以降');
    expect(response).not.toContain('reading_contract_version');
  });

  test('D: an invalid final reading contract is NOT stripped; analysis completes with one contract warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { result, saveForLaterBtn } = setupElements();
      const human = '### 原句\n  - {雨|あめ}が{降|ふ}る';
      // source_text does not match the token concatenation → SOURCE_MISMATCH
      const badContract = {
        reading_contract_version: 1,
        source_text: '雨が降る',
        tokens: [{ text: '雨', reading: 'あめ' }, { text: 'が', reading: null }, { text: '振る', reading: 'ふる' }],
      };
      const full = `${human}\n\n${readingFence(badContract)}`;

      const request = analizingSelectedText('雨が降る', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(full);
      apiCalls[0].resolve();
      await request;

      // analysis completed
      expect(result.classList.contains('show')).toBe(true);
      expect(saveForLaterBtn.disabled).toBe(false);
      // the invalid block was left in place (never delete unproven content)
      expect(global.localStorage.getItem('lastResponse')).toContain('reading_contract_version');
      // exactly one aggregated "invalid reading contract" warning, codes only
      const contractWarns = warnSpy.mock.calls
        .filter((c) => String(c[0]).includes('invalid reading contract'));
      expect(contractWarns).toHaveLength(1);
      expect(contractWarns[0][0]).toContain('READING_CONTRACT_SOURCE_MISMATCH');
      expect(contractWarns[0][0]).not.toMatch(/雨|降|振|source_text|apiKey|Bearer|Authorization/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('E: a V1-style response with no reading contract behaves exactly as before, no warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v1' });
      await flushMicrotasks();
      apiCalls[0].onDone('### 原句\n  - {台風|たいふう}が{接近|せっきん}する');
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe('### 原句\n  - {台風|たいふう}が{接近|せっきん}する');
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('reading contract'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('sidepanel analysis-mode behavior — v0.2 Phase 2B-2 authoritative ruby reconciliation', () => {
  const readingFence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';

  beforeEach(() => {
    jest.useRealTimers();
    setupElements();
    setupStorage({ promptVariant: 'v2' });
    setupLocalStorage();
    setupDeferredApi();
  });

  test('A: a wrong contextual date reading in ### 原句 is corrected from the contract', async () => {
    const apiCalls = setupDeferredApi();
    setupElements();
    const human = '### 原句\n  - 3{日|にち}{以降|いこう}\n  - 翻譯：from the 3rd\n\n### 文法分析\n（無）';
    const contract = {
      reading_contract_version: 1,
      source_text: '3日以降',
      tokens: [
        { text: '3', reading: null },
        { text: '日', reading: 'みっか' },
        { text: '以降', reading: 'いこう' },
      ],
    };

    const request = analizingSelectedText('3日以降', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    apiCalls[0].resolve();
    await request;

    const response = global.localStorage.getItem('lastResponse');
    expect(response).toContain('  - 3{日|みっか}{以降|いこう}');
    expect(response).not.toContain('3{日|にち}');
    expect(response).toContain('  - 翻譯：from the 3rd'); // translation untouched
    expect(response).not.toContain('reading_contract_version'); // 2B-1 still strips the block
  });

  test('B: a wrong ruby span in ### 原句 is corrected from token boundaries', async () => {
    const apiCalls = setupDeferredApi();
    setupElements();
    const human = '### 原句\n  - {関東も週末|かんとう}{警戒|けいかい}\n\n### 文法分析\n（無）';
    const contract = {
      reading_contract_version: 1,
      source_text: '関東も週末警戒',
      tokens: [
        { text: '関東', reading: 'かんとう' },
        { text: 'も', reading: null },
        { text: '週末', reading: 'しゅうまつ' },
        { text: '警戒', reading: 'けいかい' },
      ],
    };

    const request = analizingSelectedText('関東も週末警戒', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    apiCalls[0].resolve();
    await request;

    const response = global.localStorage.getItem('lastResponse');
    expect(response).toContain('  - {関東|かんとう}も{週末|しゅうまつ}{警戒|けいかい}');
    expect(response).not.toContain('関東も週末|かんとう');
  });

  test('HALLUCINATION GUARD: contract self-consistent with ### 原句 but not the selected text → no rewrite, one grounding warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { result, saveForLaterBtn } = setupElements();
      // model fabricates "25" consistently in BOTH ### 原句 and the contract
      const human = '### 原句\n  - {台風|たいふう}25{号|ごう}{発生|はっせい}\n\n### 文法分析\n（無）';
      const contract = {
        reading_contract_version: 1,
        source_text: '台風25号発生',
        tokens: [
          { text: '台風', reading: 'たいふう' },
          { text: '25', reading: null },
          { text: '号', reading: 'ごう' },
          { text: '発生', reading: 'はっせい' },
        ],
      };

      // ground truth: the user selected 24, not 25
      const request = analizingSelectedText('台風24号発生', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
      apiCalls[0].resolve();
      await request;

      // analysis still completes
      expect(result.classList.contains('show')).toBe(true);
      expect(saveForLaterBtn.disabled).toBe(false);

      const response = global.localStorage.getItem('lastResponse');
      // NO authoritative rewrite — the model's ### 原句 line is left as-is
      expect(response).toContain('  - {台風|たいふう}25{号|ごう}{発生|はっせい}');
      // contract still stripped (2B-1)
      expect(response).not.toContain('reading_contract_version');

      const reconcileWarns = warnSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SELECTED_TEXT_MISMATCH');
      // no selected or model text in the warning
      expect(reconcileWarns[0][0]).not.toMatch(/台風|24|25|発生|source_text|apiKey|Bearer|Authorization/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('C+D: the contract is stripped AND generated example ruby outside ### 原句 is untouched', async () => {
    const calls = [];
    const saved = [];
    global.JaAlchemyApiService = class {
      async generateResponseStream(s, v, c, onChunk, onDone, onError, options) {
        return new Promise((resolve) => { calls.push({ onDone, resolve }); });
      }
      async saveAnalysis(analysis) { saved.push(analysis); return { success: true }; }
    };
    setupElements();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/a' }]) };

    const human = [
      '### 原句',
      '  - {最接近|さいっせきん}する', // wrong reading in the source line
      '',
      '### 單字分析',
      '#### <單字>{最接近|さいせっきん}する',
      '  - 解釋：to make the closest approach',
      '  - 自然例句：{台風|たいふう}が{最接近|さいせっきん}する。',
    ].join('\n');
    const contract = {
      reading_contract_version: 1,
      source_text: '最接近する',
      tokens: [{ text: '最接近', reading: 'さいせっきん' }, { text: 'する', reading: null }],
    };

    const request = analizingSelectedText('最接近する', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    const md = saved[0].page.rendered_markdown;
    expect(md).not.toContain('reading_contract_version');
    expect(md).not.toContain('```');
    // source line reconciled
    expect(md).toContain('### 原句\n  - {最接近|さいせっきん}する\n');
    // generated example line byte-for-byte intact
    expect(md).toContain('  - 自然例句：{台風|たいふう}が{最接近|さいせっきん}する。');
    expect(md).toContain('#### <單字>{最接近|さいせっきん}する');
  });

  test('F: a response with no reading contract is unchanged (Phase 1B behaviour preserved)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();
      const human = '### 原句\n  - 3{日|にち}{以降|いこう}';

      const request = analizingSelectedText('3日以降の天気', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(human);
      apiCalls[0].resolve();
      await request;

      // no contract → no reconciliation → the wrong reading is NOT fixed
      expect(global.localStorage.getItem('lastResponse')).toBe(human);
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('reconciliation'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('G: grounded contract but the ### 原句 visible surface differs → completes, one RECONCILE_SOURCE_TEXT_MISMATCH warning, source line unchanged', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { result, saveForLaterBtn } = setupElements();
      // grounding passes (selection === source_text) but the model's ### 原句
      // line shows a paraphrase, not the selected sentence
      const human = '### 原句\n  - {台風|たいふう}が{沖縄|おきなわ}に{接近|せっきん}中\n\n### 文法分析\n（無）';
      const contract = {
        reading_contract_version: 1,
        source_text: '台風が接近する',
        tokens: [
          { text: '台風', reading: 'たいふう' },
          { text: 'が', reading: null },
          { text: '接近', reading: 'せっきん' },
          { text: 'する', reading: null },
        ],
      };

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
      apiCalls[0].resolve();
      await request;

      expect(result.classList.contains('show')).toBe(true);
      expect(saveForLaterBtn.disabled).toBe(false);
      const response = global.localStorage.getItem('lastResponse');
      expect(response).toContain('  - {台風|たいふう}が{沖縄|おきなわ}に{接近|せっきん}中'); // untouched
      expect(response).not.toContain('reading_contract_version'); // still stripped (valid contract)

      const reconcileWarns = warnSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');
      expect(reconcileWarns[0][0]).not.toMatch(/台風|接近|沖縄|source_text|apiKey|Bearer|Authorization/);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('ORDERING: reconcile runs before repairRuby — wrong reading + duplicate both fixed, no repair needed', async () => {
    const apiCalls = setupDeferredApi();
    setupElements();
    const human = '### 原句\n  - 3{日|にち}以降{以降|いこう}\n\n### 文法分析\n（無）';
    const contract = {
      reading_contract_version: 1,
      source_text: '3日以降',
      tokens: [
        { text: '3', reading: null },
        { text: '日', reading: 'みっか' },
        { text: '以降', reading: 'いこう' },
      ],
    };

    const request = analizingSelectedText('3日以降', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    apiCalls[0].resolve();
    await request;

    const response = global.localStorage.getItem('lastResponse');
    // authoritative reconstruction fixed BOTH the reading and the duplicate
    expect(response).toContain('  - 3{日|みっか}{以降|いこう}');
    expect(response).not.toContain('にち');
    expect(response).not.toContain('以降{以降');
  });
});

describe('sidepanel analysis-mode behavior — v0.3 Phase 1 persisted authoritative reading tokens', () => {
  const readingFence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';

  // Grounded fixture: fence source_text === the selected text, and the token
  // text concatenation === source_text (the parser's own contract).
  const groundedContract = {
    reading_contract_version: 1,
    source_text: '台風が接近する',
    tokens: [
      { text: '台風', reading: 'たいふう' },
      { text: 'が', reading: null },
      { text: '接近', reading: 'せっきん' },
      { text: 'する', reading: null },
    ],
  };
  // The exact shape v0.3 Phase 1 persists at structured_json.reading.
  const groundedReading = {
    version: 1,
    source_text: '台風が接近する',
    tokens: [
      { text: '台風', reading: 'たいふう' },
      { text: 'が', reading: null },
      { text: '接近', reading: 'せっきん' },
      { text: 'する', reading: null },
    ],
  };

  beforeEach(() => {
    jest.useRealTimers();
    setupElements();
    setupStorage({ promptVariant: 'v2' });
    setupLocalStorage();
    setupDeferredApi();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/a' }]) };
  });

  function deferredSaveApi() {
    const calls = [];
    const saved = [];
    global.JaAlchemyApiService = class {
      async generateResponseStream(selectedText, promptVariant, context, onChunk, onDone, onError, options) {
        return new Promise((resolve) => { calls.push({ onDone, resolve }); });
      }
      async saveAnalysis(analysis) { saved.push(analysis); return { success: true }; }
    };
    return { calls, saved };
  }

  test('A: a valid, selection-grounded contract persists structured_json.reading exactly', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';

    const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(groundedContract)}`);
    calls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.version).toBe(1); // NOT bumped
    expect(Object.keys(projection).sort()).toEqual(['cacheKey', 'html', 'json', 'response', 'version']);
    expect(projection.json.reading).toEqual(groundedReading);

    await handleSaveForLater();
    expect(saved).toHaveLength(1);
    expect(saved[0].page.structured_json.reading).toEqual(groundedReading);
  });

  test('B: a valid contract whose source_text is not the selected text persists no reading', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();
      const human = '### 原句\n  - {台風|たいふう}25{号|ごう}{発生|はっせい}\n\n### 文法分析\n（無）';
      const contract = {
        reading_contract_version: 1,
        source_text: '台風25号発生',
        tokens: [
          { text: '台風', reading: 'たいふう' },
          { text: '25', reading: null },
          { text: '号', reading: 'ごう' },
          { text: '発生', reading: 'はっせい' },
        ],
      };

      // ground truth: the user selected 24, not 25
      const request = analizingSelectedText('台風24号発生', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
      apiCalls[0].resolve();
      await request;

      const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
      expect('reading' in projection.json).toBe(false);

      // existing reconciliation warning behavior unchanged
      const reconcileWarns = warnSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SELECTED_TEXT_MISMATCH');
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('C: an invalid final contract persists no reading and is still left in place', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();
      const human = '### 原句\n  - {雨|あめ}が{降|ふ}る';
      // token concatenation (雨が振る) !== source_text (雨が降る) → SOURCE_MISMATCH
      const badContract = {
        reading_contract_version: 1,
        source_text: '雨が降る',
        tokens: [{ text: '雨', reading: 'あめ' }, { text: 'が', reading: null }, { text: '振る', reading: 'ふる' }],
      };

      const request = analizingSelectedText('雨が降る', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(`${human}\n\n${readingFence(badContract)}`);
      apiCalls[0].resolve();
      await request;

      const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
      expect('reading' in projection.json).toBe(false);
      // existing invalid-block behavior unchanged: not stripped, one contract warning
      expect(global.localStorage.getItem('lastResponse')).toContain('reading_contract_version');
      const contractWarns = warnSpy.mock.calls
        .filter((c) => String(c[0]).includes('invalid reading contract'));
      expect(contractWarns).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('D: a response with no reading contract persists no reading (V1 behavior unchanged)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();
      const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する';

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v1' });
      await flushMicrotasks();
      apiCalls[0].onDone(human);
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe(human);
      const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
      expect('reading' in projection.json).toBe(false);
      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('[ruby-contract]'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('E: a selection-grounded contract still persists reading when the ### 原句 line differs', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { calls, saved } = deferredSaveApi();
      setupElements();
      // grounding passes (selection === contract source_text); the model's
      // ### 原句 line shows a paraphrase, so reconcile skips the line rewrite
      const human = '### 原句\n  - {台風|たいふう}が{沖縄|おきなわ}に{接近|せっきん}中\n\n### 文法分析\n（無）';

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      calls[0].onDone(`${human}\n\n${readingFence(groundedContract)}`);
      calls[0].resolve();
      await request;

      const response = global.localStorage.getItem('lastResponse');
      // source line NOT rewritten — reconciliation skipped
      expect(response).toContain('  - {台風|たいふう}が{沖縄|おきなわ}に{接近|せっきん}中');
      const reconcileWarns = warnSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');

      // reading IS persisted — grounded to the browser selection, not the UI line
      const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
      expect(projection.json.reading).toEqual(groundedReading);
      await handleSaveForLater();
      expect(saved[0].page.structured_json.reading).toEqual(groundedReading);
    } finally {
      warnSpy.mockRestore();
    }
  });

  describe('F: cache restore', () => {
    test('a versioned projection with a valid reading preserves it through restore + Save For Later', async () => {
      const cacheKey = buildContextCacheKey({ selectedText: '台風が接近する', promptVariant: 'v2' });
      setupLocalStorage({
        lastAnalysisResult: completedProjection(cacheKey, {
          json: { words: [{ term: '成長', detail: 'growth' }], grammars: [], reading: groundedReading },
        }),
      });
      setupElements();
      const saved = [];
      global.JaAlchemyApiService = class { async saveAnalysis(a) { saved.push(a); return { success: true }; } };

      await analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await handleSaveForLater();

      expect(saved).toHaveLength(1);
      expect(saved[0].page.structured_json.reading).toEqual(groundedReading);
    });

    test('a malformed cached reading is dropped on restore; the rest of the save is intact', async () => {
      const cacheKey = buildContextCacheKey({ selectedText: '台風が接近する', promptVariant: 'v2' });
      setupLocalStorage({
        lastAnalysisResult: completedProjection(cacheKey, {
          json: {
            words: [{ term: '成長', detail: 'growth' }],
            grammars: [],
            // token concatenation (台風) !== source_text → malformed
            reading: { version: 1, source_text: '台風が接近する', tokens: [{ text: '台風', reading: 'たいふう' }] },
          },
        }),
      });
      setupElements();
      const saved = [];
      global.JaAlchemyApiService = class { async saveAnalysis(a) { saved.push(a); return { success: true }; } };

      await analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await handleSaveForLater();

      expect(saved).toHaveLength(1);
      expect('reading' in saved[0].page.structured_json).toBe(false);
      expect(saved[0].page.structured_json.words).toEqual([{ term: '成長', detail: 'growth' }]);
    });

    test('a legacy lastResponse restore has no reading and still saves', async () => {
      const cacheKey = buildContextCacheKey({ selectedText: '台風が接近する', promptVariant: 'v2' });
      setupLocalStorage({
        lastAnalysisKey: cacheKey,
        lastResponse: '### 單字分析\n#### <單字>成長\ngrowth',
      });
      setupElements();
      const saved = [];
      global.JaAlchemyApiService = class { async saveAnalysis(a) { saved.push(a); return { success: true }; } };

      await analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await handleSaveForLater();

      expect(saved).toHaveLength(1);
      expect('reading' in saved[0].page.structured_json).toBe(false);
    });
  });

  test('G: the reading contract fence never leaks into any markdown / UI string path', async () => {
    const { calls, saved } = deferredSaveApi();
    const { prose } = setupElements();
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';

    const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(groundedContract)}`);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    const surfaces = [
      global.localStorage.getItem('lastResponse'),
      projection.response,
      projection.html,
      prose.innerHTML,
      saved[0].page.rendered_markdown,
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain('reading_contract_version');
      expect(surface).not.toContain('```');
    }
    // the data still made it to the structured sibling
    expect(projection.json.reading).toEqual(groundedReading);
  });
});
