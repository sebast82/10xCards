# Manual Verification: SRS Review Session (S-05)

- **Date**: _pending_
- **Environment**: _pending_ (local: Windows, Chromium, local Supabase — deployed: `https://10x-cards.sebger82.workers.dev`)
- **Evidence type**: DB-state observations from the Supabase dashboard + one full session on the deployed Worker. This closes the F-01 inherited question ("does ts-fsrs behave the same on the deployed instance?").

> **Status at Phase 5 commit (2026-09-02):** automated checks 5.1–5.3 pass. Manual checks 5.4–5.6
> are **open debt** — the change was marked `implemented` before they ran (deliberate: option A).
> As of this commit, `GET https://10x-cards.sebger82.workers.dev/review` returns **404** — S-05 is
> not yet deployed. `git push` `master` (p1–p5) → Cloudflare auto-deploy, then complete (c) and (d)
> below and flip 5.4–5.6 in `plan.md`.

## Guardrail

PRD guardrail for S-05: **the review mechanism must not fail, regardless of card source (AI or manual).** F-01 delegated the *test* of both sources to this change. The automated regression guard lives in
`src/lib/reviews/service.test.ts` ("grades a manual card and an AI card through an identical guarded update") and
`src/lib/srs/scheduler.test.ts` ("previews the exact state that grading later applies"). This file is the behavioural evidence.

## Checklist

### (a) Manual card — local

- [ ] Create a manual card in `/deck`.
- [ ] Open `/review`, reveal, grade it (any grade 1–4).
- [ ] In the Supabase dashboard, confirm the row's `due`, `state`, and `reps` moved.
- **Result**: _pending_
- **Recorded with**: _commit SHA_

### (b) AI-accepted card — local

- [ ] Generate + accept one AI card in `/generate`.
- [ ] Open `/review`, reveal, grade it.
- [ ] Confirm `due` / `state` / `reps` moved in the dashboard.
- [ ] Grading path is identical to (a) — no source-dependent behaviour observed.
- **Result**: _pending_
- **Recorded with**: _commit SHA_

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

- **Deployed commit SHA**: _pending_
- **Deploy date**: _pending_

## Plan items

| Plan item | Result | Recorded with |
|-----------|--------|---------------|
| 5.4 `manual-verification.md` complete with DB-state observation for a manual and an AI card | _pending_ | |
| 5.5 One full review session on the deployed instance; grade persisted; commit SHA recorded | _pending_ | |
| 5.6 Deployed ts-fsrs interval labels match a local run for the same card state | _pending_ | |
