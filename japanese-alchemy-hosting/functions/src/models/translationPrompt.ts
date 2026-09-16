import { TranslationStyle } from "./translationStyle";
import { TranslationProfile } from "./translationProfile";

/**
 * P8-B/P8-C2/P8-D2 pre-stage translation prompt. Used ONLY to turn
 * non-Japanese source text into Japanese ahead of the existing (unmodified)
 * Japanese Analyzer prompts (systemPromptV1/V2) — it is not an analysis
 * prompt itself, and its output must be plain translated text with nothing
 * else.
 *
 * P8-C2 architecture: one shared instruction block common to every style,
 * plus a small per-style block appended on top — rather than three
 * mostly-duplicated giant prompts. Adding a style is "add one entry to
 * STYLE_INSTRUCTIONS", never "copy the whole prompt a fourth time".
 *
 * P8-D2 extends this compositionally with an OPTIONAL TranslationProfile:
 *   1. COMMON_TRANSLATION_RULES        (facts + output-format — unchanged)
 *   2. profile HARD constraints        (glossary + protected terms — only if profile given)
 *   3. STYLE_INSTRUCTIONS[style]       (generic register — unchanged)
 *   4. profile brand-voice block       (SOFT specialization — only if profile given)
 * No profile -> byte-identical output to pre-P8-D2 (verified by tests).
 */

const COMMON_TRANSLATION_RULES = `規則（所有風格皆適用）：
1. 只輸出翻譯後的日文文字本身，不要輸出任何說明、引號、前後綴、標籤，也不要輸出原文。
2. 不要輸出任何 Markdown 標記、程式碼區塊或多餘的空行。
3. 忠實保留原文的事實內容與資訊完整性：不省略、不新增、不臆測任何原文沒有的資訊。
4. 保留專有名詞、品牌名、產品名稱、型號；可視情況轉寫為片假名，以日文使用者最自然的用法為準，但不得更動其指稱對象。
5. 日期、單位、價格、百分比等數值資訊必須原樣保留，不得換算、四捨五入或省略。`;

// P8-C2: initial supported styles ONLY (natural / news / business) — do not
// add more styles without also extending TRANSLATION_STYLES.
const STYLE_INSTRUCTIONS: Record<TranslationStyle, string> = {
  natural: `風格：自然日文（一般閱讀／日語學習用途）
- 使用自然、道地的現代日文，語氣中性。
- 忠實傳達原文語意；既不逐字直譯，也不做不必要的改寫或潤飾。
- 適合作為一般書面日文閱讀材料。`,
  news: `風格：新聞日文（報導體）
- 使用簡潔、客觀、精煉的日文新聞／報導文體。
- 避免口語化、閒聊語氣，避免宣傳性或誇大的表現。
- 人名、日期、數字與陳述內容必須精確保留。`,
  business: `風格：商務日文（產品／行銷／商業文書）
- 使用專業、精練、適合日本商業讀者的日文，適用於產品頁面、宣傳手冊、提案書、企業文書、產品介紹等情境。
- 可以在不更動事實內容的前提下潤飾措辭，使其更自然通順、更適合商業讀者閱讀。
- 絕對不可臆測或新增原文沒有的優點、認證、獎項、性能宣稱或其他行銷宣傳內容。
- 規格、數字、型號、產品名稱必須逐一保留，不得省略或改寫其指稱對象。`,
};

/**
 * Renders a profile's terminology glossary + protected terms as one clearly
 * delimited, deterministic HARD-constraint block (P8-D2 Section H/I).
 *
 * Glossary entries are sorted longest-source-first ("longest-match-first",
 * Section F): a more specific/longer term (e.g. 精密滑台) is presented
 * ahead of any shorter term that could otherwise be read as matching a
 * substring of it, reducing the chance the model applies the wrong rule to
 * an overlapping span. This is deterministic PREPARATION of the prompt
 * instruction — never semantic/fuzzy matching, and never a code-level
 * find/replace over the source or translated text.
 */
