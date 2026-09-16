import { describe, it, expect, jest } from "@jest/globals";
import {
  runMultilingualPreStage,
  UnsupportedLanguageError,
  TranslationFailedError,
  MAX_TRANSLATED_CONTENT_LENGTH,
} from "../../src/v1/multilingualPreStage";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import { resolveTranslationProfile, UnknownTranslationProfileError } from "../../src/models/translationProfile";
import { LlmService } from "../../src/services/llmService";

const ORIWISH_PROFILE_ID = "oriwish-ja-business-v1";
const oriwishProfile = resolveTranslationProfile(ORIWISH_PROFILE_ID)!;

function fakeLlmService(chatCompletion: jest.Mock): LlmService {
  return {
    chatCompletion: chatCompletion as any,
    streamCompletion: jest.fn() as any,
  };
}

describe("runMultilingualPreStage", () => {
  it("bypasses translation entirely for Japanese input", async () => {
    const chatCompletion = jest.fn();
    const result = await runMultilingualPreStage("これはテストです", fakeLlmService(chatCompletion));

    expect(result).toEqual({
      detectedLanguage: "ja",
      originalContent: "これはテストです",
      analysisContent: "これはテストです",
      translated: false,
      translationStyle: "natural",
    });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("P8-C2: Japanese input ignores an explicit non-default style — still no LLM call, style just reported back", async () => {
    const chatCompletion = jest.fn();
    const result = await runMultilingualPreStage(
      "これはテストです",
      fakeLlmService(chatCompletion),
      "business"
    );

    expect(result).toEqual({
      detectedLanguage: "ja",
      originalContent: "これはテストです",
      analysisContent: "これはテストです",
      translated: false,
      translationStyle: "business",
    });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("translates Chinese input using the default (natural) translation prompt when no style is given", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });

    const result = await runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion));

    expect(chatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt("natural"), "这是一个测试");
    expect(result).toEqual({
      detectedLanguage: "zh",
      originalContent: "这是一个测试",
      analysisContent: "これはテストです",
      translated: true,
      translationStyle: "natural",
    });
  });

  it("translates English input using the translation system prompt", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({ response: { success: true, data: "こんにちは" } });

    const result = await runMultilingualPreStage("Hello there", fakeLlmService(chatCompletion));

    expect(result.detectedLanguage).toBe("en");
    expect(result.translated).toBe(true);
    expect(result.analysisContent).toBe("こんにちは");
    expect(result.originalContent).toBe("Hello there");
    expect(result.translationStyle).toBe("natural");
  });

  describe("P8-C2 translation style routing", () => {
    it.each(["natural", "news", "business"] as const)(
      "%s: passes the matching style-specific prompt to the LLM and reports it back",
      async (style) => {
        const chatCompletion = jest.fn() as any;
        chatCompletion.mockResolvedValue({ response: { success: true, data: "翻訳結果" } });

        const result = await runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion), style);

        expect(chatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt(style), "这是一个测试");
        expect(result.translationStyle).toBe(style);
        expect(result.translated).toBe(true);
      }
    );

    it("uses distinct prompts per style (no accidental sharing)", async () => {
      const natural = buildTranslationSystemPrompt("natural");
      const news = buildTranslationSystemPrompt("news");
      const business = buildTranslationSystemPrompt("business");

      expect(natural).not.toBe(news);
      expect(natural).not.toBe(business);
      expect(news).not.toBe(business);
    });
  });

  it("preserves originalContent exactly regardless of translation", async () => {
    const original = "美國 Prismacolor Premier 霹靂馬色鉛筆/油性（單支）\n#103~#997 單色下標區";
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({ response: { success: true, data: "翻訳結果" } });

    const result = await runMultilingualPreStage(original, fakeLlmService(chatCompletion));

    expect(result.originalContent).toBe(original);
    expect(result.originalContent).not.toBe(result.analysisContent);
  });

  it("fails loudly (does not fall back to untranslated content) when the LLM call throws", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockRejectedValue(new Error("provider unavailable"));

    await expect(
      runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion))
    ).rejects.toBeInstanceOf(TranslationFailedError);
  });

  it("fails loudly on empty translation output instead of a fake success", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({ response: { success: true, data: "   " } });

    await expect(
      runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion))
    ).rejects.toBeInstanceOf(TranslationFailedError);
  });

  it("rejects translated output over the ceiling instead of silently truncating it", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({
      response: { success: true, data: "あ".repeat(MAX_TRANSLATED_CONTENT_LENGTH + 1) },
    });

    await expect(
      runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion))
    ).rejects.toBeInstanceOf(TranslationFailedError);
  });

  it("accepts translated output exactly at the ceiling", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({
      response: { success: true, data: "あ".repeat(MAX_TRANSLATED_CONTENT_LENGTH) },
    });

    const result = await runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion));
    expect(result.analysisContent.length).toBe(MAX_TRANSLATED_CONTENT_LENGTH);
  });

  it("fails cleanly for unsupported/unknown language without calling the LLM", async () => {
    const chatCompletion = jest.fn();

    await expect(
      runMultilingualPreStage("안녕하세요", fakeLlmService(chatCompletion))
    ).rejects.toBeInstanceOf(UnsupportedLanguageError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  describe("P8-D2 translation profile routing", () => {
    it("Japanese input ignores an explicit profile id entirely — no LLM call, no profile in the result", async () => {
      const chatCompletion = jest.fn();
      const result = await runMultilingualPreStage(
        "これはテストです",
        fakeLlmService(chatCompletion),
        "natural",
        ORIWISH_PROFILE_ID
      );

      expect(result).toEqual({
        detectedLanguage: "ja",
        originalContent: "これはテストです",
        analysisContent: "これはテストです",
        translated: false,
        translationStyle: "natural",
      });
      expect(result.translationProfileId).toBeUndefined();
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it("zh + profile: builds the profile-specialized prompt and reports profile metadata back", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "業務日本語の翻訳結果" } });

      const result = await runMultilingualPreStage(
        "这是一个测试",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledWith(
        buildTranslationSystemPrompt("business", oriwishProfile),
        "这是一个测试"
      );
      expect(result.translationProfileId).toBe("oriwish-ja-business-v1");
      expect(result.translationProfileVersion).toBe("2");
    });

    it("en + profile: profile applies the same way regardless of source language", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "業務日本語の翻訳結果" } });

      const result = await runMultilingualPreStage(
        "Hello there",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledWith(
        buildTranslationSystemPrompt("business", oriwishProfile),
        "Hello there"
      );
      expect(result.translationProfileId).toBe("oriwish-ja-business-v1");
    });

    it("no profile id: translationProfileId/Version are absent from the result (not present as undefined keys)", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "翻訳結果" } });

      const result = await runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion));

      expect(Object.prototype.hasOwnProperty.call(result, "translationProfileId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(result, "translationProfileVersion")).toBe(false);
    });

    it("style=natural + profile: brand profile still applies; generic style is NOT silently forced to business", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "業務らしい自然な翻訳結果" } });

      const result = await runMultilingualPreStage(
        "这是一个测试",
        fakeLlmService(chatCompletion),
        "natural",
        ORIWISH_PROFILE_ID
      );

      const expectedPrompt = buildTranslationSystemPrompt("natural", oriwishProfile);
      expect(chatCompletion).toHaveBeenCalledWith(expectedPrompt, "这是一个测试");
      expect(expectedPrompt).toContain("自然日文");
      expect(expectedPrompt).not.toContain("商務日文");
      expect(expectedPrompt).toContain("【術語對照表】");
      expect(result.translationStyle).toBe("natural");
      expect(result.translationProfileId).toBe("oriwish-ja-business-v1");
    });

    it("fails closed for an unrecognized profile id (defense-in-depth; requestValidation should already have blocked it)", async () => {
      const chatCompletion = jest.fn();

      await expect(
        runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion), "natural", "does-not-exist")
      ).rejects.toBeInstanceOf(UnknownTranslationProfileError);
      expect(chatCompletion).not.toHaveBeenCalled();
    });
  });

  describe("P8-D4 real ORIWISH lifestyle/EC sample test input (Section N)", () => {
    const sampleSource = "ORIWISH 和風圖案長夾採用金襴織與西陣織的布料，展現高雅又輕量的日式質感。";

    it("the constructed prompt instructs preservation of every protected term and glossary mapping for the sample sentence", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({
        response: {
          success: true,
          data: "ORIWISHの和柄長財布は金襴織と西陣織の生地を使用し、上品で軽量な和の質感を纏っています。",
        },
      });

      await runMultilingualPreStage(sampleSource, fakeLlmService(chatCompletion), "business", ORIWISH_PROFILE_ID);

      const [sentPrompt, sentContent] = chatCompletion.mock.calls[0];
      expect(sentContent).toBe(sampleSource);
      expect(sentPrompt).toContain("- ORIWISH");
      expect(sentPrompt).toContain("和風圖案 / 和柄 → 和柄");
      expect(sentPrompt).toContain("金襴織 → 金襴織");
      expect(sentPrompt).toContain("西陣織 → 西陣織");
      expect(sentPrompt).toContain("布料 → 生地");
      expect(sentPrompt).toContain("高雅 / 上品 → 上品");
      expect(sentPrompt).toContain("輕量 / 軽量 → 軽量");
    });
  });
});
