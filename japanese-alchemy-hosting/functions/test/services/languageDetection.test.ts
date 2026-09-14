import { describe, it, expect } from "@jest/globals";
import { detectLanguage } from "../../src/services/languageDetection";

describe("detectLanguage", () => {
  it("detects Japanese via kana presence, even in a kanji-heavy sentence", () => {
    expect(detectLanguage("これはテストです")).toBe("ja");
    expect(detectLanguage("日本語のテストです")).toBe("ja");
  });

  it("detects Chinese from Han-dominant text with no kana", () => {
    expect(detectLanguage("这是一个测试")).toBe("zh");
  });

  it("detects Chinese for the benchmark #001 mixed Han/Latin product title (Latin count exceeds Han count)", () => {
    const source = "美國 Prismacolor Premier 霹靂馬色鉛筆/油性（單支）\n#103~#997 單色下標區";
    expect(detectLanguage(source)).toBe("zh");
  });

  it("detects English from Latin-only text", () => {
    expect(detectLanguage("Hello, how are you today?")).toBe("en");
  });

  it("returns unknown for Hangul text rather than forcing zh/en", () => {
    expect(detectLanguage("안녕하세요")).toBe("unknown");
  });

  it("returns unknown for text with no classifiable letters", () => {
    expect(detectLanguage("12345 !!! 😀")).toBe("unknown");
  });
});
