import { HttpsError } from "firebase-functions/v2/https";
import type { CallableRequest, CallableResponse } from "firebase-functions/v2/https";
import { buildAnalysisMessage } from "../models/analysisMessage";
import { SYSTEM_PROMPT_V1 } from "../models/systemPromptV1";
import { SYSTEM_PROMPT_V2 } from "../models/systemPromptV2";
import { createLlmService } from "../services/llmService";
import { logLlmUsageTelemetry } from "../services/llmUsageTelemetry";
import { logger } from "../utils/logger";
import { isParsedBodyTooLarge, validateExplainRequest } from "./requestValidation";
import { checkRateLimit, rateLimitKey } from "./rateLimiter";
import { consumeLlmStream } from "./llmStreamDeltas";
import {
  runMultilingualPreStage,
  TranslationFailedError,
  UnsupportedLanguageError,
} from "./multilingualPreStage";
import { detectLanguage } from "../services/languageDetection";

interface StreamChunk {
  content: string;
  // P8-B: a one-shot, empty-content status marker sent immediately when
  // non-Japanese source text is detected, before translation begins. `content`
  // stays "" so a client that only does `fullText += chunk.content` (today's
  // extension) is unaffected — reading `status` for a UI treatment is a
  // forward-compatible follow-up, not required by this phase.
  status?: "translating";
}

interface CallableStreamResult {
  success: boolean;
  error?: string;
}

function clientTag(ip?: string): string {
  return ip ? rateLimitKey(ip) : "unknown";
}

function callableErrorForRateLimit(reason?: string): HttpsError {
  if (reason === "limiter-error") {
    return new HttpsError("unavailable", "Rate limiter temporarily unavailable");
  }
  return new HttpsError("resource-exhausted", "Too many requests");
}

/** Streams managed-provider analysis through the Firebase callable protocol. */
export async function explainStreamCallableHandler(
  request: CallableRequest,
  response?: CallableResponse<StreamChunk>
): Promise<CallableStreamResult> {
  logger.setContext(request);

  if (isParsedBodyTooLarge(request.data)) {
    logger.warn("Rejected oversized callable request body", {
      client: clientTag(request.rawRequest.ip),
    });
    throw new HttpsError("invalid-argument", "Request too large");
  }

  const validation = validateExplainRequest(request.data);
  if (!validation.ok) {
    logger.warn(`Rejected invalid callable request: ${validation.error}`, {
      client: clientTag(request.rawRequest.ip),
    });
    throw new HttpsError("invalid-argument", validation.error ?? "Invalid request");
  }

  const rateLimit = await checkRateLimit(request.rawRequest.ip);
  if (!rateLimit.allowed) {
    logger.warn(`Callable request denied: ${rateLimit.reason ?? "rate-limited"}`, {
      client: clientTag(request.rawRequest.ip),
    });
    throw callableErrorForRateLimit(rateLimit.reason);
  }

  const { content, prompt = "v2", context_before, context_after } = request.data as any;
  const systemPrompt = prompt === "v2" ? SYSTEM_PROMPT_V2 : SYSTEM_PROMPT_V1;

  try {
    const llmService = createLlmService("gemini");

    // P8-B: cheap precheck (same detectLanguage the shared pre-stage below
    // uses internally) so a one-shot "translating" status chunk can go out
    // to the client before the translation call's latency is incurred. Only
    // fires when translation will actually be attempted (zh/en) — never for
    // Japanese (preserving today's latency/behavior) and never for an
    // unsupported/unknown language, which fails immediately below instead.
    const precheckLanguage = detectLanguage(content);
    if (
      (precheckLanguage === "zh" || precheckLanguage === "en") &&
      request.acceptsStreaming &&
      response
    ) {
      await response.sendChunk({ content: "", status: "translating" });
    }

    // Routes non-Japanese source text through translation before the
    // existing (unmodified) Japanese Analyzer runs. Shared with
    // explainHandler so detection/translation logic lives in exactly one
    // place. Translation itself is never streamed — it must fully complete
    // before analysis streaming begins.
    const preStage = await runMultilingualPreStage(content, llmService);

    const completion = await llmService.streamCompletion(
      systemPrompt,
      buildAnalysisMessage(preStage.analysisContent, { before: context_before, after: context_after })
    );

    const streamResult = await consumeLlmStream(completion.response, async (delta) => {
      if (request.acceptsStreaming && response) {
        await response.sendChunk({ content: delta });
      }
    });

    logLlmUsageTelemetry({
      provider: "gemini",
      requestedModel: completion.requestedModel,
      responseModel: streamResult.responseModel,
      operation: "stream",
      rawUsage: streamResult.usage,
      finishReason: streamResult.finishReason,
      completed: streamResult.completed,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof UnsupportedLanguageError) {
      logger.warn(`Rejected unsupported source language: ${error.detectedLanguage}`, {
        client: clientTag(request.rawRequest.ip),
      });
      return {
        success: false,
        error: "Unsupported source language. J-Buddy currently supports Japanese, Chinese, and English source text.",
      };
    }
    if (error instanceof TranslationFailedError) {
      logger.error(`Translation pre-stage failed (${error.detectedLanguage})`, error);
      return { success: false, error: "Translation to Japanese failed. Please try again." };
    }
    logger.error("Error in callable streaming explain", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