function buildProfileHardConstraintsBlock(profile: TranslationProfile): string {
  const sortedGlossary = [...profile.terminologyGlossary].sort((a, b) => {
    const aMax = Math.max(...a.sourceTerms.map((s) => s.length));
    const bMax = Math.max(...b.sourceTerms.map((s) => s.length));
    return bMax - aMax;
  });

  const glossaryLines = sortedGlossary
    .map((entry) => `- ${entry.sourceTerms.join(" / ")} → ${entry.target}`)
    .join("\n") || "（無）";

  const protectedLines = profile.protectedTerms.map((term) => `- ${term}`).join("\n") || "（無）";

  return `以下為必須遵守的專有名詞規則（優先權高於下方的風格與品牌語氣說明，兩者衝突時一律以此區塊為準，不可違反）：

【術語對照表】（原文出現對應詞彙時，必須翻譯為指定的日文用詞，不得使用其他譯法或自行意譯）：
${glossaryLines}

【受保護用詞】（必須在譯文中原樣保留，不得翻譯、音譯、增刪、改寫或省略）：
${protectedLines}`;
}

/** Renders a profile's SOFT brand-voice specialization, layered after style. */
function buildBrandVoiceBlock(profile: TranslationProfile): string {
  return `品牌語氣調整（在完全遵守上方【術語對照表】與【受保護用詞】、且不新增任何原文沒有的資訊、優點、認證或宣稱的前提下，微調用字與語氣）：
${profile.brandVoice.description}`;
}

/** Builds the translation system prompt for one style, optionally specialized by a translation profile. */
export function buildTranslationSystemPrompt(style: TranslationStyle, profile?: TranslationProfile): string {
  const parts = [
    `你是一名專業的日文翻譯。
任務：把使用者提供的原文（中文或英文）翻譯成日文，供後續的日文學習分析系統使用。`,
    COMMON_TRANSLATION_RULES,
  ];

  if (profile) {
    parts.push(buildProfileHardConstraintsBlock(profile));
  }

  parts.push(STYLE_INSTRUCTIONS[style]);

  if (profile) {
    parts.push(buildBrandVoiceBlock(profile));
  }

  return parts.join("\n\n");
}

/**
 * P8-D4.2: what a corrective retry needs to say — ONLY the specific
 * mappings/terms that were actually missed, never the whole glossary
 * again (translationTerminology.ts computes this from the matched
 * constraints that failed validation).
 */
export interface TerminologyCorrectionRequest {
  glossaryViolations: { sourceTerm: string; target: string }[];
  protectedTermViolations: string[];
}

/**
 * P8-D4.2: builds the ONE-SHOT corrective retry system prompt used when a
 * first translation attempt violates one or more enforcement-"stable"
 * terminology constraints. Reuses `buildTranslationSystemPrompt` verbatim
 * as the base (same style + full profile hard-constraint block + brand
 * voice a real request would already have sent) and appends a short,
 * violation-specific addendum — never a from-scratch prompt, and never
 * more glossary content than the original call already sent.
 */
export function buildCorrectiveTerminologySystemPrompt(
  style: TranslationStyle,
  profile: TranslationProfile,
  correction: TerminologyCorrectionRequest
): string {
  const basePrompt = buildTranslationSystemPrompt(style, profile);

  const glossaryLines =
    correction.glossaryViolations.map((violation) => `- ${violation.sourceTerm} → ${violation.target}`).join("\n") ||
    "（無）";
  const protectedLines = correction.protectedTermViolations.map((term) => `- ${term}`).join("\n") || "（無）";

  const addendum = `【修正指示】前一次翻譯未正確遵守下列必要術語，請重新產生完整的日文翻譯：

以下術語對應為必須遵守（原文出現對應詞彙時必須使用指定譯法；若原文僅出現對照表中「較短」的詞彙，請勿誤用對照表中「較長」詞彙的譯法，例如原文僅為「櫻花」而非「櫻花圖案」時，請使用「桜」而非「桜柄」）：
${glossaryLines}

以下受保護用詞在前次翻譯中缺漏或被更動，請確保譯文中原樣包含：
${protectedLines}

請務必保留所有事實內容、數字、單位、品牌名稱與原文語意，不得新增原文沒有的宣稱或資訊。
僅輸出修正後的完整日文翻譯本身，不要輸出任何說明、引號、標籤或其他文字。`;

  return `${basePrompt}\n\n${addendum}`;
}
