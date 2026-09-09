# Japanese Reader v0.3 — Integration Close (CLOSED / PASS / INTEGRATED / PUSHED)

**Date:** 2026-09-09
**Project:** J-Buddy → Language Agent / Japanese Reader
**Branch:** `main`

This document records the completion of the "UPSTREAM SYNC / REBASE COMPATIBILITY
CHECK" step named as the exact next step in
[`Japanese_Reader_v0.3_Close_Checkpoint_2026-09-09.md`](./Japanese_Reader_v0.3_Close_Checkpoint_2026-09-09.md).
The v0.3 feature line is now integrated onto the upstream-synced fork `main` and
published to `origin`.

## 1. Final Git State

SHAs below are the integration state this document checkpoints — i.e. `main` /
`origin/main` **before** this documentation commit is added on top.

```text
main            39c92f9  Merge branch 'feature/japanese-reader-v0.3' into chore/upstream-sync-2026-09
origin/main     39c92f9  (fast-forwarded from a54e7ed; normal fast-forward, no force)
Working tree    clean

feature/japanese-reader-v0.3   bb0b7f5  frozen / preserved / local only (never pushed, never rewritten)
chore/upstream-sync-2026-09    39c92f9  integration branch, local only, retained
upstream/main                  6a4cfd8  chore: bump v1.4.1  (NOT pushed to; no PR opened)
```

First-parent history of the integration:

```text
39c92f9  Merge branch 'feature/japanese-reader-v0.3' into chore/upstream-sync-2026-09   (Phase 2)
e494c72  Merge remote-tracking branch 'upstream/main' into chore/upstream-sync-2026-09  (Phase 1)
a54e7ed  docs: add Japanese Reader v0.2 session close                                   (previous origin/main)
```

All 28 v0.3 commits and every v0.3 checkpoint SHA (`bb0b7f5`, `f8a5176`, `37b955b`,
`8bf881c`, `c50514e`, `ba69fdc`, `617739d`, …) are preserved verbatim as the
second-parent lineage of `39c92f9`. No rebase, no squash, no cherry-pick, no SHA
rewrite.

## 2. Final Status

```text
Japanese Reader v0.3:   CLOSED / PASS / INTEGRATED / PUSHED
Upstream sync:           upstream v1.4.1 (6a4cfd8) integrated into fork main
R1:                      CLOSED / PASS

Merge to fork main:      DONE (fast-forward a54e7ed → 39c92f9)
Push to origin:          DONE (fast-forward, no force)
Push to upstream:        NOT performed
Upstream PR:             NOT opened
Deploy:                  NOT performed
```

## 3. Integration Workstream (this session)

| Step | Branch / commit | Outcome |
|---|---|---|
| **Audit** — upstream sync / rebase compatibility | (read-only + `git fetch`) | Fork point `a353385` still in `upstream/main`. Only 5 overlapping files, all in the retired personal/custom LLM-provider zone; v0.3 core (hosting, `rubyContract.js`, webapp types) had zero upstream overlap. Chose **Option 4** — freeze feature, sync `main` from upstream first, merge feature later. |
| **Phase 1** — isolated main sync | `chore/upstream-sync-2026-09` @ **`e494c72`** (merge `a54e7ed` + `6a4cfd8`) | 5 conflicts resolved per policy: `directAnalysisContract.js` (+ test), `sidepanel.personalProviderBehavior.test.js` **removed** (pure personal-provider); `sidepanel.js` — took upstream's personal-provider removal, kept the fork's 3 Reader-pipeline hunks; `sidepanel.analysisModeBehavior.test.js` — took upstream's analysis-mode block + kept the fork's Reader describe blocks. Extension: **283/283 tests, build PASS**. Hosting had 2 pre-existing golden-dataset failures (`grammarHeadingMatchesContent`, unrelated to the sync). |
| **Phase 2** — merge frozen feature | `chore/upstream-sync-2026-09` @ **`39c92f9`** (merge `e494c72` + `bb0b7f5`) | **Zero conflicts** (`git merge-tree` predicted none; `git merge --no-ff` clean via ort). The Phase-1 resolution left the Reader region byte-identical to the fork point, so v0.3's Reader evolution applied uncontested and the personal-provider block stayed deleted. |
| **Fast-forward** | `main`: `a54e7ed` → **`39c92f9`** | `git merge --ff-only chore/upstream-sync-2026-09` — no new merge commit. |
| **Push** | `origin/main`: `a54e7ed` → **`39c92f9`** | `git push origin main` → `a54e7ed..39c92f9  main -> main` (fast-forward, no `--force` / `--force-with-lease`). Push targeted `Alee3177/j-buddy` only. |

