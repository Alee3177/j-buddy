import { describe, it, expect } from "@jest/globals";
import {
  DEFAULT_TRANSLATION_STYLE,
  isValidTranslationStyle,
  TRANSLATION_STYLES,
} from "../../src/models/translationStyle";

describe("TRANSLATION_STYLES", () => {
  it("supports exactly natural, news, and business (P8-C2 scope)", () => {
    expect(TRANSLATION_STYLES).toEqual(["natural", "news", "business"]);
  });

  it("defaults to natural", () => {
    expect(DEFAULT_TRANSLATION_STYLE).toBe("natural");
    expect(TRANSLATION_STYLES).toContain(DEFAULT_TRANSLATION_STYLE);
  });
});

describe("isValidTranslationStyle", () => {
  it.each(["natural", "news", "business"])("accepts %s", (style) => {
    expect(isValidTranslationStyle(style)).toBe(true);
  });

  it("rejects an unsupported style string", () => {
    expect(isValidTranslationStyle("casual")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidTranslationStyle(123)).toBe(false);
    expect(isValidTranslationStyle(null)).toBe(false);
    expect(isValidTranslationStyle(undefined)).toBe(false);
    expect(isValidTranslationStyle({})).toBe(false);
  });
});
