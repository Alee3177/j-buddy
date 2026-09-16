import { describe, it, expect } from "@jest/globals";
import {
  findTerminologyViolations,
  isTerminologyTargetSatisfied,
  matchTerminologyConstraints,
} from "../../src/models/translationTerminology";
import { resolveTranslationProfile } from "../../src/models/translationProfile";

const profile = resolveTranslationProfile("oriwish-ja-business-v1")!;

describe("P8-D4.2: matchTerminologyConstraints — longest-match-first source scanning", () => {
  it("櫻花圖案 matches ONLY the 桜柄 rule, not also bare 櫻花 -> 桜 (Section B example)", () => {
    const matched = matchTerminologyConstraints("櫻花圖案", profile);
    const targets = matched.map((m) => m.target);
    expect(targets).toContain("桜柄");
    expect(targets).not.toContain("桜");
  });

  it("櫻花與金襴織 (non-overlapping separate terms) requires both 桜 and 金襴織", () => {
    const matched = matchTerminologyConstraints("櫻花與金襴織", profile);
    const targets = matched.map((m) => m.target);
    expect(targets).toContain("桜");
    expect(targets).toContain("金襴織");
  });

  it("matches a protected term (ORIWISH) as a stable, self-mapped constraint", () => {
    const matched = matchTerminologyConstraints("ORIWISH 和風圖案長夾", profile);
    const oriwish = matched.find((m) => m.kind === "protected");
    expect(oriwish).toMatchObject({ sourceTerm: "ORIWISH", target: "ORIWISH", enforcement: "stable" });
  });

  it("is deterministic across repeated calls on the same input", () => {
    const first = matchTerminologyConstraints("ORIWISH 和風圖案長夾，採用櫻花與金襴織設計，高雅輕量，共10色可選。", profile);
    const second = matchTerminologyConstraints("ORIWISH 和風圖案長夾，採用櫻花與金襴織設計，高雅輕量，共10色可選。", profile);
    expect(second).toEqual(first);
  });

  it("does not match anything for text with no glossary/protected term overlap", () => {
    expect(matchTerminologyConstraints("これは関係のない文章です", profile)).toEqual([]);
  });

  it("collapses repeated occurrences of the same source term into one requirement", () => {
    const matched = matchTerminologyConstraints("金襴織和金襴織", profile);
    const kinranEntries = matched.filter((m) => m.target === "金襴織");
    expect(kinranEntries).toHaveLength(1);
  });
});

describe("P8-D4.2: isTerminologyTargetSatisfied — collision-aware presence check", () => {
  const allTargets = profile.terminologyGlossary.map((e) => e.target).concat(profile.protectedTerms);

  it("named regression: source 櫻花, output 桜柄 -> NOT satisfied (桜 is only a substring of the unrelated 桜柄 target)", () => {
    expect(isTerminologyTargetSatisfied("桜", "桜柄", allTargets, new Set(["桜"]))).toBe(false);
  });

  it("source 櫻花, output 桜と金襴織 -> satisfied (clean, non-colliding occurrence)", () => {
    expect(isTerminologyTargetSatisfied("桜", "桜と金襴織", allTargets, new Set(["桜"]))).toBe(true);
  });

  it("source 櫻花圖案, output 桜柄 -> satisfied (桜柄 is the actually-required target itself)", () => {
    expect(isTerminologyTargetSatisfied("桜柄", "桜柄", allTargets, new Set(["桜柄"]))).toBe(true);
  });

  it("collision exception: when the longer colliding target is ALSO independently required, it may satisfy the shorter one", () => {
    // Both 桜 (from bare 櫻花) and 桜柄 (from 櫻花圖案) matched for this
    // hypothetical request — a single "桜柄" occurrence is allowed to
    // count toward 桜 too, per the documented exception.
    expect(isTerminologyTargetSatisfied("桜", "桜柄", allTargets, new Set(["桜", "桜柄"]))).toBe(true);
  });
});

