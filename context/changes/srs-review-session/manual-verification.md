# Manual Verification: SRS Review Session (S-05)

- **Date**: 2026-09-02
- **Environment**: deployed Worker `https://10x-cards.sebger82.workers.dev` + its cloud Supabase; DB rows pasted by the product owner. Local parity re-computation: Node + ts-fsrs 5.4.1.
- **Evidence type**: DB-state observations (before/after grade) for a manual and an AI card + one full session on the deployed Worker + a deployed-vs-local FSRS parity re-computation. Closes the F-01 inherited question ("does ts-fsrs behave the same on the deployed instance?").

> **Status: COMPLETE.** 5.1–5.3 automated. 5.4–5.6 verified from deployed DB rows on 2026-09-02.
> Runtime commit `b3e9554` deployed to the Worker; `/review` + `/api/reviews` curl-verified live
> (`GET /review` → 302 `/auth/signin`; `GET /api/reviews` → 401 with the frozen Polish message).
> ts-fsrs on workerd computes bit-identically to Node (see (d²)).

## Guardrail

PRD guardrail for S-05: **the review mechanism must not fail, regardless of card source (AI or manual).** F-01 delegated the *test* of both sources to this change. The automated regression guard lives in
`src/lib/reviews/service.test.ts` ("grades a manual card and an AI card through an identical guarded update") and
`src/lib/srs/scheduler.test.ts` ("previews the exact state that grading later applies"). This file is the behavioural evidence.

## Checklist

### (a) Manual card

- [x] Manual card created (`front: "testowa teraz"`), reviewed and graded once.
- [x] Row `flashcards/2a61a68a-1113-4712-a920-a9efc3b0023d` observed post-grade:
  `source: manual`, `reps: 0 → 1`, `state: 0 (New) → 1 (Learning)`,
  `last_review: null → 2026-09-02T00:03:41Z`, `due` → `+10 min` (learning step),
  `stability 0 → 2.3065`, `difficulty 0 → 2.118`, `updated_at > created_at` (DB trigger fired).
- **Result**: PASS — schedule state advanced through `applyReviewGrade`.
- **Recorded with**: `a106813` (DB row pasted by product owner 2026-09-02)

### (b) AI-accepted card

- [x] AI card accepted (`generation_id: ced75f6b-…`), reviewed and graded once.
- [x] Row `flashcards/1a578168-b40e-4f09-a33e-c1044a5d7d94` observed post-grade:
  `source: ai`, `reps: 0 → 1`, `state: 0 (New) → 2 (Review)`,
  `last_review: null → 2026-09-02T00:03:44Z`, `due` → `+8 days` (`scheduled_days: 8`),
  `stability 0 → 8.2956`, `difficulty 0 → 1`, `updated_at > created_at` (DB trigger fired).
- [x] Grading path identical to (a): same nine schedule columns touched, `reps`-guarded
  update, no branch on `source`. The `+10 min` vs `+8 days` difference is the chosen grade
  × FSRS math, not a source-dependent code path.
- **Result**: PASS — the PRD guardrail ("must work regardless of card source") holds behaviourally.
- **Recorded with**: `a106813` (DB row pasted by product owner 2026-09-02)

### (c) Full session on the deployed Worker

- [x] Deployed to the Worker (runtime commit `b3e9554`); `/review` + `/api/reviews` curl-verified live.
- [x] One full review session run on `https://10x-cards.sebger82.workers.dev/review`:
      question → Space reveals → `1`–`4` grades → next card → progress increments →
      final card produced the "To na dziś wszystko — powtórzono 6 fiszek." screen.
- [x] A grade persisted — row `flashcards/b2b4520a-1883-4e1b-9205-39ebefcde7cf` observed
      post-session: `reps: 1 → 2`, `last_review → 2026-09-02T00:08:46.533Z`,
      `due → 2026-09-02T00:14:46.533Z` (`last_review + 6 min`), `stability → 0.212`,
      `difficulty → 7.604` (Again on a learning card), `updated_at` bumped by trigger.
- [x] Interval-label parity spot-check — closed under 5.6 below.
- **Result**: PASS.
- **Recorded with**: `878977c` (deployed row pasted by product owner 2026-09-02)

### (d²) Interval-label / FSRS parity — deployed vs local (F-01 question)

Card `flashcards/5afe6263-4422-4242-b964-c10e4aabcc13`, state Learning, `reps: 1`.

- **Deployed grade buttons** (from the Worker): Znowu `za 1 min`, Trudno `za 6 min`,
  Dobrze `za 10 min`, Łatwo `za 2 dni`.
- **Local `preview(preRow, now)`** (Node, ts-fsrs 5.4.1, any plausible GET `now`): identical
  buckets — `za 1 min` / `za 6 min` / `za 10 min` / `za 2 dni`.
- **Chosen grade: Łatwo (Easy).** Deployed post-grade row vs local
  `applyGrade(preRow, 2026-09-02T00:16:24.254Z, Easy)`:

  | field | local (Node) | deployed (workerd) |
  |---|---|---|
  | `due` | `2026-09-04T00:16:24.254Z` | `2026-09-04 00:16:24.254+00` |
  | `stability` | `2.29815136` | `2.29815136` |
  | `difficulty` | `3.4641143` | `3.4641143` |
  | `scheduled_days` | `2` | `2` |
  | `state` | `2` | `2` |
  | `reps` | `2` | `2` |

  Bit-identical including the floats to 8 dp. `preview()` deep-equals `applyGrade()` for this
  real row. **ts-fsrs on workerd computes identically to Node — the F-01 parity question is closed.**

### (d) Deployed commit

- **Deployed commit SHA**: `b3e9554` (`origin/master` HEAD; `fix(srs-review-session): suppress Space/Enter grade activation in answer state (F1)`)
- **Deploy date**: 2026-09-02
- **Deploy verified**: 2026-09-02 via curl — `/review` 302→signin, `/api/reviews` 401 with the frozen Polish message. Full logged-in session (c) still pending.

## Plan items

| Plan item | Result | Recorded with |
|-----------|--------|---------------|
| 5.4 `manual-verification.md` complete with DB-state observation for a manual and an AI card | PASS | `a106813` |
| 5.5 One full review session on the deployed instance; grade persisted; commit SHA recorded | PASS | `878977c` |
| 5.6 Deployed ts-fsrs interval labels match a local run for the same card state | PASS | `80a59b3` |
