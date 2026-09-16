import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { explainStreamCallableHandler } from "../../src/v1/explainStreamCallableHandler";
import { checkRateLimit } from "../../src/v1/rateLimiter";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import { resolveTranslationProfile } from "../../src/models/translationProfile";
import { RetryableProviderError } from "../../src/services/httpRetry";
import { ANALYSIS_BUSY_MESSAGE, TRANSLATION_BUSY_MESSAGE } from "../../src/v1/providerBusyMessages";

const ORIWISH_PROFILE_ID = "oriwish-ja-business-v1";
const oriwishProfile = resolveTranslationProfile(ORIWISH_PROFILE_ID)!;

const mockStreamCompletion = jest.fn() as any;
const mockChatCompletion = jest.fn() as any;
const mockCreateLlmService = jest.fn((..._args: unknown[]) => ({
  streamCompletion: mockStreamCompletion,
  chatCompletion: mockChatCompletion,
}));

jest.mock("../../src/services/llmService", () => ({
  createLlmService: (...args: unknown[]) => mockCreateLlmService(...args),
}));

jest.mock("../../src/v1/rateLimiter");

function readableSseResponse(frames: string[]) {
  const values = frames.map((frame) => new TextEncoder().encode(frame));
  return {
    body: {
      getReader: () => ({
        read: jest.fn(async () => values.length
          ? { done: false, value: values.shift() }
          : { done: true, value: undefined }),
      }),
    },
  };
}

