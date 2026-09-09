/**
 * Prompt-output check runner shared by Tier 1 (mocked) and Tier 2 (real LLM).
 *
 * Each golden fixture declares a `structuralChecks` list; this module implements
 * every check by name. A check returns { pass, detail }. `runChecks` selects the
 * checks applicable to a given prompt version (v1GrammarShape / v2GrammarShape are
 * version-specific) and runs them against a response string.
 *
 * Coverage checks use partial-match tolerance (plan R28) so they stay useful
 * against non-deterministic LLM output. They are still precise enough that a
 * well-formed response scores full marks — which Tier 1 asserts explicitly.
 */
import * as fs from "fs";
import * as path from "path";

export type PromptVersion = "v1" | "v2";

export interface StructuralCheck {
  name: string;
  required: boolean;
  description: string;
  patternHint?: string;
}

/**
 * P3-A: a curated, high-confidence-only expectation for one Reading Contract
 * span. TEST/HARNESS metadata only — never part of the production Reading
 * Contract schema (functions/src/models/types.ts) or of `rubyContract.js`.
 * Only add entries where the correct reading is context-independent (see the
 * P2-C audit): ordinary lexical/compound readings and enumerable counters —
 * never proper nouns or genuinely context-sensitive readings.
 */
export interface ExpectedReading {
  text: string;
  reading: string;
}

export interface Fixture {
  id: string;
  input: string;
  difficulty: string;
  expectedVocabulary: string[];
  expectedGrammar: string[];
  expectedSections: string[];
  targetVersions: PromptVersion[];
  structuralChecks: StructuralCheck[];
  expectedReadings?: ExpectedReading[];
  /**
   * P3-B: TEST/HARNESS-only escape hatch for a legitimate heading paraphrase
   * the canonical-core reduction can't safely auto-normalize (e.g. the model
   * writing an optional suffix parenthetically — `〜ながら（も）` — instead of
   * fused — `〜ながらも`). Keyed by the exact `expectedGrammar` string; each
   * value is a list of additional accepted canonical cores. Never a
   * substitute for a real heading match — see `grammarCanonicalCore`.
   */
  grammarAliases?: Record<string, string[]>;
}

export interface CheckResult {
  pass: boolean;
  detail: string;
}

export interface CheckOutcome extends CheckResult {
  name: string;
  required: boolean;
}

export const FIXTURES_DIR = path.join(__dirname, "fixtures");

/** Load every *.json fixture in the fixtures directory. */
export function loadFixtures(): Fixture[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, f), "utf8")) as Fixture);
}

/** Strip the reading annotation from a ruby token: {漢字|かんじ} -> 漢字. */
function stripRuby(text: string): string {
  return text.replace(/\{[^{}|]+\|[^{}]*\}/g, (m) => m.slice(1, m.indexOf("|")));
}

