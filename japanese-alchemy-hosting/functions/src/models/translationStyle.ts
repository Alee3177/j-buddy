/**
 * P8-C2: single source of truth for the translation-style literal values, so
 * requestValidation.ts, multilingualPreStage.ts, translationPrompt.ts, and
 * every test share one list instead of each re-declaring the same three
 * strings. Initial supported styles ONLY — do not add more in P8-C2.
 */
export const TRANSLATION_STYLES = ["natural", "news", "business"] as const;

export type TranslationStyle = (typeof TRANSLATION_STYLES)[number];

export const DEFAULT_TRANSLATION_STYLE: TranslationStyle = "natural";

export function isValidTranslationStyle(value: unknown): value is TranslationStyle {
  return typeof value === "string" && (TRANSLATION_STYLES as readonly string[]).includes(value);
}
