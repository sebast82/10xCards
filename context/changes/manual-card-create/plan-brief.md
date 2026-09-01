# Manual Card Create — Plan Brief

> Full plan: `context/changes/manual-card-create/plan.md`

## What & Why

Add the must-have FR-005 path for creating one question-and-answer flashcard without AI. This covers topics where generation is unsuitable while keeping manual cards in the same collection and future SRS flow as generated cards.

## Starting Point

`/deck` already renders an interactive, owner-scoped collection with edit and delete behavior. The database already supports immutable `manual` provenance, a null generation link, and complete SRS state; only the manual insert contract and collection form are missing.

## Desired End State

The user opens an inline form above the collection, saves one valid card, and sees it immediately at the top with the `Ręczna` label. The card persists with the authenticated owner, no AI generation link, and a new-card SRS schedule, while failures preserve the draft and existing AI creation remains unchanged.

## Key Decisions Made

| Decision               | Choice                         | Why (1 sentence)                                                                    |
| ---------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| Creation scope         | One card per form submission   | Delivers FR-005 without batch semantics or partial-success handling.                |
| Form placement         | Inline above `/deck`           | Reuses the existing collection island and works for both empty and populated lists. |
| Success behavior       | Prepend and close              | Gives immediate confirmation while returning the collection to its normal state.    |
| Concurrent UI modes    | One active create or edit mode | Prevents silent draft loss and matches current single-card editing behavior.        |
| API surface            | Extend `POST /api/flashcards`  | The endpoint is already reserved for S-04 and avoids a duplicate write path.        |
| Request classification | Strict AI/manual payload union | Preserves the AI client and keeps `source` server-controlled.                       |
| Manual persistence     | Null generation and no recount | Manual cards do not belong to an AI generation or its acceptance KPI.               |
| Test scope             | Service, API, and component    | Covers data invariants, AI regression, and user-facing state transitions.           |

## Scope

**In scope:**

- Dedicated manual-create service behavior with standard SRS initialization.
- Manual variant of the authenticated flashcard POST endpoint.
- Inline collection form with validation, loading, cancel, error, and success states.
- Immediate prepend of the confirmed card and mutual exclusion with editing.
- Service, endpoint, component, lint, build, and manual Chromium verification.

**Out of scope:**

- Batch creation, import, tags, decks, templates, duplicate detection, or rapid-entry mode.
- New routes, modals, navigation items, pagination, search, or real-time updates.
- Schema/RLS migrations, KPI redesign, and browser E2E infrastructure.

## Architecture / Approach

The existing Astro deck page continues to SSR-fetch the initial RLS-scoped collection and mounts the same React island. The island sends a strict manual body to the existing JSON POST route; the route delegates to a dedicated service that assigns manual provenance, null generation, owner identity, and scheduler defaults. The response supplies the database ID and timestamp so the island can prepend the authoritative card without reloading.

## Phases at a Glance

| Phase                         | What it delivers                                                       | Key risk                                                 |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| 1. Manual Creation Contract   | Manual service insert and backward-compatible POST routing with tests  | Accidentally weakening or changing the AI request path   |
| 2. Inline Collection Creation | Form, local prepend, mode exclusion, errors, and complete verification | Losing drafts or adding phantom cards on failed requests |

**Prerequisites:** S-02, S-03, and S-07 are complete; Supabase configuration is available for manual persistence checks.
**Estimated effort:** ~1-2 sessions across 2 phases.

## Open Risks & Assumptions

- The 50-card newest-first collection cap remains acceptable for MVP; pagination is separate work.
- The server must return `created_at` for authoritative local ordering and display after insert.
- Existing RLS and schema tests remain sufficient because this change uses already-supported database state rather than introducing new policy behavior.

## Success Criteria (Summary)

- A signed-in user can create a manual card from empty or populated `/deck` and see it persist as `Ręczna` without reload.
- Manual cards receive valid SRS state, remain owner-isolated, and do not affect AI generation counters.
- Validation and request failures retain the draft, prevent phantom cards, and do not regress AI creation, editing, or deletion.
