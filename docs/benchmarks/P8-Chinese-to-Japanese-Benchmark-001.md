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

## P8-C2 addendum — translation style variants (2026-09-15)

P8-C2 added an explicit `translationStyle` control (`natural` | `news` |
`business`, default `natural`) applied to the multilingual pre-stage
translation step ahead of the (still unmodified) Japanese Analyzer. These
examples extend this same benchmark's source text to the `natural` and
`business` styles, plus a short news-register and an English source, per the
P8-C2 acceptance criteria — none of these are exact-string requirements, only
illustrative targets for judging translation naturalness/register in
implementation/eval work.

### 1. natural (same source as above)

Illustrative target (natural, general-reading register):

```
米国Prismacolor Premier（プリズマカラー・プレミア）の
油性色鉛筆（単色・1本売り）
#103～#997 単色から選択可能
```

Acceptance: natural Japanese, faithful to the source, usable as an ordinary
product description.

### 2. business (same source as above)

Illustrative target (polished EC/product-copy register, factual content
unchanged):

```
米国Prismacolor Premier（プリズマカラー・プレミア）
油性色鉛筆・単色売り
#103～#997 各色よりお選びいただけます
```

Acceptance: natural Japanese EC/product-copy register, polished but
factual — product/model/color-number information (Prismacolor Premier,
#103–#997, 油性/single-color) preserved exactly; no invented marketing
claims (no certifications, awards, or performance claims not present in the
source).

### 3. news (new short Chinese-adjacent source for this style)

Source (already Japanese in this particular example — included to give the
news register a concrete before/after even without a translation step; the
`news` style prompt is exercised identically regardless of source language):

```
高市首相は大詰めの調整を行っています。最新情報を伝えてもらいます。
```

Acceptance: concise, factual, objective Japanese news/reporting register —
avoids chatty phrasing and promotional exaggeration; names, dates, numbers,
and claims preserved. Not a fixed single accepted sentence.

### 4. English source (en + business / en + news routing)

Source:

```
The Prismacolor Premier oil-based color pencil is now available in single
units, colors #103 through #997.
```

Acceptance (business): polished, natural Japanese product-copy register;
model name, color-number range, and "oil-based / single-unit" facts
preserved exactly; no invented claims.

Acceptance (news): concise, factual Japanese reporting register conveying
the same facts, without marketing phrasing.

These four cases are covered by automated tests (mocked LLM) in
`japanese-alchemy-hosting/functions/test/v1/explainCallable.test.ts` and
`explainStreamCallableHandler.test.ts` (`P8-C2 translation style control`
describe blocks) — they assert routing/prompt-selection correctness, not the
LLM's actual output text.
