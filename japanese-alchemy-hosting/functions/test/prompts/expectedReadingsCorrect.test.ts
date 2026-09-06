/**
 * P3-A: deterministic tests for the advisory `expectedReadingsCorrect` Tier-2
 * checker (checks.ts). No LLM calls — synthetic fixtures/responses only.
 *
 * This checker never blocks anything by itself: it is declared with
 * `required: false` on every fixture that opts into it, so a failure here
 * never enters `requiredPassRate` / the Tier-1 or Tier-2 gate. These tests
 * verify both the matching/concatenation algorithm and that advisory
 * semantics actually hold.
 */
import { describe, it, expect } from "@jest/globals";
import { runChecks, requiredPassRate, Fixture, PromptVersion } from "./checks";

const VERSION: PromptVersion = "v2";

function baseFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: "reading-check-probe",
    input: "歴史的景観",
    difficulty: "probe",
    expectedVocabulary: [],
    expectedGrammar: [],
    expectedSections: ["原句"],
    targetVersions: [VERSION],
    structuralChecks: [{ name: "expectedReadingsCorrect", required: false, description: "" }],
    ...overrides,
  };
}

/** Build a response string carrying the given Reading Contract tokens as the trailing json fence. */
function responseWithContract(
  tokens: Array<{ text: string; reading: string | null }>,
  sourceText = "歴史的景観"
): string {
  const contract = { reading_contract_version: 1, source_text: sourceText, tokens };
  return [
    "### 原句",
    `  - ${sourceText}`,
    "  - 翻譯：歷史景觀",
    "",
    "```json",
    JSON.stringify(contract, null, 2),
    "```",
    "",
  ].join("\n");
}

function outcomeFor(response: string, fixture: Fixture) {
  const outcomes = runChecks(response, fixture, VERSION);
  const outcome = outcomes.find((o) => o.name === "expectedReadingsCorrect");
  if (!outcome) throw new Error("expectedReadingsCorrect did not run");
  return { outcome, outcomes };
}

describe("expectedReadingsCorrect (P3-A advisory semantic-reading checker)", () => {
  it("1. passes on an exact single-token expected reading", () => {
    const fixture = baseFixture({ expectedReadings: [{ text: "景観", reading: "けいかん" }] });
    const response = responseWithContract([
      { text: "歴史的", reading: "れきしてき" },
      { text: "景観", reading: "けいかん" },
    ]);
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(true);
    expect(outcome.detail).toContain("1/1");
  });

  it("2. passes when the expected phrase spans multiple adjacent tokens", () => {
    const fixture = baseFixture({ expectedReadings: [{ text: "歴史的景観", reading: "れきしてきけいかん" }] });
    const response = responseWithContract([
      { text: "歴史的", reading: "れきしてき" },
      { text: "景観", reading: "けいかん" },
    ]);
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(true);
    expect(outcome.detail).toContain("1/1");
  });

  it("3. fails on the known-bad reading (れきじてき vs れきしてき)", () => {
    const fixture = baseFixture({ expectedReadings: [{ text: "歴史的景観", reading: "れきしてきけいかん" }] });
    const response = responseWithContract([
      { text: "歴史的", reading: "れきじてき" },
      { text: "景観", reading: "けいかん" },
    ]);
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toContain("れきしてきけいかん");
    expect(outcome.detail).toContain("れきじてきけいかん");
  });

  it("4. passes when segmentation differs but adjacent tokens still concatenate correctly", () => {
    const fixture = baseFixture({ expectedReadings: [{ text: "歴史的景観", reading: "れきしてきけいかん" }] });
    const response = responseWithContract([
      { text: "歴", reading: "れき" },
      { text: "史", reading: "し" },
      { text: "的", reading: "てき" },
      { text: "景観", reading: "けいかん" },
    ]);
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(true);
  });

  it("5. fails clearly when the expected text is not present as any contiguous token span", () => {
    const fixture = baseFixture({ expectedReadings: [{ text: "存在しない", reading: "そんざいしない" }] });
    const response = responseWithContract([
      { text: "歴史的", reading: "れきしてき" },
      { text: "景観", reading: "けいかん" },
    ]);
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(false);
    expect(outcome.detail).toContain("not found");
  });

  it("6. reports NOT_APPLICABLE (not a failure) when no Reading Contract is present at all", () => {
    const fixture = baseFixture({ expectedReadings: [{ text: "歴史的景観", reading: "れきしてきけいかん" }] });
    const response = ["### 原句", "  - 歴史的景観", "  - 翻譯：歷史景觀"].join("\n");
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(true);
    expect(outcome.detail).toContain("NOT_APPLICABLE");
  });

  it("7. reports NOT_APPLICABLE when the fixture declares no expectedReadings", () => {
    const fixture = baseFixture(); // no expectedReadings field at all
    const response = responseWithContract([{ text: "歴史的", reading: "れきしてき" }]);
    const { outcome } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(true);
    expect(outcome.detail).toContain("NOT_APPLICABLE");
  });

  it("8. an advisory failure never affects requiredPassRate / the gate", () => {
    const fixture = baseFixture({
      structuralChecks: [
        { name: "expectedReadingsCorrect", required: false, description: "" },
        { name: "furiganaFormatValid", required: true, description: "" },
      ],
      expectedReadings: [{ text: "歴史的景観", reading: "れきしてきけいかん" }],
    });
    const response = responseWithContract([
      { text: "歴史的", reading: "れきじてき" }, // deliberately wrong
      { text: "景観", reading: "けいかん" },
    ]);
    const { outcome, outcomes } = outcomeFor(response, fixture);
    expect(outcome.pass).toBe(false); // the advisory check itself does fail
    expect(requiredPassRate(outcomes)).toBe(1); // but the gate is unaffected
    expect(outcomes.filter((o) => o.required && !o.pass)).toEqual([]);
  });
});
