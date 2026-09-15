/**
 * P8-D2: server-side translation profile framework — layers a terminology
 * glossary, protected terms, and a brand-voice specialization on top of the
 * existing (P8-C2) translationStyle system.
 *
 * STRICT scope for this phase (see docs — P8-D1 audit, P8-D2 spec):
 *   - Immutable, static, server-authored configuration ONLY. No Firestore
 *     lookup, no external config service, no client-supplied glossary/
 *     protectedTerms/brandVoice content of any kind.
 *   - The client can only ever select a profile by a small validated ID
 *     (translationProfileId) — never supply profile content directly. This
 *     is the trust boundary the P8-D1 audit called for: explain/
 *     explainStreamCallable are public, unauthenticated endpoints, so
 *     arbitrary client-supplied prompt content is never acceptable here.
 *   - Exactly ONE sample profile in P8-D2 ("oriwish-ja-business-v1"), for
 *     architecture validation — NOT a production ORIWISH terminology set.
 */

// --- limits (Section I: enforce maximum profile sizes) ---------------------

export const MAX_GLOSSARY_ENTRIES = 200;
export const MAX_PROTECTED_TERMS = 200;
// Generous for a term/short phrase, well under MAX_CONTENT_LENGTH (500).
export const MAX_TERM_LENGTH = 100;
// Budget for the rendered hard-constraint prompt block, so a profile can
// never crowd out the shared GEMINI_MAX_TOKENS budget (16384) the actual
// translation/analysis content also needs.
export const MAX_SERIALIZED_PROFILE_CONTEXT_CHARS = 4000;

// Structural delimiters used elsewhere in the prompt pipeline (see
// models/analysisMessage.ts's DELIMITER_PATTERN for the same defensive
// principle applied to untrusted context). Profile data is server-authored
// in P8-D2, not untrusted client input, but terms are still validated
// against these so a future less-trusted profile source (Section G of the
// P8-D1 audit) can reuse this same validator without change.
const FORBIDDEN_TERM_CHARS = /[【】\n\r]/;

export interface GlossaryEntry {
  /**
   * Exact source string(s) that map to this ONE canonical Japanese target.
   * Many-to-one aliasing is allowed (multiple source spellings -> one
   * target); one-to-many is never allowed — that ambiguity is exactly what
   * "duplicate source term with conflicting target" validation rejects.
   */
  sourceTerms: string[];
  /** Single canonical Japanese target. */
  target: string;
}

export interface TranslationProfile {
  id: string;
  version: string;
  /** Deterministic exact-match glossary — HARD constraint (Section E). */
  terminologyGlossary: GlossaryEntry[];
  /** Terms that must survive translation verbatim unless also glossary-mapped. HARD constraint. */
  protectedTerms: string[];
  /**
   * SOFT specialization layered on top of translationStyle. Server-authored
   * prose only — never client input, and never allowed (by prompt framing)
   * to override the HARD constraints above.
   */
  brandVoice: {
    description: string;
  };
}

export class UnknownTranslationProfileError extends Error {
  public readonly translationProfileId: string;

  constructor(translationProfileId: string) {
    super(`Unknown translation profile: ${translationProfileId}`);
    this.name = "UnknownTranslationProfileError";
    this.translationProfileId = translationProfileId;
  }
}

class InvalidTranslationProfileConfigError extends Error {
  constructor(profileId: string, reason: string) {
    super(`Invalid translation profile config "${profileId}": ${reason}`);
    this.name = "InvalidTranslationProfileConfigError";
  }
}

/**
 * Fail-closed structural validation, run once at module load (Section F/I:
 * "fail closed during profile validation / initialization"). A profile that
 * fails this can never reach `resolveTranslationProfile` — a config bug
 * surfaces immediately (build/test/cold-start), never at request time.
 */
