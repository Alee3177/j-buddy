# Japanese Reader v0.3 — Tier 2 Final Checkpoint (BLOCK)

**Date:** 2026-09-05
**Branch:** `feature/japanese-reader-v0.3`

## Final Git State

```text
HEAD: 3f44a29 docs: add Japanese Reader v0.3 Tier 2 durable recovery checkpoint
Working tree: clean
```

No commits were made during Tier 2 validation. All real-LLM evidence lives outside the repo at:

```text
D:\jbuddy-tier2-results\
├─ baseline\
├─ current\
└─ logs\
```

## Overall Gate

```text
Tier 1: PASS
Tier 2: BLOCK

Merge to main: BLOCKED
Deploy:        BLOCKED
```

## Paired Fixtures: 10/10 complete

| Fixture | Baseline req. | Current req. | finishReason (b/c) | Newly-failing current checks | Truncated (b/c) | Current Reading Contract | Source/ruby defects | Token Δ (completion/prompt/total) |
|---|---|---|---|---|---|---|---|---|
| three-char-selection-ame-nara | 89% (8/9) | 78% (7/9) | n/a / n/a | `expectedVocabularyCovered` (0/1, missing 雨) | No/No (35%/32%) | VALID | none | +259 / +1429 / +1191 |
| causative-form-parent | 63% (5/8) | 88% (7/8) | n/a / n/a | none — current improved on baseline's malformed ruby + unreflected heading | No/No (60% / **97.1%** near-miss) | VALID | none | +980 / +1429 / +4499 |
| causative-passive-overtime | 100% (8/8) | 100% (8/8) | n/a / n/a | none | No/No (62%/60%) | VALID | none | +243 / +1429 / +1263 |
| conditionals-to-ba-tara-nara | 100% (10/10) | 100% (10/10) | stop/stop | none | No/No | VALID | current: 気→氣 ×2 in visible Markdown only (JSON contract correct) | +1058 / +1429 / +3812 |
| keigo-honorific-visit | 88% (7/8) | 75% (6/8) | stop/stop | **`expectedVocabularyCovered`** (dropped 伝える entry) | No/No | VALID | current: malformed ruby `{ご覧\|ご\|らん}` ×12; wrong-kanji in one collocation example; baseline also had 1 unrelated malformed token | −51 / +1429 / +1577 |
| homograph-sei-shou-nama-ue | 91% (10/11) | 100% (11/11) | stop/stop | none — current improved on baseline's malformed field label | No/No | VALID | none in current; baseline had 1 unrelated malformed ruby | +769 / +1429 / +3131 |
| katakana-loanwords-remote-meeting | 100% (9/9) | 89% (8/9) | stop/stop | **`expectedGrammarCovered`** (0/1 — total loss of the fixture's sole designated grammar point, `〜では`) | No/No | VALID | none | −562 / +1429 / +67 |
| mixed-n1-n2-n3-grammar | 89% (8/9) | 100%* (9/9) | stop/**length** | none by the checker (misleading result — see note) | No/**YES** | **ABSENT** (truncated before the fence) | baseline: 1 unrelated malformed ruby | +195 / +1429 / +2892 |
| near-500-char-urban-redevelopment | 80% (8/10) | 60% (6/10) | **length/length** | `grammarHeadingMatchesContent`, `v2GrammarShape` (truncation); manually: lost 2 of 5 expected grammar points | **YES/YES** | **ABSENT** (truncated) | **baseline: severe wrong-kanji `模` substituted for both 続 and 戻, ×5**; current: 2× 続→續 drift; current: duplicated-reading defect on 認める | −1528 / +1429 / +1312 |
| passive-form-review | 100% (8/8) | 88% (7/8) | stop/stop | **`grammarHeadingMatchesContent`** (受身形 heading not echoed in body); manually: lost `〜が逆接` entirely (checker blind spot — single-character substring match) | No/No | VALID | none | +3 / +1429 / +2102 |

\* `mixed-n1-n2-n3-grammar`'s "100%" is an artifact — none of its required checks happen to depend on the section (Reading Contract, register) that got truncated away.

## Counts

- Total paired fixtures: **10/10**
- Current Reading Contract VALID: **8/10**
- Current Reading Contract ABSENT due to truncation: **2/10** (`mixed-n1-n2-n3-grammar`, `near-500-char-urban-redevelopment`)
- Fixtures with a newly-failing required check in current: **5/10**
- Fixtures with manually-discovered regressions the automated checks missed or under-reported: **4/10**
- Baseline truncation count: **2/10** (same two fixtures — the ceiling is not current-specific)
- Current truncation count: **2/10**

## Root-Cause Groups

1. **Output-budget / truncation architecture** (most severe). `max_tokens: 8192` caps completion + hidden reasoning tokens combined — confirmed every time `total_tokens − prompt_tokens` lands within a few tokens of 8192 on a truncated sample. Shared architectural ceiling (baseline truncates too), but current is more exposed per unit of delivered content and uniquely loses its Reading Contract when it happens, since that's generated last.
2. **Visible-Markdown source-fidelity drift** (Japanese→Traditional-Chinese kanji substitution inside ruby tags). Confirmed in current on 2/10 fixtures (気→氣, 続→續); machine-readable Reading Contracts have never shown this defect — confined to human-readable Markdown.
3. **Inline ruby corruption** (malformed brackets, duplicated readings). Appears on both baseline and current across the run — looks like cross-version LLM sampling noise, not a prompt-caused defect.
4. **Grammar/vocabulary coverage regressions.** The clearest current-specific signal: current drops a designated vocabulary or grammar entry outright in 4/10 fixtures, once the fixture's *only* designated grammar point.
5. **Checker blind spots.** Tolerance rules (≥1-of-N grammar coverage, ≥50% vocabulary coverage, single-character substring cores) repeatedly masked real content loss; manual inspection was required to catch it every time.
6. **Reading Contract stability when actually emitted.** On the 8/10 fixtures where it wasn't truncated away, it was 100% structurally valid every time (version, exact `source_text`, exact token concat, kana-or-null readings). The mechanism itself is sound — the risk is entirely about whether it survives to be emitted.

## Pre-existing vs. Current-Specific

**Pre-existing (also present on baseline, not introduced by Phase 2B/2C):**
- The 8192-token ceiling and its truncation risk on long/dense inputs.
- Random single-token ruby-format corruption.
- The most severe single wrong-kanji defect found in the whole run (`模` substituted for two unrelated words) belongs to baseline, not current.

**Current-specific regressions:**
- ~39% higher prompt-token cost on nearly every fixture (known, already-understood cost of the Phase 2B/2C prompt expansion).
- Total Reading Contract loss under truncation — a risk that only exists because current added this feature.
- Content-thoroughness regressions: dropped vocabulary/grammar entries on 4/10 fixtures.
- 2 confirmed instances of visible-Markdown kanji glyph drift not present in baseline's ruby-tagged output on the same fixtures.

## Recommended Remediation Priorities (not yet implemented)

1. **Highest priority:** address the token-budget/truncation risk — options to evaluate: raise `max_tokens`, emit the Reading Contract earlier in the response so it survives truncation, reduce `thinking_budget`, or add a long-input fallback path.
2. **Close the checker blind spots** — the `expectedGrammarCovered`/`expectedVocabularyCovered` tolerance thresholds and single-character substring cores let real regressions through undetected.
3. **Investigate the visible-Markdown kanji-fidelity drift** — isolated to the free-text generation path; may be addressable via a targeted prompt instruction or post-processing normalization.
4. **Lower priority:** the random single-token ruby corruption looks like inherent sampling noise on both prompt versions.

## Durable Evidence

```text
D:\jbuddy-tier2-results\
```

Contains, per fixture: baseline `.v2.md` + `.v2.usage.json`; current `.v2.md` + `.v2.usage.json` (+ `.v2.readingcontract.json` where captured); full run logs under `logs\`. All evidence was persisted exactly as generated — no real result was ever rerun or replaced to obtain a cleaner sample.

## Resume Commands

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -5 --oneline --decorate
Get-ChildItem D:\jbuddy-tier2-results
```

Expected:

```text
HEAD: 3f44a29
working tree clean
```

## Final Checkpoint Status

```text
Japanese Reader v0.3

Tier 1: PASS
Tier 2: BLOCK

Paired fixtures: 10/10 complete

Current Reading Contract:
- VALID: 8/10
- ABSENT due to truncation: 2/10

Key blockers:
1. output-budget / truncation architecture
2. current-specific grammar/vocabulary coverage regressions
3. visible Markdown source-fidelity drift
4. checker blind spots

Merge:  BLOCKED
Deploy: BLOCKED

Branch:
feature/japanese-reader-v0.3

HEAD:
3f44a29

Working tree:
CLEAN
```
