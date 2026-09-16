import { describe, it, expect } from "@jest/globals";
import { buildTranslationSystemPrompt } from "../../src/models/translationPrompt";
import { resolveTranslationProfile } from "../../src/models/translationProfile";

/**
 * P8-D4.1: ORIWISH SOURCE GROUNDING — dedicated coverage on top of
 * translationProfile.test.ts / translationProfileP8D4.test.ts, which were
 * updated in place for the grounded content (version 2 -> 3, 布料 target
 * correction, 光澤 removal).
 *
 * See docs/terminology/ORIWISH-JA-EC-Translation-Profile-v0.1.md and
 * docs/terminology/sources/ORIWISH-OW01-Canonical-Product-Source-v0.1.md
 * for the evidence this exercises.
 */
const profile = resolveTranslationProfile("oriwish-ja-business-v1")!;
const businessPrompt = buildTranslationSystemPrompt("business", profile);

const SOURCE_CONFIRMED_TARGETS = [
  "長財布",
  "和柄",
  "桜柄",
  "金襴織",
  "西陣織",
  "上品",
  "華やか",
  "質感",
  "収納",
  "バッグ",
  "贈り物",
  "外箱",
  "カラー",
  "カラーバリエーション",
  "色合い",
  "サイズ",
  "布地",
  "ご購入前にご確認ください",
  "全10色から選べる",
];

describe("P8-D4.1: source-confirmed mappings", () => {
  it("all 19 SOURCE-CONFIRMED targets from the grounding pass are present", () => {
    const targets = profile.terminologyGlossary.map((e) => e.target);
    for (const target of SOURCE_CONFIRMED_TARGETS) {
      expect(targets).toContain(target);
    }
  });

  it("外盒 -> 外箱 (bilingual pair #13)", () => {
    const entry = profile.terminologyGlossary.find((e) => e.target === "外箱")!;
    expect(entry.sourceTerms).toContain("外盒");
  });

  it("顏色款式 -> カラーバリエーション (bilingual pair #16, exact)", () => {
    const entry = profile.terminologyGlossary.find((e) => e.target === "カラーバリエーション")!;
    expect(entry.sourceTerms).toEqual(["顏色款式"]);
  });

  it("色調 (not the original 色合 guess) is the primary confirmed alias for 色合い (bilingual pair #7)", () => {
    const entry = profile.terminologyGlossary.find((e) => e.target === "色合い")!;
    expect(entry.sourceTerms).toContain("色調");
    expect(entry.sourceTerms).toContain("色合");
  });

  it("尺寸 -> サイズ (bilingual pair #8, decomposed from 長夾尺寸 -> 長財布サイズ)", () => {
    const entry = profile.terminologyGlossary.find((e) => e.target === "サイズ")!;
    expect(entry.sourceTerms).toEqual(["尺寸"]);
  });

  it("購買前請確認 -> ご購入前にご確認ください (bilingual pair #17, exact)", () => {
    const entry = profile.terminologyGlossary.find((e) => e.target === "ご購入前にご確認ください")!;
    expect(entry.sourceTerms).toContain("購買前請確認");
  });
});

describe("P8-D4.1: longest-match behavior unaffected by grounding", () => {
  it("櫻花圖案 still sorts ahead of bare 櫻花 after adding new entries", () => {
    const glossaryBlock = businessPrompt.split("【術語對照表】")[1].split("【受保護用詞】")[0];
    expect(glossaryBlock.indexOf("櫻花圖案")).toBeGreaterThanOrEqual(0);
    expect(glossaryBlock.indexOf("櫻花圖案")).toBeLessThan(glossaryBlock.indexOf(" 櫻花 "));
  });

  it("no duplicate/conflicting source terms after the grounding pass's additions/removals", () => {
    const seen = new Map<string, string>();
    for (const entry of profile.terminologyGlossary) {
      for (const source of entry.sourceTerms) {
        expect(seen.has(source)).toBe(false);
        seen.set(source, entry.target);
      }
    }
  });
});

describe("P8-D4.1: ORIWISH protected term unaffected by grounding", () => {
  it("still protects exactly ORIWISH — oriwish_01 (an internal SKU code) was NOT promoted to a protected term", () => {
    expect(profile.protectedTerms).toEqual(["ORIWISH"]);
    expect(profile.protectedTerms).not.toContain("oriwish_01");
  });
});

