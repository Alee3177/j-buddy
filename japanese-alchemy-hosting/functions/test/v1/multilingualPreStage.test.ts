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
      expect(result.translationProfileVersion).toBe("4");
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

  describe("P8-D4.1 real ORIWISH (OW_01) sample test input (Section N)", () => {
    const sampleSource = "ORIWISH 和風圖案長夾採用金襴織與西陣織的布料，展現高雅又輕量的日式質感。";

    it("the constructed prompt instructs preservation of every protected term and glossary mapping for the sample sentence", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({
        response: {
          success: true,
          data: "ORIWISHの和柄長財布は金襴織と西陣織の布地を使用し、上品で軽量な和の質感を纏っています。",
        },
      });

      await runMultilingualPreStage(sampleSource, fakeLlmService(chatCompletion), "business", ORIWISH_PROFILE_ID);

      const [sentPrompt, sentContent] = chatCompletion.mock.calls[0];
      expect(sentContent).toBe(sampleSource);
      expect(sentPrompt).toContain("- ORIWISH");
      expect(sentPrompt).toContain("和風圖案 / 和柄 → 和柄");
      expect(sentPrompt).toContain("金襴織 → 金襴織");
      expect(sentPrompt).toContain("西陣織 → 西陣織");
      expect(sentPrompt).toContain("布料 → 布地");
      expect(sentPrompt).toContain("高雅 / 上品 → 上品");
      expect(sentPrompt).toContain("輕量 / 軽量 → 軽量");
    });
  });

  describe("P8-D4.2: terminology enforcement (matcher + validator + single corrective retry)", () => {
    it("protected term ORIWISH missing from the first attempt triggers exactly one corrective retry", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "和柄長財布です。" } })
        .mockResolvedValueOnce({ response: { success: true, data: "ORIWISHの和柄長財布です。" } });

      const result = await runMultilingualPreStage(
        "ORIWISH 和風圖案長夾",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      const [correctivePrompt] = chatCompletion.mock.calls[1];
      expect(correctivePrompt).toContain("【修正指示】");
      expect(correctivePrompt).toContain("- ORIWISH");
      expect(result.analysisContent).toBe("ORIWISHの和柄長財布です。");
    });

    it("compliant original translation triggers no retry", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "ORIWISHの和柄長財布です。" } });

      const result = await runMultilingualPreStage(
        "ORIWISH 和風圖案長夾",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(result.analysisContent).toBe("ORIWISHの和柄長財布です。");
    });

    it("named regression: 櫻花 -> 桜柄 (business style) triggers exactly one stable-violation retry", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザインを採用しました。" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜のデザインを採用しました。" } });

      const result = await runMultilingualPreStage(
        "採用櫻花設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.analysisContent).toBe("桜のデザインを採用しました。");
    });

    it("retry that resolves the violation: retry output is used", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜のデザイン" } });

      const result = await runMultilingualPreStage(
        "採用櫻花設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(result.analysisContent).toBe("桜のデザイン");
    });

    it("retry that remains non-compliant: no second retry, fail-open to the (usable) retry output", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄デザイン第一版" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄デザイン第二版" } });

      const result = await runMultilingualPreStage(
        "採用櫻花設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.analysisContent).toBe("桜柄デザイン第二版");
    });

    it("retry call itself failing (provider error) fails open to the ORIGINAL translation, never throws", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン" } })
        .mockRejectedValueOnce(new Error("provider unavailable"));

      const result = await runMultilingualPreStage(
        "採用櫻花設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.analysisContent).toBe("桜柄のデザイン");
    });

    it("retry output that is empty is rejected; original translation is kept", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン" } })
        .mockResolvedValueOnce({ response: { success: true, data: "   " } });

      const result = await runMultilingualPreStage(
        "採用櫻花設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.analysisContent).toBe("桜柄のデザイン");
    });

    it("volatile-only miss (高雅 -> 上品) never triggers a retry", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "エレガントなデザインです。" } });

      const result = await runMultilingualPreStage(
        "高雅的設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(result.analysisContent).toBe("エレガントなデザインです。");
    });

    it("mixed stable + volatile miss: retry happens (once) because of the stable violation only", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄でエレガントなデザイン" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜でエレガントなデザイン" } });

      const result = await runMultilingualPreStage(
        "櫻花與高雅設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).toHaveBeenCalledTimes(2);
      expect(result.analysisContent).toBe("桜でエレガントなデザイン");
    });

    it("no-profile requests never validate/retry, even if the (unrelated) output would have violated a real profile's terms", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion.mockResolvedValue({ response: { success: true, data: "桜柄のデザイン" } });

      const result = await runMultilingualPreStage("採用櫻花設計", fakeLlmService(chatCompletion));

      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(result.analysisContent).toBe("桜柄のデザイン");
      expect(Object.prototype.hasOwnProperty.call(result, "translationProfileId")).toBe(false);
    });

    it("ja fast-path never validates/retries (no translation call at all, profile or not)", async () => {
      const chatCompletion = jest.fn();
      const result = await runMultilingualPreStage(
        "これはテストです",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(chatCompletion).not.toHaveBeenCalled();
      expect(result.translated).toBe(false);
    });

    it.each(["natural", "news", "business"] as const)(
      "%s style is preserved in the corrective retry prompt",
      async (style) => {
        const chatCompletion = jest.fn() as any;
        chatCompletion
          .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン" } })
          .mockResolvedValueOnce({ response: { success: true, data: "桜のデザイン" } });

        await runMultilingualPreStage("採用櫻花設計", fakeLlmService(chatCompletion), style, ORIWISH_PROFILE_ID);

        const [correctivePrompt] = chatCompletion.mock.calls[1];
        const styleMarker = { natural: "自然日文", news: "新聞日文", business: "商務日文" }[style];
        expect(correctivePrompt).toContain(styleMarker);
      }
    );

    it("corrective addendum reminds the model to preserve facts/numbers/units and not add claims", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜のデザイン" } });

      await runMultilingualPreStage("採用櫻花設計", fakeLlmService(chatCompletion), "business", ORIWISH_PROFILE_ID);

      const [correctivePrompt] = chatCompletion.mock.calls[1];
      expect(correctivePrompt).toContain("事實內容");
      expect(correctivePrompt).toContain("數字");
      expect(correctivePrompt).toContain("單位");
      expect(correctivePrompt).toContain("不得新增原文沒有的宣稱");
    });

    it("the retry call reuses the SAME original source content (facts/numbers untouched by the corrective step)", async () => {
      const chatCompletion = jest.fn() as any;
      const source = "採用櫻花設計，本體約19x10x1.8cm，重量約300g。";
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン、約19x10x1.8cm、約300g。" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜のデザイン、約19x10x1.8cm、約300g。" } });

      await runMultilingualPreStage(source, fakeLlmService(chatCompletion), "business", ORIWISH_PROFILE_ID);

      const [, firstContent] = chatCompletion.mock.calls[0];
      const [, retryContent] = chatCompletion.mock.calls[1];
      expect(firstContent).toBe(source);
      expect(retryContent).toBe(source);
    });

    it("PreStageResult.analysisContent (what P8-D3 persists as translatedJapanese) equals the FINAL translation actually used, including profile metadata", async () => {
      const chatCompletion = jest.fn() as any;
      chatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "桜柄のデザイン" } })
        .mockResolvedValueOnce({ response: { success: true, data: "桜のデザイン" } });

      const result = await runMultilingualPreStage(
        "採用櫻花設計",
        fakeLlmService(chatCompletion),
        "business",
        ORIWISH_PROFILE_ID
      );

      expect(result.analysisContent).toBe("桜のデザイン");
      expect(result.translationProfileId).toBe(ORIWISH_PROFILE_ID);
      expect(result.translationProfileVersion).toBe(oriwishProfile.version);
    });
  });
});