describe("P8-D4.2: findTerminologyViolations", () => {
  it("collision regression case end-to-end: source 櫻花, output 桜柄 -> violation", () => {
    const matched = matchTerminologyConstraints("採用櫻花設計", profile);
    const stable = matched.filter((m) => m.enforcement === "stable");
    const allMatchedTargets = new Set(matched.map((m) => m.target));
    const violations = findTerminologyViolations(stable, allMatchedTargets, "桜柄の魅力的なデザイン", profile);
    expect(violations.some((v) => v.target === "桜")).toBe(true);
  });

  it("correct short target: source 櫻花, output 桜と金襴織 -> compliant (no violations)", () => {
    const matched = matchTerminologyConstraints("採用櫻花與金襴織", profile);
    const stable = matched.filter((m) => m.enforcement === "stable");
    const allMatchedTargets = new Set(matched.map((m) => m.target));
    const violations = findTerminologyViolations(stable, allMatchedTargets, "桜と金襴織を採用", profile);
    expect(violations).toEqual([]);
  });

  it("long target: source 櫻花圖案, output 桜柄 -> compliant", () => {
    const matched = matchTerminologyConstraints("採用櫻花圖案設計", profile);
    const stable = matched.filter((m) => m.enforcement === "stable");
    const allMatchedTargets = new Set(matched.map((m) => m.target));
    const violations = findTerminologyViolations(stable, allMatchedTargets, "桜柄のデザインを採用", profile);
    expect(violations).toEqual([]);
  });

  it("protected term ORIWISH missing from output -> violation", () => {
    const matched = matchTerminologyConstraints("ORIWISH 和風圖案長夾", profile);
    const stable = matched.filter((m) => m.enforcement === "stable");
    const allMatchedTargets = new Set(matched.map((m) => m.target));
    const violations = findTerminologyViolations(stable, allMatchedTargets, "和柄長財布", profile);
    expect(violations.some((v) => v.kind === "protected" && v.target === "ORIWISH")).toBe(true);
  });

  it("volatile constraints never appear as violations when checked via the stable-only subset", () => {
    // 高雅 -> 上品 is volatile; matching 高雅 alone should not itself force
    // a "violation" through this function when only the stable subset is
    // passed in (the caller decides which subset to check).
    const matched = matchTerminologyConstraints("高雅的設計", profile);
    const volatile = matched.filter((m) => m.enforcement === "volatile");
    expect(volatile.some((m) => m.target === "上品")).toBe(true);
    const allMatchedTargets = new Set(matched.map((m) => m.target));
    // Even with a completely unrelated output, checking the STABLE subset
    // (empty here) yields no violations — volatile misses are a separate,
    // detect-only concern (Section E), asserted via multilingualPreStage
    // integration tests instead.
    const stable = matched.filter((m) => m.enforcement === "stable");
    expect(findTerminologyViolations(stable, allMatchedTargets, "全く関係ない出力", profile)).toEqual([]);
  });
});

describe("P8-D4.2: enforcement classification audit (per-entry, matches P8-D4.2 spec)", () => {
  const byTarget = new Map(profile.terminologyGlossary.map((e) => [e.target, e.enforcement]));

  it.each([
    ["長財布", "stable"],
    ["桜", "stable"],
    ["桜柄", "stable"],
    ["金襴織", "stable"],
    ["西陣織", "stable"],
    ["軽量", "stable"],
    ["外箱", "stable"],
    ["カラーバリエーション", "stable"],
    ["全10色", "stable"],
    ["全10色から選べる", "stable"],
  ])("%s is stable", (target, expected) => {
    expect(byTarget.get(target)).toBe(expected);
  });

  it.each([
    ["上品", "volatile"],
    ["華やか", "volatile"],
    ["持ち運びしやすい", "volatile"],
    ["日常使い", "volatile"],
  ])("%s is volatile", (target, expected) => {
    expect(byTarget.get(target)).toBe(expected);
  });

  it("exactly 4 volatile entries, the rest stable", () => {
    const volatileCount = profile.terminologyGlossary.filter((e) => e.enforcement === "volatile").length;
    expect(volatileCount).toBe(4);
    expect(profile.terminologyGlossary.length - volatileCount).toBe(profile.terminologyGlossary.length - 4);
  });

  it("protected terms are always treated as stable by the matcher, regardless of any data field", () => {
    const matched = matchTerminologyConstraints("ORIWISH test", profile);
    const oriwish = matched.find((m) => m.kind === "protected")!;
    expect(oriwish.enforcement).toBe("stable");
  });
});
