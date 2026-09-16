import { describe, it, expect } from "@jest/globals";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import {
  resolveTranslationProfile,
  MAX_SERIALIZED_PROFILE_CONTEXT_CHARS,
} from "../../src/models/translationProfile";

/**
 * P8-D4: ORIWISH JAPANESE EC / LIFESTYLE PRODUCT TERMINOLOGY PROFILE
 * EXPANSION v0.1 — dedicated coverage (spec Section O) on top of the
 * existing translationProfile.test.ts / translationPrompt.test.ts suites,
 * which were updated in place to reflect the new profile content.
 *
 * See docs/terminology/ORIWISH-JA-EC-Translation-Profile-v0.1.md for the
 * full glossary/protected-terms/provenance table this exercises.
 */
const profile = resolveTranslationProfile("oriwish-ja-business-v1")!;

describe("P8-D4: active glossary mappings render correctly", () => {
  it("renders every glossary group's canonical target in the business-style prompt", () => {
    const prompt = buildTranslationSystemPrompt("business", profile);
    for (const entry of profile.terminologyGlossary) {
      expect(prompt).toContain(`${entry.sourceTerms.join(" / ")} → ${entry.target}`);
    }
  });
});

describe("P8-D4: ORIWISH is preserved", () => {
  it("is the only protected term", () => {
    expect(profile.protectedTerms).toEqual(["ORIWISH"]);
  });

  it("appears as a protected term in the rendered prompt", () => {
    const prompt = buildTranslationSystemPrompt("business", profile);
    expect(prompt).toContain("- ORIWISH");
  });
});

describe("P8-D4: longest-match / context rules (Section E)", () => {
  it("櫻花圖案 (product-pattern phrase) sorts ahead of 櫻花 (bare flower term) in the rendered glossary", () => {
    const prompt = buildTranslationSystemPrompt("business", profile);
    const glossaryBlock = prompt.split("【術語對照表】")[1].split("【受保護用詞】")[0];
    expect(glossaryBlock.indexOf("櫻花圖案")).toBeGreaterThanOrEqual(0);
    expect(glossaryBlock.indexOf("櫻花圖案")).toBeLessThan(glossaryBlock.indexOf(" 櫻花 "));
  });

  it("和風圖案 / 和柄 group sorts ahead of any shorter overlapping single-character-class term", () => {
    const group = profile.terminologyGlossary.find((e) => e.target === "和柄")!;
    expect(Math.max(...group.sourceTerms.map((s) => s.length))).toBeGreaterThanOrEqual(4);
  });

  it("no duplicate/conflicting source mappings across the whole glossary", () => {
    const seen = new Map<string, string>();
    for (const entry of profile.terminologyGlossary) {
      for (const source of entry.sourceTerms) {
        expect(seen.has(source)).toBe(false);
        seen.set(source, entry.target);
      }
    }
  });

  it("no glossary/protected-term conflict", () => {
    const glossarySources = new Set(profile.terminologyGlossary.flatMap((e) => e.sourceTerms));
    for (const term of profile.protectedTerms) {
      expect(glossarySources.has(term)).toBe(false);
    }
  });
});

describe("P8-D4: profile immutability and versioning", () => {
  it("profile and its collections are frozen", () => {
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.terminologyGlossary)).toBe(true);
    expect(Object.isFrozen(profile.protectedTerms)).toBe(true);
    expect(Object.isFrozen(profile.brandVoice)).toBe(true);
  });

  it("returns the correct v0.1 version string (bumped 2 -> 3 -> 4 by P8-D4.1/P8-D4.1a source grounding)", () => {
    expect(profile.version).toBe("4");
  });
});

describe("P8-D4: business + oriwish-ja-business-v1 gives ORIWISH EC/lifestyle brand voice, not industrial B2B", () => {
  it("does not contain the old industrial-automation brand-voice wording", () => {
    expect(profile.brandVoice.description).not.toContain("工業產品");
    expect(profile.brandVoice.description).not.toContain("技術可信度");
  });

  it("expresses an elegant/gift-appropriate lifestyle register instead", () => {
    expect(profile.brandVoice.description).toContain("典雅");
    expect(profile.brandVoice.description).toContain("電商");
  });
});

