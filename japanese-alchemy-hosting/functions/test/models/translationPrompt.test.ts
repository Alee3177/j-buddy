import { describe, it, expect } from "@jest/globals";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import { TRANSLATION_STYLES } from "../../src/models/translationStyle";

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
});