describe("P8-D4.1: benchmarks A-D are REAL/SOURCE-DERIVED from OW_01", () => {
  it("Benchmark A — product identity: ORIWISH 和風圖案長夾 櫻花 金襴織 高雅 輕量 共10色", () => {
    expect(profile.protectedTerms).toContain("ORIWISH");
    for (const target of ["和柄", "長財布", "金襴織", "上品"]) {
      expect(profile.terminologyGlossary.some((e) => e.target === target)).toBe(true);
    }
  });

  it("Benchmark B — size and weight: dimensions/weight preserved exactly, no glossary literal for them", () => {
    // 本體：約19 × 10 × 1.8cm / 重量：約300g — these are handled entirely by
    // the profile-independent numeric-preservation rule, never by a
    // glossary entry. Only the color-count SKU exception carries a digit.
    const numeralEntries = profile.terminologyGlossary.filter(
      (e) => /[0-9]/.test(e.target) || e.sourceTerms.some((s) => /[0-9]/.test(s))
    );
    expect(numeralEntries).toHaveLength(1);
    expect(numeralEntries[0].target).toBe("全10色から選べる");
    expect(businessPrompt).toContain("日期、單位、價格、百分比等數值資訊必須原樣保留");
  });

  it("Benchmark C — gift/EC copy: 也推薦作為禮物 / 附外盒 / 共10色可選 all covered", () => {
    expect(profile.terminologyGlossary.some((e) => e.target === "贈り物")).toBe(true);
    expect(profile.terminologyGlossary.some((e) => e.target === "外箱")).toBe(true);
    expect(profile.terminologyGlossary.some((e) => e.sourceTerms.includes("共10色可選"))).toBe(true);
  });

  it("Benchmark D — product caution: 因布料裁切位置不同 register covered via corrected 布料 -> 布地 mapping", () => {
    const entry = profile.terminologyGlossary.find((e) => e.sourceTerms.includes("布料"))!;
    expect(entry.target).toBe("布地");
    expect(businessPrompt).toContain("布料 → 布地");
  });
});

describe("P8-D4.1: no industrial fixture leakage after re-grounding", () => {
  it("XYZ-300 / ISO 9001 / P8-D2 industrial glossary terms remain absent", () => {
    expect(profile.protectedTerms).not.toContain("XYZ-300");
    expect(profile.protectedTerms).not.toContain("ISO 9001");
    const allSources = profile.terminologyGlossary.flatMap((e) => e.sourceTerms);
    const allTargets = profile.terminologyGlossary.map((e) => e.target);
    for (const term of ["精密滑台", "直線模組", "線性滑軌", "精密ステージ", "リニアモジュール", "リニアガイド"]) {
      expect(allSources).not.toContain(term);
      expect(allTargets).not.toContain(term);
    }
  });

  it("PRODUCT-NR-001-derived terms (夜薔薇, 網紗) remain excluded — still ungrounded per Section C", () => {
    const allSources = profile.terminologyGlossary.flatMap((e) => e.sourceTerms);
    const allTargets = profile.terminologyGlossary.map((e) => e.target);
    for (const term of ["夜薔薇", "網紗"]) {
      expect(allSources).not.toContain(term);
      expect(allTargets).not.toContain(term);
    }
  });
});

describe("P8-D4.1: version decision", () => {
  it("version is 3 (bumped from 2: 布料 target corrected + 光澤 removed — both materially change output)", () => {
    expect(profile.version).toBe("3");
  });

  it("id remains oriwish-ja-business-v1 (unchanged, avoids orphaning P8-D3-persisted references)", () => {
    expect(profile.id).toBe("oriwish-ja-business-v1");
  });
});

describe("P8-D4.1: P8-C2/P8-D2/P8-D3 regression — no-profile and profile-independent behavior unchanged", () => {
  it("no-profile prompt is unaffected by any grounding change (byte-identical to calling with undefined)", () => {
    expect(buildTranslationSystemPrompt("business")).toBe(buildTranslationSystemPrompt("business", undefined));
    expect(buildTranslationSystemPrompt("business")).not.toContain("術語對照表");
  });

  it("business/natural/news style instructions are still independent of the profile", () => {
    expect(buildTranslationSystemPrompt("natural", profile)).toContain("自然日文");
    expect(buildTranslationSystemPrompt("natural", profile)).not.toContain("商務日文");
  });
});
