import * as functions from "firebase-functions";
import { ExplainRequest, SuccessResponse } from "../models/types";
import { buildAnalysisMessage } from "../models/analysisMessage";
import { SYSTEM_PROMPT_V1 } from "../models/systemPromptV1";
import { SYSTEM_PROMPT_V2 } from "../models/systemPromptV2";
import { createLlmService } from "../services/llmService";
import { logLlmUsageTelemetry } from "../services/llmUsageTelemetry";
import { logger } from "../utils/logger";
import { validateExplainRequest } from "./requestValidation";
import { checkRateLimit } from "./rateLimiter";
import {
  PreStageResult,
  runMultilingualPreStage,
  TranslationFailedError,
  UnsupportedLanguageError,
} from "./multilingualPreStage";
import { RetryableProviderError } from "../services/httpRetry";
import { ANALYSIS_BUSY_MESSAGE, TRANSLATION_BUSY_MESSAGE } from "./providerBusyMessages";

export async function explainHandler(
  request: any
): Promise<SuccessResponse & { preStage?: PreStageResult }> {
  logger.setContext(request);

  const data = request.data as ExplainRequest;
  // Server-authoritative input validation (content/context/prompt).
  const validation = validateExplainRequest(data);
  if (!validation.ok) {
    logger.error(`Invalid request: ${validation.error}`);
    throw new functions.https.HttpsError(
      "invalid-argument",
      validation.error ?? "Invalid request"
    );
  }

  // Defaults match the Chrome extension and streaming callable.
  const { content, prompt = "v2", context_before, context_after } = data;

  // Per-IP rate limit (parity with explainStreamCallable). The callable's client IP is
  // on the underlying Express request.
  const rateLimit = await checkRateLimit(request.rawRequest?.ip);
  if (!rateLimit.allowed) {
    const isLimiterError = rateLimit.reason === "limiter-error";
    const code = isLimiterError ? "unavailable" : "resource-exhausted";
    logger.warn(`Request denied: ${rateLimit.reason ?? "rate-limited"}`);
    throw new functions.https.HttpsError(
      code,
      isLimiterError ? "Rate limiter temporarily unavailable" : "Too many requests"
    );
  }

  logger.info(`Received explain request with prompt version: ${prompt}`);
  logger.info(`Content: ${content.substring(0, 100)}...`);

  const systemPrompt = prompt === "v2" ? SYSTEM_PROMPT_V2 : SYSTEM_PROMPT_V1;

  try {
    const llmService = createLlmService("gemini");

    // P8-B: routes non-Japanese source text through translation before the
    // existing (unmodified) Japanese Analyzer runs. Shared with
    // explainStreamCallableHandler so detection/translation logic lives in
    // exactly one place.
    const preStage = await runMultilingualPreStage(content, llmService);

    const completion = await llmService.chatCompletion(
      systemPrompt,
      buildAnalysisMessage(preStage.analysisContent, { before: context_before, after: context_after })
    );

    logLlmUsageTelemetry({
      provider: "gemini",
      requestedModel: completion.requestedModel,
      responseModel: completion.responseModel,
      operation: "batch",
      rawUsage: completion.usage,
      finishReason: completion.finishReason,
      completed: true,
    });
    logger.info("Explain request completed successfully");
    // P8-C1: same contract as the streaming callable's preStage chunk —
    // present only when translation actually happened (zh/en), so a batch
    // consumer can show the generated Japanese translation. Absent (not
    // present as undefined) for the Japanese fast path: byte-identical to
    // pre-P8-C1 response shape.
    return preStage.translated ? { ...completion.response, preStage } : completion.response;
  } catch (error) {
    if (error instanceof UnsupportedLanguageError) {
      logger.warn(`Rejected unsupported source language: ${error.detectedLanguage}`);
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Unsupported source language. J-Buddy currently supports Japanese, Chinese, and English source text."
      );
    }
    if (error instanceof TranslationFailedError) {
      logger.error(`Translation pre-stage failed (${error.detectedLanguage})`, error);
      // P8-C1.5: a translation failure caused by exhausted provider retries
      // (429/5xx) gets the "busy, try later" message; any other translation
      // failure (empty output, over the translated-content ceiling, a
      // non-retryable provider error) keeps the generic message — it isn't
      // a transient/retry situation, so "busy" would be misleading.
      const busy = error.cause instanceof RetryableProviderError;
      throw new functions.https.HttpsError(
        "internal",
        busy ? TRANSLATION_BUSY_MESSAGE : "Translation to Japanese failed. Please try again."
      );
    }
    if (error instanceof RetryableProviderError) {
      // P8-C1.5: the ANALYSIS-stage call exhausted its retries — never leak
      // the raw provider string (e.g. "Gemini API error: 429 Too Many
      // Requests") to the client; full detail is already in the service
      // layer's per-attempt logger.error calls.
      logger.error("Analysis provider temporarily unavailable after retries", error);
      throw new functions.https.HttpsError("internal", ANALYSIS_BUSY_MESSAGE);
    }
    logger.error("Error in explain callable", error);
    throw new functions.https.HttpsError(
      "internal",
      error instanceof Error ? error.message : "Unknown error occurred"
    );
  }
}
