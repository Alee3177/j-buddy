import { LlmService } from "../services/llmService";
import { DetectedLanguage, detectLanguage } from "../services/languageDetection";
import { buildCorrectiveTerminologySystemPrompt, buildTranslationSystemPrompt } from "../models/translationPrompt";
import { DEFAULT_TRANSLATION_STYLE, TranslationStyle } from "../models/translationStyle";
import { resolveTranslationProfile } from "../models/translationProfile";
import { findTerminologyViolations, matchTerminologyConstraints } from "../models/translationTerminology";
import { logger } from "../utils/logger";

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
  // P8-D2: present ONLY when a profile was actually applied (translated
  // zh/en with a translationProfileId) — absent for ja and for no-profile
  // requests. Metadata only: id + version, never the glossary/protected
  // terms/brand-voice content itself (never leak server profile internals
  // to the client).
  translationProfileId?: string;
  translationProfileVersion?: string;
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
  translationStyle: TranslationStyle = DEFAULT_TRANSLATION_STYLE,
  // P8-D2: optional — resolved to a TranslationProfile ONLY in the zh/en
  // branch below. Never resolved/read on the ja path, so it is provably
  // inert for Japanese input (no profile prompt construction at all).
  translationProfileId?: string
): Promise<PreStageResult> {
  const detectedLanguage = detectLanguage(content);

  if (detectedLanguage === "ja") {
    // P8-C2/P8-D2: translationStyle and translationProfileId have no
    // behavioral effect here — neither is read again below, so an
    // ignored/unsupported value sent for Japanese input cannot affect
    // anything. Still reported back (style only) for contract consistency
    // with the zh/en case; profile metadata is never attached for ja.
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

  // P8-D2: resolved ONLY for zh/en, right before building the translation
  // prompt. Fails closed (throws UnknownTranslationProfileError) for an
  // unrecognized id — should never happen in practice since
  // validateExplainRequest already checked it, but this is the actual
  // fail-closed guarantee, not just an upstream courtesy check.
  const profile = resolveTranslationProfile(translationProfileId);

  let translated: string;
  try {
    const completion = await llmService.chatCompletion(
      buildTranslationSystemPrompt(translationStyle, profile),
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

  // P8-D4.2: deterministic source-glossary matching + collision-aware
  // output validation + one bounded corrective retry, ONLY when a profile
  // is actually in play (no-profile requests and the ja fast-path above
  // never reach this branch at all, so both are provably inert). Never
  // throws on a terminology miss — always fails open to the best available
  // translation (Section G). See translationTerminology.ts.
  let finalTranslated = translated;

  if (profile) {
    const matched = matchTerminologyConstraints(content, profile);

    if (matched.length > 0) {
      const allMatchedTargets = new Set(matched.map((constraint) => constraint.target));
      const stableConstraints = matched.filter((constraint) => constraint.enforcement === "stable");
      const volatileConstraints = matched.filter((constraint) => constraint.enforcement === "volatile");

      const stableViolations = findTerminologyViolations(stableConstraints, allMatchedTargets, translated, profile);
      const volatileViolations = findTerminologyViolations(volatileConstraints, allMatchedTargets, translated, profile);

      // Detect-only diagnostics (Section E) — never influence retry/output.
      // Sanitized: counts only, never the actual glossary terms or text.
      if (volatileViolations.length > 0) {
        logger.info(
          `Terminology diagnostic (volatile, detect-only): ${volatileViolations.length} possible miss(es), profile=${profile.id}`
        );
      }

      if (stableViolations.length > 0) {
        logger.warn(
          `Terminology violation: ${stableViolations.length} stable constraint(s) missed, profile=${profile.id}; issuing one corrective retry`
        );

        const correctivePrompt = buildCorrectiveTerminologySystemPrompt(translationStyle, profile, {
          glossaryViolations: stableViolations
            .filter((violation) => violation.kind === "glossary")
            .map((violation) => ({ sourceTerm: violation.sourceTerm, target: violation.target })),
          protectedTermViolations: stableViolations
            .filter((violation) => violation.kind === "protected")
            .map((violation) => violation.target),
        });

        try {
          const retryCompletion = await llmService.chatCompletion(correctivePrompt, content);
          const retryTranslated =
            typeof retryCompletion.response?.data === "string" ? retryCompletion.response.data.trim() : "";

          // Fail-open rule (Section G): use the retry output whenever it's
          // usable, regardless of whether it still has a residual
          // violation — never a second retry, never throw for this reason.
          if (retryTranslated && retryTranslated.length <= MAX_TRANSLATED_CONTENT_LENGTH) {
            const retryStillViolates =
              findTerminologyViolations(stableConstraints, allMatchedTargets, retryTranslated, profile).length > 0;
            finalTranslated = retryTranslated;
            logger.info(
              `Terminology corrective retry used, profile=${profile.id}, outcome=${retryStillViolates ? "still-non-compliant" : "resolved"}`
            );
          } else {
            logger.warn(
              `Terminology corrective retry output rejected (${retryTranslated ? "exceeded length ceiling" : "empty"}), profile=${profile.id}; keeping original translation`
            );
          }
        } catch (error) {
          logger.error(`Terminology corrective retry call failed, profile=${profile.id}; keeping original translation`, error);
        }
      }
    }
  }

  return {
    detectedLanguage,
    originalContent: content,
    analysisContent: finalTranslated,
    translated: true,
    translationStyle,
    ...(profile ? { translationProfileId: profile.id, translationProfileVersion: profile.version } : {}),
  };
}
