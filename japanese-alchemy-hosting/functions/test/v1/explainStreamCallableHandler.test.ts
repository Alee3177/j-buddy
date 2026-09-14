import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { explainStreamCallableHandler } from "../../src/v1/explainStreamCallableHandler";
import { checkRateLimit } from "../../src/v1/rateLimiter";
import { TRANSLATION_SYSTEM_PROMPT } from "../../src/models/translationPrompt";

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

      expect(mockChatCompletion).toHaveBeenCalledWith(TRANSLATION_SYSTEM_PROMPT, "这是一个测试");
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
});
