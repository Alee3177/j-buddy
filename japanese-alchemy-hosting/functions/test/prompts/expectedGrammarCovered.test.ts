/**
 * P3-B: deterministic tests for the hardened `expectedGrammarCovered` /
 * `coverage()` grammar matcher (checks.ts). No LLM calls.
 *
 * P3-B only makes the `covered`/`missing` counts truthful by matching
 * expected grammar patterns against the model's own `#### <文法>` heading
 * cores (exact equality + deterministic slash/fixture aliases) instead of
 * searching the whole 文法分析 prose blob. It does NOT change the
 * `covered >= 1` pass threshold — that stays exactly as before and is
 * reserved for P3-C (see test 8b below, which pins this down explicitly).
 *
 * Real-evidence tests (10-12) inline verbatim excerpts captured during the
 * P3-B audit from D:\jbuddy-tier2-results\{baseline,current}\*.v2.md, rather
 * than reading that external directory, so this suite stays deterministic
 * and portable across machines/CI.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, it, expect } from "@jest/globals";
import { runChecks, coverage, loadFixtures, Fixture, PromptVersion } from "./checks";

const VERSION: PromptVersion = "v2";

function baseFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: "grammar-coverage-probe",
    input: "x",
    difficulty: "probe",
    expectedVocabulary: [],
    expectedGrammar: [],
    expectedSections: ["文法分析"],
    targetVersions: [VERSION],
    structuralChecks: [{ name: "expectedGrammarCovered", required: true, description: "" }],
    ...overrides,
  };
}

function wrap(grammarSection: string): string {
  return `### 原句\n  - x\n\n### 文法分析\n${grammarSection}\n`;
}

describe("expectedGrammarCovered (P3-B heading-scoped, exact-equality, alias-aware matcher)", () => {
  it("1. expected 〜でも does NOT pass on a response that only teaches 〜から", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜でも（N3）"] });
    const response = wrap(
      [
        "#### <文法>〜から（表示資訊或知識的來源）",
        "- **用法說明**",
        "  - {先生|せんせい}から{聞|き}いた。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(0);
    expect(cov.grammar.total).toBe(1);
  });

  it("2. expected 〜では does NOT pass on a response that only teaches plain 〜で", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜では（範圍・場面）（N3）"] });
    const response = wrap(
      ["#### <文法>〜で（N4）", "- **用法說明**", "  - 手段・方法を表す「で」。"].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(0);
  });

  it("3. expected 〜が（逆接） does NOT pass merely because an unrelated が appears in prose", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜が（逆接）（N3）"] });
    const response = wrap(
      [
        "#### <文法>受身形（被動語態：〜に〜される）",
        "- **例句**",
        "  - {私|わたし}の{提案|ていあん}が{採用|さいよう}されました。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(0);
  });

  it("4. fixture-declared alias ながら satisfies 〜ながらも（N2）", () => {
    const fixture = baseFixture({
      expectedGrammar: ["〜ながらも（N2）"],
      grammarAliases: { "〜ながらも（N2）": ["ながら"] },
    });
    const response = wrap(
      [
        "#### <文法>〜ながら（も）",
        "- **用法說明**",
        "  - 在本句中，「忙しいながらも」表示讓步。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(1);
  });

  it("5. exact 〜前に satisfies 〜前に（N3）", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜前に（N3）"] });
    const response = wrap(
      ["#### <文法>〜前に", "- **用法說明**", "  - 動作の先後関係を表す。"].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(1);
  });

  it("6. a term appearing only inside another entry's 相似文法比較 prose does NOT count as coverage", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜のに（N3）"] });
    const response = wrap(
      [
        "#### <文法>〜ても",
        "- **相似文法比較**",
        "  - 與「〜のに」相比：語感不同。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(0);
  });

  it("7. a ruby-wrapped heading 〜{前|まえ}に matches 〜前に（N3）", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜前に（N3）"] });
    const response = wrap(
      ["#### <文法>〜{前|まえ}に", "- **用法說明**", "  - {前|まえ}に起こる。"].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(1);
  });

  it("8. 〜が（逆接） and 〜が（主格） remain distinct from each other", () => {
    const fixtureGyakusetsu = baseFixture({ expectedGrammar: ["〜が（逆接）（N3）"] });
    const fixtureShukaku = baseFixture({ expectedGrammar: ["〜が（主格）（N3）"] });
    const responseWithShukakuHeading = wrap(
      ["#### <文法>〜が（主格）", "- **用法說明**", "  - 主語を表す「が」。"].join("\n")
    );
    // A heading for the 主格 sense must not satisfy the 逆接 expectation...
    expect(coverage(responseWithShukakuHeading, fixtureGyakusetsu).grammar.covered).toBe(0);
    // ...but does satisfy its own matching 主格 expectation.
    expect(coverage(responseWithShukakuHeading, fixtureShukaku).grammar.covered).toBe(1);
  });

  it("8b. the covered>=1 pass threshold itself is unchanged by P3-B", () => {
    // Two expected items, only one ever covered: pre-P3-B this still passed
    // via the (untouched) `covered >= 1` tolerance, and it must still pass
    // now — P3-B changes the count's accuracy, not the gate policy.
    const fixture = baseFixture({
      expectedGrammar: ["〜前に（N3）", "〜が（逆接）（N3）"],
    });
    const response = wrap(
      ["#### <文法>〜前に", "- **用法說明**", "  - 動作の先後関係を表す。"].join("\n")
    );
    const outcomes = runChecks(response, fixture, VERSION);
    const outcome = outcomes.find((o) => o.name === "expectedGrammarCovered")!;
    expect(outcome.detail).toContain("1/2");
    expect(outcome.pass).toBe(true); // still ≥1-of-N — P3-C's concern, not P3-B's
  });

  it("9. CRLF heading parsing works (heading line ending in \\r)", () => {
    const response = wrap(
      ["#### <文法>〜前に（N3）\r", "- **用法說明**\r", "  - 動作の前に起こる先後関係を表す。\r"].join("\n")
    );

    const fixture = baseFixture({ expectedGrammar: ["〜前に（N3）"] });
    expect(coverage(response, fixture).grammar.covered).toBe(1);

    // Companion fix (item F): grammarHeadingMatchesContent must also tolerate
    // CRLF without changing its intended strictness (the heading's own core
    // must still be echoed in its own body).
    const fixtureWithGhmc = baseFixture({
      expectedGrammar: ["〜前に（N3）"],
      structuralChecks: [{ name: "grammarHeadingMatchesContent", required: true, description: "" }],
    });
    const ghmcOutcome = runChecks(response, fixtureWithGhmc, VERSION).find(
      (o) => o.name === "grammarHeadingMatchesContent"
    )!;
    expect(ghmcOutcome.pass).toBe(true);
  });

  it("10. passive-form-review real current evidence reports 1/2, missing 〜が（逆接）（N3）", () => {
    // Verbatim excerpt of the 文法分析 section from
    // D:\jbuddy-tier2-results\current\passive-form-review.v2.md (captured
    // during the P3-B audit). Only one heading was ever produced; the second
    // expected point was dropped entirely, with an unrelated が only in an
    // example sentence for the first entry.
    const fixture = baseFixture({
      expectedGrammar: ["受身形（〜れる／〜られる）（N3）", "〜が（逆接）（N3）"],
    });
    const response = wrap(
      [
        "#### <文法>受身形（被動語態：〜に〜される）",
        "- **接續形式**",
        "  - 動詞未然形 ＋ れる／られる",
        "- **用法說明**",
        "  - 在本句中包含兩個被動結構。",
        "- **例句**",
        "  - （丁寧）{会議|かいぎ}で{私|わたし}の{提案|ていあん}が{採用|さいよう}されました。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(1);
    const outcomes = runChecks(response, fixture, VERSION);
    const outcome = outcomes.find((o) => o.name === "expectedGrammarCovered")!;
    expect(outcome.detail).toContain("1/2");
    expect(outcome.detail).toContain("〜が（逆接）（N3）");
  });

  it("11. homograph real current evidence reports 1/2, missing 〜ても／でも（N3）", () => {
    // Verbatim heading excerpt from
    // D:\jbuddy-tier2-results\current\homograph-sei-shou-nama-ue.v2.md — the
    // model swapped 〜でも for an unrelated 〜から（表示資訊或知識的來源）.
    const fixture = baseFixture({ expectedGrammar: ["〜前に（N3）", "〜ても／でも（N3）"] });
    const response = wrap(
      [
        "#### <文法>〜{前|まえ}に",
        "- **用法說明**",
        "  - {屋上|おくじょう}に{上|あ}がる{前|まえ}に。",
        "",
        "#### <文法>〜から（表示資訊或知識的來源）",
        "- **用法說明**",
        "  - {先生|せんせい}から{聞|き}いた。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(1);
    const outcomes = runChecks(response, fixture, VERSION);
    const outcome = outcomes.find((o) => o.name === "expectedGrammarCovered")!;
    expect(outcome.detail).toContain("1/2");
    expect(outcome.detail).toContain("〜ても／でも（N3）");
  });

  it("12. homograph real baseline evidence (alias/slash case) reports 2/2", () => {
    // Verbatim heading excerpt from
    // D:\jbuddy-tier2-results\baseline\homograph-sei-shou-nama-ue.v2.md — the
    // model taught only the でも half of the ても／でも alternation.
    const fixture = baseFixture({ expectedGrammar: ["〜前に（N3）", "〜ても／でも（N3）"] });
    const response = wrap(
      [
        "#### <文法>〜{前|まえ}に（N3）",
        "- **用法說明**",
        "  - {屋上|おくじょう}に{上|あ}がる{前|まえ}に。",
        "",
        "#### <文法>〜でも（逆接條件／提示極端例子）（N3）",
        "- **用法說明**",
        "  - {日陰|ひかげ}でも{生|は}える。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(2);
  });

  it("13. existing unaffected fixtures keep identical coverage (canonical exemplars)", () => {
    const fixtures = loadFixtures();
    const homograph = fixtures.find((f) => f.id === "homograph-sei-shou-nama-ue")!;
    for (const name of ["v1-response.md", "v2-response.md"]) {
      const response = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
      const cov = coverage(response, homograph);
      expect(cov.grammar.covered).toBe(cov.grammar.total);
      expect(cov.grammar.total).toBe(2);
    }
  });

  // --- P3-B.1: two matcher edge cases found during the P3-C audit ----------
  //
  // (A) The 1-char gloss-retention rule built for が（逆接）/が（主格） also
  //     caught conditional particles と／ば whose fixture-authored label
  //     carries a purely-documentary gloss the model never reproduces —
  //     fixed via fixture-declared `grammarAliases`, not by weakening the
  //     retention rule (which stays load-bearing for が).
  // (B) A real heading can wrap descriptive content in Japanese corner
  //     brackets with an inner （...） — 使役受身形「〜させられる（連用中止：
  //     〜させられ）」 — which used to hijack the reducer via the inner paren.

  it("P3-B.1-1: conditionals real evidence — expected 〜と（恆常條件）（N3） matches heading 〜と（N3）", () => {
    const fixture = baseFixture({
      expectedGrammar: ["〜と（恆常條件）（N3）", "〜ば（假定條件）（N3）"],
      grammarAliases: { "〜と（恆常條件）（N3）": ["と"], "〜ば（假定條件）（N3）": ["ば"] },
    });
    const response = wrap(
      [
        "#### <文法>〜と（N3）",
        "- **用法說明**",
        "  - 恆常條件を表す。",
        "",
        "#### <文法>〜ば",
        "- **用法說明**",
        "  - 假定條件を表す。",
      ].join("\n")
    );
    const cov = coverage(response, fixture);
    expect(cov.grammar.covered).toBe(2);
  });

  it("P3-B.1-2: expected 〜ば（假定條件）（N3） matches bare heading 〜ば via alias", () => {
    const fixture = baseFixture({
      expectedGrammar: ["〜ば（假定條件）（N3）"],
      grammarAliases: { "〜ば（假定條件）（N3）": ["ば"] },
    });
    const response = wrap(["#### <文法>〜ば", "- **用法說明**", "  - 假定條件を表す。"].join("\n"));
    expect(coverage(response, fixture).grammar.covered).toBe(1);
  });

  it("P3-B.1-3: が（逆接） still does NOT collapse to plain が (retention rule untouched)", () => {
    const fixture = baseFixture({ expectedGrammar: ["〜が（逆接）（N3）"] });
    const response = wrap(
      [
        "#### <文法>受身形",
        "- **例句**",
        "  - {私|わたし}が{採用|さいよう}されました。",
      ].join("\n")
    );
    expect(coverage(response, fixture).grammar.covered).toBe(0);
  });

  it("P3-B.1-4: が（逆接） and が（主格） remain distinct after the bracket-aware fix", () => {
    const gyakusetsu = baseFixture({ expectedGrammar: ["〜が（逆接）（N3）"] });
    const shukaku = baseFixture({ expectedGrammar: ["〜が（主格）（N3）"] });
    const responseWithShukaku = wrap(
      ["#### <文法>〜が（主格）", "- **用法說明**", "  - 主語を表す「が」。"].join("\n")
    );
    expect(coverage(responseWithShukaku, gyakusetsu).grammar.covered).toBe(0);
    expect(coverage(responseWithShukaku, shukaku).grammar.covered).toBe(1);
  });

  it("P3-B.1-5: causative-passive heading with inner （...） inside 「...」 canonicalizes correctly", () => {
    const fixture = baseFixture({ expectedGrammar: ["使役受身形（〜させられる）（N2）"] });
    const response = wrap(
      [
        "#### <文法>使役受身形「〜させられる（連用中止：〜させられ）」",
        "- **用法說明**",
        "  - 使役受身の連用中止形について説明する。",
      ].join("\n")
    );
    expect(coverage(response, fixture).grammar.covered).toBe(1);
  });

  it("P3-B.1-5b: a （...） strictly inside 「...」 is never mistaken for the outer boundary", () => {
    // Regression pin for the underlying mechanism, independent of any one
    // fixture's wording: the inner （中身） must never surface as the core.
    const fixture = baseFixture({ expectedGrammar: ["外側ラベル（N2）"] });
    const response = wrap(
      ["#### <文法>外側ラベル「説明（中身）続き」", "- **用法說明**", "  - 説明。"].join("\n")
    );
    expect(coverage(response, fixture).grammar.covered).toBe(1);
  });
});
