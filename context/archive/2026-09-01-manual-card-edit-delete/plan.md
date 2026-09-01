# Manual Card Edit and Delete Implementation Plan

## Overview

Add collection management for saved flashcards: owners can edit a card's question and answer inline, or permanently delete it after a confirmation dialog. The feature completes FR-006 and FR-007 without changing card source or spaced-repetition state.

## Current State Analysis

The collection page renders up to 50 cards server-side in `src/pages/deck.astro`, with no interactive mutation controls. `src/pages/api/flashcards.ts` accepts only creation requests, and `src/lib/flashcards/service.ts` provides only `createAiFlashcard`.

The database already supplies the needed data protections. The `flashcards_update_own` and `flashcards_delete_own` RLS policies restrict mutations to the authenticated owner, content constraints match shared length limits, and a trigger makes `source` immutable. The existing generation acceptance recount function must run after deleting a card with a `generation_id`, otherwise the generation KPI becomes stale.

## Desired End State

From `/deck`, a signed-in user can edit the front and back of one saved flashcard in place, validate the content, save it, or cancel without changing the stored card. The user can request deletion, read an explicit irreversible-action warning in a keyboard-accessible dialog, then either cancel or permanently remove the card.

The visible list updates only for the changed card; after the last deletion it immediately shows the existing empty-collection state. Failed requests keep the card and any local draft intact with a card-specific error and retry path. Owners cannot mutate another user's card, and edits do not modify its source, generation link, or SRS schedule.

### Key Discoveries:

- `src/pages/deck.astro` already limits the query to 50 newest cards and declares the future collection endpoint for S-03.
- `src/components/generate/GenerateView.tsx` supplies the established inline textarea, save, cancel, error, and Lucide-icon interaction pattern.
- `supabase/migrations/20260824202259_flashcards_schema.sql` already enforces content limits, source immutability, and per-owner update/delete RLS policies.
- `supabase/migrations/20260826141500_clamp_generation_acceptance.sql` recalculates per-generation acceptance counts from saved AI cards.
- `src/lib/test-support/supabase-stub.ts` can record selects and updates but needs explicit delete support for service-level tests.

## What We're NOT Doing

- Creating manual cards, changing a card source, changing generation links, or exposing SRS fields.
- Adding pagination, search, sorting, bulk editing, undo, soft delete, or recovery of a deleted card.
- Adding real-time synchronization or optimistic concurrency/versioning.
- Changing existing database constraints or RLS policies; they already cover this behavior.
- Building browser E2E infrastructure.

## Implementation Approach

Keep the current server-rendered deck data query, then pass the initial cards into a focused React collection island loaded on the page. The island owns per-card draft, save/delete progress, and error state so it can update one item without a full reload. Add an ID-addressed API route for `PATCH` and `DELETE`, both following the existing static-error and Zod-validation conventions, and centralize database work in flashcard service functions.

The service will use RLS-scoped lookups and mutations. An update sends only the trimmed `front` and `back` values. A delete first obtains the owned card's `generation_id`, deletes that same owned card, and triggers `recount_generation_acceptance` only when a generation link existed; a recount failure is logged without telling the client that a completed deletion failed.

## Critical Implementation Details

A generated card's `source` stays immutable even when its text changes, so editing must not affect acceptance buckets. Conversely, deletion changes the number of cards in a generation; it must recount after a successful delete and should preserve successful-delete semantics when the best-effort recount fails, matching the existing creation flow.

## Phase 1: Card Mutation Contract

### Overview

Expose validated, owner-scoped update and deletion operations while protecting immutable flashcard and SRS data.

### Changes Required:

#### 1. Flashcard service

**Files**: `src/lib/flashcards/service.ts`, `src/lib/test-support/supabase-stub.ts`, `src/lib/flashcards/service.test.ts`

**Intent**: Add typed update and deletion functions alongside creation, with error codes that let API callers distinguish an inaccessible/missing card from an infrastructure failure. Extend the existing service test seam so Phase 1 can verify both mutations. Preserve existing creation behavior.

