# Japanese Reader v0.3 — Tier 2 Durable Recovery Checkpoint

**Date:** 2026-09-04  
**Branch:** `feature/japanese-reader-v0.3`

## Current Git State

```text
HEAD: db3b290 docs: add Japanese Reader v0.3 Tier 2 partial checkpoint
Working tree: clean
```

## Why this checkpoint exists

The original resumable Tier-2 results under `%TEMP%` were wiped by OS temp cleanup between sessions.

Old location:

```text
%TEMP%\jbuddy-tier2-results\
```

A durable replacement was created outside the repository:

```text
D:\jbuddy-tier2-results\
├─ baseline\
├─ current\
└─ logs\
```

Future Tier-2 work must use this durable location, not `%TEMP%`.

## Recovery work

To rebuild the lost dataset before continuing:
- 7 redo calls were attempted.
- 6 succeeded.
- 1 failed with HTTP 503.
- No 429 occurred during recovery.
- No tracked repository files were modified.
- No commit was made.

Failed recovery call:

```text
baseline / conditionals-to-ba-tara-nara → HTTP 503
```

Because the old copy was already lost, this fixture currently needs both sides rebuilt.

## Durable dataset status

### Paired complete — 3/10

1. `three-char-selection-ame-nara`
   - Baseline complete
   - Current complete

2. `causative-form-parent`
   - Baseline complete
   - Current complete

3. `causative-passive-overtime`
   - Baseline complete
   - Current complete

### Partial

`keigo-honorific-visit`

```text
Baseline: complete
Current: pending
```

### Rebuild required

`conditionals-to-ba-tara-nara`

```text
Baseline: pending
Current: pending
```

### Untouched

```text
homograph-sei-shou-nama-ue
katakana-loanwords-remote-meeting
mixed-n1-n2-n3-grammar
near-500-char-urban-redevelopment
passive-form-review
```

## Step 6 fresh paired result — causative-passive-overtime

```text
Baseline API: PASS
Current API:  PASS

Baseline required checks: 8/8 PASS
Current required checks:  8/8 PASS

Grammar count:
Baseline 2
Current  2
```

Both retained:
- causative-passive conjugation
- `〜かける`

A literal machine-check mismatch remains because baseline/current used different Japanese terminology for the same causative-passive concept; this is terminology brittleness rather than a comprehension gap.

## Classification

Collocation:

```text
Baseline: 1
Current:  1
```

Both correctly classified:

```text
体調を崩す
```

Register:

```text
Baseline: 1
Current:  1
```

Both correctly identified continuative-form linkage in the source sentence.

## JLPT / pitch

Baseline:
- JLPT labels present, as expected for the old prompt.

Current:
- no forced JLPT labels
- no `重音` field

Both match the intended baseline/current distinction.

## Inline ruby and Reading Contract

Current inline ruby:

```text
VALID
```

Current Reading Contract:

```text
VALID
```

Observed checks:

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

Ruby ↔ Reading Contract agreement:

```text
PASS
```

## Cross-version ruby observation

Earlier real Tier-2 samples showed malformed inline ruby on both baseline and current at different times.

Current interpretation:

```text
Malformed inline ruby
→ cross-version LLM sampling issue so far

Reading Contract
→ no comparable structural corruption observed in successful current samples
```

Do not overwrite real malformed-ruby samples simply to obtain cleaner results.

## Token comparison — Step 6

```text
Baseline:
completion_tokens: 2107
prompt_tokens:     3643
total_tokens:      8715

Current:
completion_tokens: 2350
prompt_tokens:     5072
total_tokens:      9978
```

Delta:

```text
Prompt:     +39.2%
Completion: +11.5%
Total:      +14.5%
```

Prompt growth is expected from Phase 2B/2C system-prompt expansion. Total growth remains below the earlier 15% unexplained-increase review threshold and has an identified cause.

## API / quota state

Observed total API attempts today reached approximately:

```text
20
```

Previously-observed free-tier quota:

```text
GenerateRequestsPerDayPerProjectPerModel-FreeTier
limit: 20
model: gemini-3.6-flash
```

No further Tier-2 API calls should be made in this session.

HTTP 503 responses observed during the day are transient Gemini capacity/high-demand errors and must not be treated as prompt-quality failures.

## Current gate

```text
Tier 1: PASS

Tier 2:
3/10 paired complete
durable recovery completed
INCOMPLETE

Merge to main: BLOCKED
Deploy:        BLOCKED
```

## Resume priority after next quota reset

Use only:

```text
D:\jbuddy-tier2-results\
```

Resume in this order:

1. `keigo-honorific-visit`
   - Current only

2. `conditionals-to-ba-tara-nara`
   - Baseline
   - Current

3. Remaining untouched:
   - `homograph-sei-shou-nama-ue`
   - `katakana-loanwords-remote-meeting`
   - `mixed-n1-n2-n3-grammar`
   - `near-500-char-urban-redevelopment`
   - `passive-form-review`

Persist every successful call immediately:
- raw response
- usage JSON
- check summary
- logs

## Resume commands

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -5 --oneline --decorate
Get-ChildItem D:\jbuddy-tier2-results
```

Expected:

```text
HEAD: db3b290
working tree clean
```

Durable folders:

```text
baseline
current
logs
```

## Final checkpoint

```text
Japanese Reader v0.3

Tier 1: PASS
Tier 2: INCOMPLETE

Paired complete: 3/10

Durable results:
D:\jbuddy-tier2-results\

Partial:
- keigo-honorific-visit
  baseline done / current pending

Rebuild required:
- conditionals-to-ba-tara-nara
  baseline pending / current pending

Merge:  BLOCKED
Deploy: BLOCKED

Branch:
feature/japanese-reader-v0.3

HEAD:
db3b290

Working tree:
CLEAN
```
