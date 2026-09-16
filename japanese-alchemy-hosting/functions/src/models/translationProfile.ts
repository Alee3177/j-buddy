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
 *   - Exactly ONE profile ("oriwish-ja-business-v1"). P8-D2 shipped it as an
 *     industrial-automation architecture-validation fixture; P8-D4 replaced
 *     its content wholesale with the real ORIWISH lifestyle/EC terminology
 *     set (version bumped 1 -> 2); P8-D4.1 grounded that content against
 *     verified ORIWISH source material, correcting one target (布料) and
 *     removing one contextually-ambiguous entry (光澤) — both materially
 *     change runtime translation output, so version bumped 2 -> 3. See the
 *     profile definition below and
 *     docs/terminology/ORIWISH-JA-EC-Translation-Profile-v0.1.md.
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

// --- P8-D4/P8-D4.1 v0.1 ORIWISH lifestyle/EC profile --------------------
//
// Real product domain: Japanese-style textile lifestyle accessories (long
// wallets, textile pouches, Japanese-pattern goods, gift-oriented consumer
// products). Supersedes the P8-D2 industrial-automation FRAMEWORK/test
// fixture (精密滑台/直線模組/線性滑軌, protected XYZ-300/ISO 9001) — that
// content was never real ORIWISH data and has been removed entirely.
//
// PROVENANCE: P8-D4.1 grounded this profile against verified ORIWISH
// source material (SKU oriwish_01 + owner-verified bilingual EC copy —
// see docs/terminology/sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md).
// Entries below are grouped SOURCE-CONFIRMED (Class A: directly evidenced
// by that source) vs GENERIC-EC (Class B: standard Japanese EC/textile
// vocabulary, safe and useful but not directly evidenced). Full per-term
// evidence notes and excluded/uncertain terms are in
// docs/terminology/ORIWISH-JA-EC-Translation-Profile-v0.1.md — this file
// intentionally does NOT carry provenance metadata into the runtime data
// structure (would grow the rendered prompt for no translation-time
// benefit); provenance lives in docs only.
//
// Glossary entries for 金襴織/西陣織 are TRANSLATION-CONSISTENCY rules only
// (if the source text uses this term, preserve it verbatim) — they do not
// assert that any real ORIWISH product is actually made this way. Note
// that OW_01's own material list (金襴織錦布料、布料、金屬配件) does NOT
// mention 西陣織 — that entry's evidence is the separate owner-verified
// bilingual copy set, not OW_01's own factual material description. Brand
// voice must never add origin/certification/handcraft/material claims the
// source text does not state (Section H).
const ORIWISH_JA_BUSINESS_V1 = defineProfile({
  id: "oriwish-ja-business-v1",
  version: "3",
  protectedTerms: ["ORIWISH"],
  terminologyGlossary: [
    // --- SOURCE-CONFIRMED (Class A) ---------------------------------
    { sourceTerms: ["長夾", "長錢包", "長財布"], target: "長財布" },
    { sourceTerms: ["和風圖案", "和柄"], target: "和柄" },
    { sourceTerms: ["櫻花圖案", "桜柄"], target: "桜柄" },
    { sourceTerms: ["金襴織"], target: "金襴織" },
    { sourceTerms: ["西陣織"], target: "西陣織" },
    { sourceTerms: ["高雅", "上品"], target: "上品" },
    { sourceTerms: ["華麗"], target: "華やか" },
    { sourceTerms: ["質感"], target: "質感" },
    { sourceTerms: ["收納"], target: "収納" },
    { sourceTerms: ["包包"], target: "バッグ" },
    { sourceTerms: ["禮物"], target: "贈り物" },
    { sourceTerms: ["外盒"], target: "外箱" },
    { sourceTerms: ["顏色"], target: "カラー" },
    { sourceTerms: ["顏色款式"], target: "カラーバリエーション" },
    { sourceTerms: ["色調", "色合"], target: "色合い" },
    { sourceTerms: ["尺寸"], target: "サイズ" },
    { sourceTerms: ["布料"], target: "布地" },
    { sourceTerms: ["購買前請確認"], target: "ご購入前にご確認ください" },
    // SKU-specific literal (matches OW_01's confirmed 共10色 color count
    // exactly) — NOT a general "共N色" pattern. A different color count on
    // a different SKU simply won't match this entry and falls through to
    // ordinary translation, still covered by the numeric-preservation rule
    // in COMMON_TRANSLATION_RULES.
    { sourceTerms: ["共10色可選"], target: "全10色から選べる" },

    // --- GENERIC-EC (Class B) ---------------------------------------
    { sourceTerms: ["收納包"], target: "収納ポーチ" },
    { sourceTerms: ["櫻花", "桜"], target: "桜" },
    { sourceTerms: ["輕量", "軽量"], target: "軽量" },
    { sourceTerms: ["禮品"], target: "ギフト" },
    { sourceTerms: ["商品說明"], target: "商品説明" },
    { sourceTerms: ["商品特色"], target: "商品の特徴" },
    { sourceTerms: ["商品尺寸"], target: "商品サイズ" },
    { sourceTerms: ["素材"], target: "素材" },
    { sourceTerms: ["方便攜帶"], target: "持ち運びしやすい" },
    { sourceTerms: ["日常使用"], target: "日常使い" },
  ],
  brandVoice: {
    description:
      "典雅、溫和、貼近日常生活的日系電商語氣，適用於和風布飾、長夾等禮品類商品頁面文案。" +
      "用詞含蓄、不誇張，避免「絕對」「最高級」「唯一」等宣傳性極端用語，也不得使用其他行銷式浮誇語言；" +
      "可在不影響事實內容的前提下潤飾文字，使其更自然通順、更貼近日本電商讀者的閱讀習慣；" +
      "絕對不可無中生有地新增原文沒有提及的材質、產地、認證、手工製作、獎項、耐用性或功效等宣稱。",
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
