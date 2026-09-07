/**
 * P3-C final policy: `expectedGrammarCovered` is now a relabeled ADVISORY
 * quality metric, not a structural hard blocker (see the P3-C audit — grammar
 * point *selection* is probabilistic; requiring exact curated coverage
 * contradicts that, and no automated gate ever consumed `requiredPassRate`
 * mechanically in the first place, so this is a truthful relabel, not a CI
 * weakening).
 *
 * This suite proves the policy change in isolation from the matcher itself:
 * `expectedGrammarCovered`'s pass calculation, detail string, matcher,
 * aliases, and canonicalization are UNCHANGED (pinned here) — only the
 * `required` flag on every fixture declaring it moved from true to false.
 */
import { describe, it, expect } from "@jest/globals";
import { loadFixtures, runChecks, requiredPassRate, CHECK_NAMES, Fixture, PromptVersion } from "./checks";

const VERSION: PromptVersion = "v2";
const fixtures = loadFixtures();

function baseFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: "policy-probe",
    input: "x",
    difficulty: "probe",
    expectedVocabulary: [],
    expectedGrammar: [],
    expectedSections: ["文法分析"],
    targetVersions: [VERSION],
    structuralChecks: [],
    ...overrides,
  };
}

function wrap(grammarSection: string): string {
  return `### 原句\n  - x\n\n### 文法分析\n${grammarSection}\n`;
}

