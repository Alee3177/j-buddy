/**
 * P8-C1.5: clean, user-facing messages for when a provider call was retried
 * (see services/httpRetry.ts) and still failed with a transient error
 * (429/5xx). Shared by explainHandler and explainStreamCallableHandler so
 * both surfaces stay in sync and neither leaks a raw provider string (e.g.
 * "Gemini API error: 429 Too Many Requests") to the client. Full technical
 * detail is still logged server-side on every attempt inside
 * geminiLlmService.ts/zaiLlmService.ts.
 */
export const TRANSLATION_BUSY_MESSAGE = "翻譯服務目前忙碌中，請稍後再試。";
export const ANALYSIS_BUSY_MESSAGE = "分析服務目前忙碌中，請稍後再試。";