function validateTranslationProfile(profile: TranslationProfile): void {
  const fail = (reason: string): never => {
    throw new InvalidTranslationProfileConfigError(profile.id, reason);
  };

  if (profile.terminologyGlossary.length > MAX_GLOSSARY_ENTRIES) {
    fail(`terminologyGlossary exceeds ${MAX_GLOSSARY_ENTRIES} entries`);
  }
  if (profile.protectedTerms.length > MAX_PROTECTED_TERMS) {
    fail(`protectedTerms exceeds ${MAX_PROTECTED_TERMS} entries`);
  }

  // Terminology glossary + protected terms are ONE hard-constraint layer
  // (Section G): build a single source->target map and reject any
  // contradiction within or across the two, rather than picking a winner.
  const sourceToTarget = new Map<string, string>();
  let serializedChars = 0;

  for (const entry of profile.terminologyGlossary) {
    if (entry.target.length > MAX_TERM_LENGTH) fail(`glossary target "${entry.target}" exceeds ${MAX_TERM_LENGTH} chars`);
    if (FORBIDDEN_TERM_CHARS.test(entry.target)) fail(`glossary target "${entry.target}" contains a forbidden character`);
    serializedChars += entry.target.length;

    for (const source of entry.sourceTerms) {
      if (source.length > MAX_TERM_LENGTH) fail(`glossary source "${source}" exceeds ${MAX_TERM_LENGTH} chars`);
      if (FORBIDDEN_TERM_CHARS.test(source)) fail(`glossary source "${source}" contains a forbidden character`);
      serializedChars += source.length;

      const existing = sourceToTarget.get(source);
      if (existing !== undefined && existing !== entry.target) {
        fail(`duplicate glossary source term "${source}" maps to conflicting targets ("${existing}" vs "${entry.target}")`);
      }
      sourceToTarget.set(source, entry.target);
    }
  }

  for (const term of profile.protectedTerms) {
    if (term.length > MAX_TERM_LENGTH) fail(`protected term "${term}" exceeds ${MAX_TERM_LENGTH} chars`);
    if (FORBIDDEN_TERM_CHARS.test(term)) fail(`protected term "${term}" contains a forbidden character`);
    serializedChars += term.length;

    // A protected term with NO glossary mapping means "preserve exactly" —
    // equivalent to an implicit self-mapped glossary entry. Only a mapping
    // to a genuinely DIFFERENT target is a contradiction.
    const existing = sourceToTarget.get(term);
    if (existing !== undefined && existing !== term) {
      fail(`protected term "${term}" conflicts with a glossary mapping to a different target ("${existing}")`);
    }
  }

  serializedChars += profile.brandVoice.description.length;
  if (serializedChars > MAX_SERIALIZED_PROFILE_CONTEXT_CHARS) {
    fail(`serialized profile context exceeds ${MAX_SERIALIZED_PROFILE_CONTEXT_CHARS} characters`);
  }
}

/**
 * Deep-freezes a profile after validation, so `resolveTranslationProfile`
 * can never hand out a mutable reference a caller could accidentally (or
 * maliciously, if ever reached from less-trusted code) alter in place.
 */
function freezeProfile(profile: TranslationProfile): TranslationProfile {
  profile.terminologyGlossary.forEach((entry) => {
    Object.freeze(entry.sourceTerms);
    Object.freeze(entry);
  });
  Object.freeze(profile.terminologyGlossary);
  Object.freeze(profile.protectedTerms);
  Object.freeze(profile.brandVoice);
  return Object.freeze(profile);
}

function defineProfile(profile: TranslationProfile): TranslationProfile {
  validateTranslationProfile(profile);
  return freezeProfile(profile);
}

// --- P8-D2 sample profile ----------------------------------------------
//
// SAMPLE / FRAMEWORK profile for architecture validation ONLY — NOT a real
// ORIWISH terminology dataset. "XYZ-300" is a test fixture, not a real
// ORIWISH product; no real certifications/specs are implied or asserted.
const ORIWISH_JA_BUSINESS_V1 = defineProfile({
  id: "oriwish-ja-business-v1",
  version: "1",
  protectedTerms: ["ORIWISH", "XYZ-300", "ISO 9001"],
  terminologyGlossary: [
    { sourceTerms: ["精密滑台"], target: "精密ステージ" },
    { sourceTerms: ["直線模組"], target: "リニアモジュール" },
    { sourceTerms: ["線性滑軌"], target: "リニアガイド" },
  ],
  brandVoice: {
    description:
      "專業、精簡、具技術可信度的日文商務語氣，符合日本 B2B 工業產品溝通慣例；" +
      "避免誇大宣稱，避免消費性廣告式的浮誇用語，維持理性、客觀的技術溝通風格。",
  },
});

const PROFILES: Readonly<Record<string, TranslationProfile>> = Object.freeze({
  [ORIWISH_JA_BUSINESS_V1.id]: ORIWISH_JA_BUSINESS_V1,
});

export const TRANSLATION_PROFILE_IDS: readonly string[] = Object.freeze(Object.keys(PROFILES));

export function isValidTranslationProfileId(value: unknown): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROFILES, value);
}

/**
 * Resolves a translationProfileId to its (immutable) TranslationProfile.
 *
 *   undefined            -> undefined (no profile — existing P8-C2 behavior)
 *   a known id           -> the frozen TranslationProfile
 *   an unrecognized id   -> throws UnknownTranslationProfileError (fail closed)
 *
 * Callers that already validated the id via `isValidTranslationProfileId`
 * (requestValidation.ts) will never hit the throw path in practice — it
 * exists as the fail-closed guarantee for any other/future caller.
 */
export function resolveTranslationProfile(translationProfileId?: string): TranslationProfile | undefined {
  if (translationProfileId === undefined) return undefined;
  const profile = PROFILES[translationProfileId];
  if (!profile) {
    throw new UnknownTranslationProfileError(translationProfileId);
  }
  return profile;
}

// Exported for tests only, so the validator itself (fail-closed behavior on
// a deliberately-broken fixture) can be exercised without needing to break
// the real, always-valid module-level registry.
export const __testing = {
  validateTranslationProfile,
  defineProfile,
};
