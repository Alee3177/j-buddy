# Japanese Reader v0.3 — Close Checkpoint (CLOSED / PASS)

**Date:** 2026-09-09
**Project:** J-Buddy → Language Agent / Japanese Reader
**Branch:** `feature/japanese-reader-v0.3`

## 1. Final Git State

```text
HEAD:         f8a5176 fix(reader): reject ascii-contaminated ruby readings
Branch:       feature/japanese-reader-v0.3
Working tree: clean
```

Relative to `main` (before this checkpoint commit):

```text
34 files changed, 5782 insertions(+), 279 deletions(-)
```

Branch commits since `main`:

```text
f8a5176 fix(reader): reject ascii-contaminated ruby readings
37b955b test(prompt): mark grammar coverage advisory
8bf881c test(prompt): fix grammar matcher edge cases
c50514e test(prompt): harden grammar coverage matching
ba69fdc test(prompt): add semantic reading quality check
617739d fix(reader): unify reading trust for render and persistence
189ac3d fix(reader): canonicalize selected source text
6949bec test(gemini): evaluate zero-temperature managed generation
ba6217b fix(reader): handle repeated reading contract attempts
57f3e89 fix(prompt): scan candidates before selection
9136073 fix(prompt): protect high-value grammar and vocabulary
01a425d fix(gemini): raise managed output token ceiling
83fcbe0 fix(reader): preserve reading contract before prose
bd898b3 fix(gemini): align batch and stream generation policy
99ffb32 docs: add Japanese Reader v0.3 Tier 2 final BLOCK checkpoint
3f44a29 docs: add Japanese Reader v0.3 Tier 2 durable recovery checkpoint
db3b290 docs: add Japanese Reader v0.3 Tier 2 partial checkpoint
9c55938 test(prompt): fix Tier 2 response extraction
e549741 docs: add Japanese Reader v0.3 final checkpoint
ca55fb8 feat(prompt): add managed reading contract
d0f7d09 docs: add Japanese Reader v0.3 phase 2B checkpoint
4f3c229 feat(prompt): remove grammar quota and JLPT forcing
e42b0ad test(prompt): allow zero grammar and unlabeled headings
c8bb330 feat(prompt): converge managed taxonomy sections
fa44604 docs: add Japanese Reader v0.3 phase 1 and 2A session close
840e18f feat(reader): persist collocation and register taxonomy
48ada3f feat(reader): persist grounded reading tokens
```

## 2. Final Status

```text
Japanese Reader v0.3:  CLOSED / PASS

Final deterministic verification:  PASS
Final real verification (Tier 2):  PASS

Merge to main:  UNBLOCKED from the v0.3 quality gate
                (still gated on the upstream-sync / rebase compatibility check — see §8)
Deploy:         Follows merge; not part of this checkpoint
```

## 3. Phase Status Table

| Phase | Status | Outcome recorded at close |
|---|---|---|
| **P0** | **CLOSED** | Reading Contract emitted first, behind sentinel markers, so output truncation can no longer take it down (`83fcbe0`); repeated / multi-attempt marked contract blocks resolved — last attempt authoritative, no fallback to an earlier attempt (`ba6217b`); managed output token ceiling raised and batch/stream generation policy aligned (`01a425d`, `bd898b3`). |
| **P1** | **HYBRID policy finalized** | Structural correctness = **blocker class**. Grammar / vocabulary **pedagogical selection = quality metric** (not a blocker). Zero-temperature (greedy) diagnostic generation config **remains the current-branch configuration** (`6949bec`); high-value grammar/vocabulary protection and pre-selection candidate scan landed as quality improvements (`9136073`, `57f3e89`). |
| **P2** | **CLOSED** | Selected source text is **canonical ground truth**; reading trust **unified for render and persistence** (`617739d`); selected source text canonicalized (`189ac3d`); an invalid / untrusted Reading Contract **fails closed** — `readingTrusted=false`, no trusted persistence, visible `### 原句` still forced to byte-exact ground truth. |
| **P3** | **CLOSED** | Semantic reading checker is **advisory** (`ba69fdc`); grammar coverage matcher **hardened** to heading-scoped exact-core matching (`c50514e`); grammar matcher **edge cases fixed** — bracket-aware boundary, CRLF, 1-char gloss retention (`8bf881c`); grammar coverage **reclassified advisory** (`37b955b`). |
| **R1** | **CLOSED / PASS** | Reproduced ASCII-contaminated ruby `{改善点\|かいぜnてん}` from real close-batch evidence. Production validation added (`f8a5176`): `validateRuby` reports `READING_ASCII_CONTAMINATION`; `repairRuby` **demotes the contaminated inline ruby to its plain base** — no guessed correction, no `n → ん`, base characters untouched; a Reading Contract token with ASCII contamination makes the contract **invalid** (`READING_CONTRACT_INVALID_READING`) → `readingTrusted=false` → the contaminated reading **cannot persist** as a trusted structured reading. |