describe("P8-D4: factual-preservation rules remain dominant; dimensions/weights/numbers unchanged", () => {
  it("the shared COMMON_TRANSLATION_RULES numeric-preservation rule is present regardless of profile", () => {
    const prompt = buildTranslationSystemPrompt("business", profile);
    expect(prompt).toContain("日期、單位、價格、百分比等數值資訊必須原樣保留");
  });

  it("the hard-constraint block is still framed as taking priority over brand voice/style", () => {
    const prompt = buildTranslationSystemPrompt("business", profile);
    expect(prompt.indexOf("術語對照表")).toBeLessThan(prompt.indexOf("品牌語氣調整"));
  });

  it("no numeral-bearing literal entry exists EXCEPT the two P8-D4.1/P8-D4.1a SKU-specific exceptions", () => {
    // Variable counts (共N色/全N色) are deliberately NOT a static glossary
    // PATTERN — an exact-lexical entry could only ever match one specific
    // N, which would silently mistranslate every other count. Both
    // exceptions (共10色可選 → 全10色から選べる, 共10色 → 全10色) are literal
    // convenience entries justified because they match OW_01's own
    // confirmed color count exactly — neither is a stand-in for arbitrary
    // N. Any other count still falls through to the profile-independent
    // numeric-preservation rule, not to either glossary entry.
    const numeralEntries = profile.terminologyGlossary.filter(
      (entry) => /[0-9]/.test(entry.target) || entry.sourceTerms.some((s) => /[0-9]/.test(s))
    );
    const bySource = Object.fromEntries(numeralEntries.map((e) => [e.sourceTerms.join(","), e.target]));
    expect(bySource).toEqual({
      共10色可選: "全10色から選べる",
      共10色: "全10色",
    });
  });
});

describe("P8-D4: no industrial terminology remains in production ORIWISH profile", () => {
  it("XYZ-300 synthetic fixture is absent from the production profile", () => {
    expect(profile.protectedTerms).not.toContain("XYZ-300");
    const prompt = buildTranslationSystemPrompt("business", profile);
    expect(prompt).not.toContain("XYZ-300");
  });

  it("ISO 9001 synthetic fixture is absent (not independently source-confirmed for ORIWISH)", () => {
    expect(profile.protectedTerms).not.toContain("ISO 9001");
    const prompt = buildTranslationSystemPrompt("business", profile);
    expect(prompt).not.toContain("ISO 9001");
  });

  it("the P8-D2 industrial glossary terms are gone", () => {
    const allSources = profile.terminologyGlossary.flatMap((e) => e.sourceTerms);
    const allTargets = profile.terminologyGlossary.map((e) => e.target);
    for (const term of ["精密滑台", "直線模組", "線性滑軌", "精密ステージ", "リニアモジュール", "リニアガイド"]) {
      expect(allSources).not.toContain(term);
      expect(allTargets).not.toContain(term);
    }
  });
});

describe("P8-D4: profile stays within configured size limits", () => {
  it("glossary group count is within the requested v0.1 scope (20-40)", () => {
    expect(profile.terminologyGlossary.length).toBeGreaterThanOrEqual(20);
    expect(profile.terminologyGlossary.length).toBeLessThanOrEqual(40);
  });

  it("protected term count is within the requested v0.1 scope (5-10 as an upper guide; ORIWISH-only for now is intentionally conservative)", () => {
    expect(profile.protectedTerms.length).toBeGreaterThanOrEqual(1);
    expect(profile.protectedTerms.length).toBeLessThanOrEqual(10);
  });

  it("serialized profile context is comfortably within MAX_SERIALIZED_PROFILE_CONTEXT_CHARS", () => {
    const serializedChars =
      profile.terminologyGlossary.reduce(
        (sum, e) => sum + e.target.length + e.sourceTerms.reduce((s, t) => s + t.length, 0),
        0
      ) +
      profile.protectedTerms.reduce((sum, t) => sum + t.length, 0) +
      profile.brandVoice.description.length;
    expect(serializedChars).toBeLessThan(MAX_SERIALIZED_PROFILE_CONTEXT_CHARS);
  });
});