describe("P3-C: expectedGrammarCovered is advisory, not a hard blocker", () => {
  it("1. every fixture declaring expectedGrammarCovered has required === false", () => {
    const withCheck = fixtures.filter((f) =>
      f.structuralChecks.some((c) => c.name === "expectedGrammarCovered")
    );
    expect(withCheck.length).toBeGreaterThan(0); // sanity: the check is actually still declared somewhere
    for (const fixture of withCheck) {
      const check = fixture.structuralChecks.find((c) => c.name === "expectedGrammarCovered")!;
      expect({ id: fixture.id, required: check.required }).toEqual({ id: fixture.id, required: false });
    }
  });

  it("2. expectedGrammarCovered pass/detail is byte-for-byte unchanged for fixed synthetic responses", () => {
    // Full coverage.
    const fullFixture = baseFixture({
      expectedGrammar: ["〜前に（N3）"],
      structuralChecks: [{ name: "expectedGrammarCovered", required: false, description: "" }],
    });
    const fullResponse = wrap(["#### <文法>〜前に", "- **用法說明**", "  - 動作の前に起こる。"].join("\n"));
    const fullOutcome = runChecks(fullResponse, fullFixture, VERSION).find(
      (o) => o.name === "expectedGrammarCovered"
    )!;
    expect(fullOutcome.pass).toBe(true);
    expect(fullOutcome.detail).toBe("1/1 covered");

    // Partial coverage — the exact passive-form-review real-evidence shape (see P3-B/P3-C audits).
    const partialFixture = baseFixture({
      expectedGrammar: ["受身形（〜れる／〜られる）（N3）", "〜が（逆接）（N3）"],
      structuralChecks: [{ name: "expectedGrammarCovered", required: false, description: "" }],
    });
    const partialResponse = wrap(
      [
        "#### <文法>受身形（被動語態：〜に〜される）",
        "- **例句**",
        "  - （丁寧）{会議|かいぎ}で{私|わたし}の{提案|ていあん}が{採用|さいよう}されました。",
      ].join("\n")
    );
    const partialOutcome = runChecks(partialResponse, partialFixture, VERSION).find(
      (o) => o.name === "expectedGrammarCovered"
    )!;
    expect(partialOutcome.pass).toBe(true); // covered>=1 threshold untouched
    expect(partialOutcome.detail).toBe("1/2 covered; missing: 〜が（逆接）（N3）");

    // Zero coverage.
    const zeroFixture = baseFixture({
      expectedGrammar: ["〜が（逆接）（N3）"],
      structuralChecks: [{ name: "expectedGrammarCovered", required: false, description: "" }],
    });
    const zeroOutcome = runChecks(partialResponse, zeroFixture, VERSION).find(
      (o) => o.name === "expectedGrammarCovered"
    )!;
    expect(zeroOutcome.pass).toBe(false); // 0 >= 1 is false — threshold formula untouched
    expect(zeroOutcome.detail).toBe("0/1 covered; missing: 〜が（逆接）（N3）");
  });

  it("3. a fixture whose only failing check is expectedGrammarCovered does NOT lower requiredPassRate", () => {
    const fixture = baseFixture({
      expectedGrammar: ["〜が（逆接）（N3）"], // guaranteed to fail (no heading for it)
      structuralChecks: [
        { name: "furiganaFormatValid", required: true, description: "" },
        { name: "expectedGrammarCovered", required: false, description: "" },
      ],
    });
    const response = wrap(["#### <文法>受身形", "- **用法說明**", "  - 說明。"].join("\n"));
    const outcomes = runChecks(response, fixture, VERSION);
    const grammarOutcome = outcomes.find((o) => o.name === "expectedGrammarCovered")!;
    expect(grammarOutcome.pass).toBe(false); // it genuinely fails...
    expect(requiredPassRate(outcomes)).toBe(1); // ...but never touches the required rate
  });

  it("4. a failing structural required check still DOES lower requiredPassRate", () => {
    const fixture = baseFixture({
      structuralChecks: [
        { name: "furiganaFormatValid", required: true, description: "" },
        { name: "expectedGrammarCovered", required: false, description: "" },
      ],
    });
    const brokenResponse = "### 原句\n  - <ruby>生<rt>なま</rt></ruby>ビール\n\n### 文法分析\n";
    const outcomes = runChecks(brokenResponse, fixture, VERSION);
    const furiganaOutcome = outcomes.find((o) => o.name === "furiganaFormatValid")!;
    expect(furiganaOutcome.pass).toBe(false);
    expect(requiredPassRate(outcomes)).toBeLessThan(1);
  });

  it("5. P3-A expectedReadingsCorrect remains advisory (required === false)", () => {
    const withReadingCheck = fixtures.filter((f) =>
      f.structuralChecks.some((c) => c.name === "expectedReadingsCorrect")
    );
    expect(withReadingCheck.length).toBeGreaterThan(0);
    for (const fixture of withReadingCheck) {
      const check = fixture.structuralChecks.find((c) => c.name === "expectedReadingsCorrect")!;
      expect(check.required).toBe(false);
    }
  });

  it("6. no other existing required check was accidentally flipped (exact snapshot)", () => {
    // Captured immediately before the P3-C `required:false` flip — every
    // OTHER structural check's required-ness must be identical afterward.
    const expectedRequired: Record<string, string[]> = {
      "causative-form-parent.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered",
      ],
      "causative-passive-overtime.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered",
      ],
      "conditionals-to-ba-tara-nara.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered", "v2GrammarShape", "allFourConditionalsContrasted",
      ],
      "homograph-sei-shou-nama-ue.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "noVocabularyConjugationForms", "v2VocabularyUsageShape",
        "grammarHeadingMatchesContent", "allOutputKanjiAnnotated", "expectedVocabularyCovered",
        "homographReadingsDisambiguated",
      ],
      "katakana-loanwords-remote-meeting.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered", "katakanaFieldsPresent",
      ],
      "keigo-honorific-visit.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered",
      ],
      "mixed-n1-n2-n3-grammar.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered", "v2GrammarShape",
      ],
      "near-500-char-urban-redevelopment.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered", "v2GrammarShape", "longInputHandledWithoutTruncation",
      ],
      "passive-form-review.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered",
      ],
      "three-char-selection-ame-nara.json": [
        "furiganaFormatValid", "requiredHeadingsPresent", "translationInsideOriginalSection",
        "vocabularyHeadingMatchesContent", "grammarHeadingMatchesContent", "allOutputKanjiAnnotated",
        "expectedVocabularyCovered", "fragmentHandledAsFragment",
      ],
    };

    for (const [file, expectedNames] of Object.entries(expectedRequired)) {
      const id = file.replace(/\.json$/, "");
      const fixture = fixtures.find((f) => f.id === id);
      expect(fixture).toBeDefined();
      const actualRequired = fixture!.structuralChecks.filter((c) => c.required).map((c) => c.name);
      expect(actualRequired.sort()).toEqual([...expectedNames].sort());
      // And expectedGrammarCovered specifically must never appear in this required set.
      expect(actualRequired).not.toContain("expectedGrammarCovered");
    }
  });

  it("7. full fixture schema remains valid after the flip", () => {
    expect(() => loadFixtures()).not.toThrow();
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
    const known = new Set(CHECK_NAMES);
    for (const fixture of fixtures) {
      expect(fixture.id).toBeTruthy();
      expect(fixture.input).toBeTruthy();
      expect(Array.isArray(fixture.expectedGrammar)).toBe(true);
      expect(Array.isArray(fixture.structuralChecks)).toBe(true);
      for (const check of fixture.structuralChecks) {
        expect(typeof check.name).toBe("string");
        expect(typeof check.required).toBe("boolean");
        expect(typeof check.description).toBe("string");
        expect(known.has(check.name)).toBe(true);
      }
    }
  });
});