## 4. Final Integration Validation (tree at `39c92f9`)

### 4.1 Extension (`japanese-alchemy-chrome-extension`)

```text
npm ci    → exit 0
npm test  → Test Suites: 14 passed, 14 total
            Tests:       378 passed, 378 total          exit 0
npm run build (webpack --mode production) → compiled successfully, exit 0
            sidepanel.bundle.js emitted — no errors, no warnings
```

- `rubyContract.test.js`: **179/179 pass** (R1 pins).
- `sidepanel.analysisModeBehavior.test.js`: pass — 7 describe blocks (upstream analysis-mode +
  Phase 1B + Phase 2B-1 + Phase 2B-2 + v0.3 Phase 1 persisted tokens + P2-B `readingTrusted` +
  v0.3 Phase 2A taxonomy).
- `onDone()` pipeline order preserved:
  `separateReadingContract → reconcileRuby → (persistedReading = readingTrusted ? … : null) →
  repairRuby → enrichMarkdownWithConjugation → format/render`.
- No stale provider imports; no missing-module build errors.

### 4.2 Hosting (`japanese-alchemy-hosting/functions`)

```text
npm ci  → exit 0
npx jest (ephemeral jest/ts-jest via --no-save --no-package-lock; package.json / lock UNCHANGED)
        → Test Suites: 19 passed, 19 total
          Tests:       257 passed, 257 total            exit 0
```

