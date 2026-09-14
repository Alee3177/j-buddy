// sidepanel.js now imports JaAlchemyApiService directly (P7.3-F — it used to
// read the bare `JaAlchemyApiService` global, which this file's many tests
// still control by reassigning `global.JaAlchemyApiService` per scenario).
// Rather than rewriting every one of those call sites, this mock proxies
// construction through to whatever `global.JaAlchemyApiService` currently
// points to, so all existing `global.JaAlchemyApiService = class {...}`
// assignments below keep working unchanged.
jest.mock('../src/scripts/jaAlchemyApiService.js', () => ({
  __esModule: true,
  default: class JaAlchemyApiServiceProxy {
    constructor(...args) {
      return new global.JaAlchemyApiService(...args);
    }
  },
}));

import {
  analizingSelectedText,
  handleCancelAnalysis,
  handleSaveForLater,
  handleAnalysisModeChange,
  handleSidepanelStorageChanges,
  handleTranslationStyleChange,
  initializeTranslationStyle,
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
  const analyzeButton = { disabled: true };
  const pendingSelectionStatus = { textContent: '' };
  const translationStyleSelect = { value: 'natural' };
  const elements = {
    alertMessage,
    analysisModeButtons: [compactButton, usageButton],
    translationStyleSelect,
    cancelAnalysisButton,
    analyzeButton,
    pendingSelectionStatus,
    copyButton,
    prose,
    result,
    saveAsBtn,
    saveForLaterBtn,
  };

  document.getElementById = jest.fn((id) => {
    if (id === 'result') return result;
    if (id === 'loading') return loading;
    if (id === 'alertMessage') return alertMessage;
    return null;
  });

  setSidepanelElementsForTesting(elements);
  return {
    alertMessage,
    compactButton,
    cancelAnalysisButton,
    analyzeButton,
    copyButton,
    elements,
    loading,
    loadingMessage,
    prose,
    pendingSelectionStatus,
    result,
    saveAsBtn,
    saveForLaterBtn,
    translationStyleSelect,
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

  describe('P8-B translation status UX', () => {
    test('shows 「日本語に変換しています…」 when the callable signals status:"translating"', async () => {
      const apiCalls = setupDeferredApi();
      const { loading, loadingMessage } = setupElements();

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      expect(apiCalls).toHaveLength(1);
      apiCalls[0].options.onStatus('translating');

      expect(loadingMessage.textContent).toBe('「日本語に変換しています…」');
      expect(loading.classList.contains('show')).toBe(true);

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;
    });

    test('the first real analysis chunk clears/replaces the translating status', async () => {
      const apiCalls = setupDeferredApi();
      const { loadingMessage } = setupElements();

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onStatus('translating');
      expect(loadingMessage.textContent).toBe('「日本語に変換しています…」');

      apiCalls[0].onChunk('分析', '分析');
      expect(loadingMessage.textContent).toBe('已收到分析結果，正在整理版面…');
      expect(loadingMessage.textContent).not.toContain('日本語に変換しています');

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;
    });

    test('Japanese input never shows the translating status (fast path unchanged)', async () => {
      const apiCalls = setupDeferredApi();
      const { loadingMessage } = setupElements();

      const analysisPromise = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      expect(loadingMessage.textContent).toBe('AI 正在分析，請稍候…');
      expect(apiCalls[0].options.onStatus).toBeInstanceOf(Function);
      // The real backend never sends a status chunk for Japanese input, so
      // onStatus is simply never invoked here — asserting the loading
      // message stays on the ordinary analysis copy throughout.
      apiCalls[0].onChunk('分析', '分析');
      expect(loadingMessage.textContent).toBe('已收到分析結果，正在整理版面…');
      expect(loadingMessage.textContent).not.toContain('日本語に変換しています');

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;
    });

    test('a translation/pre-stage error clears the loading state and shows a clean error message', async () => {
      const apiCalls = setupDeferredApi();
      const { loading, alertMessage } = setupElements();

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onStatus('translating');
      apiCalls[0].onError('Translation to Japanese failed. Please try again.');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(loading.classList.contains('show')).toBe(false);
      expect(alertMessage.textContent).toContain('Translation to Japanese failed. Please try again.');
      expect(alertMessage.classList.contains('show')).toBe(true);
    });
  });

  describe('P8-C1 natural Japanese presentation', () => {
    function chineseBenchmark001() {
      return {
        originalContent: '美國 Prismacolor Premier 霹靂馬色鉛筆/油性（單支）\n#103~#997 單色下標區',
        analysisContent: '米国Prismacolor Premier（プリズマカラー・プレミア）の油性色鉛筆（単色・1本売り）#103～#997 各色から選択可能',
      };
    }

    test('zh input renders 原文 + 自然日文 ahead of the existing analysis', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();
      const { originalContent, analysisContent } = chineseBenchmark001();

      const analysisPromise = analizingSelectedText(originalContent, {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'zh',
        originalContent,
        analysisContent,
        translated: true,
      });
      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      // Newlines in the original text render as <br> (plain text, not markdown).
      const displayedOriginal = originalContent.replace(/\n/g, '<br>');
      expect(prose.innerHTML).toContain('原文');
      expect(prose.innerHTML).toContain(displayedOriginal);
      expect(prose.innerHTML).toContain('自然日文');
      expect(prose.innerHTML).toContain(analysisContent);
      expect(prose.innerHTML).toContain('成長');

      const originalIdx = prose.innerHTML.indexOf(displayedOriginal);
      const naturalIdx = prose.innerHTML.indexOf(analysisContent);
      const wordsIdx = prose.innerHTML.indexOf('成長');
      expect(originalIdx).toBeGreaterThanOrEqual(0);
      expect(naturalIdx).toBeGreaterThan(originalIdx);
      expect(wordsIdx).toBeGreaterThan(naturalIdx);
    });

    test('en input renders 原文 + 自然日文 ahead of the existing analysis', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();
      const originalContent = 'Hello there, how are you doing today?';
      const analysisContent = 'こんにちは、今日の調子はいかがですか。';

      const analysisPromise = analizingSelectedText(originalContent, {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'en',
        originalContent,
        analysisContent,
        translated: true,
      });
      apiCalls[0].onDone('### 單字分析\n#### <單字>調子\ncondition');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(prose.innerHTML).toContain('原文');
      expect(prose.innerHTML).toContain(originalContent);
      expect(prose.innerHTML).toContain('自然日文');
      expect(prose.innerHTML).toContain(analysisContent);
      expect(prose.innerHTML).toContain('調子');
    });

    test('ja input does not render a 自然日文 section (onPreStage never fires)', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();

      const analysisPromise = analizingSelectedText('成長を後押しする', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      // Mirrors production: the callable never sends a preStage chunk on the
      // Japanese fast path, so onPreStage is simply never invoked here.
      apiCalls[0].onChunk('分析', '分析');
      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(prose.innerHTML).not.toContain('自然日文');
      expect(prose.innerHTML).not.toContain('原文');
      expect(prose.innerHTML).toContain('成長');
    });

    test('the displayed originalContent matches the pre-stage contract exactly', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();
      const originalContent = '这是一段包含標點、換行\n與空格 的測試文字！？';

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'zh',
        originalContent,
        analysisContent: 'これはテストです。',
        translated: true,
      });
      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      // Newlines become <br> for display; everything else (including full-width
      // punctuation) must appear byte-for-byte, unparaphrased.
      const expectedDisplayed = originalContent.replace(/\n/g, '<br>');
      expect(prose.innerHTML).toContain(expectedDisplayed);
    });

    test('analysisContent is displayed exactly once', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();
      const analysisContent = 'これは一意な自然日文のテストです。';

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'zh',
        originalContent: '这是一个测试',
        analysisContent,
        translated: true,
      });
      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      const occurrences = prose.innerHTML.split(analysisContent).length - 1;
      expect(occurrences).toBe(1);
    });

    test('streaming and the translating-status UX still work alongside the pre-stage presentation', async () => {
      const apiCalls = setupDeferredApi();
      const { prose, loadingMessage } = setupElements();
      const originalContent = '这是一个测试';
      const analysisContent = 'これはテストです。';

      const analysisPromise = analizingSelectedText(originalContent, {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onStatus('translating');
      expect(loadingMessage.textContent).toBe('「日本語に変換しています…」');

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'zh',
        originalContent,
        analysisContent,
        translated: true,
      });

      apiCalls[0].onChunk('分析結果', '分析結果');
      expect(loadingMessage.textContent).toBe('已收到分析結果，正在整理版面…');

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(prose.innerHTML).toContain('自然日文');
      expect(prose.innerHTML).toContain(analysisContent);
      expect(prose.innerHTML).toContain('成長');
    });
  });

  describe('P8-C2 translation style control', () => {
    test('the selector defaults to natural (自然) on init', async () => {
      const { translationStyleSelect, elements } = setupElements();
      setupStorage({});

      await initializeTranslationStyle(elements);

      expect(translationStyleSelect.value).toBe('natural');
    });

    test('the selector reflects a previously-persisted style on init', async () => {
      const { translationStyleSelect, elements } = setupElements();
      setupStorage({ translationStyle: 'business' });

      await initializeTranslationStyle(elements);

      expect(translationStyleSelect.value).toBe('business');
    });

    test('changing the selector persists the style and does not start analysis', async () => {
      const apiCalls = setupDeferredApi();
      const { elements, translationStyleSelect } = setupElements();
      const storage = setupStorage({});

      await handleTranslationStyleChange(elements, 'news');

      expect(storage.translationStyle).toBe('news');
      expect(translationStyleSelect.value).toBe('news');
      expect(apiCalls).toHaveLength(0);
    });

    test('an invalid style is rejected without mutating storage or the selector', async () => {
      const { elements, translationStyleSelect } = setupElements();
      const storage = setupStorage({ translationStyle: 'natural' });
      translationStyleSelect.value = 'natural';

      await handleTranslationStyleChange(elements, 'casual');

      expect(storage.translationStyle).toBe('natural');
      expect(translationStyleSelect.value).toBe('natural');
    });

    test('the next analysis request sends the currently-selected style', async () => {
      const apiCalls = setupDeferredApi();
      setupElements();
      setupStorage({ translationStyle: 'business' });

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      expect(apiCalls[0].options.translationStyle).toBe('business');

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;
    });

    test('an explicit options.translationStyle overrides the persisted selector value', async () => {
      const apiCalls = setupDeferredApi();
      setupElements();
      setupStorage({ translationStyle: 'business' });

      const analysisPromise = analizingSelectedText(
        '这是一个测试', {}, { promptVariant: 'v2', translationStyle: 'news' }
      );
      await flushMicrotasks();

      expect(apiCalls[0].options.translationStyle).toBe('news');

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;
    });

    test('the translated-section label matches the style reported by the server (news)', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();
      setupStorage({ translationStyle: 'news' });
      const analysisContent = 'ニュース文体の翻訳結果';

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'zh',
        originalContent: '这是一个测试',
        analysisContent,
        translated: true,
        translationStyle: 'news',
      });
      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(prose.innerHTML).toContain('新聞日文');
      expect(prose.innerHTML).not.toContain('自然日文');
      expect(prose.innerHTML).not.toContain('商務日文');
      expect(prose.innerHTML).toContain(analysisContent);
    });

    test('the translated-section label matches the style reported by the server (business)', async () => {
      const apiCalls = setupDeferredApi();
      const { prose } = setupElements();
      setupStorage({ translationStyle: 'business' });
      const analysisContent = '商務文体の翻訳結果';

      const analysisPromise = analizingSelectedText('这是一个测试', {}, { promptVariant: 'v2' });
      await flushMicrotasks();

      apiCalls[0].options.onPreStage({
        detectedLanguage: 'zh',
        originalContent: '这是一个测试',
        analysisContent,
        translated: true,
        translationStyle: 'business',
      });
      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(prose.innerHTML).toContain('商務日文');
      expect(prose.innerHTML).not.toContain('自然日文');
      expect(prose.innerHTML).not.toContain('新聞日文');
      expect(prose.innerHTML).toContain(analysisContent);
    });

    test('Japanese input ignores an explicit non-default style: no status, no preStage, no translated section', async () => {
      const apiCalls = setupDeferredApi();
      const { prose, loadingMessage } = setupElements();

      const analysisPromise = analizingSelectedText(
        '成長を後押しする', {}, { promptVariant: 'v2', translationStyle: 'business' }
      );
      await flushMicrotasks();

      // Mirrors production: the callable never sends status/preStage chunks
      // on the Japanese fast path, regardless of the requested style.
      apiCalls[0].onChunk('分析', '分析');
      expect(loadingMessage.textContent).not.toContain('日本語に変換しています');

      apiCalls[0].onDone('### 單字分析\n#### <單字>成長\ngrowth');
      apiCalls[0].resolve();
      await analysisPromise;

      expect(prose.innerHTML).not.toContain('自然日文');
      expect(prose.innerHTML).not.toContain('新聞日文');
      expect(prose.innerHTML).not.toContain('商務日文');
      expect(prose.innerHTML).not.toContain('原文');
      expect(prose.innerHTML).toContain('成長');
      // The request itself still carries the requested style (server ignores it).
      expect(apiCalls[0].options.translationStyle).toBe('business');
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
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      const rubyWarns = debugSpy.mock.calls.filter((c) => String(c[0]).includes('[ruby-contract]'));
      expect(rubyWarns).toHaveLength(1);
      expect(rubyWarns[0][0]).toContain('MISSING_OPEN_BRACE');
      expect(rubyWarns[0][0]).toContain('UNBALANCED_BRACE');
      expect(rubyWarns[0][0]).not.toMatch(/apiKey|Bearer|Authorization/i);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('D: a semantic reading warning (3{日|にち}) is reported but the reading is never rewritten', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();

      const request = analizingSelectedText('3日以降の予報', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('3{日|にち}{以降|いこう}');
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe('3{日|にち}{以降|いこう}');
      const rubyWarns = debugSpy.mock.calls.filter((c) => String(c[0]).includes('[ruby-contract]'));
      expect(rubyWarns).toHaveLength(1);
      expect(rubyWarns[0][0]).toContain('SUSPECT_COUNTER_READING');
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('E: valid completed output is unchanged and logs no ruby-contract warning', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('{台風|たいふう}が{接近|せっきん}する');
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe('{台風|たいふう}が{接近|せっきん}する');
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('[ruby-contract]'))).toBe(false);
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// P8 follow-up: live testing proved chrome://extensions' red "錯誤" (Errors)
// indicator is populated by console.warn too, not only console.error, in
// this unpacked-extension environment — so recoverable ruby-contract /
// reading-reconciliation diagnostics were moved from console.warn to
// console.debug (still visible in DevTools, e.g. Console's "Verbose"
// filter, but does not surface as an extension error). The three sites
// above (invalid reading contract, reconciliation skipped, unresolved ruby
// issues) now log via console.debug; these tests lock that in explicitly —
// spying on console.debug, console.warn, AND console.error together — so a
// future change can't silently regress one of them back to warn or error,
// and confirm a genuine fatal failure elsewhere in the same pipeline still
// uses console.error.
describe('P8 ruby diagnostic logging cleanup', () => {
  const readingFence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';

  beforeEach(() => {
    jest.useRealTimers();
    setupElements();
    setupStorage({ promptVariant: 'v2' });
    setupLocalStorage();
    setupDeferredApi();
  });

  test('1/2: RECONCILE_SELECTED_TEXT_MISMATCH and RECONCILE_SOURCE_TEXT_MISMATCH use console.debug, never warn/error', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { result, saveForLaterBtn } = setupElements();
      // Model fabricates "25" consistently in both ### 原句 and the contract;
      // the user actually selected "24" — grounding + surface both mismatch.
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

      const request = analizingSelectedText('台風24号発生', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(`${human}\n\n${readingFence(contract)}`);
      apiCalls[0].resolve();
      await request;

      // Recoverable: the analysis still completes.
      expect(result.classList.contains('show')).toBe(true);
      expect(saveForLaterBtn.disabled).toBe(false);

      const reconcileDebugs = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileDebugs).toHaveLength(1);
      expect(reconcileDebugs[0][0]).toContain('RECONCILE_SELECTED_TEXT_MISMATCH');
      expect(reconcileDebugs[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test('3: KANA_ONLY_BASE unresolved issue uses console.debug, never warn/error', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { result } = setupElements();
      // "ありがとう" is entirely kana (no Han) — a ruby base over it is
      // KANA_ONLY_BASE, which repairRuby reports but never auto-repairs.
      const request = analizingSelectedText('ありがとうございます', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('{ありがとう|アリガトウ}ございます');
      apiCalls[0].resolve();
      await request;

      // Recoverable: the analysis still completes.
      expect(result.classList.contains('show')).toBe(true);

      const rubyDebugs = debugSpy.mock.calls.filter((c) => String(c[0]).includes('[ruby-contract]'));
      expect(rubyDebugs).toHaveLength(1);
      expect(rubyDebugs[0][0]).toContain('KANA_ONLY_BASE');
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test('4: a genuine fatal setup failure (analysis cannot start) still uses console.error', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { alertMessage, result } = setupElements();
      // No promptVariant supplied in options, so analizingSelectedText falls
      // back to getPromptVariant() -> chrome.storage.local.get(), forced here
      // to reject — a true failure: setup cannot complete, so no analysis
      // request is ever made at all.
      global.chrome.storage.local.get = jest.fn(async () => {
        throw new Error('storage unavailable');
      });

      await analizingSelectedText('台風が接近する', {}, {});

      expect(result.classList.contains('show')).toBe(false);
      expect(alertMessage.classList.contains('show')).toBe(true);
      const setupErrors = errorSpy.mock.calls.filter((c) => String(c[0]).includes('Analysis setup error'));
      expect(setupErrors).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('5: a normal (issue-free) analysis result is unchanged and logs no ruby diagnostic at any level', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      const { prose, result } = setupElements();

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone('{台風|たいふう}が{接近|せっきん}する');
      apiCalls[0].resolve();
      await request;

      expect(result.classList.contains('show')).toBe(true);
      expect(prose.innerHTML).toContain('<rb>台風</rb>');
      expect(global.localStorage.getItem('lastResponse')).toBe('{台風|たいふう}が{接近|せっきん}する');
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('[ruby-contract]'))).toBe(false);
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('reading reconciliation skipped'))).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
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
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      const contractWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('invalid reading contract'));
      expect(contractWarns).toHaveLength(1);
      expect(contractWarns[0][0]).toContain('READING_CONTRACT_SOURCE_MISMATCH');
      expect(contractWarns[0][0]).not.toMatch(/雨|降|振|source_text|apiKey|Bearer|Authorization/);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('E: a V1-style response with no reading contract behaves exactly as before, no warning', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v1' });
      await flushMicrotasks();
      apiCalls[0].onDone('### 原句\n  - {台風|たいふう}が{接近|せっきん}する');
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe('### 原句\n  - {台風|たいふう}が{接近|せっきん}する');
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('reading contract'))).toBe(false);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('F (P0-C1): a MARKED contract emitted FIRST is stripped, reconciled, and never leaks — full pipeline', async () => {
    const apiCalls = setupDeferredApi();
    const { prose } = setupElements();
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
    // Contract FIRST, wrapped in the P0-C1 markers, prose AFTER — the new
    // production shape, in place of the legacy "contract as final block".
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';
    const fullText = [
      '<!-- READING_CONTRACT_START -->',
      readingFence(groundedContract),
      '<!-- READING_CONTRACT_END -->',
      '',
      human,
    ].join('\n');

    const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(fullText);
    apiCalls[0].resolve();
    await request;

    expect(prose.innerHTML).not.toContain('reading_contract_version');
    expect(prose.innerHTML).not.toContain('READING_CONTRACT');
    const response = global.localStorage.getItem('lastResponse');
    expect(response).toBe(human);
    expect(response).not.toContain('reading_contract_version');
    expect(response).not.toContain('READING_CONTRACT');
    expect(response).not.toContain('```');
    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.response).toBe(human);
    expect(projection.html).not.toContain('reading_contract_version');
  });

  test('G (P0-C1): saved page.rendered_markdown carries no marked-contract block either', async () => {
    const saved = [];
    global.JaAlchemyApiService = class {
      async generateResponseStream(selectedText, promptVariant, context, onChunk, onDone, onError, options) {
        return new Promise((resolve) => { calls.push({ onDone, resolve }); });
      }
      async saveAnalysis(analysis) { saved.push(analysis); return { success: true }; }
    };
    var calls = [];
    setupElements();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/a' }]) };
    const human = '### 原句\n  - {沖縄|おきなわ}に{最接近|さいせっきん}\n\n### 單字分析\n#### <單字>{最接近|さいせっきん}する\n  - 解釋：x';
    const fullText = [
      '<!-- READING_CONTRACT_START -->',
      readingFence({
        reading_contract_version: 1,
        source_text: '沖縄に最接近',
        tokens: [
          { text: '沖縄', reading: 'おきなわ' },
          { text: 'に', reading: null },
          { text: '最接近', reading: 'さいせっきん' },
        ],
      }),
      '<!-- READING_CONTRACT_END -->',
      '',
      human,
    ].join('\n');

    const request = analizingSelectedText('沖縄に最接近', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(fullText);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    expect(saved).toHaveLength(1);
    expect(saved[0].page.rendered_markdown).toBe(human);
    expect(saved[0].page.rendered_markdown).not.toContain('reading_contract_version');
    expect(saved[0].page.rendered_markdown).not.toContain('READING_CONTRACT');
    expect(saved[0].page.rendered_markdown).not.toContain('```');
  });

  test('H (P0-C1.1): a response with TWO marked contract attempts leaves no debris anywhere in the pipeline', async () => {
    const saved = [];
    global.JaAlchemyApiService = class {
      async generateResponseStream(selectedText, promptVariant, context, onChunk, onDone, onError, options) {
        return new Promise((resolve) => { calls.push({ onDone, resolve }); });
      }
      async saveAnalysis(analysis) { saved.push(analysis); return { success: true }; }
    };
    var calls = [];
    const { prose } = setupElements();
    global.chrome.tabs = { query: jest.fn(async () => [{ url: 'https://example.com/a' }]) };

    const invalidFirst = {
      reading_contract_version: 1,
      source_text: '台風が接近する',
      tokens: [
        { text: '台風', reading: 'たいふう' },
        { text: 'が', reading: null },
        { text: '接近', reading: 'せっきん' },
        // deliberately missing the final "する" token → concatenation
        // ("台風が接近") does not equal source_text → SOURCE_MISMATCH.
      ],
    };
    const validSecond = {
      reading_contract_version: 1,
      source_text: '台風が接近する',
      tokens: [
        { text: '台風', reading: 'たいふう' },
        { text: 'が', reading: null },
        { text: '接近', reading: 'せっきん' },
        { text: 'する', reading: null },
      ],
    };
    const narration = '> [!NOTE]\n> 備註：上述 JSON 契約的 token 拆解有誤，更正精確的 JSON 請見如下。';
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';
    const fullText = [
      '<!-- READING_CONTRACT_START -->',
      readingFence(invalidFirst),
      '<!-- READING_CONTRACT_END -->',
      '',
      narration,
      '',
      '<!-- READING_CONTRACT_START -->',
      readingFence(validSecond),
      '<!-- READING_CONTRACT_END -->',
      '',
      human,
    ].join('\n');

    const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(fullText);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    const debrisMarkers = [
      'READING_CONTRACT_START',
      'READING_CONTRACT_END',
      'reading_contract_version',
      '備註',
      '上述 JSON 契約',
      '[!NOTE]',
      '```',
    ];

    const response = global.localStorage.getItem('lastResponse');
    expect(response).toBe(human);
    for (const marker of debrisMarkers) expect(response).not.toContain(marker);

    expect(prose.innerHTML).not.toContain('reading_contract_version');
    expect(prose.innerHTML).not.toContain('READING_CONTRACT');
    for (const marker of debrisMarkers) expect(prose.innerHTML).not.toContain(marker);

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.response).toBe(human);
    for (const marker of debrisMarkers) expect(projection.html).not.toContain(marker);

    expect(saved).toHaveLength(1);
    expect(saved[0].page.rendered_markdown).toBe(human);
    for (const marker of debrisMarkers) expect(saved[0].page.rendered_markdown).not.toContain(marker);
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

  test('HALLUCINATION GUARD: contract self-consistent with ### 原句 but not the selected text → ground truth (plain, no ruby) overwrites it, grounding warning still fires (P2-A)', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      // ground truth wins: the hallucinated contract is never trusted, so the
      // line becomes plain ground-truth text (no ruby) rather than being left
      // showing the wrong "25"
      expect(response).toContain('  - 台風24号発生');
      expect(response).not.toContain('たいふう');
      expect(response).not.toContain('25');
      // contract still stripped (2B-1)
      expect(response).not.toContain('reading_contract_version');

      const reconcileWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SELECTED_TEXT_MISMATCH');
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');
      // no selected or model text in the warning
      expect(reconcileWarns[0][0]).not.toMatch(/台風|24|25|発生|source_text|apiKey|Bearer|Authorization/);
    } finally {
      debugSpy.mockRestore();
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

  test('F: a response with no reading contract still gets its ### 原句 line corrected against ground truth (P2-A)', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();
      const human = '### 原句\n  - 3{日|にち}{以降|いこう}';

      const request = analizingSelectedText('3日以降の天気', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(human);
      apiCalls[0].resolve();
      await request;

      // no contract to add ruby from, but the visible line disagreed with the
      // actual selection ("3日以降" vs "3日以降の天気"), so ground truth
      // (plain, no ruby) still overwrites it
      const response = global.localStorage.getItem('lastResponse');
      expect(response).toContain('  - 3日以降の天気');
      expect(response).not.toContain('にち');
      const reconcileWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');
    } finally {
      debugSpy.mockRestore();
    }
  });

  test("F2: legacy/personal-provider compatibility — no contract + a ### 原句 line that's already ground-truth-correct is left byte-for-byte untouched", async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const apiCalls = setupDeferredApi();
      setupElements();
      const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する';

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      apiCalls[0].onDone(human);
      apiCalls[0].resolve();
      await request;

      expect(global.localStorage.getItem('lastResponse')).toBe(human);
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('[ruby-contract]'))).toBe(false);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('G: grounded contract but the ### 原句 visible surface differs → the grounded contract reconstruction overwrites it, one RECONCILE_SOURCE_TEXT_MISMATCH warning (P2-A)', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      expect(response).toContain('  - {台風|たいふう}が{接近|せっきん}する'); // rebuilt from the grounded contract
      expect(response).not.toContain('沖縄');
      expect(response).not.toContain('reading_contract_version'); // still stripped (valid contract)

      const reconcileWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');
      expect(reconcileWarns[0][0]).not.toMatch(/台風|接近|沖縄|source_text|apiKey|Bearer|Authorization/);
    } finally {
      debugSpy.mockRestore();
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
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      const reconcileWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SELECTED_TEXT_MISMATCH');
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('C: an invalid final contract persists no reading and is still left in place', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      const contractWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('invalid reading contract'));
      expect(contractWarns).toHaveLength(1);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('D: a response with no reading contract persists no reading (V1 behavior unchanged)', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
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
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('[ruby-contract]'))).toBe(false);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('E: a selection-grounded contract still persists reading when the ### 原句 line differs (and the grounded contract now also fixes the visible line, P2-A)', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const { calls, saved } = deferredSaveApi();
      setupElements();
      // grounding passes (selection === contract source_text); the model's
      // ### 原句 line shows a paraphrase, so reconcile rebuilds it from the
      // grounded contract tokens
      const human = '### 原句\n  - {台風|たいふう}が{沖縄|おきなわ}に{接近|せっきん}中\n\n### 文法分析\n（無）';

      const request = analizingSelectedText('台風が接近する', {}, { promptVariant: 'v2' });
      await flushMicrotasks();
      calls[0].onDone(`${human}\n\n${readingFence(groundedContract)}`);
      calls[0].resolve();
      await request;

      const response = global.localStorage.getItem('lastResponse');
      // source line rebuilt from the grounded contract (P2-A)
      expect(response).toContain('  - {台風|たいふう}が{接近|せっきん}する');
      expect(response).not.toContain('沖縄');
      const reconcileWarns = debugSpy.mock.calls
        .filter((c) => String(c[0]).includes('reading reconciliation skipped'));
      expect(reconcileWarns).toHaveLength(1);
      expect(reconcileWarns[0][0]).toContain('RECONCILE_SOURCE_TEXT_MISMATCH');

      // reading IS persisted — grounded to the browser selection, not the UI line
      const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
      expect(projection.json.reading).toEqual(groundedReading);
      await handleSaveForLater();
      expect(saved[0].page.structured_json.reading).toEqual(groundedReading);
    } finally {
      debugSpy.mockRestore();
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

describe('sidepanel analysis-mode behavior — P2-B readingTrusted unifies render/persistence', () => {
  const readingFence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';

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

  test('10: a valid single-line grounded contract persists structured_json.reading (unchanged from P2-A)', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';
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
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.json.reading).toEqual({ version: 1, source_text: '台風が接近する', tokens: contract.tokens });

    await handleSaveForLater();
    expect(saved[0].page.structured_json.reading).toEqual({ version: 1, source_text: '台風が接近する', tokens: contract.tokens });
  });

  test('11: a multi-line grounded contract is NOT persisted (render refuses, readingTrusted: false)', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();
    const selected = '台風が\n接近する';
    const human = `### 原句\n  - {台風|たいふう}が\n接近する\n\n### 文法分析\n（無）`;
    const contract = {
      reading_contract_version: 1,
      source_text: selected,
      tokens: [{ text: selected, reading: null }],
    };

    const request = analizingSelectedText(selected, {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect('reading' in projection.json).toBe(false);

    await handleSaveForLater();
    expect('reading' in saved[0].page.structured_json).toBe(false);
  });

  test('12: an ambiguous ### 原句 (multiple candidate lines) is NOT persisted (readingTrusted: false)', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();
    const human = '### 原句\n  - {台風|たいふう}\n  - {台風|たいぷう}\n\n### 文法分析\n（無）';
    const contract = {
      reading_contract_version: 1,
      source_text: '台風',
      tokens: [{ text: '台風', reading: 'たいふう' }],
    };

    const request = analizingSelectedText('台風', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect('reading' in projection.json).toBe(false);

    await handleSaveForLater();
    expect('reading' in saved[0].page.structured_json).toBe(false);
  });

  test('13: an invalid/fabricated (ungrounded) contract is NOT persisted (readingTrusted: false)', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();
    const human = '### 原句\n  - {台風|たいふう}25{号|ごう}{発生|はっせい}\n\n### 文法分析\n（無）';
    const contract = {
      reading_contract_version: 1,
      source_text: '台風25号発生', // fabricated — user actually selected 24号
      tokens: [
        { text: '台風', reading: 'たいふう' },
        { text: '25', reading: null },
        { text: '号', reading: 'ごう' },
        { text: '発生', reading: 'はっせい' },
      ],
    };

    const request = analizingSelectedText('台風24号発生', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect('reading' in projection.json).toBe(false);

    await handleSaveForLater();
    expect('reading' in saved[0].page.structured_json).toBe(false);
  });

  test('14: rendered/saved markdown behavior for multi-line and ambiguous cases remains exactly P2-A behavior (render unaffected by P2-B)', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();
    // multi-line case: render still refuses (P2-A design, unchanged) — the
    // model's own line is left exactly as it was, only persistence changed
    const selected = '台風が\n接近する';
    const human = `### 原句\n  - {台風|たいふう}が\n接近する\n\n### 文法分析\n（無）`;
    const contract = {
      reading_contract_version: 1,
      source_text: selected,
      tokens: [{ text: selected, reading: null }],
    };

    const request = analizingSelectedText(selected, {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;

    const response = global.localStorage.getItem('lastResponse');
    expect(response).toContain('{台風|たいふう}が'); // untouched — render never attempted a rewrite here
    expect(response).not.toContain('reading_contract_version'); // contract still stripped (2B-1, unaffected)

    await handleSaveForLater();
    expect(saved[0].page.rendered_markdown).toContain('{台風|たいふう}が');
  });

  test('15: Copy / Save-As / rendered_markdown are unchanged for the trusted case; only untrusted reading data stops persisting', async () => {
    const { calls, saved } = deferredSaveApi();
    const { prose } = setupElements();
    const human = '### 原句\n  - {台風|たいふう}が{接近|せっきん}する\n\n### 文法分析\n（無）';
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
    calls[0].onDone(`${human}\n\n${readingFence(contract)}`);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(global.localStorage.getItem('lastResponse')).toContain('{台風|たいふう}が{接近|せっきん}する');
    expect(projection.html).not.toContain('reading_contract_version');
    expect(prose.innerHTML).not.toContain('reading_contract_version');
    expect(saved[0].page.rendered_markdown).toContain('{台風|たいふう}が{接近|せっきん}する');
    expect(projection.json.reading).toEqual({ version: 1, source_text: '台風が接近する', tokens: contract.tokens });
  });
});

describe('sidepanel analysis-mode behavior — v0.3 Phase 2A collocation / register taxonomy', () => {
  // Personal-provider (6-section) style body. The 單字 entry is a plain noun so
  // enrichMarkdownWithConjugation is a strict no-op and the markdown surfaces
  // stay byte-identical.
  const sixSection = [
    '### 原句',
    '  - {台風|たいふう}が{沖縄|おきなわ}に{最接近|さいせっきん}する。',
    '  - 翻譯：颱風最接近沖繩。',
    '',
    '### 單字分析',
    '#### <單字>{前線|ぜんせん}',
    '  - 解釋：鋒面',
    '',
    '### 文法分析',
    '（無）',
    '',
    '### 搭配分析',
    '  - 〜に{最接近|さいせっきん}する：固定搭配，常見於氣象報導。',
    '  - {前線|ぜんせん}を{刺激|しげき}する：活化鋒面。',
    '',
    '### 語體／新聞表現',
    '  - 句尾「〜か」：標題式的不確定與省略。',
    '  - 連用中止（「{刺激|しげき}し、」）：書面語語法。',
    '',
  ].join('\n');

  const collocations = [
    { text: '〜に{最接近|さいせっきん}する：固定搭配，常見於氣象報導。' },
    { text: '{前線|ぜんせん}を{刺激|しげき}する：活化鋒面。' },
  ];
  const registers = [
    { text: '句尾「〜か」：標題式的不確定與省略。' },
    { text: '連用中止（「{刺激|しげき}し、」）：書面語語法。' },
  ];

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

  test('A: a 6-section result populates projection.json.collocations / registers and round-trips through Save For Later', async () => {
    const { calls, saved } = deferredSaveApi();
    setupElements();

    const request = analizingSelectedText('台風が沖縄に最接近する。', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(sixSection);
    calls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(projection.version).toBe(1); // NOT bumped
    expect(Object.keys(projection).sort()).toEqual(['cacheKey', 'html', 'json', 'response', 'version']);
    expect(projection.json.collocations).toEqual(collocations);
    expect(projection.json.registers).toEqual(registers);

    await handleSaveForLater();
    expect(saved).toHaveLength(1);
    expect(saved[0].page.structured_json.collocations).toEqual(collocations);
    expect(saved[0].page.structured_json.registers).toEqual(registers);
    // legacy flat vocab/grammar mapping untouched
    expect(Array.isArray(saved[0].words)).toBe(true);
    expect(Array.isArray(saved[0].grammars)).toBe(true);
  });

  test('B: versioned cache restore preserves valid collocations / registers', async () => {
    const cacheKey = buildContextCacheKey({ selectedText: '台風が沖縄に最接近する。', promptVariant: 'v2' });
    setupLocalStorage({
      lastAnalysisResult: completedProjection(cacheKey, {
        json: { words: [{ term: '成長', detail: 'growth' }], grammars: [], collocations, registers },
      }),
    });
    setupElements();
    const saved = [];
    global.JaAlchemyApiService = class { async saveAnalysis(a) { saved.push(a); return { success: true }; } };

    await analizingSelectedText('台風が沖縄に最接近する。', {}, { promptVariant: 'v2' });
    await handleSaveForLater();

    expect(saved).toHaveLength(1);
    expect(saved[0].page.structured_json.collocations).toEqual(collocations);
    expect(saved[0].page.structured_json.registers).toEqual(registers);
  });

  test('C: malformed cached collocations / registers are dropped; words / grammars stay valid', async () => {
    const cacheKey = buildContextCacheKey({ selectedText: '台風が沖縄に最接近する。', promptVariant: 'v2' });
    setupLocalStorage({
      lastAnalysisResult: completedProjection(cacheKey, {
        json: {
          words: [{ term: '成長', detail: 'growth' }],
          grammars: [],
          collocations: 'not-an-array',
          registers: [{ text: '' }, { nope: 1 }, 42, { text: 'ok' }],
        },
      }),
    });
    setupElements();
    const saved = [];
    global.JaAlchemyApiService = class { async saveAnalysis(a) { saved.push(a); return { success: true }; } };

    await analizingSelectedText('台風が沖縄に最接近する。', {}, { promptVariant: 'v2' });
    await handleSaveForLater();

    expect(saved).toHaveLength(1);
    const sj = saved[0].page.structured_json;
    expect('collocations' in sj).toBe(false);        // non-array → dropped fail-closed
    expect(sj.registers).toEqual([{ text: 'ok' }]);  // bad items filtered out
    expect(sj.words).toEqual([{ term: '成長', detail: 'growth' }]);
    expect(sj.grammars).toEqual([]);
  });

  test('D: managed-style markdown without those sections keeps the exact legacy { words, grammars } shape', async () => {
    const apiCalls = setupDeferredApi();
    setupElements();
    const managed = '### 單字分析\n#### <單字>{成長|せいちょう}\n  - 解釋：成長\n\n### 文法分析\n（無）';

    const request = analizingSelectedText('成長する社会', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    apiCalls[0].onDone(managed);
    apiCalls[0].resolve();
    await request;

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect('collocations' in projection.json).toBe(false);
    expect('registers' in projection.json).toBe(false);
    expect('reading' in projection.json).toBe(false);
    expect(Object.keys(projection.json).sort()).toEqual(['grammars', 'words']);
  });

  test('E: taxonomy parsing does not alter any markdown / UI string surface', async () => {
    const { calls, saved } = deferredSaveApi();
    const { prose } = setupElements();

    const request = analizingSelectedText('台風が沖縄に最接近する。', {}, { promptVariant: 'v2' });
    await flushMicrotasks();
    calls[0].onDone(sixSection);
    calls[0].resolve();
    await request;
    await handleSaveForLater();

    const projection = JSON.parse(global.localStorage.getItem('lastAnalysisResult'));
    expect(global.localStorage.getItem('lastResponse')).toBe(sixSection);
    expect(projection.response).toBe(sixSection);
    expect(saved[0].page.rendered_markdown).toBe(sixSection);
    // the section text still renders as a normal list in the panel
    expect(prose.innerHTML).toContain('<rb>前線</rb>');
    // structured data still captured alongside the unchanged markdown
    expect(projection.json.collocations).toHaveLength(2);
    expect(projection.json.registers).toHaveLength(2);
  });
});