describe("explainStreamCallableHandler", () => {
  beforeEach(() => {
    mockStreamCompletion.mockReset();
    mockChatCompletion.mockReset();
    mockCreateLlmService.mockClear();
    jest.mocked(checkRateLimit).mockReset();
    jest.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
  });

  it("streams analysis deltas and completes the managed-provider analysis", async () => {
    mockStreamCompletion.mockResolvedValue({ response: readableSseResponse([
      'data: {"choices":[{"delta":{"content":"分"}}]}\n',
      'data: {"choices":[{"delta":{"content":"析"}}]}\n',
      "data: [DONE]\n",
    ]), requestedModel: "gemini-3-flash-preview" });
    const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

    const result = await explainStreamCallableHandler(
      {
        data: { content: "テストです" },
        acceptsStreaming: true,
        rawRequest: { ip: "127.0.0.1" },
      } as any,
      response as any
    );

    expect(response.sendChunk).toHaveBeenCalledWith({ content: "分" });
    expect(response.sendChunk).toHaveBeenCalledWith({ content: "析" });
    expect(result).toEqual({ success: true });
  });

  it("rejects a rate-limited request before starting the LLM stream", async () => {
    jest.mocked(checkRateLimit).mockResolvedValue({ allowed: false });

    await expect(explainStreamCallableHandler(
      {
        data: { content: "テストです" },
        acceptsStreaming: true,
        rawRequest: { ip: "127.0.0.1" },
      } as any,
      { sendChunk: jest.fn(async (_chunk: unknown) => true) } as any
    )).rejects.toMatchObject({ code: "resource-exhausted" });

    expect(mockStreamCompletion).not.toHaveBeenCalled();
  });

  it("returns a provider failure as the callable result", async () => {
    mockStreamCompletion.mockRejectedValue(new Error("provider unavailable"));

    const result = await explainStreamCallableHandler(
      {
        data: { content: "テストです" },
        acceptsStreaming: true,
        rawRequest: { ip: "127.0.0.1" },
      } as any,
      { sendChunk: jest.fn(async (_chunk: unknown) => true) } as any
    );

    expect(result).toEqual({ success: false, error: "provider unavailable" });
  });

  describe("P8-B multilingual pre-stage", () => {
    it("bypasses translation and sends no interim status chunk for Japanese input", async () => {
      mockStreamCompletion.mockResolvedValue({ response: readableSseResponse([
        'data: {"choices":[{"delta":{"content":"分"}}]}\n',
        "data: [DONE]\n",
      ]), requestedModel: "gemini-3-flash-preview" });
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        { data: { content: "テストです" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(response.sendChunk).not.toHaveBeenCalledWith(expect.objectContaining({ status: "translating" }));
    });

    it("translates Chinese input, sends an interim status chunk, then streams the Japanese analysis", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });
      mockStreamCompletion.mockResolvedValue({ response: readableSseResponse([
        'data: {"choices":[{"delta":{"content":"分析"}}]}\n',
        "data: [DONE]\n",
      ]), requestedModel: "gemini-3-flash-preview" });
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(mockChatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt("natural"), "这是一个测试");
      expect(response.sendChunk).toHaveBeenCalledWith({ content: "", status: "translating" });
      expect(mockStreamCompletion).toHaveBeenCalledWith(expect.any(String), "これはテストです");
      expect(response.sendChunk).toHaveBeenCalledWith({ content: "分析" });
      expect(result).toEqual({ success: true });
    });

    it("P8-C1: sends the full pre-stage contract once, after translation and before analysis streaming", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });
      mockStreamCompletion.mockResolvedValue({ response: readableSseResponse([
        'data: {"choices":[{"delta":{"content":"分析"}}]}\n',
        "data: [DONE]\n",
      ]), requestedModel: "gemini-3-flash-preview" });
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };
      const source = "这是一个测试";

      await explainStreamCallableHandler(
        { data: { content: source }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      const preStageChunkCalls = response.sendChunk.mock.calls.filter(
        ([chunk]: [any]) => chunk.preStage !== undefined
      );
      expect(preStageChunkCalls).toHaveLength(1);
      const [preStageChunk] = preStageChunkCalls[0];
      expect(preStageChunk).toEqual({
        content: "",
        preStage: {
          detectedLanguage: "zh",
          originalContent: source,
          analysisContent: "これはテストです",
          translated: true,
          translationStyle: "natural",
        },
      });

      // Ordering: status -> preStage -> analysis delta.
      const chunkOrder = response.sendChunk.mock.calls.map(([chunk]: [any]) =>
        chunk.status ?? (chunk.preStage ? "preStage" : chunk.content)
      );
      expect(chunkOrder).toEqual(["translating", "preStage", "分析"]);
    });

    it("P8-C1: sends no pre-stage chunk on the Japanese fast path (contract unchanged)", async () => {
      mockStreamCompletion.mockResolvedValue({ response: readableSseResponse([
        'data: {"choices":[{"delta":{"content":"分"}}]}\n',
        "data: [DONE]\n",
      ]), requestedModel: "gemini-3-flash-preview" });
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        { data: { content: "テストです" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(response.sendChunk).not.toHaveBeenCalledWith(expect.objectContaining({ preStage: expect.anything() }));
    });

    it("fails loudly with a clean error when translation fails, without starting the analysis stream", async () => {
      mockChatCompletion.mockRejectedValue(new Error("provider unavailable"));
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/translation/i);
      expect(mockStreamCompletion).not.toHaveBeenCalled();
    });

    it("fails cleanly for unsupported/unknown language without calling the LLM or starting a stream", async () => {
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "안녕하세요 테스트" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(result.success).toBe(false);
      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(mockStreamCompletion).not.toHaveBeenCalled();
    });
  });

  describe("P8-C1.5 rate-limit / retry hardening", () => {
    it("sanitizes an exhausted-retry TRANSLATION failure to the busy message, never the raw provider text", async () => {
      mockChatCompletion.mockRejectedValueOnce(
        new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests")
      );
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(result).toEqual({ success: false, error: TRANSLATION_BUSY_MESSAGE });
      expect(result.error).not.toContain("Gemini API error");
      expect(result.error).not.toContain("429");
      expect(mockStreamCompletion).not.toHaveBeenCalled();
    });

    it("sanitizes an exhausted-retry ANALYSIS failure to the busy message on the Japanese fast path", async () => {
      mockStreamCompletion.mockRejectedValueOnce(
        new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests")
      );
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "テストです" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(result).toEqual({ success: false, error: ANALYSIS_BUSY_MESSAGE });
      expect(mockChatCompletion).not.toHaveBeenCalled();
    });

    it("sanitizes an exhausted-retry ANALYSIS failure after a successful translation (zh)", async () => {
      mockChatCompletion.mockResolvedValueOnce({ response: { success: true, data: "これはテストです" } });
      mockStreamCompletion.mockRejectedValueOnce(
        new RetryableProviderError(429, "Gemini API error: 429 Too Many Requests")
      );
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(result).toEqual({ success: false, error: ANALYSIS_BUSY_MESSAGE });
    });

    it("a non-retryable translation failure keeps the existing generic message, unaffected by the busy-message change", async () => {
      mockChatCompletion.mockRejectedValueOnce(new Error("provider unavailable"));
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(result).toEqual({
        success: false,
        error: "Translation to Japanese failed. Please try again.",
      });
    });
  });

  describe("P8-C2 translation style control", () => {
    function sseResponse() {
      return {
        response: readableSseResponse([
          'data: {"choices":[{"delta":{"content":"分析"}}]}\n',
          "data: [DONE]\n",
        ]),
        requestedModel: "gemini-3-flash-preview",
      };
    }

    it("omitted translationStyle defaults to natural", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(mockChatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt("natural"), "这是一个测试");
    });

    it.each(["natural", "news", "business"] as const)(
      "%s is accepted and routed to the matching style-specific translation prompt",
      async (style) => {
        mockChatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });
        mockStreamCompletion.mockResolvedValue(sseResponse());
        const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

        await explainStreamCallableHandler(
          {
            data: { content: "这是一个测试", translationStyle: style },
            acceptsStreaming: true,
            rawRequest: { ip: "127.0.0.1" },
          } as any,
          response as any
        );

        expect(mockChatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt(style), "这是一个测试");
      }
    );

    it("rejects an invalid translationStyle without calling the LLM or starting a stream", async () => {
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await expect(
        explainStreamCallableHandler(
          {
            data: { content: "这是一个测试", translationStyle: "casual" },
            acceptsStreaming: true,
            rawRequest: { ip: "127.0.0.1" },
          } as any,
          response as any
        )
      ).rejects.toMatchObject({ code: "invalid-argument" });

      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(mockStreamCompletion).not.toHaveBeenCalled();
    });

    it("streaming handler propagates translationStyle to the shared pre-stage (preStage chunk carries it)", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "商務日本語の翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationStyle: "business" },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      const preStageChunkCalls = response.sendChunk.mock.calls.filter(
        ([chunk]: [any]) => chunk.preStage !== undefined
      );
      const [preStageChunk] = preStageChunkCalls[0] as [any];
      expect(preStageChunk.preStage).toEqual({
        detectedLanguage: "zh",
        originalContent: "这是一个测试",
        analysisContent: "商務日本語の翻訳結果",
        translated: true,
        translationStyle: "business",
      });
    });

    it("zh + news translates before the Analyzer streaming begins", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "ニュース日本語の翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationStyle: "news" },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      expect(mockStreamCompletion).toHaveBeenCalledWith(expect.any(String), "ニュース日本語の翻訳結果");
    });

    it.each(["business", "news"] as const)(
      "en + %s translates before the Analyzer streaming begins",
      async (style) => {
        mockChatCompletion.mockResolvedValue({ response: { success: true, data: "日本語の翻訳結果" } });
        mockStreamCompletion.mockResolvedValue(sseResponse());
        const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

        await explainStreamCallableHandler(
          {
            data: { content: "Hello there, how are you", translationStyle: style },
            acceptsStreaming: true,
            rawRequest: { ip: "127.0.0.1" },
          } as any,
          response as any
        );

        expect(mockChatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt(style), "Hello there, how are you");
        expect(mockStreamCompletion).toHaveBeenCalledWith(expect.any(String), "日本語の翻訳結果");
      }
    );

    it("ja fast-path ignores an explicit translationStyle, makes no translation call, and sends no preStage chunk", async () => {
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        {
          data: { content: "テストです", translationStyle: "business" },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(response.sendChunk).not.toHaveBeenCalledWith(expect.objectContaining({ status: "translating" }));
      expect(response.sendChunk).not.toHaveBeenCalledWith(expect.objectContaining({ preStage: expect.anything() }));
      expect(result).toEqual({ success: true });
    });
  });

  describe("P8-D2 server-side translation profile", () => {
    function sseResponse() {
      return {
        response: readableSseResponse([
          'data: {"choices":[{"delta":{"content":"分析"}}]}\n',
          "data: [DONE]\n",
        ]),
        requestedModel: "gemini-3-flash-preview",
      };
    }

    it("omitted translationProfileId → existing (no-profile) behavior unchanged", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        { data: { content: "这是一个测试" }, acceptsStreaming: true, rawRequest: { ip: "127.0.0.1" } } as any,
        response as any
      );

      expect(mockChatCompletion).toHaveBeenCalledWith(buildTranslationSystemPrompt("natural"), "这是一个测试");
    });

    it("valid oriwish-ja-business-v1 is accepted and threaded to the translation prompt", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "業務日本語の翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationStyle: "business", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      expect(mockChatCompletion).toHaveBeenCalledWith(
        buildTranslationSystemPrompt("business", oriwishProfile),
        "这是一个测试"
      );
    });

    it("an unknown translationProfileId is rejected before any streaming or translation begins", async () => {
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await expect(
        explainStreamCallableHandler(
          {
            data: { content: "这是一个测试", translationProfileId: "not-a-real-profile" },
            acceptsStreaming: true,
            rawRequest: { ip: "127.0.0.1" },
          } as any,
          response as any
        )
      ).rejects.toMatchObject({ code: "invalid-argument" });

      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(mockStreamCompletion).not.toHaveBeenCalled();
    });

    it("an invalid-type translationProfileId is rejected before any streaming or translation begins", async () => {
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await expect(
        explainStreamCallableHandler(
          {
            data: { content: "这是一个测试", translationProfileId: 123 },
            acceptsStreaming: true,
            rawRequest: { ip: "127.0.0.1" },
          } as any,
          response as any
        )
      ).rejects.toMatchObject({ code: "invalid-argument" });

      expect(mockChatCompletion).not.toHaveBeenCalled();
    });

    it("streaming handler propagates the profile id through to the shared pre-stage", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "業務日本語の翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      expect(mockChatCompletion.mock.calls[0][0]).toContain("【術語對照表】");
    });

    it("ja fast-path ignores the profile, makes no translation call, and sends no preStage chunk", async () => {
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      const result = await explainStreamCallableHandler(
        {
          data: { content: "テストです", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      expect(mockChatCompletion).not.toHaveBeenCalled();
      expect(response.sendChunk).not.toHaveBeenCalledWith(expect.objectContaining({ preStage: expect.anything() }));
      expect(result).toEqual({ success: true });
    });

    it("preStage chunk carries profile metadata ONLY when a profile was applied — never the profile internals", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "業務日本語の翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      const preStageChunkCalls = response.sendChunk.mock.calls.filter(
        ([chunk]: [any]) => chunk.preStage !== undefined
      );
      const [preStageChunk] = preStageChunkCalls[0] as [any];
      expect(preStageChunk.preStage.translationProfileId).toBe(ORIWISH_PROFILE_ID);
      expect(preStageChunk.preStage.translationProfileVersion).toBe("3");
      const serialized = JSON.stringify(preStageChunk);
      expect(serialized).not.toContain("terminologyGlossary");
      expect(serialized).not.toContain("protectedTerms");
      expect(serialized).not.toContain("brandVoice");
      expect(serialized).not.toContain("上品");
    });

    it("style=business + profile: business register and brand voice both applied, hard terms present", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationStyle: "business", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      const sentPrompt = mockChatCompletion.mock.calls[0][0];
      expect(sentPrompt).toContain("商務日文");
      expect(sentPrompt).toContain("品牌語氣調整");
      expect(sentPrompt).toContain("【術語對照表】");
    });

    it("style=natural + profile: brand profile still applies without forcing business register", async () => {
      mockChatCompletion.mockResolvedValue({ response: { success: true, data: "翻訳結果" } });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: "这是一个测试", translationStyle: "natural", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      const sentPrompt = mockChatCompletion.mock.calls[0][0];
      expect(sentPrompt).toContain("自然日文");
      expect(sentPrompt).not.toContain("商務日文");
      expect(sentPrompt).toContain("品牌語氣調整");
    });

    it("P8-D4.1 real ORIWISH (OW_01) sample sentence: streamed translation prompt preserves protected terms and glossary mappings", async () => {
      const sampleSource = "ORIWISH 和風圖案長夾採用金襴織與西陣織的布料，展現高雅又輕量的日式質感。";
      mockChatCompletion.mockResolvedValue({
        response: {
          success: true,
          data: "ORIWISHの和柄長財布は金襴織と西陣織の布地を使用し、上品で軽量な和の質感を纏っています。",
        },
      });
      mockStreamCompletion.mockResolvedValue(sseResponse());
      const response = { sendChunk: jest.fn(async (_chunk: unknown) => true) };

      await explainStreamCallableHandler(
        {
          data: { content: sampleSource, translationStyle: "business", translationProfileId: ORIWISH_PROFILE_ID },
          acceptsStreaming: true,
          rawRequest: { ip: "127.0.0.1" },
        } as any,
        response as any
      );

      const [sentPrompt, sentContent] = mockChatCompletion.mock.calls[0];
      expect(sentContent).toBe(sampleSource);
      expect(sentPrompt).toContain("和風圖案 / 和柄 → 和柄");
      expect(sentPrompt).toContain("西陣織 → 西陣織");
      expect(sentPrompt).toContain("布料 → 布地");
      expect(sentPrompt).toContain("- ORIWISH");
      expect(mockStreamCompletion).toHaveBeenCalledWith(
        expect.any(String),
        "ORIWISHの和柄長財布は金襴織と西陣織の布地を使用し、上品で軽量な和の質感を纏っています。"
      );
    });
  });
});