**Contract**: `updateFlashcard` accepts `supabase`, `userId`, `flashcardId`, `front`, and `back`, and writes only trimmed content to the owner-visible row. `deleteFlashcard` accepts the same dependency and identifiers, returns success only when its owner-scoped delete returns the deleted `id`; no returned row maps to a typed not-found error, including when a concurrent request removes the card after lookup. It calls `recount_generation_acceptance` only after that confirmed deletion with a non-null `generation_id`; neither function writes source, ownership, generation, timestamps, or schedule fields. The test double records a `delete` operation and supports the chains used by these functions; focused service tests cover their success and failure contracts.

#### 2. Item API route

**File**: `src/pages/api/flashcards/[id].ts` (new)

**Intent**: Provide the collection island with resource-oriented `PATCH` and `DELETE` endpoints while applying the authentication, configuration, JSON parsing, and static-message conventions of the existing flashcards endpoint.

**Contract**: `PATCH /api/flashcards/:id` requires a UUID path parameter and JSON `{ front, back }` satisfying the shared trimmed limits; `DELETE /api/flashcards/:id` requires only a UUID path parameter. Both reject unauthenticated calls with 401 and missing Supabase configuration with 503, return 400 for malformed IDs or bodies, 404 when RLS exposes no card, and return a success response that the client can use to commit local state.

#### 3. Flashcard API messages and request schemas

**File**: `src/pages/api/flashcards/[id].ts` (new)

**Intent**: Make mutation failures actionable without echoing potentially sensitive card content or database details.

**Contract**: Reuse `FRONT_MAX_LENGTH` and `BACK_MAX_LENGTH` from `src/lib/limits.ts`; use static Polish messages for invalid content, not-found cards, unavailable service, and unexpected errors. Do not alter the create-card `POST /api/flashcards` contract.

### Success Criteria:

#### Automated Verification:

- Service tests demonstrate that an edit only writes `front` and `back`, is owner-scoped, and exposes typed not-found/persistence errors: `npm test -- src/lib/flashcards/service.test.ts`.
- Route tests cover valid `PATCH` and `DELETE` responses plus invalid ID/body, 401, 503, and 404 mappings: `npm test -- src/pages/api/flashcards/[id].test.ts`.
- The project typecheck/build accepts the dynamic Astro API route: `npm run build`.

#### Manual Verification:

- An authenticated owner can update a saved card and observe only its content changed; its source label and review schedule remain intact.
- Deleting a generated card removes it permanently and its generation acceptance counters match the remaining generated cards in Supabase.

**Implementation Note**: After completing this phase and its automated verification, pause for human confirmation of the manual checks before continuing.

---

## Phase 2: Interactive Deck Management

### Overview

Turn the static collection list into a focused client island that supports inline editing and deliberate deletion without sacrificing the SSR-loaded collection state.

### Changes Required:

#### 1. Collection management island

**File**: `src/components/deck/FlashcardCollection.tsx` (new)

**Intent**: Render the initial collection and own transient edit, delete-dialog, request-progress, draft, and per-card error state.

**Contract**: The component accepts the server-selected card fields (`id`, `front`, `back`, `source`, `created_at`) as serializable props. Exactly one card can enter inline editing at a time; save trims values and calls `PATCH`, cancel restores the original values, and a failed save retains the draft. A successful edit replaces only that card's displayed content. While a request is in flight, its controls are disabled and have an accessible loading state.

#### 2. Accessible destructive-action dialog

**File**: `src/components/ui/alert-dialog.tsx` (new)

**File**: `package.json`

**Intent**: Add the standard Radix alert-dialog primitive through the established shadcn-style UI layer, then use it for a clear, keyboard-accessible deletion confirmation.