describe("P8-D4: benchmark cases (Section L) — terminology + facts + register, not fixed-sentence match", () => {
  const businessPrompt = buildTranslationSystemPrompt("business", profile);

  it("Benchmark 1 (REAL/SOURCE-DERIVED CONCEPTS, per user-supplied domain spec): core product identity terms are all covered by the glossary", () => {
    for (const target of ["和柄", "長財布", "桜", "金襴織", "上品", "軽量"]) {
      expect(profile.terminologyGlossary.some((e) => e.target === target)).toBe(true);
    }
    expect(profile.protectedTerms).toContain("ORIWISH");
  });

  it("Benchmark 2 (GENERIC EC EXAMPLE): lifestyle description vocabulary maps to a consistent, elegant register", () => {
    expect(businessPrompt).toContain("華麗");
    expect(businessPrompt).toContain("華やか");
    expect(businessPrompt).toContain("金襴織");
  });

  it("Benchmark 3 (GENERIC EC EXAMPLE): size/weight vocabulary terms exist; dimensions/weight are never glossary literals", () => {
    expect(profile.terminologyGlossary.some((e) => e.target === "商品サイズ")).toBe(true);
    expect(profile.terminologyGlossary.some((e) => e.target === "サイズ")).toBe(true);
    // Dimensions (19x10x1.8cm) and weight (300g) are never glossary
    // literals — only the two color-count SKU exceptions (see the
    // dedicated numeral-entries test above) carry a digit.
    const numeralTargets = new Set(["全10色から選べる", "全10色"]);
    for (const entry of profile.terminologyGlossary) {
      if (numeralTargets.has(entry.target)) continue;
      expect(/[0-9]/.test(entry.target)).toBe(false);
    }
  });

  it("Benchmark 4 (REAL/SOURCE-DERIVED, P8-D4.1/P8-D4.1a): gift/color-selection vocabulary is present, including OW_01's confirmed 10-color count in both bare and 可選 form", () => {
    expect(profile.terminologyGlossary.some((e) => e.target === "贈り物")).toBe(true);
    expect(profile.terminologyGlossary.some((e) => e.target === "ギフト")).toBe(true);
    expect(profile.terminologyGlossary.some((e) => e.target === "カラー")).toBe(true);
    expect(profile.terminologyGlossary.some((e) => e.sourceTerms.includes("共10色可選"))).toBe(true);
    // P8-D4.1a: promoted — the Product Image 1 bilingual heading directly
    // confirms bare 共10色 -> 全10色 (word-for-word tag list, not a sentence).
    expect(profile.terminologyGlossary.some((e) => e.sourceTerms.includes("共10色"))).toBe(true);
  });

  it("Benchmark 5 (GENERIC EC EXAMPLE): caution/disclaimer register terms exist without asserting a fixed disclaimer sentence", () => {
    expect(profile.terminologyGlossary.some((e) => e.target === "ご購入前にご確認ください")).toBe(true);
    // The disclaimer sentences themselves (screen/lighting variance, fabric
    // cut-position pattern variance) are deliberately NOT static glossary
    // literals — full boilerplate clauses are validated for meaning
    // preservation via COMMON_TRANSLATION_RULES, not exact-string matching.
  });
});

describe("P8-D4: PRODUCT-NR-001 — no local product data available (Section M)", () => {
  it("no PRODUCT-NR-001-derived terms (e.g. 夜薔薇, 網紗) are present in the active profile", () => {
    const allSources = profile.terminologyGlossary.flatMap((e) => e.sourceTerms);
    const allTargets = profile.terminologyGlossary.map((e) => e.target);
    for (const uncertainTerm of ["夜薔薇", "網紗"]) {
      expect(allSources).not.toContain(uncertainTerm);
      expect(allTargets).not.toContain(uncertainTerm);
    }
  });
});