- `test/prompts/promptEvaluation.test.ts` → **PASS**. The 2 pre-existing golden-dataset
  failures observed on the Phase-1 branch (`v1-response` / `v2-response` "passes every required
  check", `grammarHeadingMatchesContent → heading "前に（N3）" not reflected`) are **eliminated**
  by v0.3's `checks.ts` P3 hardening + the `v2-response.md` fixture fix.
- New v0.3 suites pass: `expectedGrammarCovered`, `expectedReadingsCorrect`,
  `grammarCoverageAdvisoryPolicy`.
- `npx tsc --noEmit`: 50 parse errors, **all in `node_modules/@types/node/ffi.d.ts`**, none in
  project code (see §5.2). Does not affect ts-jest.

### 4.3 Policy regression pins — all PASS

| Pin | Result |
|---|---|
| `expectedGrammarCovered` advisory (`required: false`, never lowers `requiredPassRate`) | PASS |
| `expectedReadingsCorrect` advisory (`required: false`) | PASS |
| Grammar matcher P3-B / P3-B.1 (bracket-aware boundary, `「…」`-nested `（…）`, 1-char gloss retention, が（逆接）≠が（主格）) | PASS |
| Conditionals aliases — 〜と（恆常條件）→ 〜と（N3）, 〜ば（假定條件）→ 〜ば | PASS |
| Homograph / passive checker pins (passive 1/2, homograph current 1/2, homograph baseline 2/2) | PASS |
| R1 ASCII contamination pins (`{改善点\|かいぜnてん}` validate / repair-to-plain-base / no-guess / contract-invalid / fail-closed) | PASS |
| Source fidelity + `readingTrusted` (byte-exact through reconcile+repair; `readingTrusted=false` for every unsafe case) | PASS |

### 4.4 Personal / custom LLM-provider retirement — preserved

`git grep` over `src/` + `tests/` for `directLlmApiService | personalProvider | modelCatalog |
directAnalysisContract | PERSONAL_PROVIDER_MODE`:

- Only matches are upstream's own `retirePersonalProvider.js` migration shim + its
  `background.js` invocation + a `not.toContain('personalProvider')` assertion + two Reader-test
  descriptions that use "personal-provider style" to name a Markdown *shape* (no retired runtime
  touched).
- All 8 deleted provider files confirmed absent. `sidepanel.js` has no provider code.
- **No retired provider code was reintroduced by merging the feature.**

## 5. Known Non-Blocking Follow-ups

### 5.1 `functions/package.json` test-environment hygiene
`jest`, `ts-jest`, `@types/jest` are absent from `devDependencies` (identically on `main`,
`feature`, and `upstream/main` — not introduced or fixable in the integration). The
deterministic hosting suite required a non-persisted install to run in this environment.
**Follow-up:** add the three dev-dependencies (and pin them) so `npm ci && npm test` works
out of the box.

### 5.2 TypeScript / `@types/node` compatibility debt
Pinned `typescript@4.9.5` cannot parse the `@types/node` `ffi.d.ts` that `npm ci` currently
resolves — `tsc --noEmit` reports 50 errors, **all in that third-party `.d.ts`, zero in project
code**. ts-jest (per-file transpile) is unaffected.
**Follow-up:** pin `@types/node` to a 4.9-compatible line, or raise `typescript`.

### 5.3 `expectedVocabularyCovered` policy
Still `required: true`. Review separately whether it should align with the grammar-coverage
advisory policy (advisory reclassification or partial-coverage tolerance). **Not** part of v0.3
or this integration.

### 5.4 Reading Contract `READING_CONTRACT_SOURCE_MISMATCH`
Occasional managed-model defect (contract token concatenation ≠ `source_text`). Currently
**safely fail-closed**: invalid contract → `readingTrusted = false` → no trusted persistence →
visible `### 原句` falls back to byte-exact ground truth. Source fidelity preserved; only the
optional ruby-from-contract enrichment is skipped.
**Follow-up:** production observability for the valid/invalid contract rate; prompt tightening
if the rate proves high.

### 5.5 Selective upstream PR review
Decide later which *generic* Japanese Reader improvements (ruby contract validator, reading
trust, checker hardening) are appropriate to propose back to `xfalcons/j-buddy`. The v0.3
commits are preserved unrewritten and individually cherry-pickable for this purpose.
**Do NOT open any PR automatically.**

## 6. Next Product-Development Step

```text
Japanese Reader v0.4 planning
Expected focus: Learning DB + personal memory / review loop
```

## 7. Resume Point

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout main
git status
git log -5 --oneline --decorate
```

Expected (this checkpoint doc adds one commit on top of the integration merge):

```text
main HEAD                    "docs: close Japanese Reader v0.3 integration"
main^ (integration merge)    39c92f9   (== origin/main until this docs commit is pushed)
feature/japanese-reader-v0.3 bb0b7f5   (frozen, local only)
chore/upstream-sync-2026-09  39c92f9   (local only)
working tree clean
```

## 8. Final Checkpoint Status

```text
Japanese Reader v0.3

P0:  CLOSED
P1:  HYBRID policy finalized
P2:  CLOSED
P3:  CLOSED
R1:  CLOSED / PASS

v0.3:                 CLOSED / PASS / INTEGRATED / PUSHED
Upstream v1.4.1:      INTEGRATED into fork main
Extension:            378/378 PASS, build PASS
Hosting deterministic: 257/257 PASS
Policy / R1 pins:     PASS
Provider retirement:  PRESERVED

Integration merge: 39c92f9   (== origin/main; local main adds this docs commit on top, unpushed)
feature branch:    bb0b7f5   (frozen / preserved / local only)
Working tree:      CLEAN

No force push. No upstream push. No upstream PR. No deploy.

Next step:       Japanese Reader v0.4 planning
                 (Learning DB + personal memory / review loop)
```