**Contract**: The dialog names the pending irreversible deletion and exposes Cancel and destructive Delete actions. Opening it never mutates data; confirmation calls `DELETE /api/flashcards/:id`. On failure, the dialog closes or remains in a deterministic state while the card persists and receives a localized error message; on success, the card disappears from local collection state.

#### 3. Deck page integration

**File**: `src/pages/deck.astro`

**Intent**: Preserve the RLS-backed SSR query, collection-level error state, and navigation while delegating interactive card rendering to the new React island.

**Contract**: Render `FlashcardCollection` with `client:load` only when the server query succeeds. Move the current count, empty-state condition, source labels, date display, and card markup into the island so removing the final card immediately renders the existing empty state and its `/generate` link. Keep `PAGE_SIZE = 50` and do not add a user-ID filter.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes for the new React island, dynamic controls, and dialog component.
- `npm run build` renders the deck page and bundles the React island without Astro or TypeScript errors.

#### Manual Verification:

- On Chromium, edit a card inline, cancel a second edit, then save an edit; each state is readable, keyboard operable, and updates only the affected card without page reload.
- Delete a card, cancel from the confirmation dialog, then confirm deletion; the last-card case shows the empty collection immediately.
- Force a failed mutation and confirm the card remains visible, the draft survives a failed save, and an understandable error appears at that card.

**Implementation Note**: After completing this phase and its automated verification, pause for human confirmation of the manual checks before continuing.

---

## Phase 3: Mutation Regression Coverage

### Overview

Extend the local test seam to cover the new mutation operations and verify that collection-management behavior preserves database isolation and generation metrics.

### Changes Required:

#### 1. Collection-island component tests

**Files**: `src/components/deck/FlashcardCollection.test.tsx` (new), `vitest.config.ts`, `package.json`

**Intent**: Add a narrow React component-test seam for the collection island without changing the Node environment used by route and service tests.

**Contract**: Configure `jsdom` only for the new `.test.tsx` file and add the required React testing dependencies. Mock mutation responses and assert that a failed save retains its draft and card-specific error, a successful edit replaces only the targeted card, a confirmed delete removes only the targeted card, and deleting the final card renders the existing empty state.

#### 2. API route tests

**File**: `src/pages/api/flashcards/[id].test.ts` (new)

**Intent**: Lock the HTTP contract so UI changes cannot silently break authentication, validation, or error translation.

**Contract**: Invoke the exported Astro handlers with mocked locals and requests. Assert status and static response shape for valid updates/deletes, malformed input, unauthenticated/configuration-disabled requests, not-found service errors, and unexpected failures. Do not assert raw validation issue content.

#### 3. Database regression coverage

**Files**: `supabase/tests/rls_flashcards.test.sql`, `supabase/tests/recount_generation_acceptance.test.sql`

**Intent**: Retain the database-level guarantees the application relies on while exercising the deletion-induced recount outcome.

**Contract**: Keep/extend the RLS assertions that another authenticated user affects zero rows on update and delete. Add or adjust the recount test to prove a deleted AI-linked flashcard reduces the applicable acceptance count without violating `accepted_total <= generated_count`; do not add a migration when the current function passes the regression scenario.

### Success Criteria:

#### Automated Verification:

- Focused service, component, and API tests pass: `npm test -- src/lib/flashcards/service.test.ts src/components/deck/FlashcardCollection.test.tsx src/pages/api/flashcards/[id].test.ts`.
- All TypeScript tests pass: `npm test`.
- Database RLS and acceptance regressions pass locally: `npm run db:test`.
- Lint and production build pass: `npm run lint` and `npm run build`.

#### Manual Verification:

- Using two accounts, confirm one account cannot observe, edit, or delete the other account's card through the application or direct API calls.
- Inspect a generation before and after deleting one of its accepted AI cards and confirm the displayed/stored acceptance totals reflect the remaining cards.

**Implementation Note**: After completing this phase and its automated verification, pause for human confirmation of the manual checks before declaring the change ready to archive.

## Testing Strategy

### Unit Tests:

