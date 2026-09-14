import { TranslationStyle } from "./translationStyle";

/**
 * P8-B/P8-C2 pre-stage translation prompt. Used ONLY to turn non-Japanese
 * source text into Japanese ahead of the existing (unmodified) Japanese
 * Analyzer prompts (systemPromptV1/V2) — it is not an analysis prompt
 * itself, and its output must be plain translated text with nothing else.
 *
 * P8-C2 architecture: one shared instruction block common to every style,
 * plus a small per-style block appended on top — rather than three
 * mostly-duplicated giant prompts. Adding a style is "add one entry to
 * STYLE_INSTRUCTIONS", never "copy the whole prompt a fourth time".
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

/** Builds the translation system prompt for one style. */
export function buildTranslationSystemPrompt(style: TranslationStyle): string {
  return `你是一名專業的日文翻譯。
任務：把使用者提供的原文（中文或英文）翻譯成日文，供後續的日文學習分析系統使用。

${COMMON_TRANSLATION_RULES}

${STYLE_INSTRUCTIONS[style]}`;
}
