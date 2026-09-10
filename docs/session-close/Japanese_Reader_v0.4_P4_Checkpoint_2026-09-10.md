# Japanese Reader v0.4 — P4 Checkpoint (Deployment Readiness + Persistent Review State / COMPLETE WITH NOTES / NOT PUSHED)

**Date:** 2026-09-10
**Project:** J-Buddy → Language Agent / Japanese Reader
**Branch:** `feature/japanese-reader-v0.4`
**Scope of this document:** record the completed P4 work (P4.1 audit → P4.2
build/Firebase-init fix → P4.3 CI + rules hardening + runbook → P4.4 persistent
"已加入複習" state) and the exact resume point. Documentation only — no source /
test changes, no commit, no push, no deploy, no rules/index changes, no tool
installs.

Succeeds [`Japanese_Reader_v0.4_P3_Checkpoint_2026-09-10.md`](./Japanese_Reader_v0.4_P3_Checkpoint_2026-09-10.md).

---

## 1. Final Git State

```text
branch          feature/japanese-reader-v0.4
HEAD            4344210  feat(reader): persist already-in-review state
working tree    clean (nothing to commit) — before this checkpoint doc

main            fb56056  docs: close Japanese Reader v0.3 integration   (UNTOUCHED)
origin/main     fb56056  (identical to main)

feature/japanese-reader-v0.4 vs main:  +13 ahead / 0 behind
push status     NOT DONE   (all 13 feature commits are local only)
deploy status   NOT DONE
migration / backfill   NONE
```

- `main` / `origin/main` **not** modified, merged into, or rebased.
- The feature branch has **no upstream tracking ref** and has never been pushed.
- `firestore.rules` **was modified** in P4.3 (review_cards hardening) but **not
  deployed**. `firestore.indexes.json` unchanged.

---

## 2. Phase Status

| Phase | Status | Summary |
|---|---|---|
| **P0** | **COMPLETE** | Pure model / extractor: `LearningItem` + `deriveLearningItems()`. |
| **P1** | **COMPLETE** | Personal `learning_items` persistence; auth-scoped write; atomic `analysis_pages` + `learning_items` batch. |
| **P2** | **COMPLETE WITH NOTES** | Direct-client `listLearningItems` read; read-only `學習項目` tab; deterministic integration. Live Firebase smoke deferred. |
| **P3** | **COMPLETE WITH NOTES** | `ReviewCard` model + `cardId = base64url(lexicalKey)`; deterministic step scheduler; `materializeReviewCard` / `applyReviewRating` (transactions); `listDueReviewCards` (`dueAt <= now`, asc, ≤50); `複習` tab (reveal → 重來/良好/簡單 → auto-advance → refetch). |
| **P4.1** | **COMPLETE** | Current-state / technical-debt audit. Identified: `next build` fails without `.env.local` (hard deploy blocker); no webapp CI; unhardened `review_cards` rules (data-integrity, not a boundary); index claims unverified; identity-split / grammar-sense / first-occurrence-snapshot risks classified; recommended **Option A — deployment readiness**. Verdict: NEEDS PRODUCT DECISION (scope + who provisions real Firebase). |
| **P4.2** | **COMPLETE** | Firebase config-presence contract (`hasFirebaseConfig()`); guarded/lazy init in `lib/firebase.ts`; `AuthContext` degraded signed-out mode; `firestoreService` / `reviewService` guard nullable `db`/`auth`. `npm run build` with **no `.env.local` → exit 0**, `out/` produced, all routes prerendered, no `auth/invalid-api-key`. 20 new tests → 214/214. |
| **P4.3** | **COMPLETE WITH NOTES** | Repo-root `.github/workflows/webapp-ci.yml` (quality job + Firestore-emulator rules job); `review_cards` rules hardened (owner-only, exact-shape create, schedule-only update, no delete, wildcard narrowed to read-only); 28-case rules test; deploy + live-smoke + index-confirmation + deploy-separation runbook; 3 pre-existing lint problems fixed → **project lint 0**. Rules test **NOT RUN** (no Java/emulator); CI **not yet executed** (branch not pushed). |
| **P4.4** | **COMPLETE** | `listReviewCardKeys()` + `useReviewCardKeys()` → persistent "已加入複習" state in the 學習項目 tab; every occurrence of a `lexicalKey` shows the same state; one add flips all duplicates without reload; state restored from Firestore on reload; `lexicalKey`-level pending/error. 35 new tests → **249/249**. |