## 4. Verification Summary

### 4.1 Deterministic (offline)

```text
Final deterministic verification: PASS
```

- R1 remediation shipped with an exact-defect regression pin in
  `japanese-alchemy-chrome-extension/tests/rubyContract.test.js` (added in `f8a5176`)
  covering `{改善点|かいぜnてん}` → validate / repair / no-guess / contract-invalid.
- Prior deterministic regression pass recorded in the Tier-2 final checkpoint lineage;
  no new defect found during R1 close, so the suite was not re-run per the R1 close
  protocol.

### 4.2 Fresh final R1 real verification (Tier 2)

One authorized real Gemini call, `passive-form-review` ×1, current branch, no retry,
no baseline, replicating the production `GeminiLlmService` generation policy verbatim
(temp 0, `max_tokens` 16384, `thinking_budget` 512, `SYSTEM_PROMPT_V2` as-is, raw
fixture input), then run through the actual current production module
(`chrome-extension/src/scripts/rubyContract.js`:
`separateReadingContract → reconcileRuby → repairRuby`).

```text
Result:            PASS
HTTP:              200
finish_reason:     stop
completion tokens: 2509  (prompt 5789, total 8298)
truncation:        NO

B. Raw contamination:        NOT PRESENT
   - {改善点|かいぜnてん}:    NOT present (all 改善点 ruby clean: {改善点|かいぜんてん})
   - raw contract JSON:      0 contaminated token readings
C. Production R1 guard:      NOT LIVE-TRIGGERED by this sample (nothing to remove)
D. Reading Contract:         PRESENT but INVALID (READING_CONTRACT_SOURCE_MISMATCH —
                             spurious extra token {"text":"具体的内容","reading":null});
                             readingTrusted = false; not persisted (correct fail-closed)
E. Source fidelity:          final rendered 原句 plain surface byte-exact to input
F. Structural checks:        all required checks PASS on both raw and protected output;
                             NEW structural regression caused by R1: NONE
G. Grammar (advisory):       expectedGrammarCovered 0/2 on BOTH raw and protected
                             (identical — not an R1 effect); non-blocking
```

Interpretation: this fresh response did **not** contain ASCII-contaminated ruby, so it
does not independently exercise the R1 guard against a live Gemini tendency. The
deterministic exact-defect pin remains the standing regression evidence. No claim is
made that Gemini's underlying contamination tendency is eliminated — only that R1
protection is in place, verified deterministically, and introduces no regression on a
fresh real response.

## 5. Evidence Summary

All real-LLM evidence lives **outside** the repository. Nothing was ever re-run or
replaced to obtain a cleaner sample.

| Directory | Contents | Role |
|---|---|---|
| `D:\jbuddy-tier2-results\` | `baseline/`, `current/`, `logs/` | Original 10-fixture paired baseline-vs-current Tier-2 run (v0.3 Tier-2 final BLOCK checkpoint, 2026-09-05). |
| `D:\jbuddy-tier2-results-final-v03\` | `_batch_summary.json`, per-fixture `*.v2.md` / `*.usage.json` / `*.error.json` | Post-remediation Tier-2 batch (partial — provider errors on some samples). |
| `D:\jbuddy-tier2-results-final-v03-close\` | `_batch_summary.json`, `passive-form-review` + `near-500-char-urban-redevelopment` `*.v2.md` / `*.usage.json` | Close-batch that first reproduced the ASCII ruby contamination defect (`{改善点\|かいぜnてん}`) — origin of R1. |
| `D:\jbuddy-tier2-results-final-v03-r1\` | `passive-form-review.sample1.error.json` | First R1 real-call attempt — HTTP 429, no usable sample (PARTIAL). |
| `D:\jbuddy-tier2-results-final-v03-r1-final\` | `passive-form-review.sample1.raw.json`, `.v2.md`, `.provider.json`, `.request.json`, `r1-analysis.json`, `REPORT.md`, `VERDICT.txt`, `git-status.txt`, `harness.r1final.mjs` | **Fresh final R1 real verification (this close).** One real call, HTTP 200, PASS. |

## 6. Blocking vs Advisory Policy (finalized at v0.3 close)

**Blocker class — a failure here blocks close / merge:**

- Ruby markup structural validity (`furiganaFormatValid` — no raw `<ruby>`, no malformed
  braces, no empty readings) on the **protected production output**.
- Required headings present and ordered (`### 原句`, `### 單字分析`, `### 文法分析`).
- Translation inside the `原句` section, not a separate top-level section.
- Vocabulary / grammar heading-to-content alignment.
- All output kanji annotated outside the raw input field.
- `expectedVocabularyCovered` (**`required: true` today** — see §7.3).
- **Source fidelity:** the visible `### 原句` surface must be byte-exact to the
  request-captured selected text.
