/**
 * Unit tests for getTranslationStyle — the P8-C2 translation-style resolver.
 * Mirrors promptVariant.test.js. Mocks chrome.storage.local in isolation (no
 * sidepanel.js / authService import).
 */
import {
  DEFAULT_TRANSLATION_STYLE,
  TRANSLATION_STYLE_OPTIONS,
  VALID_TRANSLATION_STYLES,
  getTranslatedSectionLabel,
  getTranslationStyle,
  isValidTranslationStyle,
  setTranslationStyle,
} from '../src/scripts/translationStyle.js';

describe('translationStyle', () => {
  let store;

  beforeEach(() => {
    store = {};
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async (key) => ({ [key]: store[key] })),
          set: jest.fn(async (obj) => {
            Object.assign(store, obj);
          }),
        },
      },
    };
  });

  test('defaults to natural', () => {
    expect(DEFAULT_TRANSLATION_STYLE).toBe('natural');
    expect(VALID_TRANSLATION_STYLES).toEqual(['natural', 'news', 'business']);
  });

  describe('isValidTranslationStyle', () => {
    it.each(['natural', 'news', 'business'])('accepts %s', (style) => {
      expect(isValidTranslationStyle(style)).toBe(true);
    });

    test('rejects an unsupported value', () => {
      expect(isValidTranslationStyle('casual')).toBe(false);
      expect(isValidTranslationStyle(undefined)).toBe(false);
    });
  });

  describe('getTranslatedSectionLabel', () => {
    test('maps each style to its own translated-section heading', () => {
      expect(getTranslatedSectionLabel('natural')).toBe('自然日文');
      expect(getTranslatedSectionLabel('news')).toBe('新聞日文');
      expect(getTranslatedSectionLabel('business')).toBe('商務日文');
    });

    test('falls back to the natural label for an unknown/missing style', () => {
      expect(getTranslatedSectionLabel('casual')).toBe('自然日文');
      expect(getTranslatedSectionLabel(undefined)).toBe('自然日文');
    });
  });

  test('exposes learner-facing selector labels for every style', () => {
    expect(TRANSLATION_STYLE_OPTIONS).toEqual([
      expect.objectContaining({ style: 'natural', label: '自然', sectionLabel: '自然日文' }),
      expect.objectContaining({ style: 'news', label: '新聞', sectionLabel: '新聞日文' }),
      expect.objectContaining({ style: 'business', label: '商務', sectionLabel: '商務日文' }),
    ]);
  });

  describe('getTranslationStyle', () => {
    test('defaults to natural and persists when not set', async () => {
      const style = await getTranslationStyle();

      expect(style).toBe('natural');
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ translationStyle: 'natural' });
    });

    test('returns news when stored without re-persisting', async () => {
      store.translationStyle = 'news';

      const style = await getTranslationStyle();

      expect(style).toBe('news');
      expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('returns business when stored without re-persisting', async () => {
      store.translationStyle = 'business';

      const style = await getTranslationStyle();

      expect(style).toBe('business');
      expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    });

    test('resets an invalid stored value back to natural', async () => {
      store.translationStyle = 'casual';

      const style = await getTranslationStyle();

      expect(style).toBe('natural');
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ translationStyle: 'natural' });
    });
  });

  describe('setTranslationStyle', () => {
    test('persists a valid translation style selected from the UI', async () => {
      const style = await setTranslationStyle('business');

      expect(style).toBe('business');
      expect(store.translationStyle).toBe('business');
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ translationStyle: 'business' });
    });

    test('rejects an invalid translation style without mutating storage', async () => {
      store.translationStyle = 'natural';

      await expect(setTranslationStyle('casual')).rejects.toThrow('Invalid translation style: casual');

      expect(store.translationStyle).toBe('natural');
      expect(global.chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });
});
