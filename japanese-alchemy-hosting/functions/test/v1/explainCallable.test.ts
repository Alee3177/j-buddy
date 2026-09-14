import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { explainHandler } from "../../src/v1/explainCallable";
import { checkRateLimit } from "../../src/v1/rateLimiter";
import { SYSTEM_PROMPT_V1 } from "../../src/models/systemPromptV1";
import { SYSTEM_PROMPT_V2 } from "../../src/models/systemPromptV2";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import { RetryableProviderError } from "../../src/services/httpRetry";
import { ANALYSIS_BUSY_MESSAGE, TRANSLATION_BUSY_MESSAGE } from "../../src/v1/providerBusyMessages";

// `mock`-prefixed vars are the one exception jest allows inside a mock factory.
// Cast as any: jest.fn() infers `never` under this global jest typing, which
// would reject the mockResolvedValue payload.
const mockChatCompletion = jest.fn() as any;
const mockCreateLlmService = jest.fn((..._args: unknown[]) => ({ chatCompletion: mockChatCompletion }));
jest.mock("../../src/services/llmService", () => ({
  createLlmService: (...args: unknown[]) => mockCreateLlmService(...args),
}));

jest.mock("../../src/v1/rateLimiter");

describe("explainHandler", () => {
  beforeEach(() => {
    mockChatCompletion.mockReset();
    mockCreateLlmService.mockClear();
    mockChatCompletion.mockResolvedValue({
      success: true,
      data: "mocked analysis",
      timestamp: 0,
    });
    jest.mocked(checkRateLimit).mockReset();
    jest.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
  });

  it("defaults to v2 when no prompt is provided", async () => {
    await explainHandler({ data: { content: "テストです" } } as any);

    expect(mockChatCompletion).toHaveBeenCalledWith(SYSTEM_PROMPT_V2, "テストです");
  });

  it.each([undefined, "gemini", "zai"])("always selects Gemini for ai=%s", async (ai) => {
    await explainHandler({ data: { content: "テストです", ...(ai && { ai }) } } as any);

    expect(mockCreateLlmService).toHaveBeenCalledWith("gemini");
  });

  it("selects v1 when prompt is v1", async () => {
    await explainHandler({ data: { content: "テストです", prompt: "v1" } } as any);

    expect(mockChatCompletion).toHaveBeenCalledWith(SYSTEM_PROMPT_V1, "テストです");
  });

  it("rejects an invalid prompt version without calling the LLM", async () => {
    await expect(
      explainHandler({ data: { content: "テストです", prompt: "v3" } } as any)
    ).rejects.toThrow();

    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects missing content without calling the LLM", async () => {
    await expect(
      explainHandler({ data: {} } as any)
    ).rejects.toThrow();

    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("rejects oversized content without calling the LLM (parity with stream)", async () => {
    await expect(
      explainHandler({ data: { content: "あ".repeat(501) } } as any)
    ).rejects.toThrow();

    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("throws resource-exhausted when the rate limit denies, without calling the LLM", async () => {
    jest.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false });
    await expect(
      explainHandler({ data: { content: "テストです" } } as any)
    ).rejects.toMatchObject({ code: "resource-exhausted" });

    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it("wraps the user message with context blocks when context is provided", async () => {
    await explainHandler({
      data: {
        content: "テストです",
        prompt: "v2",
        context_before: "前文",
        context_after: "後文",
      },
    } as any);

    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    const [, message] = mockChatCompletion.mock.calls[0];
    expect(message).toContain("【前文】前文");
    expect(message).toContain("【分析対象】テストです");
    expect(message).toContain("【後文】後文");
  });

  describe("P8-B multilingual pre-stage", () => {
    it("bypasses translation for Japanese input (single LLM call)", async () => {
      await explainHandler({ data: { content: "テストです" } } as any);

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
      expect(mockChatCompletion).toHaveBeenCalledWith(SYSTEM_PROMPT_V2, "テストです");
    });

    it("translates Chinese input before analysis", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      await explainHandler({ data: { content: "这是一个测试" } } as any);

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(mockChatCompletion.mock.calls[0]).toEqual([buildTranslationSystemPrompt("natural"), "这是一个测试"]);
      expect(mockChatCompletion.mock.calls[1][1]).toBe("これはテストです");
    });

    it("translates English input before analysis", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "こんにちは" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      await explainHandler({ data: { content: "Hello there, how are you" } } as any);

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(mockChatCompletion.mock.calls[0]).toEqual([
        buildTranslationSystemPrompt("natural"),
        "Hello there, how are you",
      ]);
      expect(mockChatCompletion.mock.calls[1][1]).toBe("こんにちは");
    });

    it("fails loudly with a clean error when translation fails, without calling the analysis LLM", async () => {
      mockChatCompletion.mockRejectedValueOnce(new Error("provider unavailable"));

      await expect(
        explainHandler({ data: { content: "这是一个测试" } } as any)
      ).rejects.toMatchObject({ code: "internal", message: expect.stringMatching(/translation/i) });

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    });

    it("rejects unsupported/unknown language cleanly without calling the LLM", async () => {
      await expect(
        explainHandler({ data: { content: "안녕하세요 테스트입니다" } } as any)
      ).rejects.toMatchObject({ code: "invalid-argument" });

      expect(mockChatCompletion).not.toHaveBeenCalled();
    });

    it("benchmark #001: Chinese product title is translated before analysis instead of producing empty analysis", async () => {
      const source = "美國 Prismacolor Premier 霹靂馬色鉛筆/油性（單支）\n#103~#997 單色下標區";
      const translated = "米国Prismacolor Premier（プリズマカラー・プレミア）\n油性色鉛筆・単色\n#103～#997 各色から選択可能";
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: translated } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      await explainHandler({ data: { content: source } } as any);

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      const [, analysisMessage] = mockChatCompletion.mock.calls[1];
      expect(analysisMessage).toBe(translated);
      expect(analysisMessage).not.toBe(source);
    });

    it("P8-C1: attaches the pre-stage contract to the response when translation happened", async () => {
      const source = "这是一个测试";
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果", timestamp: 0 } });

      const result = await explainHandler({ data: { content: source } } as any);

      expect(result.preStage).toEqual({
        detectedLanguage: "zh",
        originalContent: source,
        analysisContent: "これはテストです",
        translated: true,
        translationStyle: "natural",
      });
      expect(result.data).toBe("分析結果");
    });

    it("P8-C1: omits the pre-stage field entirely for the Japanese fast path", async () => {
      mockChatCompletion.mockResolvedValueOnce({ response: { success: true, data: "分析結果", timestamp: 0 } });

      const result = await explainHandler({ data: { content: "テストです" } } as any);

      expect(result.preStage).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result, "preStage")).toBe(false);
    });
  });

  describe("P8-C1.5 rate-limit / retry hardening", () => {
    it("sanitizes an exhausted-retry TRANSLATION failure to the busy message, never the raw provider text", async () => {
      mockChatCompletion.mockRejectedValueOnce(
        new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests")
      );

      await expect(
        explainHandler({ data: { content: "这是一个测试" } } as any)
      ).rejects.toMatchObject({ code: "internal", message: TRANSLATION_BUSY_MESSAGE });

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    });

    it("sanitizes an exhausted-retry ANALYSIS failure to the busy message on the Japanese fast path (single LLM call)", async () => {
      mockChatCompletion.mockRejectedValueOnce(
        new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests")
      );

      await expect(
        explainHandler({ data: { content: "テストです" } } as any)
      ).rejects.toMatchObject({ code: "internal", message: ANALYSIS_BUSY_MESSAGE });

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    });

    it("sanitizes an exhausted-retry ANALYSIS failure after a successful translation (zh, second LLM call)", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } })
        .mockRejectedValueOnce(new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests"));

      await expect(
        explainHandler({ data: { content: "这是一个测试" } } as any)
      ).rejects.toMatchObject({ code: "internal", message: ANALYSIS_BUSY_MESSAGE });

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
    });

    it("never leaks the raw provider error string to the client for a retry-exhausted failure", async () => {
      mockChatCompletion.mockRejectedValueOnce(
        new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests")
      );

      expect.assertions(2);
      try {
        await explainHandler({ data: { content: "テストです" } } as any);
      } catch (error: any) {
        expect(error.message).not.toContain("Gemini API error");
        expect(error.message).not.toContain("429");
      }
    });

    it("a non-retryable translation failure keeps the existing generic message, unaffected by the busy-message change", async () => {
      mockChatCompletion.mockRejectedValueOnce(new Error("provider unavailable"));

      await expect(
        explainHandler({ data: { content: "这是一个测试" } } as any)
      ).rejects.toMatchObject({
        code: "internal",
        message: "Translation to Japanese failed. Please try again.",
      });
    });
  });

  describe("P8-C2 translation style control", () => {
    it("omitted translationStyle defaults to natural", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      const result = await explainHandler({ data: { content: "这是一个测试" } } as any);

      expect(mockChatCompletion.mock.calls[0][0]).toBe(buildTranslationSystemPrompt("natural"));
      expect(result.preStage?.translationStyle).toBe("natural");
    });

    it.each(["natural", "news", "business"] as const)(
      "%s is accepted and routed to the matching style-specific translation prompt",
      async (style) => {
        mockChatCompletion
          .mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } })
          .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

        const result = await explainHandler(
          { data: { content: "这是一个测试", translationStyle: style } } as any
        );

        expect(mockChatCompletion.mock.calls[0][0]).toBe(buildTranslationSystemPrompt(style));
        expect(result.preStage?.translationStyle).toBe(style);
      }
    );

    it("rejects an invalid translationStyle without calling the LLM", async () => {
      await expect(
        explainHandler({ data: { content: "这是一个测试", translationStyle: "casual" } } as any)
      ).rejects.toMatchObject({ code: "invalid-argument" });

      expect(mockChatCompletion).not.toHaveBeenCalled();
    });

    it("batch handler propagates translationStyle through to the analysis stage unaffected (style only touches translation)", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      await explainHandler({ data: { content: "这是一个测试", translationStyle: "business" } } as any);

      // The analysis-stage call always uses the (unmodified) Japanese
      // Analyzer prompt — style is a translation-only concern.
      expect(mockChatCompletion.mock.calls[1][0]).toBe(SYSTEM_PROMPT_V2);
      expect(mockChatCompletion.mock.calls[1][1]).toBe("これはテストです");
    });

    it("zh + business translates before the Analyzer runs", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "業務日本語の翻訳結果" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      const result = await explainHandler(
        { data: { content: "这是一个测试", translationStyle: "business" } } as any
      );

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(result.preStage).toEqual({
        detectedLanguage: "zh",
        originalContent: "这是一个测试",
        analysisContent: "業務日本語の翻訳結果",
        translated: true,
        translationStyle: "business",
      });
    });

    it("zh + news translates before the Analyzer runs", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "ニュース日本語の翻訳結果" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      const result = await explainHandler(
        { data: { content: "这是一个测试", translationStyle: "news" } } as any
      );

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(result.preStage?.translationStyle).toBe("news");
      expect(result.preStage?.analysisContent).toBe("ニュース日本語の翻訳結果");
    });

    it.each(["business", "news"] as const)(
      "en + %s translates before the Analyzer runs",
      async (style) => {
        mockChatCompletion
          .mockResolvedValueOnce({ response: { success: true, data: "日本語の翻訳結果" } })
          .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

        const result = await explainHandler(
          { data: { content: "Hello there, how are you", translationStyle: style } } as any
        );

        expect(mockChatCompletion).toHaveBeenCalledTimes(2);
        expect(mockChatCompletion.mock.calls[0][0]).toBe(buildTranslationSystemPrompt(style));
        expect(result.preStage?.translated).toBe(true);
        expect(result.preStage?.translationStyle).toBe(style);
      }
    );

    it("ja fast-path ignores an explicit translationStyle and makes no translation call", async () => {
      mockChatCompletion.mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      const result = await explainHandler(
        { data: { content: "テストです", translationStyle: "business" } } as any
      );

      expect(mockChatCompletion).toHaveBeenCalledTimes(1);
      expect(mockChatCompletion).toHaveBeenCalledWith(SYSTEM_PROMPT_V2, "テストです");
      expect(result.preStage).toBeUndefined();
    });
  });
});
