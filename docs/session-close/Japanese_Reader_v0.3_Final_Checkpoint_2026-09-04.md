# Japanese Reader v0.3 — Final Checkpoint

**Date:** 2026-09-04  
**Project:** J-Buddy → Language Agent / Japanese Reader  
**Branch:** `feature/japanese-reader-v0.3`

## 1. Final Git State

```text
HEAD: ca55fb8 feat(prompt): add managed reading contract
Branch: feature/japanese-reader-v0.3
Working tree: clean
```

Recent commits:

```text
ca55fb8 feat(prompt): add managed reading contract
d0f7d09 docs: add Japanese Reader v0.3 phase 2B checkpoint
4f3c229 feat(prompt): remove grammar quota and JLPT forcing
e42b0ad test(prompt): allow zero grammar and unlabeled headings
c8bb330 feat(prompt): converge managed taxonomy sections
fa44604 docs: add Japanese Reader v0.3 phase 1 and 2A session close
840e18f feat(reader): persist collocation and register taxonomy
48ada3f feat(reader): persist grounded reading tokens
```

Relative to `main`:

```text
12 files changed
1518 insertions(+)
28 deletions(-)
```

## 2. v0.3 Completed Scope

### Phase 1 — Grounded Reading Tokens
Commit:
```text
48ada3f feat(reader): persist grounded reading tokens
```

### Phase 2A — Collocation / Register Taxonomy
Commit:
```text
840e18f feat(reader): persist collocation and register taxonomy
```

### Phase 2B-1 — Managed Taxonomy Convergence
Commit:
```text
c8bb330 feat(prompt): converge managed taxonomy sections
```

### Phase 2B-2a — Tier-1 Contract Migration
Commit:
```text
e42b0ad test(prompt): allow zero grammar and unlabeled headings
```

### Phase 2B-2b — Managed Grammar Contract Switch
Commit:
```text
4f3c229 feat(prompt): remove grammar quota and JLPT forcing
```

### Phase 2C-1 — Managed Reading Contract
Commit:
```text
ca55fb8 feat(prompt): add managed reading contract
```

## 3. Current Structured Data Shape

```json
{
  "words": [],
  "grammars": [],
  "collocations": [{ "text": "..." }],
  "registers": [{ "text": "..." }],
  "reading": {
    "version": 1,
    "source_text": "...",
    "tokens": [{ "text": "...", "reading": "..." }]
  }
}
```

## 4. Verification Status

### Hosting / Prompt Tier 1
Managed prompt unit tests:
```text
48 / 48 PASS
```

Prompt evaluation:
```text
26 / 27 PASS
```

Full default hosting suite:
```text
193 / 194 PASS
```

The only remaining failure is the known pre-existing V1 CRLF / parenthetical-normalization issue in `grammarHeadingMatchesContent`.

No new regression was introduced by Phase 2C.

### Tier 2 — Real Managed LLM
```text
NOT RUN
```

Reason:
- `japanese-alchemy-hosting/functions/secrets.json` absent
- `PROMPT_QUALITY_TEST` not enabled
- managed-provider API credentials unavailable

No simulated or fabricated Tier-2 results were used.

## 5. Merge / Deploy Gate

```text
Tier 1: PASS
Tier 2: NOT RUN

Merge to main: BLOCKED
Deploy:        BLOCKED
```

Reason:
Phase 2B/2C change actual managed-model behavior and add a machine-readable Reading Contract. Tier 1 proves static contract consistency and client fail-safety, but cannot prove real-model reliability, contextual-reading accuracy, or token-budget sufficiency.

## 6. Tier 2 Unblock Procedure

Create local-only:
```text
D:\J-Buddy-Dev\j-buddy\japanese-alchemy-hosting\functions\secrets.json
```

based on `secrets.example`.

Do not commit it.

Recommended comparison:
```text
Baseline: c8bb330
Current:  ca55fb8
```

Check:
- required-check pass rate
- grammar counts
- expected grammar retention
- collocation/register classification
- vocabulary relevance
- absence of JLPT forcing
- absence of pitch accent
- Reading Contract fence presence
- contract parse success rate
- source_text exactness
- token-concat fidelity
- contextual date accuracy
- output-token usage if exposed

## 7. Known Deferred / Follow-up

- V1 CRLF check bug in `grammarHeadingMatchesContent`
- Production observability for valid/invalid contract rate
- Future taxonomy versioning when a real learner UI exists

## 8. Resume Point

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -8 --oneline --decorate
```

Expected HEAD:
```text
ca55fb8 feat(prompt): add managed reading contract
```

Expected status:
```text
nothing to commit, working tree clean
```

Next priority:
```text
Tier 2 managed prompt quality validation
```

Until then:
```text
Do not merge to main.
Do not deploy managed prompt.
```

## 9. Final Checkpoint Status

```text
Japanese Reader v0.3

Phase 1:   COMPLETED / COMMITTED
Phase 2A:  COMPLETED / COMMITTED
Phase 2B:  COMPLETED / COMMITTED
Phase 2C1: COMPLETED / COMMITTED

Tier 1: PASS
Tier 2: NOT RUN — credentials unavailable

Merge to main: BLOCKED
Deploy:        BLOCKED
Working tree:  CLEAN
```
