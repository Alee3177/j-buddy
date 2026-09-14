import { describe, it, expect } from "@jest/globals";
import {
  validateExplainRequest,
  isBodyTooLarge,
  validateSaveItemsCounts,
  MAX_CONTENT_LENGTH,
  MIN_CONTENT_LENGTH,
  MAX_REQUEST_BYTES,
  MAX_SAVE_ITEMS_COUNT,
} from "../../src/v1/requestValidation";
import { MAX_CONTEXT_CHARS } from "../../src/models/analysisMessage";

describe("validateExplainRequest", () => {
  it("accepts a minimal valid body", () => {
    expect(validateExplainRequest({ content: "テストです" }).ok).toBe(true);
  });

  it("accepts content with context and prompt", () => {
    expect(
      validateExplainRequest({
        content: "テスト",
        context_before: "前",
        context_after: "後",
        prompt: "v2",
      }).ok
    ).toBe(true);
  });

  it("rejects missing content", () => {
    const r = validateExplainRequest({});
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects content shorter than the minimum", () => {
    const r = validateExplainRequest({ content: "あ" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects content longer than the maximum", () => {
    const r = validateExplainRequest({ content: "あ".repeat(MAX_CONTENT_LENGTH + 1) });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects non-string content", () => {
    const r = validateExplainRequest({ content: 123 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("accepts content at exactly the boundaries", () => {
    expect(validateExplainRequest({ content: "あ".repeat(MIN_CONTENT_LENGTH) }).ok).toBe(true);
    expect(validateExplainRequest({ content: "あ".repeat(MAX_CONTENT_LENGTH) }).ok).toBe(true);
  });

  it("rejects context_before over the bound", () => {
    const r = validateExplainRequest({
      content: "テスト",
      context_before: "あ".repeat(MAX_CONTEXT_CHARS + 1),
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("rejects non-string context_before", () => {
    const r = validateExplainRequest({ content: "テスト", context_before: 123 });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("accepts absent context fields", () => {
    expect(validateExplainRequest({ content: "テスト" }).ok).toBe(true);
  });

  it("rejects an invalid prompt version", () => {
    const r = validateExplainRequest({ content: "テスト", prompt: "v3" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it("accepts prompt v1 and v2", () => {
    expect(validateExplainRequest({ content: "テスト", prompt: "v1" }).ok).toBe(true);
    expect(validateExplainRequest({ content: "テスト", prompt: "v2" }).ok).toBe(true);
  });

  it("accepts legacy Gemini and ZAI provider values but rejects unknown values", () => {
    expect(validateExplainRequest({ content: "テスト", ai: "gemini" }).ok).toBe(true);
    expect(validateExplainRequest({ content: "テスト", ai: "zai" }).ok).toBe(true);
    expect(validateExplainRequest({ content: "テスト", ai: "other" }).ok).toBe(false);
  });

  describe("P8-C2 translationStyle", () => {
    it("accepts an absent translationStyle (optional)", () => {
      expect(validateExplainRequest({ content: "テスト" }).ok).toBe(true);
    });

    it.each(["natural", "news", "business"])("accepts translationStyle=%s", (translationStyle) => {
      expect(validateExplainRequest({ content: "テスト", translationStyle }).ok).toBe(true);
    });

    it("rejects an invalid translationStyle", () => {
      const r = validateExplainRequest({ content: "テスト", translationStyle: "casual" });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
    });

    it("rejects a non-string translationStyle", () => {
      const r = validateExplainRequest({ content: "テスト", translationStyle: 123 });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
    });
  });
});

describe("isBodyTooLarge", () => {
  const req = (cl: string | undefined) => ({
    header: (name: string) => (name === "content-length" ? cl : undefined),
  });

  it("rejects a body over the ceiling", () => {
    expect(isBodyTooLarge(req(String(MAX_REQUEST_BYTES + 1)))).toBe(true);
  });

  it("accepts a body at the ceiling", () => {
    expect(isBodyTooLarge(req(String(MAX_REQUEST_BYTES)))).toBe(false);
  });

  it("accepts a small body", () => {
    expect(isBodyTooLarge(req("100"))).toBe(false);
  });

  it("accepts an absent content-length", () => {
    expect(isBodyTooLarge(req(undefined))).toBe(false);
  });
});

// P7.4 — saveItems item-count guard (see requestValidation.ts for rationale).
describe("validateSaveItemsCounts", () => {
  const arrayOf = (n: number) => Array.from({ length: n }, () => ({}));

  it("accepts empty arrays", () => {
    expect(validateSaveItemsCounts([], []).ok).toBe(true);
  });

  it("accepts exactly the maximum count", () => {
    expect(validateSaveItemsCounts(arrayOf(MAX_SAVE_ITEMS_COUNT), []).ok).toBe(true);
    expect(validateSaveItemsCounts([], arrayOf(MAX_SAVE_ITEMS_COUNT)).ok).toBe(true);
  });

  it("rejects a words array over the maximum", () => {
    const result = validateSaveItemsCounts(arrayOf(MAX_SAVE_ITEMS_COUNT + 1), []);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects a grammars array over the maximum", () => {
    const result = validateSaveItemsCounts([], arrayOf(MAX_SAVE_ITEMS_COUNT + 1));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});
