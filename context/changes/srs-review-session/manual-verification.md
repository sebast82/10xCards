# Manual Verification: SRS Review Session (S-05)

- **Date**: _pending_
- **Environment**: _pending_ (local: Windows, Chromium, local Supabase — deployed: `https://10x-cards.sebger82.workers.dev`)
- **Evidence type**: DB-state observations from the Supabase dashboard + one full session on the deployed Worker. This closes the F-01 inherited question ("does ts-fsrs behave the same on the deployed instance?").

> **Status:** automated checks 5.1–5.3 pass. `origin/master` @ `b3e9554` (p1–p5 + epilogue + F1
> fix) is deployed to the Worker — verified 2026-09-02 by curl:
>
> | Deployed check | Result |
> |---|---|
> | `GET /review` (logged out) | `302` → `/auth/signin` — route + `PROTECTED_ROUTES` live |
> | `GET /api/reviews` (logged out) | `401` `{"error":"Zaloguj się, aby powtarzać fiszki."}` — S-05 endpoint live, frozen message |
> | `POST /api/reviews` grade:5 (logged out) | `401` (auth gate fires before body validation — expected order) |
>
> Remaining: (a)/(b) local DB-state observations, (c) one full logged-in session on the Worker,
> (d) the label-parity spot-check. These need a browser session + Supabase dashboard — pending the
> product-owner run. Flip 5.4–5.6 in `plan.md` once recorded.

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

- [ ] `git push` to `master` → Cloudflare auto-deploy completes.
- [ ] Run one full review session on `https://10x-cards.sebger82.workers.dev`:
      question shows, Space reveals, `1`–`4` grades, next card appears, progress increments,
      final card → "to na dziś wszystko" screen.
- [ ] A grade persists (re-open `/review` or check the dashboard).
- [ ] Interval labels ("za 3 dni" etc.) are sane and match a local run for the same card state
      (F-01 ts-fsrs parity question — **closed**).
- **Result**: _pending_
- **Recorded with**: _commit SHA_

### (d) Deployed commit

- **Deployed commit SHA**: `b3e9554` (`origin/master` HEAD; `fix(srs-review-session): suppress Space/Enter grade activation in answer state (F1)`)
- **Deploy date**: 2026-09-02
- **Deploy verified**: 2026-09-02 via curl — `/review` 302→signin, `/api/reviews` 401 with the frozen Polish message. Full logged-in session (c) still pending.

## Plan items

| Plan item | Result | Recorded with |
|-----------|--------|---------------|
| 5.4 `manual-verification.md` complete with DB-state observation for a manual and an AI card | PASS | `a106813` |
| 5.5 One full review session on the deployed instance; grade persisted; commit SHA recorded | _pending_ | |
| 5.6 Deployed ts-fsrs interval labels match a local run for the same card state | _pending_ | |
