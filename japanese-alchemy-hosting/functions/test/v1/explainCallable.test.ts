import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { explainHandler } from "../../src/v1/explainCallable";
import { checkRateLimit } from "../../src/v1/rateLimiter";
import { SYSTEM_PROMPT_V1 } from "../../src/models/systemPromptV1";
import { SYSTEM_PROMPT_V2 } from "../../src/models/systemPromptV2";
import { TRANSLATION_SYSTEM_PROMPT } from "../../src/models/translationPrompt";
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
      expect(mockChatCompletion.mock.calls[0]).toEqual([TRANSLATION_SYSTEM_PROMPT, "这是一个测试"]);
      expect(mockChatCompletion.mock.calls[1][1]).toBe("これはテストです");
    });

    it("translates English input before analysis", async () => {
      mockChatCompletion
        .mockResolvedValueOnce({ response: { success: true, data: "こんにちは" } })
        .mockResolvedValueOnce({ response: { success: true, data: "分析結果" } });

      await explainHandler({ data: { content: "Hello there, how are you" } } as any);

      expect(mockChatCompletion).toHaveBeenCalledTimes(2);
      expect(mockChatCompletion.mock.calls[0]).toEqual([TRANSLATION_SYSTEM_PROMPT, "Hello there, how are you"]);
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
});
