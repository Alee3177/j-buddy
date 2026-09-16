import { TerminologyEnforcementClass, TranslationProfile } from "./translationProfile";

/**
 * P8-D4.2: deterministic source-text glossary matching + collision-aware
 * output validation, layered on top of the P8-D2/P8-D4 prompt-only
 * enforcement (see docs/plans's P8-D4.2 audit for why prompt-only alone
 * was insufficient — Live Test #1: 櫻花 -> 桜 required, business style
 * produced 桜柄).
 *
 * This module is pure/side-effect-free: it never calls an LLM, never
 * mutates its inputs, and never reads/writes Firestore. `multilingualPreStage.ts`
 * is the only caller, and only in the zh/en + profile branch — inert for
 * ja fast-path and no-profile requests by construction (those callers
 * never invoke this module at all).
 */

export interface MatchedTerminologyConstraint {
  /** The exact source substring that matched (one of a glossary entry's sourceTerms, or a protected term). */
  sourceTerm: string;
  /** The canonical Japanese target this source term must produce. */
  target: string;
  enforcement: TerminologyEnforcementClass;
  kind: "glossary" | "protected";
}

export interface TerminologyViolation {
  sourceTerm: string;
  target: string;
  kind: "glossary" | "protected";
}

interface Candidate {
  sourceTerm: string;
  target: string;
  enforcement: TerminologyEnforcementClass;
  kind: "glossary" | "protected";
}

function buildCandidates(profile: TranslationProfile): Candidate[] {
  const candidates: Candidate[] = [];
  for (const entry of profile.terminologyGlossary) {
    const enforcement: TerminologyEnforcementClass = entry.enforcement ?? "volatile";
    for (const sourceTerm of entry.sourceTerms) {
      candidates.push({ sourceTerm, target: entry.target, enforcement, kind: "glossary" });
    }
  }
  // Protected terms are always stable (P8-D4.2 Section D) and self-mapped
  // (the required "target" IS the source term, preserved verbatim).
  for (const term of profile.protectedTerms) {
    candidates.push({ sourceTerm: term, target: term, enforcement: "stable", kind: "protected" });
  }
  return candidates;
}

interface Occurrence {
  start: number;
  end: number;
  candidate: Candidate;
}

/**
 * Deterministic, exact-lexical, longest-match-first scan of `sourceText`
 * against every glossary alias + protected term in `profile`. Extends the
 * length-based ordering already used to RENDER the prompt
 * (translationPrompt.ts's buildProfileHardConstraintsBlock) into an actual
 * scan over real text with overlap suppression:
 *
 *   "櫻花圖案"   -> only 櫻花圖案 -> 桜柄 is required (NOT also bare 櫻花 -> 桜,
 *                   even though "櫻花" is a literal substring of "櫻花圖案")
 *   "櫻花與金襴織" -> both 櫻花 -> 桜 and 金襴織 -> 金襴織 required
 *                   (non-overlapping spans, both kept)
 *
 * Case-sensitive, no fuzzy/semantic matching — pure substring search.
 * Multiple occurrences of the same source term collapse to one requirement
 * (only presence matters for validation, not count).
 */
export function matchTerminologyConstraints(
  sourceText: string,
  profile: TranslationProfile
): MatchedTerminologyConstraint[] {
  const candidates = buildCandidates(profile);

  const occurrences: Occurrence[] = [];
  for (const candidate of candidates) {
    if (candidate.sourceTerm.length === 0) continue;
    let fromIndex = 0;
    for (;;) {
      const index = sourceText.indexOf(candidate.sourceTerm, fromIndex);
      if (index === -1) break;
      occurrences.push({ start: index, end: index + candidate.sourceTerm.length, candidate });
      fromIndex = index + 1;
    }
  }

  // Longest-match-first: longer spans processed first; equal-length spans
  // broken by earliest start for deterministic output regardless of
  // glossary declaration order.
  occurrences.sort((a, b) => {
    const lengthDiff = b.end - b.start - (a.end - a.start);
    if (lengthDiff !== 0) return lengthDiff;
    return a.start - b.start;
  });

  const claimedSpans: Array<[number, number]> = [];
  const isClaimed = (start: number, end: number) =>
    claimedSpans.some(([claimedStart, claimedEnd]) => start < claimedEnd && end > claimedStart);

  const matched: MatchedTerminologyConstraint[] = [];
  const seenKeys = new Set<string>();

  for (const occurrence of occurrences) {
    if (isClaimed(occurrence.start, occurrence.end)) continue;
    claimedSpans.push([occurrence.start, occurrence.end]);

    const key = `${occurrence.candidate.kind}:${occurrence.candidate.sourceTerm}:${occurrence.candidate.target}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    matched.push({
      sourceTerm: occurrence.candidate.sourceTerm,
      target: occurrence.candidate.target,
      enforcement: occurrence.candidate.enforcement,
      kind: occurrence.candidate.kind,
    });
  }

  return matched;
}

/** Every canonical target string known to the profile (glossary targets + protected terms). */
function collectAllCanonicalTargets(profile: TranslationProfile): string[] {
  const targets = new Set<string>();
  for (const entry of profile.terminologyGlossary) targets.add(entry.target);
  for (const term of profile.protectedTerms) targets.add(term);
  return [...targets];
}

/**
 * True if `target` is present in `output` at an occurrence that is not
 * "swallowed" by a longer, DIFFERENT canonical target beginning with
 * `target` (P8-D4.2 Section C's collision rule) — unless that longer
 * target is itself independently required for this same request
 * (`alsoRequiredTargets`).
 *
 * This is exactly what makes the 桜/桜柄 regression case work: 桜柄 begins
 * with 桜, so an output of "桜柄" does NOT satisfy a requirement for bare
 * 桜 unless 桜柄 was ALSO matched from the source (i.e. the source really
 * did contain 櫻花圖案 somewhere too). Deliberately NOT full Japanese
 * morphological parsing — a bounded, profile-local collision check only.
 */
export function isTerminologyTargetSatisfied(
  target: string,
  output: string,
  allCanonicalTargets: readonly string[],
  alsoRequiredTargets: ReadonlySet<string>
): boolean {
  const collidingLongerTargets = allCanonicalTargets.filter(
    (candidate) => candidate !== target && candidate.length > target.length && candidate.startsWith(target)
  );

  let fromIndex = 0;
  for (;;) {
    const index = output.indexOf(target, fromIndex);
    if (index === -1) return false;

    const isSwallowed = collidingLongerTargets.some(
      (longerTarget) => output.startsWith(longerTarget, index) && !alsoRequiredTargets.has(longerTarget)
    );
    if (!isSwallowed) return true;

    fromIndex = index + 1;
  }
}

/**
 * Filters `constraintsToCheck` down to the ones NOT satisfied in `output`.
 * `allMatchedTargets` should be the full set of targets matched for this
 * request (stable + volatile combined) — not just the subset being
 * checked — so the collision exception in `isTerminologyTargetSatisfied`
 * sees the complete picture regardless of which subset is being validated.
 */
export function findTerminologyViolations(
  constraintsToCheck: readonly MatchedTerminologyConstraint[],
  allMatchedTargets: ReadonlySet<string>,
  output: string,
  profile: TranslationProfile
): TerminologyViolation[] {
  const allCanonicalTargets = collectAllCanonicalTargets(profile);

  return constraintsToCheck
    .filter((constraint) => !isTerminologyTargetSatisfied(constraint.target, output, allCanonicalTargets, allMatchedTargets))
    .map((constraint) => ({ sourceTerm: constraint.sourceTerm, target: constraint.target, kind: constraint.kind }));
}
