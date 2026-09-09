# Japanese Reader v0.3 — Phase 2B Checkpoint

**Date:** 2026-09-04
**Branch:** `feature/japanese-reader-v0.3`

## Final Git State

```text
HEAD: 4f3c229 feat(prompt): remove grammar quota and JLPT forcing
Working tree: clean
```

Recent commits:

```text
4f3c229 feat(prompt): remove grammar quota and JLPT forcing
e42b0ad test(prompt): allow zero grammar and unlabeled headings
c8bb330 feat(prompt): converge managed taxonomy sections
fa44604 docs: add Japanese Reader v0.3 phase 1 and 2A session close
840e18f feat(reader): persist collocation and register taxonomy
48ada3f feat(reader): persist grounded reading tokens
```

Relative to `main`:

```text
11 files changed
1155 insertions(+)
28 deletions(-)
```

## Phase 2B Status

### 2B-1 — Managed taxonomy convergence
**COMPLETED / COMMITTED**

- Added `### 搭配分析`
- Added `### 語體／新聞表現`
- Added basic-particle carve-out
- Added grounding rule
- Added correct 連用中止 guidance
- Removed pitch-accent output requirement
- Reading contract remained out of scope

### 2B-2a — Tier-1 checks migration
**COMPLETED / COMMITTED**

- `grammarHeadingMatchesContent` no longer requires JLPT labels
- V2 grammar minimum changed to 0
- V1 grammar minimum remains 1
- empty `expectedGrammar` now vacuously passes
- removed `(N3)` from the two V2 gold grammar headings
- fixture JSON files unchanged

### 2B-2b — Managed grammar contract switch
**COMPLETED / COMMITTED**

- Grammar count `1〜5` → `0〜5`
- Explicitly allows 0 grammar points
- Explicitly forbids quota-filling
- Removed forced JLPT grammar labels
- Removed vocabulary N1/N2/N3 chasing
- Replaced band-based vocab selection with learner-value selection
- Preserved Phase 2B-1 rules
- Reading contract still not added

## Verification

Targeted managed prompt tests:

```text
39 / 39 PASS
```

Full default hosting suite:

```text
184 / 185 PASS
```

The only remaining failure is the known pre-existing V1 CRLF / parenthetical-normalization issue in `grammarHeadingMatchesContent`.

No new regression was introduced by Phase 2B.

## Tier 2 — Real Managed LLM

```text
NOT RUN
```

Reason:

- `japanese-alchemy-hosting/functions/secrets.json` is absent
- `PROMPT_QUALITY_TEST` is not enabled
- managed-provider API credentials are unavailable in the current environment

No simulation or fabricated Tier-2 results were used.

## Merge / Deploy Gate

```text
DO NOT merge to main yet
DO NOT deploy managed prompt yet
```

Reason: Phase 2B changes actual managed-model behavior and Tier 2 has not run.

## Tier 2 Unblock

Create a local-only, gitignored:

```text
D:\J-Buddy-Dev\j-buddy\japanese-alchemy-hosting\functions\secrets.json
```

based on `secrets.example`.

Then compare the same model/provider/fixtures between:

```text
Baseline: c8bb330
Current:  4f3c229
```

Check:
- required-check pass rate
- grammar entry counts
- expected grammar retention
- collocation/register classification
- vocabulary relevance
- absence of JLPT forcing
- absence of pitch accent
- token usage if exposed by the harness

Rollback/hold if:
- any fixture loses a previously passing required check
- any genuine-grammar fixture unexpectedly returns 0 grammar
- expected grammar disappears
- classification materially worsens
- malformed output appears
- output token use rises >15% without justification

## Deferred

### Managed Reading Contract
Deferred to a separate phase because it is independently testable and should have its own fixtures / Tier-2 validation.

### Known V1 CRLF bug
Pre-existing issue in `grammarHeadingMatchesContent`; out of scope for Phase 2B.

## Resume Point

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -6 --oneline --decorate
```

Expected HEAD:

```text
4f3c229 feat(prompt): remove grammar quota and JLPT forcing
```

## Checkpoint

```text
2B-1:  COMPLETED / COMMITTED
2B-2a: COMPLETED / COMMITTED
2B-2b: COMPLETED / COMMITTED

Tier 1: PASS (no new regression)
Tier 2: NOT RUN — credentials unavailable

Merge to main: BLOCKED pending Tier 2
Deploy:        BLOCKED pending Tier 2
Working tree:  CLEAN
```