/** Return the body of a `### <name>` section (up to the next `### ` heading). */
function section(response: string, name: string): string {
  const blocks = response.split(/(?=^### )/gm);
  const hit = blocks.find((b) => b.trim().startsWith(`### ${name}`));
  return hit ?? "";
}

/**
 * Mirror of the Chrome extension's formatAnalysisResult parser (sidepanel.js).
 * Splits on `### `, extracts `#### ` headings into words/grammars arrays.
 */
export function parseAnalysis(response: string): {
  words: Array<{ term: string; detail: string }>;
  grammars: Array<{ point: string; explanation: string }>;
} {
  const result = { words: [] as Array<{ term: string; detail: string }>, grammars: [] as Array<{ point: string; explanation: string }> };

  const wordSection = section(response, "單字分析");
  if (wordSection) {
    const wordContent = wordSection.replace(/^### 單字分析*/m, "").trim();
    wordContent
      .split(/^####\s+/gm)
      .map((e) => e.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const lines = entry.split("\n");
        const term = lines.shift()?.trim().replace("<單字>", "").trim() ?? "";
        if (term) result.words.push({ term: stripRuby(term), detail: lines.join("\n").trim() });
      });
  }

  const grammarSection = section(response, "文法分析");
  if (grammarSection) {
    const grammarContent = grammarSection.replace(/^### 文法分析*/m, "").trim();
    grammarContent
      .split(/^####\s+/gm)
      .map((e) => e.trim())
      .filter(Boolean)
      .forEach((entry) => {
        const lines = entry.split("\n");
        const point = lines.shift()?.trim().replace("<文法>", "").trim() ?? "";
        if (point) result.grammars.push({ point: stripRuby(point), explanation: lines.join("\n").trim() });
      });
  }

  return result;
}

/** Extract the kanji/term core from an expectedVocabulary entry: "生ビール（なま）" -> "生ビール". */
function vocabCore(term: string): string {
  return term.replace(/[（(].*$/, "").trim();
}

// --- P3-B: canonical grammar-heading matching -------------------------------
//
// See the P3-B audit: matching an expected grammar pattern against WHOLE
// 文法分析 prose (rather than the model's own headings) let unrelated example
// text silently "cover" a completely different taught point — most severely
// when the reduced anchor was a single hiragana particle (`が`), which is
// close to certain to appear somewhere in ANY natural Japanese explanation.
//
// This section is heading-scoped, exact-equality, deterministic, and
// fixture-driven — no dictionary, no morphology, no fuzzy matching:
//   1. `grammarCanonicalCore` reduces a raw label (expected OR a response's
//      own `#### <文法>` heading) to one canonical key. It strips ONLY
//      trailing JLPT-level metadata (（N3）, （JLPT N2）, ...) and a leading
//      〜 run — never blanket "everything after the first paren". Remaining
//      non-JLPT parenthetical content (a sense gloss like （逆接）, an
//      optional-suffix marker like （も）) is KEPT attached whenever the text
//      before it is a single character — exactly the degenerate case that
//      let 〜が（逆接） collapse into a bare "が" other が-bearing text could
//      satisfy by accident, and that would otherwise let 〜が（逆接） and
//      〜が（主格） collide with each other. When the text before the
//      parenthetical is already 2+ characters (受身形, 一方, ながら, つつ, …)
//      — already a safe, specific anchor — the parenthetical is stripped, since
//      it is almost always the model's own free-form gloss and essentially
//      never matches the fixture's bracketed label byte-for-byte.
//   2. `extractGrammarHeadingCores` pulls ONLY the canonical core of every
//      `#### <文法>` heading the response actually produced — CRLF-safe
//      (`split(/\r?\n/)`, never a `$`-anchored regex against a line that may
//      carry a trailing `\r`) — and never looks at body prose.
//   3. `expandSlashAliases` deterministically splits `〜ても／でも` into
//      `["ても", "でも"]` (mirrors the convention `grammarHeadingMatchesContent`
//      already used) so either half alone counts as a match.
//   4. `grammarExpectationSatisfied` combines both sides' slash-expansions
//      plus any fixture-declared `grammarAliases` for that exact expected
//      string, and requires EXACT equality against a produced heading core —
//      never substring-of-heading, never substring-of-prose.
//
// P3-B.1 (found during the P3-C audit) fixed two edge cases without touching
// this design's semantics:
//   - The 1-char retention rule meant for が（逆接）/が（主格） also caught
//     conditional particles と／ば whose fixture-authored label carries a
//     purely-documentary gloss (（恆常條件）/（假定條件）) the model was never
//     asked to reproduce — fixed via fixture-declared `grammarAliases`
//     ("と"/"ば"), not by weakening the retention rule itself.
//   - `findBoundaryIndex` (below) is now bracket-aware: a real heading can
//     wrap descriptive content in Japanese corner brackets — `使役受身形「〜
//     させられる（連用中止：〜させられ）」` — and the OLD plain `search(/[（(]/)`
//     found the INNER （連用中止…） first, hijacking the reducer into a
//     garbled core. `findBoundaryIndex` tracks `「」` depth so a `（`/`(`
//     inside a `「...」` span is never treated as the boundary; the `「`
//     itself becomes the boundary instead, exactly mirroring how a bare
//     `（...）` gloss is already treated.

/** Strip a trailing JLPT-level annotation like （N3）, (N3), （JLPT N2）; repeatable, metadata-only. */
function stripJlptLevel(s: string): string {
  const jlptTail = /[（(]\s*(?:JLPT\s*)?N[1-5]\s*[）)]\s*$/;
  let out = s;
  while (jlptTail.test(out)) {
    out = out.replace(jlptTail, "").trim();
  }
  return out;
}

/**
 * P3-B.1: index of the first top-level canonicalization boundary in `s` — the
 * first `（`, `(`, or `「` encountered while NOT already inside a `「...」`
 * span. A `「...」` elaboration is itself treated as a boundary (its content
 * is descriptive quoting, the same role a bare `（...）` gloss plays) the same
 * way a bare `（...）` is; a `（`/`(` that occurs INSIDE a `「...」` span is
 * never a boundary, so it can't hijack the reducer into cutting the outer
 * label at the wrong point — e.g. `使役受身形「〜させられる（連用中止：〜さ
 * せられ）」` must cut at the outer `「`, not at the inner `（`. A simple
 * depth-counted character scan — not a general parser; unmatched/unbalanced
 * brackets fall through to "no boundary found" (same as today).
 */
function findBoundaryIndex(s: string): number {
  let quoteDepth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "「") {
      if (quoteDepth === 0) return i; // a 「...」 span itself starts a boundary
      quoteDepth += 1;
      continue;
    }
    if (ch === "」") {
      quoteDepth = Math.max(0, quoteDepth - 1);
      continue;
    }
    if ((ch === "（" || ch === "(") && quoteDepth === 0) return i;
  }
  return -1;
}

/** Canonical grammar-label core used for exact-equality matching (see section comment above). */
function grammarCanonicalCore(raw: string): string {
  let s = raw.replace(/^.*<文法>/, "");
  s = stripJlptLevel(s);
  s = s.replace(/^〜+/, "").trim();
  const boundaryIdx = findBoundaryIndex(s);
  if (boundaryIdx === -1) return s;
  const prefix = s.slice(0, boundaryIdx).trim();
  return prefix.length > 1 ? prefix : s; // keep a disambiguating gloss attached to a 1-char anchor
}

/** Deterministic slash-alternative split: "ても／でも" -> ["ても", "でも"]. No fuzzy matching. */
function expandSlashAliases(core: string): string[] {
  return core.split(/[／/]/).map((s) => s.trim()).filter(Boolean);
}

/** Every `#### <文法>` heading's canonical core actually produced in the response (CRLF-safe; heading-only, never body prose). */
function extractGrammarHeadingCores(response: string): string[] {
  const gs = section(response, "文法分析");
  return gs
    .split(/^####\s+/gm)
    .slice(1)
    .map((entry) => {
      const head = entry.split(/\r?\n/)[0] ?? "";
      return grammarCanonicalCore(stripRuby(head));
    })
    .filter(Boolean);
}

/** Does any produced heading core exactly satisfy this one expectedGrammar entry (incl. slash + fixture aliases)? */
function grammarExpectationSatisfied(expectedRaw: string, headingCores: string[], aliases: string[]): boolean {
  const expectedCore = grammarCanonicalCore(expectedRaw);
  const expectedVariants = new Set([expectedCore, ...expandSlashAliases(expectedCore), ...aliases]);
  return headingCores.some((hc) => expectedVariants.has(hc) || expandSlashAliases(hc).some((h) => expectedVariants.has(h)));
}

// --- individual checks -------------------------------------------------------

function furiganaFormatValid(response: string): CheckResult {
  if (response.includes("<ruby>")) {
    return { pass: false, detail: "response contains raw <ruby> HTML" };
  }
  const loose = /\{[^}\n]*\|[^}\n]*\}/g;
  const strict = /^\{[^{}|]+\|[ぁ-ゖー]+\}$/;
  const tokens = response.match(loose) ?? [];
  for (const t of tokens) {
    if (!strict.test(t)) {
      return { pass: false, detail: `malformed ruby token: ${t}` };
    }
  }
  return { pass: true, detail: `${tokens.length} ruby tokens well-formed` };
}

function requiredHeadingsPresent(response: string): CheckResult {
  const i1 = response.indexOf("### 原句");
  const i2 = response.indexOf("### 單字分析");
  const i3 = response.indexOf("### 文法分析");
  const pass = i1 >= 0 && i2 > i1 && i3 > i2;
  return { pass, detail: `原句@${i1} 單字分析@${i2} 文法分析@${i3}` };
}

function translationInsideOriginalSection(response: string): CheckResult {
  const hasSeparate = /^### 翻譯/m.test(response);
  const orig = section(response, "原句");
  // The 翻譯 line may be a list item ("  - 翻譯：…"), so match anywhere in the 原句 section.
  const inside = /翻譯[:：]/.test(orig);
  return { pass: inside && !hasSeparate, detail: inside ? "翻譯 line inside 原句" : "no 翻譯 line in 原句" };
}

function vocabularyHeadingMatchesContent(response: string): CheckResult {
  const ws = section(response, "單字分析");
  const entries = ws.split(/^####\s+/gm).slice(1);
  for (const entry of entries) {
    if (!entry.includes("<單字>")) continue;
    if (!/(讀音|读音|重音|英文|解釋|解释|意思)[:：]/.test(entry)) {
      return { pass: false, detail: `vocab entry lacks fields: ${entry.split("\n")[0]}` };
    }
  }
  return { pass: true, detail: `${entries.filter((e) => e.includes("<單字>")).length} vocab entries` };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detailFieldValue(detail: string, field: string): string | null {
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${escapeRegExp(field)}(?:\\*\\*)?\\s*[:：]\\s*(.*)$`,
    "m"
  );
  const match = detail.match(pattern);
  return match ? match[1].trim() : null;
}

function noVocabularyConjugationForms(response: string): CheckResult {
  const ws = section(response, "單字分析");
  const forbidden = [
    "ます形",
    "ない形",
    "た形",
    "て形",
    "意向形",
    "命令形",
    "使役形",
    "受身形",
    "使役受身形",
    "否定形",
  ];
  const found = forbidden.filter((label) => detailFieldValue(ws, label) !== null);
  return {
    pass: found.length === 0,
    detail: found.length ? `vocabulary section has generated form labels: ${found.join(", ")}` : "no generated verb form labels in vocabulary",
  };
}

function v2VocabularyUsageShape(response: string): CheckResult {
  const parsed = parseAnalysis(response);
  if (parsed.words.length < 1 || parsed.words.length > 4) {
    return { pass: false, detail: `${parsed.words.length} vocabulary entries (expected 1-4 for v2)` };
  }

  const requiredFields = [
    "原句中的意思",
    "常見搭配／句型框架",
    "語感／語域",
    "自然例句",
    "造句模板",
    "回想題",
  ];
  for (const word of parsed.words) {
    for (const field of requiredFields) {
      const value = detailFieldValue(word.detail, field);
      if (value === null || value.length === 0) {
        return { pass: false, detail: `entry "${word.term}" missing V2 usage field ${field}` };
      }
    }
    const naturalExample = detailFieldValue(word.detail, "自然例句") ?? "";
    if (!/\{[^{}|]+\|[^{}]*\}/.test(naturalExample) || !/(?:（.+）|\(.+\))/.test(naturalExample)) {
      return { pass: false, detail: `entry "${word.term}" natural example lacks ruby or translation` };
    }
  }
  return { pass: true, detail: `${parsed.words.length} V2 usage-oriented entries` };
}

function grammarHeadingMatchesContent(response: string): CheckResult {
  const gs = section(response, "文法分析");
  const entries = gs.split(/^####\s+/gm).slice(1).map((e) => e.trim()).filter(Boolean);
  for (const entry of entries) {
    // P3-B CRLF fix only (audit item C/F): a Windows checkout (core.autocrlf)
    // leaves a trailing \r on each line; `.split("\n")` kept it on `head`,
    // and the old `/[（(].*$/` couldn't bridge across it (`.` excludes `\r`,
    // and `$` without `/m` only anchors at the true end of string), so the
    // parenthetical/JLPT suffix silently failed to strip. `/\r?\n/` splitting
    // plus a `[\s\S]`-based (line-terminator-inclusive) replacement fixes
    // this without changing the check's existing strictness in any other way.
    const head = entry.split(/\r?\n/)[0] ?? "";
    const headNorm = stripRuby(head);
    const core = headNorm.replace(/^.*<文法>/, "").replace(/[（(][\s\S]*$/, "").replace(/^〜+/, "").trim();
    if (core) {
      // Split slash-alternatives (ても／でも) and accept if any part appears in the body.
      const parts = core.split(/[／/]/).map((s) => s.trim()).filter(Boolean);
      const bodyNorm = stripRuby(entry.split(/\r?\n/).slice(1).join("\n"));
      const found = parts.some((p) => bodyNorm.includes(p));
      if (!found) {
        return { pass: false, detail: `heading "${core}" not reflected in its body` };
      }
    }
  }
  return { pass: true, detail: `${entries.length} grammar entries aligned` };
}

function allOutputKanjiAnnotated(response: string): CheckResult {
  // Best-effort: the strict furigana check already validates token shape; here we
  // only confirm the response actually uses ruby annotation for kanji.
  const tokens = response.match(/\{[^{}|]+\|[^{}]*\}/g) ?? [];
  return { pass: tokens.length > 0, detail: `${tokens.length} ruby annotations` };
}

function expectedVocabularyCovered(response: string, fixture: Fixture): CheckResult {
  const ws = stripRuby(section(response, "單字分析"));
  const total = fixture.expectedVocabulary.length;
  let covered = 0;
  const missing: string[] = [];
  for (const term of fixture.expectedVocabulary) {
    if (ws.includes(vocabCore(term))) covered++;
    else missing.push(term);
  }
  const ratio = total ? covered / total : 1;
  return { pass: ratio >= 0.5, detail: `${covered}/${total} covered${missing.length ? `; missing: ${missing.join(", ")}` : ""}` };
}

function expectedGrammarCovered(response: string, fixture: Fixture): CheckResult {
  const headingCores = extractGrammarHeadingCores(response);
  const total = fixture.expectedGrammar.length;
  let covered = 0;
  const missing: string[] = [];
  for (const g of fixture.expectedGrammar) {
    const aliases = fixture.grammarAliases?.[g] ?? [];
    if (grammarExpectationSatisfied(g, headingCores, aliases)) covered++;
    else missing.push(g);
  }
  // P3-B note: this threshold is UNCHANGED — still ≥1-of-N, not all-of-N.
  // P3-B only makes `covered`/`missing` truthful; the aggregation policy is
  // reserved for P3-C.
  return { pass: total === 0 || covered >= 1, detail: `${covered}/${total} covered${missing.length ? `; missing: ${missing.join(", ")}` : ""}` };
}

// --- P3-A: advisory semantic-reading coverage -------------------------------
//
// The Reading Contract is opaque to every check above: nothing validates that
// tokens[].reading is the linguistically correct kana for its span (see the
// P2-C audit — 歴史的景観 → れきじてき is structurally perfect and semantically
// wrong). This section adds ONE deterministic, advisory check against a small
// curated `expectedReadings` list per fixture. It never guesses a reading
// itself (no dictionary, no morphology, no on/kun inference) — it only
// compares the model's own Reading Contract tokens against explicit,
// hand-picked expectations declared in the fixture.
//
// Extraction here is a deliberately minimal, test-only re-implementation of
// enough of rubyContract.js's marker-first / final-fence-fallback rule to find
// the contract in a raw response string (Tier 2's `promptQuality.test.ts`
// only has the raw string, not a pre-parsed contract object). It does not
// reproduce structural validation (truncation states, source_text grounding,
// etc.) — a missing/malformed contract simply yields `null` here, which this
// check reports as NOT_APPLICABLE, never as a semantic-reading failure.

interface ReadingContractToken {
  text: string;
  reading: string | null;
}

const READING_CONTRACT_START_MARKER = '<!-- READING_CONTRACT_START -->';

function tryParseContractTokens(jsonText: string): ReadingContractToken[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    (parsed as { reading_contract_version?: unknown }).reading_contract_version !== 1 ||
    !Array.isArray((parsed as { tokens?: unknown }).tokens)
  ) {
    return null;
  }
  const tokens = (parsed as { tokens: unknown[] }).tokens;
  return tokens.map((t) => {
    const rawText = (t as { text?: unknown })?.text;
    const rawReading = (t as { reading?: unknown })?.reading;
    return {
      text: typeof rawText === 'string' ? rawText : '',
      reading: typeof rawReading === 'string' ? rawReading : null,
    };
  });
}

/**
 * Find the Reading Contract's tokens in a raw model response, or `null` when
 * none is present / parseable. When the P0-C1 start marker is present, only
 * the fenced json block immediately following its LAST occurrence is tried
 * (mirrors rubyContract.js's "last marked attempt is authoritative" rule).
 * Otherwise, every ```json fence in the response is tried and the LAST one
 * that parses as a valid contract shape wins (legacy final-fence rule).
 */
function extractReadingContractTokens(response: string): ReadingContractToken[] | null {
  const markerIdx = response.lastIndexOf(READING_CONTRACT_START_MARKER);
  const searchFrom = markerIdx >= 0 ? markerIdx + READING_CONTRACT_START_MARKER.length : 0;

  const fenceRe = /```json\s*\n([\s\S]*?)\n?```/g;
  fenceRe.lastIndex = searchFrom;
  let match: RegExpExecArray | null;
  let lastValid: ReadingContractToken[] | null = null;
  while ((match = fenceRe.exec(response)) !== null) {
    const tokens = tryParseContractTokens(match[1]);
    if (tokens) {
      lastValid = tokens;
      if (markerIdx >= 0) break; // marker present: the fence right after it is authoritative
    }
  }
  return lastValid;
}

/**
 * Walk `tokens` looking for a contiguous run whose concatenated `.text`
 * exactly equals `target` (supports the expected phrase being one token or
 * spanning several adjacent tokens, regardless of how the model segmented
 * it), returning the concatenation of those tokens' `.reading` values in
 * source order. Returns `null` when no contiguous span reproduces `target`.
 */
function findConcatenatedReading(tokens: ReadingContractToken[], target: string): string | null {
  for (let start = 0; start < tokens.length; start += 1) {
    let text = '';
    let reading = '';
    for (let end = start; end < tokens.length; end += 1) {
      text += tokens[end].text;
      if (!target.startsWith(text)) break;
      reading += tokens[end].reading ?? '';
      if (text === target) return reading;
    }
  }
  return null;
}

/**
 * ADVISORY ONLY (P3-A). Declared with `required: false` on every fixture that
 * uses it — a failure here never enters `requiredPassRate` / the Tier-2 gate.
 *
 * - No `expectedReadings` declared on the fixture -> NOT_APPLICABLE (pass).
 * - No parseable Reading Contract in the response -> NOT_APPLICABLE (pass);
 *   this is a structural-validity question owned by other checks/P2-B, and is
 *   deliberately never double-counted as a semantic-reading failure here.
 * - Otherwise every curated expectation is matched against the contract
 *   tokens; any not-found span or reading mismatch fails this (advisory)
 *   check, with expected-vs-actual detail for the report.
 */
function expectedReadingsCorrect(response: string, fixture: Fixture): CheckResult {
  const expectations = fixture.expectedReadings ?? [];
  if (expectations.length === 0) {
    return { pass: true, detail: 'NOT_APPLICABLE: fixture declares no expectedReadings' };
  }

  const tokens = extractReadingContractTokens(response);
  if (!tokens) {
    return {
      pass: true,
      detail: 'NOT_APPLICABLE: no valid Reading Contract found in response (structural validity is checked elsewhere)',
    };
  }

  const lines: string[] = [];
  let failures = 0;
  for (const exp of expectations) {
    const actual = findConcatenatedReading(tokens, exp.text);
    if (actual === null) {
      failures += 1;
      lines.push(`FAIL ${exp.text}: not found as a contiguous token span`);
    } else if (actual !== exp.reading) {
      failures += 1;
      lines.push(`FAIL ${exp.text}: expected "${exp.reading}", got "${actual}"`);
    } else {
      lines.push(`PASS ${exp.text}: "${actual}"`);
    }
  }

  return {
    pass: failures === 0,
    detail: `${expectations.length - failures}/${expectations.length} expected readings correct; ${lines.join('; ')}`,
  };
}

function grammarEntries(response: string): string[] {
  return section(response, "文法分析")
    .split(/^####\s+/gm)
    .slice(1)
    .map((e) => e.trim())
    .filter((e) => e.startsWith("<文法>"));
}

function grammarShape(response: string, version: PromptVersion): CheckResult {
  const entries = grammarEntries(response);
  const min = version === "v2" ? 0 : 1;
  const max = version === "v1" ? 3 : 5;
  if (entries.length < min || entries.length > max) {
    return { pass: false, detail: `${entries.length} grammar entries (expected ${min}-${max})` };
  }
  const requiredFields = version === "v1"
    ? ["接續形式", "用法說明"]
    : ["接續形式", "元素分解", "用法說明", "母語者語感", "例句"];
  for (const entry of entries) {
    for (const field of requiredFields) {
      if (!entry.includes(field)) {
        return { pass: false, detail: `entry "${entry.split("\n")[0]}" missing field ${field}` };
      }
    }
  }
  return { pass: true, detail: `${entries.length} entries, all ${version} fields present` };
}

function allFourConditionalsContrasted(response: string): CheckResult {
  const gs = stripRuby(section(response, "文法分析"));
  const forms = ["と", "ば", "たら", "なら"];
  const missing = forms.filter((f) => !new RegExp(`〜?${f}[（(（]`).test(gs) && !gs.includes(`〜${f}`));
  return { pass: missing.length === 0, detail: missing.length ? `missing conditionals: ${missing.join(", ")}` : "all four conditionals present" };
}

function homographReadingsDisambiguated(response: string): CheckResult {
  // Collect distinct readings assigned to 生 via {生|X} annotations.
  const readings = new Set<string>();
  const re = /\{生\|([^|}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(response))) readings.add(m[1]);
  // Also count explicit reading lines under 生 entries (e.g. 生ビール なま).
  for (const line of response.split("\n")) {
    const lm = line.match(/^[ \t-]*讀音[:：]\s*([ぁ-ゖー]+)/);
    if (lm && /生/.test(line)) readings.add(lm[1]);
  }
  const distinct = readings.size;
  return { pass: distinct >= 2, detail: `${distinct} distinct readings for 生 (${[...readings].join("/")})` };
}

function katakanaFieldsPresent(response: string): CheckResult {
  const ws = section(response, "單字分析");
  const hasKatakanaEntry = /####\s*<單字>[^\n]*[ァ-ヴー][^\n]*\n[\s\S]*?英文[:：]/m.test(ws);
  return { pass: hasKatakanaEntry, detail: hasKatakanaEntry ? "katakana entry with 英文 field found" : "no katakana entry with 英文 field" };
}

function longInputHandledWithoutTruncation(response: string, fixture: Fixture): CheckResult {
  const orig = stripRuby(section(response, "原句"));
  const probe = fixture.input.slice(0, 20);
  const pass = orig.includes(probe);
  return { pass, detail: pass ? "full input present in 原句" : `first 20 chars not found verbatim` };
}

function fragmentHandledAsFragment(response: string, fixture: Fixture): CheckResult {
  const gs = stripRuby(section(response, "文法分析"));
  const hasNara = /なら/.test(gs);
  const origKept = section(response, "原句").includes(fixture.input.trim());
  return { pass: hasNara && origKept, detail: `なら in 文法分析: ${hasNara}; raw fragment preserved: ${origKept}` };
}

// --- dispatch ---------------------------------------------------------------

const CHECKS: Record<string, (response: string, fixture: Fixture, version: PromptVersion) => CheckResult> = {
  furiganaFormatValid: (r) => furiganaFormatValid(r),
  requiredHeadingsPresent: (r) => requiredHeadingsPresent(r),
  translationInsideOriginalSection: (r) => translationInsideOriginalSection(r),
  vocabularyHeadingMatchesContent: (r) => vocabularyHeadingMatchesContent(r),
  noVocabularyConjugationForms: (r) => noVocabularyConjugationForms(r),
  v2VocabularyUsageShape: (r, _f, v) => (v === "v2" ? v2VocabularyUsageShape(r) : { pass: true, detail: "n/a for v1" }),
  grammarHeadingMatchesContent: (r) => grammarHeadingMatchesContent(r),
  allOutputKanjiAnnotated: (r) => allOutputKanjiAnnotated(r),
  expectedVocabularyCovered: (r, f) => expectedVocabularyCovered(r, f),
  expectedGrammarCovered: (r, f) => expectedGrammarCovered(r, f),
  expectedReadingsCorrect: (r, f) => expectedReadingsCorrect(r, f),
  v1GrammarShape: (r, _f, v) => (v === "v1" ? grammarShape(r, "v1") : { pass: true, detail: "n/a for v2" }),
  v2GrammarShape: (r, _f, v) => (v === "v2" ? grammarShape(r, "v2") : { pass: true, detail: "n/a for v1" }),
  allFourConditionalsContrasted: (r) => allFourConditionalsContrasted(r),
  homographReadingsDisambiguated: (r) => homographReadingsDisambiguated(r),
  katakanaFieldsPresent: (r) => katakanaFieldsPresent(r),
  longInputHandledWithoutTruncation: (r, f) => longInputHandledWithoutTruncation(r, f),
  fragmentHandledAsFragment: (r, f) => fragmentHandledAsFragment(r, f),
};

/** Is a check name applicable to the given prompt version? */
function appliesTo(name: string, version: PromptVersion): boolean {
  if (name === "v1GrammarShape") return version === "v1";
  if (name === "v2GrammarShape") return version === "v2";
  if (name === "v2VocabularyUsageShape") return version === "v2";
  return true;
}

/** Run all version-applicable checks declared by the fixture against a response. */
export function runChecks(response: string, fixture: Fixture, version: PromptVersion): CheckOutcome[] {
  return fixture.structuralChecks
    .filter((c) => appliesTo(c.name, version))
    .map((c) => {
      const fn = CHECKS[c.name];
      if (!fn) return { name: c.name, required: c.required, pass: false, detail: `unknown check: ${c.name}` };
      const res = fn(response, fixture, version);
      return { name: c.name, required: c.required, ...res };
    });
}

/** Fraction of required checks that pass (0-1). */
export function requiredPassRate(outcomes: CheckOutcome[]): number {
  const required = outcomes.filter((o) => o.required);
  if (!required.length) return 1;
  return required.filter((o) => o.pass).length / required.length;
}

/** Strict coverage counts (used by Tier 1 to assert canonical exemplars are perfect). */
export function coverage(response: string, fixture: Fixture): {
  vocab: { covered: number; total: number };
  grammar: { covered: number; total: number };
} {
  const ws = stripRuby(section(response, "單字分析"));
  const headingCores = extractGrammarHeadingCores(response);
  const vocabCovered = fixture.expectedVocabulary.filter((t) => ws.includes(vocabCore(t))).length;
  const grammarCovered = fixture.expectedGrammar.filter((g) =>
    grammarExpectationSatisfied(g, headingCores, fixture.grammarAliases?.[g] ?? [])
  ).length;
  return {
    vocab: { covered: vocabCovered, total: fixture.expectedVocabulary.length },
    grammar: { covered: grammarCovered, total: fixture.expectedGrammar.length },
  };
}

/** All check names implemented by this runner. */
export const CHECK_NAMES = Object.keys(CHECKS);
