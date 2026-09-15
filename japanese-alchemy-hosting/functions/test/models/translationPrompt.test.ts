import { describe, it, expect } from "@jest/globals";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import { TRANSLATION_STYLES } from "../../src/models/translationStyle";
import { resolveTranslationProfile } from "../../src/models/translationProfile";

const oriwishProfile = resolveTranslationProfile("oriwish-ja-business-v1")!;

describe("buildTranslationSystemPrompt", () => {
  it("produces a distinct, non-empty prompt for every supported style", () => {
    const prompts = TRANSLATION_STYLES.map((style) => buildTranslationSystemPrompt(style));
    for (const prompt of prompts) {
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    }
    expect(new Set(prompts).size).toBe(TRANSLATION_STYLES.length);
  });

  describe("common rules shared by every style", () => {
    it.each(TRANSLATION_STYLES)("%s: output Japanese only, no explanation/quotes", (style) => {
      const prompt = buildTranslationSystemPrompt(style);
      expect(prompt).toContain("只輸出翻譯後的日文文字本身");
      expect(prompt).toContain("不要輸出任何說明、引號");
    });

    it.each(TRANSLATION_STYLES)("%s: no markdown", (style) => {
      expect(buildTranslationSystemPrompt(style)).toContain("不要輸出任何 Markdown");
    });

    it.each(TRANSLATION_STYLES)("%s: preserve factual meaning, no hallucination or omission", (style) => {
      const prompt = buildTranslationSystemPrompt(style);
      expect(prompt).toContain("忠實保留原文的事實內容與資訊完整性");
      expect(prompt).toContain("不省略、不新增、不臆測");
    });

    it.each(TRANSLATION_STYLES)("%s: preserve proper nouns / product names / model numbers", (style) => {
      const prompt = buildTranslationSystemPrompt(style);
      expect(prompt).toContain("保留專有名詞、品牌名、產品名稱、型號");
    });

    it.each(TRANSLATION_STYLES)("%s: preserve dates/units/prices/percentages exactly", (style) => {
      expect(buildTranslationSystemPrompt(style)).toContain("日期、單位、價格、百分比");
    });
  });

  it("natural prompt contains natural/general-reading instructions", () => {
    const prompt = buildTranslationSystemPrompt("natural");
    expect(prompt).toContain("自然日文");
    expect(prompt).toContain("一般閱讀");
  });

  it("news prompt contains news/reporting-register instructions", () => {
    const prompt = buildTranslationSystemPrompt("news");
    expect(prompt).toContain("新聞日文");
    expect(prompt).toContain("報導");
  });

  it("business prompt contains business/product-copy instructions and forbids invented claims", () => {
    const prompt = buildTranslationSystemPrompt("business");
    expect(prompt).toContain("商務日文");
    expect(prompt).toContain("產品頁面");
    expect(prompt).toContain("不可臆測或新增原文沒有的優點、認證、獎項、性能宣稱");
  });

  it("natural prompt does NOT contain the other styles' distinguishing instructions", () => {
    const prompt = buildTranslationSystemPrompt("natural");
    expect(prompt).not.toContain("新聞日文");
    expect(prompt).not.toContain("商務日文");
  });

  describe("P8-D2: no profile — byte-identical to pre-P8-D2 output (item 19)", () => {
    it.each(TRANSLATION_STYLES)("%s: omitting the profile parameter produces the same prompt as calling with one argument", (style) => {
      expect(buildTranslationSystemPrompt(style)).toBe(buildTranslationSystemPrompt(style, undefined));
    });

    it.each(TRANSLATION_STYLES)("%s: no profile means no hard-constraint or brand-voice block at all", (style) => {
      const prompt = buildTranslationSystemPrompt(style);
      expect(prompt).not.toContain("術語對照表");
      expect(prompt).not.toContain("受保護用詞");
      expect(prompt).not.toContain("品牌語氣調整");
    });
  });

  describe("P8-D2: profile-specialized prompt", () => {
    it("includes the glossary mappings and protected terms as a clearly delimited hard-constraint block", () => {
      const prompt = buildTranslationSystemPrompt("business", oriwishProfile);

      expect(prompt).toContain("【術語對照表】");
      expect(prompt).toContain("精密滑台 → 精密ステージ");
      expect(prompt).toContain("直線模組 → リニアモジュール");
      expect(prompt).toContain("線性滑軌 → リニアガイド");
      expect(prompt).toContain("【受保護用詞】");
      expect(prompt).toContain("- ORIWISH");
      expect(prompt).toContain("- XYZ-300");
      expect(prompt).toContain("- ISO 9001");
    });

    it("frames the hard-constraint block as taking priority over style/brand-voice", () => {
      const prompt = buildTranslationSystemPrompt("business", oriwishProfile);
      expect(prompt).toContain("優先權高於下方的風格與品牌語氣說明");
    });

    it("includes the brand-voice specialization, framed as never overriding the hard constraints", () => {
      const prompt = buildTranslationSystemPrompt("business", oriwishProfile);
      expect(prompt).toContain("品牌語氣調整");
      expect(prompt).toContain(oriwishProfile.brandVoice.description);
      expect(prompt).toContain("不新增任何原文沒有的資訊、優點、認證或宣稱");
    });

    it("still includes the generic business style instructions alongside the profile (style is not replaced)", () => {
      const withoutProfile = buildTranslationSystemPrompt("business");
      const withProfile = buildTranslationSystemPrompt("business", oriwishProfile);
      expect(withProfile).toContain("商務日文");
      // Everything the no-profile prompt says is still present verbatim —
      // the profile is purely additive.
      expect(withProfile.startsWith(withoutProfile.split("\n\n").slice(0, 2).join("\n\n"))).toBe(true);
    });

    it("also works with the natural style — brand profile applies independently of generic style (Section O)", () => {
      const prompt = buildTranslationSystemPrompt("natural", oriwishProfile);
      expect(prompt).toContain("自然日文");
      expect(prompt).toContain("【術語對照表】");
      expect(prompt).toContain("【受保護用詞】");
      expect(prompt).toContain("品牌語氣調整");
      // Never silently forced to business just because a profile is set.
      expect(prompt).not.toContain("商務日文");
    });

    it("orders glossary entries longest-source-first (deterministic preparation, not model-order-dependent)", () => {
      const prompt = buildTranslationSystemPrompt("business", oriwishProfile);
      const glossaryBlock = prompt.split("【術語對照表】")[1].split("【受保護用詞】")[0];
      const lines = glossaryBlock.split("\n").filter((l) => l.startsWith("- "));
      const lengths = lines.map((l) => {
        const source = l.replace(/^- /, "").split(" → ")[0];
        return source.length;
      });
      const sorted = [...lengths].sort((a, b) => b - a);
      expect(lengths).toEqual(sorted);
    });
  });
});
