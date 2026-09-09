# Japanese Reader v0.3 — Tier 2 Partial Checkpoint

**Date:** 2026-09-04  
**Branch:** `feature/japanese-reader-v0.3`

## Current Git State

```text
HEAD: 9c55938 test(prompt): fix Tier 2 response extraction
Working tree: clean
```

## Tier 2 Harness Fix

A real Tier-2 harness bug was fixed:

```text
res.data
→
res.response.data
```

Commit:

```text
9c55938 test(prompt): fix Tier 2 response extraction
```

A real Gemini smoke test confirmed a non-empty response through the corrected path.

## Managed Provider

```text
Provider: gemini
Model: gemini-3.6-flash
```

Local `secrets.json` is gitignored and must not be committed.

## Tier 2 Status

```text
INCOMPLETE DUE TO RATE LIMIT
```

Gemini free-tier quota was exhausted:

```text
GenerateRequestsPerDayPerProjectPerModel-FreeTier
limit: 20
model: gemini-3.6-flash
```

Completed real samples:

```text
Current:  2 / 10
Baseline: 0 / 10
```

Therefore no fair baseline/current regression conclusion is possible yet.

## Current Real Samples

### causative-form-parent
- Required checks: 8/9 PASS
- Grammar entries: 2
- Collocation section: present
- Register section: （無）
- Forced JLPT labels: absent
- Pitch-accent field: absent
- Reading Contract: valid

Note: `expectedVocabularyCovered` failed because the model analyzed conjugated surface forms while the fixture matches dictionary forms literally.

### keigo-honorific-visit
- Required checks: 8/9 PASS
- Grammar entries: 2
- Collocation section: present
- Register section: present
- Forced JLPT labels: absent
- Pitch-accent field: absent
- Reading Contract: valid

Note: `grammarHeadingMatchesContent` failed on a template-style heading such as `お＋動詞連用形＋になる`.

Classification note: `ご〜いただく` was placed under Collocation rather than Grammar. This is worth later taxonomy review, but cannot yet be called a regression without baseline output.

## Reading Contract — Real Observation

For both successful current samples:

```text
Final json fence present:            PASS
Fence final non-whitespace content:  PASS
JSON parse:                          PASS
reading_contract_version === 1:      PASS
source_text exact match:             PASS
tokens non-empty:                    PASS
every token.text non-empty:          PASS
concat(tokens.text) === source_text: PASS
reading kana or null:                PASS
no empty-string reading:             PASS
```

Observed:

```text
2 / 2 Reading Contracts valid
```

No contextual date reading was exercised in these two samples.

## Partial Token Usage

```text
causative-form-parent
prompt_tokens:     5066
completion_tokens: 2136
total_tokens:      9420

keigo-honorific-visit
prompt_tokens:     5064
completion_tokens: 2153
total_tokens:      10126
```

No baseline token data exists yet, so no valid percentage comparison can be made.

## Gate

```text
Tier 1: PASS
Tier 2: PARTIAL / INCOMPLETE

Merge to main: BLOCKED
Deploy:        BLOCKED
```

## Resume Strategy

Do not rerun all 20 calls in one shot.

Use resumable batches:

```text
Batch A: Baseline 2 + Current 2
Batch B: Baseline 2 + Current 2
...
```

Persist after each successful fixture:
- raw response
- required-check results
- grammar count
- collocation/register observations
- Reading Contract validation
- usage metadata

This avoids losing completed work if quota is exhausted again.

## Follow-up Candidates

Do not change these yet based on partial Tier 2 alone:

1. `expectedVocabularyCovered`
   - may need conjugation-aware matching

2. `grammarHeadingMatchesContent`
   - may need to tolerate template-style headings

3. Grammar vs Collocation boundary
   - especially `ご〜いただく`

## Resume Point

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -5 --oneline --decorate
```

Expected HEAD:

```text
9c55938 test(prompt): fix Tier 2 response extraction
```

Expected status:

```text
nothing to commit, working tree clean
```

## Final Checkpoint

```text
Japanese Reader v0.3

Tier 1: PASS
Tier 2: INCOMPLETE DUE TO QUOTA

Provider: gemini
Model: gemini-3.6-flash

Current real samples:  2 / 10
Baseline real samples: 0 / 10
Reading Contract validity observed: 2 / 2 PASS

Merge:  BLOCKED
Deploy: BLOCKED
Working tree: CLEAN
```
