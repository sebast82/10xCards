# Test Rollout Phase 3 — Schedule & Counter Integrity — Plan Brief

> Full plan: `context/changes/testing-schedule-counter-integrity/plan.md`
> Research: `context/changes/testing-schedule-counter-integrity/research.md`

## What & Why

Rollout Phase 3 of `context/foundation/test-plan.md` closes the coverage gaps for **Risk #3**
(a review session silently loses schedule state — "ocena nie zapisuje się") and **Risk #6**
(generation acceptance counters drift from collection state after an edit or delete, so the "75%"
success criterion can't be reconstructed from data). Test-only change — no production code touched.

## Starting Point

`applyReviewGrade` writes a 9-field schedule payload but the only assertions are `reps: prev+1` and
the absence of `updated_at` — the named failure would pass every current test. The `due <= now()`
queue selection is unverifiable under `SupabaseStub` (it conflates `eq`/`gte`/`lte`) and has no
pgTAP at all. On Risk #6, `updateFlashcard` correctly never calls `recount`, but nothing asserts
that; and the `least()` clamp — the entire reason the third `recount` migration exists — has no
regression test.

## Desired End State

The write payload is pinned field-by-field against the scheduler wrapper's own output; a new
`supabase/tests/review_queue.test.sql` proves real `due <= now()` selection, `due` ordering, the
50-row cap, cross-account queue isolation, and the `reps`-guard optimistic lock against a real row.
`updateFlashcard` / PATCH is asserted to make zero `recount` calls. The `recount` pgTAP covers the
`least()` clamp, delete-of-last-card (→ `(0,0)`), and `recount` on a deleted generation. Cookbook
§6.5 is filled, §7 gains three entries, and `test-plan.md` §3 row 3 reads `complete`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Risk #3 write-payload oracle | Compare captured payload to a single `createScheduler().applyGrade(row, now, grade)` object, field by field | Pins our row→card→row plumbing without becoming a ts-fsrs mirror test; library arithmetic stays out of scope (§7) | Plan |
| Review-queue pgTAP | New `supabase/tests/review_queue.test.sql` | `SupabaseStub` structurally cannot model `WHERE due <= now()`, ordering, the 50-cap, RLS, or the reps-guard race | Plan |
| Re-grade of the same card in a session | Add a positive round-trip test that a legitimate second grade yields a consistent, re-parseable row; do **not** change the queue to exclude just-graded cards | Proves "repeat grade ≠ contradictory state" as a positive property; the product question is unresolved by any source | Plan |
| Risk #6 "reconstructable" under the clamp | `accepted_unedited + accepted_edited == least(raw source count, generated_count)` | The clamp is intended behaviour; asserting raw `count(*)` would fail against live code on any replayed save | Plan |
| `recount` `for update` lock | §7 "deliberately don't test" entry | Single-session pgTAP can't reproduce the race; a `pg_get_functiondef` match is brittle and low-signal | Plan |
| Risk #6 delete-side coverage | pgTAP: delete-last-card → `(0,0)` + `recount` on a deleted generation is a no-op; plus the edit-half `rpcCalls == []` one-liners | Covers the "po usunięciu fiszki" half of the phase goal at the layer where the counter value lives | Plan |

## Scope

**In scope:**
- Schedule-field write-payload assertion; `last_review === now`; Learning / Relearning / `reps:0` fixtures
- Reviews POST `.strict()` guard against a smuggled `now`
- New `review_queue.test.sql` (selection, ordering, 50-cap, isolation, reps-guard sequence)
- `updateFlashcard` + PATCH `rpcCalls == []`
- `recount` pgTAP: `least()` clamp, delete-last-card, deleted-generation no-op
- Cookbook §6.5, §6.7 Faza 3 note, §7 (3 entries), §3 status, deferred register

**Out of scope:**
- The interior of `ts-fsrs` (§7); any absolute numeric bound on `due`
- A Vitest integration layer against real Postgres (no harness exists)
- Server-side evidence for the `edited` flag (`lessons.md` rule)
- Undo / "reconstruct schedule from history" (no `review_logs` table)
- Changing the queue to exclude just-graded cards
- `recount` concurrency; the aggregate "75%" query population
- CI pipeline YAML

## Architecture / Approach

Two phases, one per risk. Each mixes a **Vitest layer** (write-payload contracts and side-effect
presence — fast, every commit) with a **pgTAP layer** (real `due <= now()`, RLS, CHECK constraints,
the `least()` clamp — load-bearing, PR-only via the `db-tests` job already required on `master`).
The rollout close-out (§6.5, §7, §3 status, deferred register) rides with Phase 2 so the cookbook
reflects what both phases actually did.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Risk #3 — schedule state | Write-payload contract + state fixtures + `.strict()` guard (Vitest); new `review_queue.test.sql` (pgTAP) | The oracle-safe assertion must compare to one `expected` object, not recompute per field, or it's a mirror test |
| 2. Risk #6 — counters + close-out | `rpcCalls == []` on edit; `recount` clamp + delete-edge pgTAP; §6.5 / §6.7 / §7 / §3 / deferred register | pgTAP seeding for the clamp case (more AI cards than `generated_count`) must actually exceed the cap to exercise `least()` |

**Prerequisites:** local `supabase start` for `npm run db:test`; research doc (done).
**Estimated effort:** ~2 sessions, one per phase.

## Open Risks & Assumptions

- The `reps`-guard pgTAP hand-writes the `UPDATE` the service emits (pgTAP can't call TypeScript).
  Mitigated by a comment-anchor to `src/lib/reviews/service.ts`; drift is a review catch, not an
  automated one.
- `astro check` is the typecheck gate (no `npm run typecheck` script) — invoked as `npx astro check`.
- Deriving a clean `state:3` (Relearning) fixture from the real module needs a Review-state card
  then `Again`; if the pinned params don't produce `state:3` there, fall back to a schema-valid
  hand-override with a comment.

## Success Criteria (Summary)

- A dropped or non-persisted schedule field, or a flipped queue predicate, now turns a test red.
- The `least()` clamp and both delete edges are regression-locked in pgTAP.
- An edit that touched a counter would fail a test; the rollout phase reads `complete` with §6.5
  and §7 reflecting what shipped.
