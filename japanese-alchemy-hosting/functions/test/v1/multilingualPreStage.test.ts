import { describe, it, expect, jest } from "@jest/globals";
import {
  runMultilingualPreStage,
  UnsupportedLanguageError,
  TranslationFailedError,
  MAX_TRANSLATED_CONTENT_LENGTH,
} from "../../src/v1/multilingualPreStage";
import { TRANSLATION_SYSTEM_PROMPT } from "../../src/models/translationPrompt";
import { LlmService } from "../../src/services/llmService";

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
    });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("translates Chinese input using the translation system prompt", async () => {
    const chatCompletion = jest.fn() as any;
    chatCompletion.mockResolvedValue({ response: { success: true, data: "これはテストです" } });

    const result = await runMultilingualPreStage("这是一个测试", fakeLlmService(chatCompletion));

    expect(chatCompletion).toHaveBeenCalledWith(TRANSLATION_SYSTEM_PROMPT, "这是一个测试");
    expect(result).toEqual({
      detectedLanguage: "zh",
      originalContent: "这是一个测试",
      analysisContent: "これはテストです",
      translated: true,
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
});
