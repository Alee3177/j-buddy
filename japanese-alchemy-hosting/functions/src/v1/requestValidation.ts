import { MAX_CONTEXT_CHARS } from "../models/analysisMessage";
import { isValidTranslationStyle, TRANSLATION_STYLES } from "../models/translationStyle";
import { isValidTranslationProfileId, TRANSLATION_PROFILE_IDS } from "../models/translationProfile";

export const MIN_CONTENT_LENGTH = 2;
export const MAX_CONTENT_LENGTH = 500;
// Envelope ceiling for the streaming endpoint. The platform-level body cap and
// field-level validation are the backstops for under-reported/chunked bodies.
export const MAX_REQUEST_BYTES = 16 * 1024;

export interface ValidationResult {
  ok: boolean;
  error?: string;
  status: number;
}

/**
 * Validate the explain request body. Shared by explainStream and explain so the
 * analysis-text contract cannot drift between surfaces. Server-authoritative:
 * never trusts the client's 2-500 contract.
 *
 * @returns `{ ok, error, status }` — `status` is the HTTP code (stream) and
 * maps to an `invalid-argument` error on the callable.
 */
export function validateExplainRequest(body: unknown): ValidationResult {
  const content = (body as any)?.content;
  if (
    typeof content !== "string" ||
    content.length < MIN_CONTENT_LENGTH ||
    content.length > MAX_CONTENT_LENGTH
  ) {
    return {
      ok: false,
      status: 400,
      error: `content must be a string of ${MIN_CONTENT_LENGTH}-${MAX_CONTENT_LENGTH} characters`,
    };
  }

  const before = (body as any)?.context_before;
  if (before !== undefined) {
    if (typeof before !== "string" || before.length > MAX_CONTEXT_CHARS) {
      return {
        ok: false,
        status: 400,
        error: `context_before must be a string of at most ${MAX_CONTEXT_CHARS} characters`,
      };
    }
  }

  const after = (body as any)?.context_after;
  if (after !== undefined) {
    if (typeof after !== "string" || after.length > MAX_CONTEXT_CHARS) {
      return {
        ok: false,
        status: 400,
        error: `context_after must be a string of at most ${MAX_CONTEXT_CHARS} characters`,
      };
    }
  }

  const prompt = (body as any)?.prompt;
  if (prompt !== undefined && prompt !== "v1" && prompt !== "v2") {
    return { ok: false, status: 400, error: "Prompt must be 'v1' or 'v2'" };
  }

  const ai = (body as any)?.ai;
  if (ai !== undefined && ai !== "gemini" && ai !== "zai") {
    return { ok: false, status: 400, error: "AI must be 'gemini' or 'zai'" };
  }

  // P8-C2: optional; runMultilingualPreStage defaults an omitted value to
  // "natural" and ignores it entirely for Japanese input. This is the ONLY
  // validation point — no other layer re-checks the literal values.
  const translationStyle = (body as any)?.translationStyle;
  if (translationStyle !== undefined && !isValidTranslationStyle(translationStyle)) {
    return {
      ok: false,
      status: 400,
      error: `translationStyle must be one of: ${TRANSLATION_STYLES.join(", ")}`,
    };
  }

  // P8-D2: optional; runMultilingualPreStage resolves an omitted value to
  // "no profile" (existing P8-C2 behavior) and ignores it entirely for
  // Japanese input. This is the ONLY validation point — the client never
  // supplies profile content, only this small validated id.
  const translationProfileId = (body as any)?.translationProfileId;
  if (translationProfileId !== undefined && !isValidTranslationProfileId(translationProfileId)) {
    return {
      ok: false,
      status: 400,
      error: `translationProfileId must be one of: ${TRANSLATION_PROFILE_IDS.join(", ")}`,
    };
  }

  return { ok: true, status: 200 };
}

/**
 * Body-size guard for the streaming endpoint. Rejects oversized requests before
 * any parsing work or LLM invocation, based on the Content-Length header.
 */
export function isBodyTooLarge(req: {
  header: (name: string) => string | undefined;
}): boolean {
  const cl = Number(req.header("content-length") ?? 0);
  return Number.isFinite(cl) && cl > MAX_REQUEST_BYTES;
}

/**
 * Secondary body-size guard on the parsed body, for requests with an absent or
 * under-reported Content-Length (e.g. chunked transfer). The header check alone
 * is bypassable; this bounds the bytes actually buffered.
 */
export function isParsedBodyTooLarge(body: unknown): boolean {
  try {
    return JSON.stringify(body).length > MAX_REQUEST_BYTES;
  } catch {
    return false;
  }
}

// P7.4 — saveItems is auth-gated but, unlike explain, had no ceiling on how
// many vocab/grammar items a single save could contain. `saveVocabulary` /
// `saveGrammar` each commit one Firestore batch (a hard 500-write limit) per
// array, so an oversized array previously surfaced as an unhandled Firestore
// "too many writes" error instead of a clean rejection. A legitimate save is
// derived from a single ≤500-character `explain` analysis (MAX_CONTENT_LENGTH
// above), which realistically yields well under a hundred items — 200 is a
// generous ceiling that stays safely under Firestore's 500-write batch limit.
export const MAX_SAVE_ITEMS_COUNT = 200;

export function validateSaveItemsCounts(
  words: unknown[],
  grammars: unknown[]
): ValidationResult {
  if (words.length > MAX_SAVE_ITEMS_COUNT || grammars.length > MAX_SAVE_ITEMS_COUNT) {
    return {
      ok: false,
      status: 400,
      error: `A single save cannot exceed ${MAX_SAVE_ITEMS_COUNT} words or ${MAX_SAVE_ITEMS_COUNT} grammar points`,
    };
  }
  return { ok: true, status: 200 };
}
