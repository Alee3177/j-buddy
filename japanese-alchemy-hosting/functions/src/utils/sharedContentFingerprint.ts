import { createHash } from "crypto";

/**
 * P7.4 — shared-collection deduplication.
 *
 * Every repeated "save analysis" with is_shared=true previously created
 * another shared_analysis_pages document with a random Firestore auto-ID, so
 * identical content accumulated as duplicates with no server-side guard at
 * all (client/UI prevention is explicitly not sufficient — see
 * saveItemsCallable.ts). A shared analysis page's identity is its source
 * text: normalize it, then SHA-256 it, and use that as the document's own
 * deterministic id (see FirestoreService.saveAnalysisPage), so two saves of
 * "the same" text can never produce two documents, and concurrent identical
 * saves are only ever settled by Firestore's own atomic create().
 */

/**
 * Normalize source text for shared-content deduplication: trim leading/
 * trailing whitespace and collapse every run of whitespace (spaces, tabs,
 * newlines) to a single space, while preserving all non-whitespace
 * (semantic) characters exactly as-is. Two analyses of "the same" text that
 * differ only in incidental whitespace must fingerprint identically;
 * anything that changes the actual text must fingerprint differently.
 */
export function normalizeSharedSourceText(sourceText: string): string {
  return sourceText.trim().replace(/\s+/g, " ");
}

/**
 * Deterministic SHA-256 fingerprint of a shared analysis page's identity.
 *
 * Returns `null` when there is no usable source text to fingerprint (absent,
 * or empty/whitespace-only after normalization) — callers must fall back to
 * non-deduplicated behavior in that case. Fingerprinting an empty string
 * would otherwise collapse every source-text-less shared save into a single
 * document, merging genuinely unrelated content.
 */
export function sharedPageContentHash(
  sourceText: string | undefined | null
): string | null {
  const normalized = normalizeSharedSourceText(sourceText ?? "");
  if (normalized.length === 0) {
    return null;
  }
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
