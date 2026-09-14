/**
 * P8-C2: translation style resolution + persistence, mirroring promptVariant.js.
 * Single source of truth for the extension-side style values/labels so the UI,
 * request builder, and sidepanel label logic don't each re-declare them.
 */

export const TRANSLATION_STYLE_KEY = 'translationStyle';
export const DEFAULT_TRANSLATION_STYLE = 'natural';
export const VALID_TRANSLATION_STYLES = ['natural', 'news', 'business'];

// Learner-facing selector labels + the matching translated-section heading
// (P8-C1's 「自然日文」, now style-dependent — P8-C2 section F).
export const TRANSLATION_STYLE_OPTIONS = Object.freeze([
  Object.freeze({ style: 'natural', label: '自然', sectionLabel: '自然日文' }),
  Object.freeze({ style: 'news', label: '新聞', sectionLabel: '新聞日文' }),
  Object.freeze({ style: 'business', label: '商務', sectionLabel: '商務日文' }),
]);

const SECTION_LABEL_BY_STYLE = TRANSLATION_STYLE_OPTIONS.reduce((acc, option) => {
  acc[option.style] = option.sectionLabel;
  return acc;
}, {});

export function isValidTranslationStyle(style) {
  return VALID_TRANSLATION_STYLES.includes(style);
}

/** The translated-section heading for a style, falling back to natural's for an unknown/missing value. */
export function getTranslatedSectionLabel(style) {
  return SECTION_LABEL_BY_STYLE[style] || SECTION_LABEL_BY_STYLE[DEFAULT_TRANSLATION_STYLE];
}

/**
 * Resolve the translation style to use. Returns the stored value when valid,
 * otherwise persists and returns the default.
 * @returns {Promise<"natural" | "news" | "business">}
 */
export async function getTranslationStyle() {
  const result = await chrome.storage.local.get(TRANSLATION_STYLE_KEY);
  const style = result?.[TRANSLATION_STYLE_KEY];

  if (isValidTranslationStyle(style)) {
    return style;
  }

  await chrome.storage.local.set({ [TRANSLATION_STYLE_KEY]: DEFAULT_TRANSLATION_STYLE });
  return DEFAULT_TRANSLATION_STYLE;
}

/**
 * Persist a translation style selected through the UI.
 * @param {"natural" | "news" | "business"} style
 * @returns {Promise<"natural" | "news" | "business">}
 */
export async function setTranslationStyle(style) {
  if (!isValidTranslationStyle(style)) {
    throw new RangeError(`Invalid translation style: ${style}`);
  }

  await chrome.storage.local.set({ [TRANSLATION_STYLE_KEY]: style });
  return style;
}
