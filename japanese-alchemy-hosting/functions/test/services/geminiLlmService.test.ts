import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { GeminiLlmService } from "../../src/services/geminiLlmService";

// Mock the config so configSecret.value().gemini returns test credentials.
jest.mock("../../src/config", () => ({
  configSecret: {
    value: () => ({
      gemini: {
        api_url: "https://test-api-url.com",
        api_key: "test-api-key",
        model: "test-model",
      },
      zai: {
        api_url: "https://zai.test-api-url.com",
        api_key: "test-zai-key",
        model: "test-zai-model",
      },
    }),
  },
  LLM_PROVIDER: "gemini",
}));

// Mock fetch. Cast as any so mockResolvedValue/mockClear accept any payload
// regardless of the global jest typing (jest.fn() infers `never` here).
const mockFetch = jest.fn() as any;
(global as any).fetch = mockFetch;

describe("GeminiLlmService", () => {
  let service: GeminiLlmService;
  const mockSystemPrompt = "You are a helpful assistant";
  const mockContent = "Test content";

  beforeEach(() => {
    mockFetch.mockClear();
    service = new GeminiLlmService();
  });

  describe("Constructor", () => {
    it("should initialize with correct configuration", () => {
      expect(service).toBeDefined();
    });

    it("should throw when the Gemini API key is missing", () => {
      // Temporarily override configSecret to omit the api_key.
      const { configSecret } = require("../../src/config");
      const original = configSecret.value;
      configSecret.value = () => ({
        gemini: { api_url: "https://test-api-url.com", api_key: "", model: "test-model" },
        zai: { api_url: "", api_key: "", model: "" },
      });

      expect(() => new GeminiLlmService()).toThrow(
        "Gemini API key not found"
      );

      configSecret.value = original;
    });
  });

  describe("chatCompletion", () => {
    const mockResponse = {
      model: "gemini-3-flash-preview",
      usage: {
        prompt_tokens: 12,
        completion_tokens: 34,
        total_tokens: 46,
      },
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: "Test response",
          },
        },
      ],
    };

    it("should call Gemini API with correct payload", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await service.chatCompletion(mockSystemPrompt, mockContent);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-api-url.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: mockSystemPrompt },
              { role: "user", content: mockContent },
            ],
            model: "test-model",
            temperature: 0,
            max_tokens: 16384,
            extra_body: {
              google: {
                thinking_config: {
                  thinking_budget: 512,
                  include_thoughts: false,
                },
              },
            },
          }),
        }
      );
    });

    it("should return successful response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.chatCompletion(mockSystemPrompt, mockContent);

      expect(result).toEqual({
        response: {
          success: true,
          data: "Test response",
          timestamp: expect.any(Number),
        },
        requestedModel: "test-model",
        usage: mockResponse.usage,
        responseModel: "gemini-3-flash-preview",
        finishReason: "stop",
      });
    });

    it("should throw error when API returns error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Error details",
      });

      await expect(
        service.chatCompletion(mockSystemPrompt, mockContent)
      ).rejects.toThrow("Gemini API error: 500 Internal Server Error");
    });

    it("should include timestamp in response", async () => {
      const beforeCall = Date.now();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.chatCompletion(mockSystemPrompt, mockContent);

      const afterCall = Date.now();

      expect(result.response.timestamp).toBeGreaterThanOrEqual(beforeCall);
      expect(result.response.timestamp).toBeLessThanOrEqual(afterCall);
    });

    it("should handle empty content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "" } }],
        }),
      });

      const result = await service.chatCompletion(mockSystemPrompt, "");

      expect(result.response.success).toBe(true);
      expect(result.response.data).toBe("");
    });

    it("should handle long content", async () => {
      const longContent = "あ".repeat(10000);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.chatCompletion(mockSystemPrompt, longContent);

      expect(result.response.success).toBe(true);
    });

    it("should handle special characters in content", async () => {
      const specialContent = "日本語のテスト 🎌";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.chatCompletion(mockSystemPrompt, specialContent);

      expect(result.response.success).toBe(true);
    });
  });

  describe("streamCompletion", () => {
    it("requests terminal usage without changing Gemini thinking configuration", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await service.streamCompletion(mockSystemPrompt, mockContent);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.stream_options).toEqual({ include_usage: true });
      expect(payload.extra_body.google.thinking_config).toEqual({
        thinking_budget: 512,
        include_thoughts: false,
      });
    });

    it("P1-C1 diagnostic: requests temperature 0 (greedy decoding)", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await service.streamCompletion(mockSystemPrompt, mockContent);

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.temperature).toBe(0);
    });
  });

  describe("generation policy parity (P0-0)", () => {
    const mockResponse = {
      choices: [{ finish_reason: "stop", message: { content: "Test response" } }],
    };

    // Tier-2/batch evaluation calls chatCompletion(); production streaming
    // (the Chrome extension's managed path) calls streamCompletion(). Both
    // must request the same Gemini generation policy so Tier-2 results are
    // representative of production behavior.
    it("chatCompletion and streamCompletion send the same max_tokens and thinking_config", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });
      await service.chatCompletion(mockSystemPrompt, mockContent);
      const batchPayload = JSON.parse(mockFetch.mock.calls[0][1].body);

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({ ok: true });
      await service.streamCompletion(mockSystemPrompt, mockContent);
      const streamPayload = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(batchPayload.max_tokens).toBe(streamPayload.max_tokens);
      expect(batchPayload.max_tokens).toBe(16384);
      expect(batchPayload.extra_body).toEqual(streamPayload.extra_body);
      expect(batchPayload.extra_body.google.thinking_config).toEqual({
        thinking_budget: 512,
        include_thoughts: false,
      });
    });

    // P1-C1 diagnostic: temperature was previously untested for equality
    // between the two methods (only chatCompletion's exact-payload test
    // pinned a literal value) — a real gap that would have let the two
    // methods silently drift apart. Closed here alongside the existing
    // max_tokens/thinking_config parity checks.
    it("P1-C1: chatCompletion and streamCompletion send the same temperature, and it is 0", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse });
      await service.chatCompletion(mockSystemPrompt, mockContent);
      const batchPayload = JSON.parse(mockFetch.mock.calls[0][1].body);

      mockFetch.mockClear();
      mockFetch.mockResolvedValueOnce({ ok: true });
      await service.streamCompletion(mockSystemPrompt, mockContent);
      const streamPayload = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(batchPayload.temperature).toBe(streamPayload.temperature);
      expect(batchPayload.temperature).toBe(0);
      expect(streamPayload.temperature).toBe(0);

      // Confirm nothing else in the shared generation policy moved alongside
      // the temperature change.
      expect(batchPayload.max_tokens).toBe(16384);
      expect(streamPayload.max_tokens).toBe(16384);
      expect(batchPayload.extra_body.google.thinking_config).toEqual({
        thinking_budget: 512,
        include_thoughts: false,
      });
      expect(streamPayload.extra_body.google.thinking_config).toEqual({
        thinking_budget: 512,
        include_thoughts: false,
      });
    });
  });
});
