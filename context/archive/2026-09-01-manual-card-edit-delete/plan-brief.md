# Manual Card Edit and Delete — Plan Brief

> Full plan: `context/changes/manual-card-edit-delete/plan.md`

## What & Why

This change completes the collection-management portion of the MVP: a user can correct the question or answer of a saved flashcard and permanently remove an unnecessary one. It fulfills FR-006 and FR-007 while protecting the learning schedule, source metadata, ownership boundary, and AI-generation acceptance metrics.

## Starting Point

`/deck` is a server-rendered, RLS-scoped list of at most 50 saved cards with no mutation controls. The database already has content constraints, owner-only update/delete policies, immutable source metadata, timestamp updates, and a function for recalculating generation acceptance counts.

## Desired End State

A collection card can enter an inline edit mode with Save and Cancel, allowing changes only to its front and back. Deletion requires an accessible confirmation dialog that makes permanence explicit; confirmed deletion updates the list immediately, including the empty state after the final card.

A mutation failure leaves the affected card and its local edit draft in place with a readable, card-specific error. A user cannot change another user's records, card source, generation linkage, or SRS schedule.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Edit interaction | Inline within the collection card | Matches the existing generated-proposal editing model and preserves list context. | Plan |
| Delete safeguard | Accessible alert dialog | Deletion is intentionally permanent and needs an explicit, keyboard-usable confirmation. | Roadmap / Plan |
| Editable fields | Only `front` and `back` | Source metadata and SRS state must remain stable for metrics and learning correctness. | Research / Plan |
| Success rendering | Update local item state | The small, capped collection can respond immediately without losing scroll position. | Plan |
| Mutation error UX | Per-card error with retained draft | A failed save must not discard the user's work or leave ambiguity about its target. | Plan |
| Concurrent changes | Preserve local draft and report missing card | Avoids silent loss without adding versioning or real-time synchronization. | Plan |
| Test scope | Service, route, and SQL regression tests | Covers the mutation contract and owner-only database boundary without creating E2E infrastructure. | Plan |

## Scope

**In scope:**

- Owner-only `PATCH` and `DELETE` endpoints for one flashcard.
- Flashcard service operations and generation-counter reconciliation after relevant deletion.
- React collection island with inline edit, card-specific errors, and local list updates.
- Accessible confirmation dialog for permanent deletion.
- Unit, endpoint, RLS, and acceptance-recount regression coverage.

**Out of scope:**

- Manual creation, bulk actions, undo/soft delete, pagination, search, sort, or real-time synchronization.
- Changes to card source, generation reference, SRS schedule, existing RLS policy, or database schema.
- Browser E2E test infrastructure.

## Architecture / Approach

The Astro page continues to fetch the initial RLS-scoped collection on the server and mounts a small React island only for management controls. The island sends JSON mutations to an ID-addressed API route; that route validates input and delegates to the flashcard service. The service relies on RLS and updates only the permitted content, while deletion obtains the generation ID before removal and performs a best-effort recount afterward.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Card mutation contract | Owner-scoped update/delete service functions and validated API route | Stale generation metrics after deletion |
| 2. Interactive deck management | Inline edit, alert dialog, local state, and empty/error states | Keeping drafts and UI state correct through failures |
| 3. Mutation regression coverage | Expanded test double, route tests, RLS and recount regressions | Coverage must verify the database boundary, not just UI |

**Prerequisites:** S-02 and S-07 are complete; local Supabase is available for `npm run db:test`.
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- The application currently has no dialog primitive; the implementation adds the standard Radix alert-dialog dependency and a local shadcn-style wrapper.
- The deck stays capped at 50 cards, which makes client-managed local list state acceptable for MVP.
- Recounting remains best-effort after a successful deletion, consistent with the existing creation operation; failures are logged without causing a destructive-operation retry.

## Success Criteria (Summary)

- An owner can edit or deliberately delete a saved card from `/deck` without a full page reload.
- Edits change only question/answer; deletion is confirmed, permanent, and updates AI-generation counts when applicable.
- Invalid, unavailable, missing, and unauthorized mutation paths fail safely, keep user data intact, and are covered by automated tests.