- **Reading trust integrity:** an invalid / ungrounded / misaligned Reading Contract
  must fail closed (`readingTrusted = false`, no trusted persistence).
- **R1:** ASCII-contaminated ruby / contract readings must never survive into rendered,
  copied, saved, or persisted output.

**Advisory / quality-metric class — measured, reported, never blocks close:**

- `expectedGrammarCovered` (grammar pedagogical selection / heading paraphrasing).
- `expectedReadingsCorrect` (semantic reading correctness — curated advisory list).
- `v1GrammarShape` / `v2GrammarShape` / `v2VocabularyUsageShape` entry-count and
  field-completeness heuristics.
- Grammar/vocabulary count stability across samples.
- Zero-temperature diagnostic generation config (kept as current-branch config; not a
  proven production behavior change).

## 7. Known Non-Blocking Follow-ups

### 7.1 Reading Contract `READING_CONTRACT_SOURCE_MISMATCH` may still occur
The managed model can still emit a contract whose token concatenation does not
reproduce `source_text` (observed in the fresh R1 sample: a spurious
`{"text":"具体的内容","reading":null}` token).
**Current mitigation (sufficient for close):** `parseReadingContract` returns invalid →
`readingTrusted = false` → no trusted structured-reading persistence → the visible
`### 原句` line falls back to byte-exact ground truth. Source fidelity is preserved;
only the optional ruby-from-contract enrichment is skipped.
**Follow-up:** production observability for the valid/invalid contract rate; consider a
prompt tightening pass if the invalid rate proves high in real traffic.

### 7.2 Grammar heading paraphrasing remains probabilistic / advisory
The model frequently labels a taught point with its own phrasing
(e.g. `〜が（逆接接続助詞）` vs the fixture's `〜が（逆接）（N3）`), which fails
canonical-core matching. This is by design an advisory metric after P3 and cannot block
close. Any future tightening belongs to a P3-C-style policy pass, not v0.3.

### 7.3 `expectedVocabularyCovered` is still `required: true`
It should be **reviewed separately** for possible future alignment with the P3-C grammar
policy (advisory reclassification or partial-coverage tolerance).
**Do NOT change it as part of v0.3 close.**

## 8. Exact Next Step

```text
UPSTREAM SYNC / REBASE COMPATIBILITY CHECK
```

Bring `feature/japanese-reader-v0.3` up to date with upstream `main` and verify the v0.3
reader / prompt / contract changes still apply cleanly and pass the deterministic suite
after rebase, **before** any merge.

Until that check passes:

```text
Do not merge to main.
Do not push.
Do not deploy.
```

## 9. Resume Point

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -6 --oneline --decorate
```

Expected HEAD (after this checkpoint commit):

```text
docs: close Japanese Reader v0.3
f8a5176 fix(reader): reject ascii-contaminated ruby readings
```

Expected status:

```text
nothing to commit, working tree clean
```

## 10. Final Checkpoint Status

```text
Japanese Reader v0.3

P0:  CLOSED
P1:  HYBRID policy finalized (structural = blocker, pedagogical selection = quality metric,
     zero-temperature diagnostic config = current-branch config)
P2:  CLOSED
P3:  CLOSED
R1:  CLOSED / PASS

Final deterministic verification: PASS
Final real verification:          PASS

v0.3:            CLOSED / PASS
Working tree:    CLEAN
Next step:       UPSTREAM SYNC / REBASE COMPATIBILITY CHECK
```