- Update sends only permitted trimmed content and preserves immutable fields by omission.
- Owner-scoped lookups/mutations map absent RLS-visible rows to a typed not-found result.
- Delete triggers acceptance recount only after successful deletion of a generated card, and logs but does not retry a completed delete when recount fails.
- Per-card UI state retains drafts and errors after failed saves and removes exactly one card after a successful delete.

### Integration Tests:

- Route handlers validate UUID path parameters and JSON content limits before service calls.
- Route handlers return static errors with correct status codes for auth, configuration, validation, missing cards, and persistence failures.
- pgTAP confirms cross-user update/delete attempts affect zero rows and recounting reflects deletion of AI cards.

### Manual Testing Steps:

1. Sign in, open `/deck`, edit both fields of an AI card, save, reload, and confirm the new text persisted while the source label remains unchanged.
2. Open edit on a second card, change content, cancel, and confirm original text remains; then simulate a failed save and confirm the typed draft remains available.
3. Open deletion confirmation, cancel it, then confirm deletion and verify only that card disappears without reload.
4. Delete the final collection card and verify the empty state and generation link appear immediately.
5. With a second account, attempt direct `PATCH` and `DELETE` calls for the first account's card and verify no mutation occurs.

## Performance Considerations

The page remains capped at 50 cards, so local state updates and a single loaded island are appropriate for the MVP. No polling, real-time subscription, pagination, or cache layer is required. The delete workflow adds at most an owner-scoped lookup, delete, and generation recount to a low-QPS operation.

## Migration Notes

No migration is expected: the schema already has content validation, an `updated_at` trigger, source immutability, update/delete RLS policies, and the generation recount function. Regenerate database types only if implementation reveals an actual schema change, which is not part of this plan.

## References

- Product requirements: `context/foundation/prd.md` (FR-006, FR-007, Access Control)
- Roadmap scope: `context/foundation/roadmap.md` (S-03)
- Existing collection: `src/pages/deck.astro`
- Existing mutation API: `src/pages/api/flashcards.ts`
- Existing inline edit UI: `src/components/generate/GenerateView.tsx`
- Database security and constraints: `supabase/migrations/20260824202259_flashcards_schema.sql`
- Acceptance reconciliation: `supabase/migrations/20260826141500_clamp_generation_acceptance.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Card Mutation Contract

#### Automated

- [x] 1.1 Extend the Supabase test double and add owner-scoped service tests for update, delete, errors, and generation recount — 24ccdca
- [x] 1.2 Add PATCH and DELETE API handlers with validation and static error mapping — 24ccdca
- [x] 1.3 Pass focused service and API tests — 24ccdca
- [x] 1.4 Pass production build for the dynamic API route — 24ccdca

#### Manual

- [x] 1.5 Verify an owner edit preserves source and SRS state — 24ccdca
- [x] 1.6 Verify an AI-card deletion reconciles its generation acceptance counters — 24ccdca

### Phase 2: Interactive Deck Management

#### Automated

- [x] 2.1 Add the deck collection island and accessible alert dialog — 6223e61
- [x] 2.2 Integrate the client island into the RLS-backed deck page — 6223e61
- [x] 2.3 Pass lint and production build — 6223e61

#### Manual

- [x] 2.4 Verify inline edit, cancel, save, dialog cancellation, and confirmed deletion in Chromium — 6223e61
- [x] 2.5 Verify empty state and card-specific failed-mutation feedback — 6223e61

### Phase 3: Mutation Regression Coverage

#### Automated

- [x] 3.1 Add the React component test seam and collection state tests — 08e8056
- [x] 3.2 Add API route contract tests — 08e8056
- [x] 3.3 Extend RLS and generation recount SQL regressions — 08e8056
- [x] 3.4 Pass the complete TypeScript suite, database tests, lint, and build — 08e8056

#### Manual

- [x] 3.5 Verify cross-account isolation and generation counters against Supabase — 08e8056
