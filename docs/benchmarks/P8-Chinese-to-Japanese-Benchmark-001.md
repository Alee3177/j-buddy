---
title: Chinese-to-Japanese Benchmark 001
type: benchmark
status: planning-only
date: 2026-09-14
phase: P8 (future) — NOT PART OF P7
---

# P8 FUTURE BENCHMARK — NOT PART OF P7

> This document is a **planning-only record**. It captures a known input/output
> gap for a future phase (P8). No runtime code is implemented, changed, or
> deployed as part of creating this record.

## Source

**Source type:** Chinese e-commerce product title

**Source text:**

```
美國 Prismacolor Premier 霹靂馬色鉛筆/油性（單支）
#103~#997 單色下標區
```

## Observed current J-Buddy result

| Analysis stage | Result |
|---|---|
| Extension acceptance | Chinese text is accepted by the Extension |
| "Translation" | Remains effectively Chinese (not translated to Japanese) |
| Vocabulary analysis | None |
| Grammar analysis | None |
| Collocation analysis | None |
| Register / news-expression analysis | None |

**Current status: FAIL**

J-Buddy's pipeline is built for Japanese-language input. Given Chinese
source text, the existing Japanese Analyzer has no Japanese-language surface
to operate on, so every downstream analysis stage silently produces nothing
rather than failing loudly or routing the text through a translation step
first.

## Future target pipeline (P8)

```
Chinese
  → auto-detect zh
  → natural Japanese translation
  → existing Japanese Analyzer
  → vocabulary / kana / grammar / collocation / register
  → Learning Items
```

The key architectural change this implies for P8: a **language-detection +
translation pre-stage** ahead of the existing (unmodified) Japanese Analyzer,
so Chinese source text is normalized into natural Japanese before analysis
begins. The Japanese Analyzer itself is expected to be reused as-is.

### Example target Japanese output

Given the source text above, a natural Japanese translation should read
approximately as:

```
米国Prismacolor Premier（プリズマカラー・プレミア）
油性色鉛筆・単色
#103～#997 各色から選択可能
```

This target string is illustrative (for judging translation naturalness in
P8 implementation/eval work), not a literal string-match requirement.

## Acceptance criteria (for P8 implementation, not evaluated here)

1. Chinese must not be returned unchanged as the translation.
2. Natural Japanese must be produced before Japanese-language analysis runs.
3. The existing Japanese Analyzer must be reused downstream (not replaced or
   forked).
4. The result must produce at least valid vocabulary analysis.
5. The result must remain compatible with Learning Items persistence.

## Scope note

This benchmark record exists to give a future P8 phase a concrete,
reproducible failing case and a target shape to implement against. It does
not:
- implement Chinese detection, translation, or any pipeline change,
- modify the Extension, Cloud Functions, Firestore rules, or the Webapp,
- deploy anything.

P7 is unaffected by this record.
