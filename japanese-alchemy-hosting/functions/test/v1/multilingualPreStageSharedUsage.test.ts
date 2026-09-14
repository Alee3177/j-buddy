import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// Proves explainHandler and explainStreamCallableHandler both funnel
// through the SAME runMultilingualPreStage export (P8-B: "one shared helper
// ... do not duplicate detection/translation logic"), rather than each
// having its own copy.
const mockRunMultilingualPreStage = jest.fn() as any;
jest.mock("../../src/v1/multilingualPreStage", () => {
  const actual = jest.requireActual("../../src/v1/multilingualPreStage") as object;
  return {
    ...actual,
    runMultilingualPreStage: (...args: unknown[]) => mockRunMultilingualPreStage(...args),
  };
});

const mockChatCompletion = jest.fn() as any;
const mockStreamCompletion = jest.fn() as any;
jest.mock("../../src/services/llmService", () => ({
  createLlmService: () => ({ chatCompletion: mockChatCompletion, streamCompletion: mockStreamCompletion }),
}));

jest.mock("../../src/v1/rateLimiter", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
  rateLimitKey: (ip: string) => ip,
}));

import { explainHandler } from "../../src/v1/explainCallable";
import { explainStreamCallableHandler } from "../../src/v1/explainStreamCallableHandler";

describe("shared multilingual pre-stage usage", () => {
  beforeEach(() => {
    mockRunMultilingualPreStage.mockReset();
    mockRunMultilingualPreStage.mockResolvedValue({
      detectedLanguage: "ja",
      originalContent: "テストです",
      analysisContent: "テストです",
      translated: false,
      translationStyle: "natural",
    });
    mockChatCompletion.mockReset();
    mockChatCompletion.mockResolvedValue({ response: { success: true, data: "x" } });
    mockStreamCompletion.mockReset();
    mockStreamCompletion.mockResolvedValue({ response: { body: null }, requestedModel: "m" });
  });

  it("explainHandler funnels content through the shared pre-stage helper", async () => {
    await explainHandler({ data: { content: "テストです" } } as any);
    expect(mockRunMultilingualPreStage.mock.calls[0][0]).toBe("テストです");
  });

  it("explainStreamCallableHandler funnels content through the same shared pre-stage helper", async () => {
    await explainStreamCallableHandler({
      data: { content: "テストです" },
      acceptsStreaming: false,
      rawRequest: { ip: "127.0.0.1" },
    } as any);
    expect(mockRunMultilingualPreStage.mock.calls[0][0]).toBe("テストです");
  });

  // P8-C2: item 8 — the shared pre-stage helper actually receives the
  // caller-supplied translationStyle, through BOTH surfaces, via the same
  // (single) call site shape — not two independently-wired copies.
  it("P8-C2: explainHandler forwards translationStyle to the shared pre-stage helper", async () => {
    await explainHandler({ data: { content: "テストです", translationStyle: "business" } } as any);
    expect(mockRunMultilingualPreStage).toHaveBeenCalledWith(
      "テストです",
      expect.anything(),
      "business"
    );
  });

  it("P8-C2: explainStreamCallableHandler forwards translationStyle to the shared pre-stage helper", async () => {
    await explainStreamCallableHandler({
      data: { content: "テストです", translationStyle: "news" },
      acceptsStreaming: false,
      rawRequest: { ip: "127.0.0.1" },
    } as any);
    expect(mockRunMultilingualPreStage).toHaveBeenCalledWith(
      "テストです",
      expect.anything(),
      "news"
    );
  });
});
