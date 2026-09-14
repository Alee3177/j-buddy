import { LlmService } from "../services/llmService";
import { DetectedLanguage, detectLanguage } from "../services/languageDetection";
import { buildTranslationSystemPrompt } from "../models/translationPrompt";
import { DEFAULT_TRANSLATION_STYLE, TranslationStyle } from "../models/translationStyle";

export type { DetectedLanguage };
export type { TranslationStyle };

// Translated Japanese output can legitimately exceed the original-input
// ceiling (MAX_CONTENT_LENGTH in requestValidation.ts) — e.g. a Chinese
// product title often expands when rendered as natural Japanese. This is a
// separate ceiling on the TRANSLATED text, checked before analysis runs, so
// a pathological translation is rejected rather than silently truncated
// (truncation could cut mid-word and feed a broken fragment to the analyzer).
export const MAX_TRANSLATED_CONTENT_LENGTH = 1000;

export interface PreStageResult {
  detectedLanguage: DetectedLanguage;
  originalContent: string;
  analysisContent: string;
  translated: boolean;
  // P8-C2: the style actually used (or that would have applied — ja always
  // carries the resolved value even though it has no effect there). Lets a
  // client pick the matching translated-section label (自然日文/新聞日文/
  // 商務日文) without re-deriving it.
  translationStyle: TranslationStyle;
}

/** Thrown when the source language is not one the pipeline supports (P8 scope: ja/zh/en only). */
export class UnsupportedLanguageError extends Error {
  public readonly detectedLanguage: DetectedLanguage;

  constructor(detectedLanguage: DetectedLanguage) {
    super(`Unsupported or undetermined source language: ${detectedLanguage}`);
    this.name = "UnsupportedLanguageError";
    this.detectedLanguage = detectedLanguage;
  }
}

/**
 * Thrown when zh/en source text is detected but translation to Japanese
 * could not be completed (provider error, empty output, or output over the
 * translated-content ceiling). Callers must fail loudly on this — never fall
 * back to analyzing the untranslated source, and never return a fake success
 * with empty analysis.
 */
export class TranslationFailedError extends Error {
  public readonly detectedLanguage: DetectedLanguage;
  public readonly cause?: unknown;

  constructor(detectedLanguage: DetectedLanguage, message: string, cause?: unknown) {
    super(message);
    this.name = "TranslationFailedError";
    this.detectedLanguage = detectedLanguage;
    this.cause = cause;
  }
}

/**
 * Shared P8-B pre-stage, used by BOTH explainHandler and
 * explainStreamCallableHandler immediately before their existing analysis
 * LLM call. Routes source text to the (unmodified) Japanese Analyzer:
 *
 *   ja               -> analysisContent === originalContent, no LLM call
 *   zh / en          -> translated to natural Japanese via one batch LLM call
 *                       (always chatCompletion, even from the streaming
 *                       handler — translation is never itself streamed)
 *   unknown/unsupported -> throws UnsupportedLanguageError
 *
 * `llmService` is the same instance the caller already created for analysis,
 * so the translation call reuses the caller's selected provider without a
 * second `createLlmService` call.
 */
export async function runMultilingualPreStage(
  content: string,
  llmService: LlmService,
  // P8-C2: optional — the ONLY place an omitted style is resolved to
  // "natural". Callers (explainHandler, explainStreamCallableHandler) just
  // pass whatever validateExplainRequest already accepted through as-is.
  translationStyle: TranslationStyle = DEFAULT_TRANSLATION_STYLE
): Promise<PreStageResult> {
  const detectedLanguage = detectLanguage(content);

  if (detectedLanguage === "ja") {
    // P8-C2: translationStyle has no behavioral effect here — it is never
    // read again below, so an ignored/unsupported value sent for Japanese
    // input cannot affect anything. Still reported back for contract
    // consistency with the zh/en case.
    return {
      detectedLanguage,
      originalContent: content,
      analysisContent: content,
      translated: false,
      translationStyle,
    };
  }

  if (detectedLanguage === "unknown") {
    throw new UnsupportedLanguageError(detectedLanguage);
  }

  let translated: string;
  try {
    const completion = await llmService.chatCompletion(
      buildTranslationSystemPrompt(translationStyle),
      content
    );
    translated = typeof completion.response?.data === "string" ? completion.response.data.trim() : "";
  } catch (error) {
    throw new TranslationFailedError(
      detectedLanguage,
      "Translation to Japanese failed before analysis could run",
      error
    );
  }

  if (!translated) {
    throw new TranslationFailedError(
      detectedLanguage,
      "Translation to Japanese produced empty output"
    );
  }

  if (translated.length > MAX_TRANSLATED_CONTENT_LENGTH) {
    throw new TranslationFailedError(
      detectedLanguage,
      `Translated output exceeded the ${MAX_TRANSLATED_CONTENT_LENGTH}-character ceiling`
    );
  }

  return {
    detectedLanguage,
    originalContent: content,
    analysisContent: translated,
    translated: true,
    translationStyle,
  };
}