**P4 overall: COMPLETE WITH NOTES.**

---

## 3. Exact P4 Commit Chain

```text
4344210  feat(reader): persist already-in-review state                      ← HEAD (P4.4)
2baa9c1  chore(webapp): add CI, harden review rules, and deploy runbook     ← P4.3
6a50402  fix(webapp): tolerate missing Firebase config at build time        ← P4.2
06ef90b  docs: add Japanese Reader v0.4 P3 checkpoint                        ← previous checkpoint
72344c5  feat(reader): add minimal review session UI                        ← P3.4
f007d1b  feat(reader): add due review queue query                           ← P3.3
043f1b7  feat(reader): add review card model and mutation service           ← P3.2
8c7cf49  docs: add Japanese Reader v0.4 P2 checkpoint
...
fb56056  docs: close Japanese Reader v0.3 integration                       ← main / origin/main
```

- **P4.1 produced no commit** — audit/design only, delivered inline.
- All feature commits carry the `Co-Authored-By: Claude Sonnet 5` /
  `Claude-Session:` trailers. No rebase, squash, or SHA rewrite.

---

## 4. P4.2 — Firebase Initialization Contract

**Required env (`lib/firebase.ts`):**
```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

`hasFirebaseConfig()` returns `true` **only when all six** are present and
`.trim().length > 0`. Whitespace-only = missing. No partial config accepted, no
empty-string fallback, no fake defaults, values never logged.

| Config state | Behaviour |
|---|---|
| **missing / partial** | `app = auth = db = functions = null` (default export `null`); **module import does not throw**; `getAuth` / `getFirestore` / `getFunctions` / `initializeApp` are **never called**; `AuthContext` resolves signed-out (`user: null`, `loading: false`, no `onAuthStateChanged`); static prerender succeeds |
| **valid (all six)** | `initializeApp({6 values})` (or `getApp()` if already initialised), then `getAuth` / `getFirestore` / `getFunctions` each once; all existing runtime behaviour preserved |

**Build result (no `.env.local`):** `npm run build` → **exit 0**; compile PASS,
TypeScript PASS, static prerender PASS for `/`, `/_not-found`, `/auth`, `/faq`;
**`out/` produced**; no `auth/invalid-api-key`. `out/index.html` prerenders the
signed-out dashboard directly.

---

## 5. Firebase Degraded Mode

**`AuthContext` (`auth === null`):**
- `user = null`; `loading` starts `false` (lazy `useState(auth !== null)`).
- The `useEffect` returns early — **`onAuthStateChanged` is never called**.
- `signUp` / `signIn` / `signInWithGoogle` / `signOut` → throw
  `Error('登入功能目前無法使用。')` — deterministic, no Firebase details, **no SDK
  call made**.
- With valid config: the `onAuthStateChanged` subscription + method delegation
  are **unchanged**.

**Services (`firestoreService.ts`, `reviewService.ts`):**
- Exported `db` / `auth` are `X | null`. Each function narrows via a local
  `requireDb()` / `requireUid()` guard and **throws a generic error before any
  Firestore call** when Firebase is unavailable.
- Business logic, query shapes, and public signatures are **unchanged** — signed-in
  UI never reaches these guards in degraded mode (the tabs are gated on `user`).

---

## 6. CI Architecture

**Workflow:** `.github/workflows/webapp-ci.yml` (**repo root** — GitHub Actions
executes only repo-root `.github/workflows/`; the pre-existing
`japanese-alchemy-hosting/.github/workflows/firebase-hosting-*.yml` are at a
nested path and are **inert**).

**Triggers:** `pull_request` and `push` to `main` / `feature/**`, path-filtered to
`japanese-alchemy-webapp/**`, `japanese-alchemy-hosting/firestore.rules`,
`japanese-alchemy-hosting/firebase.json`, and the workflow file.

| Job | Steps |
|---|---|
| **`webapp-quality`** (wd `japanese-alchemy-webapp`) | checkout · setup-node 22 · `npm install` · `npx vitest run` · `npx tsc --noEmit` · `npm run lint` · `npm run build` · verify `out/index.html` |
| **`firestore-rules`** | checkout · setup-node 22 · **setup-java 17 (temurin)** · `npm install` (webapp) · `npx --yes firebase-tools@15 emulators:exec --only firestore --project demo-japanese-alchemy "npm --prefix ../japanese-alchemy-webapp run test:rules"` |

- **No Firebase secrets** required by either job (`--project demo-*` forbids real
  contact; the build works without env after P4.2).
- **CI uses `npm install`, not `npm ci`** — the repo-wide `.gitignore` excludes
  `package-lock.json` / `yarn.lock`; there is no committed lock file.
- `@firebase/rules-unit-testing@^5.0.2` is a webapp devDependency; the rules test
  is `japanese-alchemy-webapp/test/firestoreRules.reviewCards.rules.test.ts`, run
  only via `npm run test:rules` (`vitest.rules.config.mts`), excluded from the
  default suite.

---

## 7. Firestore Rules Hardening (P4.3)

**Original issue:** `match /users/{userId}/{document=**} { allow read, write: if
isOwner(userId) }` — Firestore rules OR-combine, so a nested `review_cards` match
could not *constrain* the owner's write; the wildcard had to be narrowed.

**New structure (`japanese-alchemy-hosting/firestore.rules`):**
- `match /users/{userId}/{document=**}` → **`allow read` only** (owner may read
  anything in their subtree; an undeclared future subcollection is read-only).
- Explicit **`allow write: if isOwner(userId)`** for `vocabularies`, `grammars`,
  `analysis_pages`, `learning_items` — **behaviour-identical** to before (write =
  create + update + delete; `deleteAnalysisPage` still works).
- `review_cards` gets explicit constrained rules + helper functions
  (`isValidReviewCard`, `reviewCardImmutableFieldsUnchanged`, `isWholeNonNegative`).

**`users/{userId}/review_cards/{cardId}`:**

| Op | Rule |
|---|---|
| `read` | owner only |
| `create` | owner only · exact **20-field** shape · `id == cardId` · `userId == {userId}` · `type in ['vocab','grammar']` · `state in ['learning','review']` · `lastRating == null \|\| in [1,3,4]` · `intervalDays`/`reps`/`lapses` whole & `>= 0` · `dueAt`/`createdAt`/`updatedAt` `is number` · `lastReviewedAt == null \|\| is number` · face strings / nullable strings valid · **`keys().hasOnly(...) && hasAll(...)`** (no extra, no missing) |
| `update` | owner only · same full-shape validation of the resulting doc · **immutable fields unchanged** · only scheduling fields may change |
| `delete` | **`if false`** (no remove-from-review UX) |

**Immutable on update:** `id, userId, lexicalKey, type, surface, reading,
meaning, sourceSentence, sourceUrl, sourceAnalysisId, sourceLearningItemId,
createdAt`.
**Mutable scheduling fields:** `state, dueAt, intervalDays, reps, lapses,
lastRating, lastReviewedAt, updatedAt`.

> `is int` is **not** used — the Firestore Web SDK stores every JS number as a
> double, so `is int` would reject every client write; `isWholeNonNegative()` =
> `is number && >= 0 && == math.floor(n)` is used instead.

---

## 8. Rules Test Status

**28 cases** in `test/firestoreRules.reviewCards.rules.test.ts`:
- owner / non-owner / unauthenticated **read**
- **create**: valid ✓ · mismatched `userId` ✗ · `id != cardId` ✗ · bad `type` ✗ ·
  bad `state` ✗ · bad `lastRating` ✗ · negative / fractional numeric fields ✗ ·
  extra field ✗ · missing required field ✗ · non-owner ✗ · null nullable fields ✓
- **update**: valid scheduling-only ✓ · change `surface` ✗ · change `lexicalKey`
  ✗ · change `userId` ✗ · change `createdAt` ✗ · add arbitrary field ✗ · invalid
  schedule values ✗ · non-owner ✗
- **delete** ✗ (denied)
- **regression**: owner `learning_items` create/read/delete ✓ + other-user ✗ ·
  owner `analysis_pages` create/read/delete ✓ + other-user ✗ · `shared_*` public
  read ✓ / client write ✗ · undeclared future user subcollection: read ✓ / write ✗
- + "rules file loaded into the emulator" sanity

**Local emulator: NOT RUN** — no Java/JRE, no local emulator stack. The test file
parses / imports / discovers all 28 cases; a local `npm run test:rules` fails at
`initializeTestEnvironment` ("wrap with `firebase emulators:exec`").

**CI `firestore-rules` job: configured but NOT YET EXECUTED** — the branch has
not been pushed to GitHub.

> **The `firestore.rules` change is NOT live-verified.** Do not claim it is.

---

## 9. Deploy / Live-Smoke Runbook

**Path:** `docs/runbooks/Japanese_Reader_v0.4_Webapp_Deploy_and_Live_Smoke.md`

Contains (operator-facing, **no real credential values**):
- **A** prerequisites — repo/branch/Node, `firebase-tools`, the 6
  `NEXT_PUBLIC_FIREBASE_*` **template names** only, test Google account,
  `.env.local` at `japanese-alchemy-webapp/.env.local` (must stay uncommitted)
- **B** pre-deploy local gates (`npm install / vitest / tsc / lint / build`,
  `out/`), CI both jobs green
- **C** real-project local smoke — boot → Google sign-in → signed-in tabs →
  `學習項目` real query (no `FAILED_PRECONDITION`) → `加入複習` → reload → `複習`
  real query (no `FAILED_PRECONDITION`) → reveal → rate Good → reload confirms
  persisted schedule → cross-user isolation; console watch-list
- **D** Firestore rule smoke (own-card ops, `surface`/`delete` denied, cross-user
  denied) — or accept a green CI `firestore-rules` job
- **E** deploy — `firebase deploy --only hosting` from `japanese-alchemy-webapp/`
  (project `japanese-alchemy`, site `japanese-alchemy-webapp`, no functions, no
  rules); **rules deploy is separate**: `firebase deploy --only firestore:rules`
  from `japanese-alchemy-hosting/`
- **F** post-deploy smoke · **G** rollback (Hosting release history; rules version
  history; **never delete/edit data**) · **H** 11-box release gate checklist
- **§8** index-confirmation procedure (both queries, expected no composite index,
  STOP-on-`FAILED_PRECONDITION`)
- **§9** deploy-separation audit (webapp hosting / Firestore rules / Firestore
  indexes / Cloud Functions / the separate `public/` static site — each with its
  own directory + `--only` command)

No real credentials committed.

---

## 10. P4.4 — Reviewed-Key Contract

```ts
listReviewCardKeys(): Promise<Set<string>>
```

| Aspect | Value |
|---|---|
| Path | `users/{auth.currentUser.uid}/review_cards` |
| Query | plain `getDocs(collection(doc(db, 'users', uid), 'review_cards'))` |
| Not present | `where` · `orderBy` · cursor · **`limit`** · any write / transaction · root `review_cards` · `shared_*` |
| Auth | `requireUid('review')` throws **before** any Firestore call; no `userId` argument |
| Returned keys | valid non-empty string `lexicalKey` only; missing / non-string / empty → skipped; duplicates collapse in the `Set` |
| Scale | **complete collection scan — no artificial 50-card truncation** (tested with 137 mocked cards) |
| Index | **none** — `firestore.indexes.json` untouched |

---

## 11. `useReviewCardKeys(uid, authResolved)` Contract

```ts
{ keys: ReadonlySet<string>; loading: boolean; error: boolean; addKey: (k: string) => void }
```

| Situation | Behaviour |
|---|---|
| `authResolved === false` | no query; `{ keys: ∅, loading: true, error: false }` |
| signed out (`uid === null`) | `RESET` → `{ keys: ∅, loading: false, error: false }`; **no query** |
| signed in | `LOAD_PENDING` (set cleared) → `LOAD_OK{keys}` / `LOAD_FAILED` |
| load **failure** | `{ keys: ∅, loading: false, error: true }` — **never fabricates reviewed keys** |
| logout | effect re-runs → `RESET` |
| user switch | generation counter bumped → stale prior-user response discarded; old set cleared immediately; fresh load |
| `addKey(lexicalKey)` | inserts immediately (new `Set` ref), **idempotent**, ignores empty/non-string |

**No realtime listener. No polling.** Mirrors the `useLearningItemsFeed` /
`useReviewSession` generation-guard pattern. `addKey` is a stable
`useCallback([])`.

---

## 12. 學習項目 UX after P4.4

| State | Render |
|---|---|
| `reviewedKeys.has(item.lexicalKey)` | **`已加入複習`** (muted text), **no add button** |
| not reviewed | **`加入複習`** button |
| `reviewKeysLoading` | **add controls hidden**; the item's reading / meaning / source content still renders |
| `reviewKeysError` | one panel line `無法載入複習狀態,「加入複習」仍可使用。` + the `加入複習` button (safe because `materializeReviewCard` is idempotent) |

- **Pending is `lexicalKey`-level** — clicking one `改善` card disables **every**
  `改善` button while that one request is in flight; a `問題` button is unaffected.
- **Duplicate occurrences** (same `lexicalKey`) share pending state **and**
  reviewed state.
- **On success:** parent runs `materializeReviewCard(item)` → `addReviewedKey(item.lexicalKey)`
  → every visible duplicate flips to `已加入複習` immediately (no reload, no feed
  refresh).
- **On reload:** `listReviewCardKeys` restores the set from Firestore.
- **Not done:** `LearningItem` mutation · feed refresh · `occurrenceCount` ·
  remove-from-review · bulk add.

Wiring: `app/page.tsx` → `useReviewCardKeys(user?.uid ?? null, !loading)` →
`<LearningItemsPanel … onAddToReview={handleAddToReview} reviewedKeys=…
reviewKeysLoading=… reviewKeysError=… />`. Not connected to `ReviewPanel` /
scheduling.

---

## 13. Performance Note (P4.4)

P4.4 reads **all** `review_cards` docs for the signed-in user **once per
authenticated dashboard load** (same cadence as `useLearningItemsFeed` /
`useReviewSession`; no active-tab lazy loading exists).

- **Accepted v0.4 assumption:** tens to low-hundreds of small `ReviewCard` docs
  (~200 reads ≈ US$0.00007, sub-100 ms).
- **Revisit threshold:** ~**1,000+** cards, or measurable dashboard-load latency.
- **Deferred (P5) options:** a `review_key_summary` doc / server membership map;
  querying only the `lexicalKey`s visible on the current 學習項目 page; active-tab
  lazy loading; a realtime `onSnapshot` listener. **No counter/summary doc was
  introduced.**

---

## 14. Final Test / Quality Baseline

**Latest (HEAD `4344210`, P4.4):**
| Gate | Result |
|---|---|
| Full webapp `vitest` | **249 / 249 PASS** (16 files) |
| `npx tsc --noEmit` | PASS (exit 0) |
| `npx eslint` changed/new files | PASS (0 problems) |
| `npm run lint` (project) | **0 problems** |
| `npm run build` with **no `.env.local`** | PASS (exit 0), `out/index.html` present |
| `git diff --check` | PASS (exit 0) |
| `npm run test:rules` (local) | **NOT RUN** (no emulator) |

**Per-phase test deltas:**
| Phase | New tests | Total at that checkpoint |
|---|---|---|
| P4.2 | 20 | 214 / 214 |
| P4.3 | 28 rules cases (NOT RUN locally) + 3 pre-existing lint fixes | 214 / 214 (rules excluded from default suite) |
| P4.4 | 35 | **249 / 249** |

**No external API calls. No real Firebase / emulator.**

---

## 15. Known Notes / Deferred Items

### Infrastructure / live verification — NOT RUN (reason: branch not pushed / no local Java / no real `.env.local`)
- real Firebase **Auth** smoke
- real Firestore **query** smoke (`listLearningItems`, `listDueReviewCards`, `listReviewCardKeys`)
- index **`FAILED_PRECONDITION`** confirmation (both queries expected index-free)
- Firestore **emulator rules test** (locally — no Java; in CI — not executed, branch not pushed)
- **GitHub Actions** workflow (never run)
- real **transaction contention** / retry behaviour
- **browser live render** against real Firebase

### Product / future (all deferred)
- `Hard` rating (integer `2` reserved) · SM-2 · FSRS
- review history / event log
- `occurrenceCount` on `ReviewCard`
- representative-context refresh on re-materialise
- reading-agnostic identity merge (`vocab|改善|かいぜん` vs `vocab|改善|` split)
- grammar function / sense splitting (`grammar|が|` collision)
- removal from review · bulk add
- true daily quotas · timezone model
- review statistics surface
- active-tab lazy loading for the dashboard hooks
- `>1000` review-card membership optimisation

---

## 16. No Semantic Drift

P4 did **not** change:
- `LearningItem` schema · P1 `learning_items` persistence / `savePersonalAnalysisPage` / `saveItemsCallable`
- `ReviewCard` schema · `reviewCardIdFor` · scheduler constants / transitions · `computeNextSchedule`
- `applyReviewRating` semantics · `materializeReviewCard` idempotency (transaction untouched)
- `listDueReviewCards` contract (`where dueAt <= now` + `orderBy dueAt asc` + `limit ≤50`) · `REVIEW_QUEUE_CAP`
- P2 `listLearningItems` pagination semantics
- `firestore.indexes.json`
- the Chrome extension · prompts / `systemPromptV1` / `systemPromptV2`
- `japanese-alchemy-hosting/functions/**`
- the shared save / shared-collection flow (still no shared review cards)
- migration / backfill (none)

`reviewService.ts` diff is **purely additive** (`listReviewCardKeys` only).
`firestore.rules` **was** modified (P4.3) but preserves every real collection's
behaviour — only the write-wildcard for *undeclared* subcollections tightened
(there are none) and `review_cards` constrained.

---

## 17. Current Product Capability

```text
Japanese web content
  → sidepanel AI analysis (extension → Functions → LLM)
  → personal save  →  users/{uid}/analysis_pages + users/{uid}/learning_items   (P1)
  → 學習項目 browser tab  (P2.2 — raw occurrences, newest first)
  → persistent "已加入複習" membership  (P4.4 — listReviewCardKeys / useReviewCardKeys)
  → explicit 加入複習 on a chosen occurrence  (P3.4)
  → materializeReviewCard  →  one deduplicated ReviewCard per lexicalKey  (P3.2)
  → 複習 tab: due queue  (dueAt <= now, asc, ≤50)  (P3.3)
  → 顯示答案 → 重來 / 良好 / 簡單  (P3.4)
  → applyReviewRating → computeNextSchedule → deterministic reschedule  (P3.2)
  → auto-advance; re-fetch when the batch empties
```

**Three distinct concepts:**
1. **`LearningItem`** — a raw, **immutable** occurrence (one row per word/grammar × saved analysis). Duplicates are expected and preserved.
2. **`ReviewCard`** — one **deduplicated** review entity per lexical identity, created only by an explicit `加入複習`, carrying all mutable scheduling state.
3. **`reviewCardKeys`** — a **UI read model**: the `Set` of `lexicalKey`s that have a `ReviewCard`, used only to render "已加入複習" in the 學習項目 tab. Not connected to scheduling.

---

## 18. Deployment Readiness Gate

| Dimension | State |
|---|---|
| Local deterministic readiness | **READY** — 249/249, tsc, lint 0, build/compile all pass |
| Static build readiness (no `.env.local`) | **READY** — `npm run build` exit 0, `out/` produced |
| CI configuration | **IMPLEMENTED / NOT YET EXECUTED** (branch not pushed) |
| Rules hardening | **IMPLEMENTED / NOT YET EMULATOR-VERIFIED** |
| Real Firebase local smoke | **DEFERRED** (no `.env.local` / no CLI / no Java) |
| Production deployment | **NOT YET APPROVED** |

**Remaining before deploy:** push the branch → obtain the first green CI (both
jobs) → provision a real `japanese-alchemy-webapp/.env.local` → run the live
Auth / query / persistence smoke (runbook §C) → confirm indexes (no
`FAILED_PRECONDITION`) → decide on the `firestore:rules` deploy → decide on
merge-to-`main`.

---

## 19. Current Gate

```text
P0:  COMPLETE
P1:  COMPLETE
P2:  COMPLETE WITH NOTES
P3:  COMPLETE WITH NOTES
P4:  COMPLETE WITH NOTES

Branch          feature/japanese-reader-v0.4
Code HEAD       4344210
Working tree    clean (before this checkpoint doc)
main            UNTOUCHED (fb56056)
push            NOT DONE
deploy          NOT DONE
migration / backfill   NONE
```

---

## 20. Recommended Next Phase

**P5 — Live Verification / Release Candidate Gate. Do NOT implement product features.**

Candidate goals (sequence):
1. push `feature/japanese-reader-v0.4`
2. run GitHub Actions (`webapp-quality` + `firestore-rules`)
3. fix any CI / rules-emulator failure surfaced (pin `firebase-tools@15` if the
   run is green; adjust rules if a case fails)
4. provision `japanese-alchemy-webapp/.env.local` with the real `japanese-alchemy`
   Web config + a test Google account (human prerequisite — cannot be done by an
   AI session)
5. run the real-Firebase smoke (runbook §C / §D)
6. confirm both queries are index-free against real Firestore (runbook §8)
7. decide on the `firestore:rules` deploy
8. decide on merge-to-`main`
9. decide on the webapp Hosting deploy

**Do NOT start SM-2 / FSRS / review history / any scheduling work until the live
backend path is verified.**

---

## 21. Resume Commands

```bash
cd D:\J-Buddy-Dev\j-buddy
git checkout feature/japanese-reader-v0.4
git status
git log -8 --oneline --decorate
```

Expected:

```text
HEAD            4344210  feat(reader): persist already-in-review state
working tree    clean   (before this checkpoint doc is added)

4344210 (HEAD -> feature/japanese-reader-v0.4) feat(reader): persist already-in-review state
2baa9c1 chore(webapp): add CI, harden review rules, and deploy runbook
6a50402 fix(webapp): tolerate missing Firebase config at build time
06ef90b docs: add Japanese Reader v0.4 P3 checkpoint
72344c5 feat(reader): add minimal review session UI
f007d1b feat(reader): add due review queue query
043f1b7 feat(reader): add review card model and mutation service
8c7cf49 docs: add Japanese Reader v0.4 P2 checkpoint
```

Push + first-CI-run (P5.1):

```bash
git push -u origin feature/japanese-reader-v0.4
# then watch the "Webapp CI" workflow on GitHub
```

Live smoke (P5, after a human provides `.env.local`):

```bash
cd japanese-alchemy-webapp
cp .env.local.example .env.local     # fill real NEXT_PUBLIC_FIREBASE_* values
npm install
npm run dev
# follow docs/runbooks/Japanese_Reader_v0.4_Webapp_Deploy_and_Live_Smoke.md §C
```

---

## 22. Session Close Block

```text
┌─ Japanese Reader v0.4 — P4 CHECKPOINT ──────────────────────────────────────┐
│ Japanese Reader v0.4                                                        │
│ P4: COMPLETE WITH NOTES                                                     │
│                                                                            │
│ Branch                 feature/japanese-reader-v0.4                         │
│ Code HEAD              4344210  feat(reader): persist already-in-review     │
│ Tests                 249/249 PASS                                          │
│ Project lint          0                                                     │
│ Static build w/o .env.local   PASS  (out/ produced)                        │
│                                                                            │
│ Review membership persistence   IMPLEMENTED                                 │
│   listReviewCardKeys / useReviewCardKeys → 已加入複習 survives reload,      │
│   shared across duplicate lexicalKey occurrences                            │
│ Firebase init                   guarded — degrades to signed-out           │
│ CI                              IMPLEMENTED / NOT RUN (branch not pushed)   │
│ Rules hardening                 IMPLEMENTED / NOT EMULATOR-VERIFIED         │
│   review_cards: owner-only, exact-shape create, schedule-only update,      │
│   no delete; wildcard write narrowed to read-only                          │
│ firestore.indexes.json          UNCHANGED                                   │
│                                                                            │
│ Live Firebase smoke             DEFERRED (no .env.local / CLI / Java)       │
│ main                            UNTOUCHED (fb56056)                         │
│ push / deploy / merge           NOT DONE                                    │
│ migration / backfill            NONE                                        │
│                                                                            │
│ NEXT   P5 LIVE VERIFICATION / RELEASE CANDIDATE GATE                        │
│        push → CI → .env.local → real smoke → index/rules confirm →          │
│        merge/deploy decisions. No SM-2/FSRS before the live path is proven. │
└────────────────────────────────────────────────────────────────────────────┘
```
