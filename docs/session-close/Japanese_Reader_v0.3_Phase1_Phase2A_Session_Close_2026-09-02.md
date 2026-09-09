# Session Close — Japanese Reader v0.3 Phase 1 + Phase 2A

**Date:** 2026-09-02  
**Project:** J-Buddy → Language Agent / Japanese Reader  
**Branch:** `feature/japanese-reader-v0.3`

## 1. Session Outcome

今天完成 Japanese Reader v0.3 的兩個階段。

### Phase 1 — Persist Grounded Reading Tokens

Commit:

```text
48ada3f feat(reader): persist grounded reading tokens
```

完成：
- 新增 `structured_json.reading`
- browser selected text 作為 grounding truth
- exact match gate，無 trim / NFKC / width / whitespace normalization
- reading contract 不進 UI / Copy / Save-As / rendered_markdown
- cache restore 可保留 valid reading，malformed reading fail-closed
- hosting / webapp type mirror
- hosting persistence 維持 wholesale copy

### Phase 2A — Persist Collocation / Register Taxonomy

Commit:

```text
840e18f feat(reader): persist collocation and register taxonomy
```

完成：
- 保留既有 `words` / `grammars`
- additive 新增 `collocations?: [{ text }]`
- additive 新增 `registers?: [{ text }]`
- parser 支援 `### 搭配分析`
- parser 支援 `### 語體／新聞表現`
- heading absent → key absent
- section present but `（無）` / no valid bullets → `[]`
- inline Ruby 保留
- malformed cached taxonomy fail-closed
- old cache / old Firestore pages / old extension output backward-compatible
- hosting persistence implementation 不變
- managed-provider prompt 尚未修改

## 2. Final Git State

Current branch:

```text
feature/japanese-reader-v0.3
```

Final HEAD:

```text
840e18f feat(reader): persist collocation and register taxonomy
```

Recent commits:

```text
840e18f feat(reader): persist collocation and register taxonomy
48ada3f feat(reader): persist grounded reading tokens
a54e7ed docs: add Japanese Reader v0.2 session close
```

Working tree:

```text
nothing to commit, working tree clean
```

Important:
- v0.3 branch 尚未 merge 到 `main`
- v0.3 branch 本次尚未 push
- `main` 維持 v0.2 session-close baseline

## 3. Verification

Extension targeted:

```text
tests/formatAnalysisResult.test.js
31 / 31 PASS

tests/sidepanel.analysisModeBehavior.test.js
59 / 59 PASS
```

Full extension regression:

```text
Test Suites: 17 passed, 17 total
Tests:       461 passed, 461 total
```

Hosting:

```text
test/services/firestoreService.test.ts
13 / 13 PASS
```

Build:

```text
webpack compiled successfully with 3 existing warnings
```

Diff hygiene:

```text
git diff --check
clean
```

## 4. Current Structured Schema

```json
{
  "words": [],
  "grammars": [],
  "collocations": [
    { "text": "..." }
  ],
  "registers": [
    { "text": "..." }
  ],
  "reading": {
    "version": 1,
    "source_text": "...",
    "tokens": []
  }
}
```

## 5. Important Finding — Prompt Contract Divergence

Personal Provider prompt already includes：
- 原句
- 漢字提取
- 單字分析
- 文法分析
- 搭配分析
- 語體／新聞表現
- reading contract
- anti-quota rules
- basic-particle carve-out
- no pitch accent / fake JLPT requirements

Managed Provider hosting prompt still uses older contract：
- 原句
- 單字分析
- 文法分析
- no 搭配分析
- no 語體／新聞表現
- no reading contract
- grammar quota pressure remains
- still requests older JLPT / pitch-related metadata

Consequence：
managed path remains susceptible to collocation-as-grammar, headline/register-as-grammar, and basic-particle-as-grammar.

## 6. Deferred — Next Session

### Phase 2B — Managed Provider Prompt Convergence

Next priority:
- converge hosting `SYSTEM_PROMPT_V2`
- add `### 搭配分析`
- add `### 語體／新聞表現`
- remove grammar quota pressure
- allow 0 grammar points
- basic particles must not be promoted to grammar
- collocation/register carve-outs
- remove pitch accent request
- remove forced/fake JLPT labeling
- re-baseline hosting prompt tests / prompt-quality fixtures

Do not start Phase 2C taxonomy renaming yet.

## 7. Next Session Start

```powershell
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.3
git status
git log -3 --oneline --decorate
```

Expected HEAD:

```text
840e18f feat(reader): persist collocation and register taxonomy
```

Expected status:

```text
nothing to commit, working tree clean
```

## 8. Session Close Status

```text
Japanese Reader v0.3

Phase 1:  COMPLETED / COMMITTED
Phase 2A: COMPLETED / COMMITTED

Extension tests: 17 suites / 461 tests PASS
Hosting test:    13 / 13 PASS
Build:           PASS
Diff check:      CLEAN
Working tree:    CLEAN

Push:            DEFERRED
Merge to main:   DEFERRED
Phase 2B:        DEFERRED TO NEXT SESSION
```

**Session closed.**
