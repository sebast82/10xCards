# Manual Card Create Implementation Plan

## Overview

Add manual flashcard creation to the existing collection screen so a signed-in user can save one question-and-answer pair without AI. The change reuses the current flashcard schema, SRS initialization, JSON endpoint, and interactive collection island while preserving the existing AI acceptance flow.

## Current State Analysis

`src/pages/deck.astro` server-renders up to 50 newest owner-visible cards into `FlashcardCollection`, which already owns edit, delete, draft, loading, and local list state. `POST /api/flashcards` currently accepts only AI proposals and delegates to `createAiFlashcard`; the service validates the generation, sets `source` to `ai` or `ai_edited`, initializes SRS state, inserts the card, and recounts generation acceptance.

The database already supports manual cards. `generation_id` is nullable, `flashcard_source` includes `manual`, source is immutable after insert, and insert/select RLS policies enforce ownership. No migration or generated-type update is needed.

## Desired End State

From `/deck`, the user can open one inline form above the collection, enter a valid front and back, save the card, and immediately see it at the top of the list with the `Ręczna` source label. A successful save closes and clears the form; cancel also discards its draft. Creating and editing are mutually exclusive modes.

The server persists the card with `source = manual`, `generation_id = null`, the authenticated owner, and the same initial SRS schedule as an AI card. Manual creation does not alter generation acceptance counters. Invalid, unauthorized, unavailable, and persistence-failure paths return static errors without exposing card content, while a failed UI request keeps the draft available for retry.

### Key Discoveries:

- `src/pages/api/flashcards.ts:15` has the existing trimmed content limits and authenticated JSON mutation convention to extend.
- `src/lib/flashcards/service.ts:47` contains the AI creation flow and shared SRS initialization pattern; its generation lookup and recount are intentionally AI-only.
- `src/components/deck/FlashcardCollection.tsx:48` already owns the capped collection state and reusable edit/error/loading behavior.
- `supabase/migrations/20260824202259_flashcards_schema.sql:1` defines `manual`; `generation_id` is nullable and owner-only insert RLS is already active.
- `docs/reference/contract-surfaces.md:53` reserves the existing `POST /api/flashcards` endpoint for both S-02 and S-04, so no new route is needed.

## What We're NOT Doing

- Batch or rapid-series creation, bulk import, card templates, tags, decks, or duplicate detection.
- A modal, dedicated create route, or new navigation item.
- Pagination, search, sorting, real-time synchronization, or increasing the 50-card collection cap.
- Client-selected arbitrary source values or changes to AI acceptance metrics.
- Database migrations, RLS changes, generated database types, or browser E2E infrastructure.
- Changes to editing, deletion, generation, or review-session behavior beyond regression protection.

## Implementation Approach

Extend the existing flashcard service with a dedicated manual-create operation, then make the existing POST route accept a strict union of two request shapes: the unchanged AI payload and a manual payload containing only `front` and `back`. Payload shape chooses the server branch; clients never submit a writable `source`. The manual service inserts the authenticated owner, null generation link, immutable manual source, trimmed content, and scheduler defaults, returning the database-generated `id` and `created_at`.

Extend `FlashcardCollection` rather than adding another island. It owns a separate create draft and error, renders the form above both populated and empty collection states, blocks creation while editing and editing while creating, and prepends the confirmed server result to local state. Existing page SSR, RLS query, source labels, and edit/delete behavior remain intact.

## Critical Implementation Details

### State sequencing

Do not prepend a card until the insert response provides the authoritative `id` and `created_at`; on failure, retain the create draft and keep the form open. The manual branch must not call `recount_generation_acceptance`, because it has no generation and does not contribute to AI acceptance metrics.

## Phase 1: Manual Creation Contract

### Overview

Add the owner-scoped service operation and extend the existing POST endpoint without changing the current AI request contract.

### Changes Required:

#### 1. Flashcard service

**Files**: `src/lib/flashcards/service.ts`, `src/lib/flashcards/service.test.ts`

**Intent**: Add a dedicated manual-card creation operation beside AI creation so generation ownership and KPI logic remain isolated to generated proposals.

**Contract**: `createManualFlashcard` accepts `supabase`, `userId`, `front`, and `back`; trims content defensively; inserts `user_id`, `generation_id: null`, `source: "manual"`, and all fields returned by `createScheduler().createNewCard(now)`; selects and returns `{ id, created_at }`. Insert errors map to the existing `persist_failed` service error. It performs no generation lookup or acceptance recount.

#### 2. Flashcard collection POST route

**Files**: `src/pages/api/flashcards.ts`, `src/pages/api/flashcards.test.ts` (new)

**Intent**: Let one authenticated endpoint create either an accepted AI proposal or a manual card while keeping source assignment and request classification on the server.

**Contract**: `POST /api/flashcards` accepts a strict union: the existing AI body `{ generationId, front, back, edited }`, or the manual body `{ front, back }`. Both content fields use shared trimmed limits. Ambiguous or mixed bodies are rejected with the existing static 400 response; missing user and Supabase configuration remain 401 and 503. The AI branch retains its current service call and response. The manual branch returns 201 with `{ id, created_at }`; persistence failures map to the existing static 500 response.

### Success Criteria:

#### Automated Verification:

- Service tests prove manual insert ownership, null generation, immutable source, complete initial SRS state, authoritative timestamp return, no KPI recount, and typed persistence failure: `npm test -- src/lib/flashcards/service.test.ts`.
- POST route tests cover successful manual creation, trimmed limits, malformed/mixed bodies, 401, 503, persistence failure, and the unchanged AI request branch: `npm test -- src/pages/api/flashcards.test.ts`.
- Production build type-checks the expanded service and API contracts: `npm run build`.

#### Manual Verification:

- An authenticated direct manual POST creates one row with `source = manual`, `generation_id = null`, the caller's `user_id`, and a valid new-card SRS schedule.
- A manual insert leaves generation acceptance counters unchanged, while an existing AI proposal can still be saved successfully.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Inline Collection Creation

### Overview

Expose manual creation on the collection screen and lock its interaction and failure behavior with component tests and full project verification.

### Changes Required:

#### 1. Collection creation form and local state

**Files**: `src/components/deck/FlashcardCollection.tsx`, `src/components/deck/FlashcardCollection.test.tsx`

**Intent**: Add an inline manual-card form above the list while preserving the existing collection, empty, edit, delete, and card-specific error states.

**Contract**: A clearly labeled Add action opens a two-textarea form using `FRONT_MAX_LENGTH` and `BACK_MAX_LENGTH`. Save trims and validates both fields, submits the manual POST body, disables relevant controls in flight, and on success prepends a card built from the submitted content plus server `id` and `created_at`, with `source: "manual"`, then slices local state to `pageSize`; it then clears and closes the form. Cancel clears and closes it without a request. Failed validation or requests keep the form and draft visible with a localized error.

#### 2. Mutually exclusive collection modes

**File**: `src/components/deck/FlashcardCollection.tsx`

**Intent**: Prevent competing create and edit drafts from producing ambiguous state or accidental data loss.

**Contract**: The Add action is unavailable while any existing card is being edited or mutated; existing Edit and Delete actions are unavailable while the create form is open or its request is pending. Opening either mode never silently discards the other mode's draft. The create form remains available when the collection is empty, alongside the existing path to AI generation.

#### 3. Deck copy and integration

**File**: `src/pages/deck.astro`

**Intent**: Make the collection description accurately cover both generated and manually created cards without changing SSR data loading.

**Contract**: Update only the descriptive copy needed to reflect mixed card origins. Keep `PAGE_SIZE = 50`, newest-first ordering, the RLS-only ownership boundary, and the existing `client:load` island integration.

### Success Criteria:

#### Automated Verification:

- Component tests cover open/cancel, client validation, failed-request draft retention, exact manual POST payload, successful prepend and close, page-size cap preservation, empty-collection creation, and create/edit mutual exclusion: `npm test -- src/components/deck/FlashcardCollection.test.tsx`.
- All TypeScript tests, including AI creation and edit/delete regressions, pass: `npm test`.
- Lint and production build pass: `npm run lint` and `npm run build`.

#### Manual Verification:

- In current Chromium, create a card from both empty and populated `/deck`; each appears first with the `Ręczna` label, persists after reload, and can use existing edit and delete controls.
- Cancel discards a create draft; a forced network/server failure keeps the draft and shows a readable retryable error without adding a phantom card.
- Creating and editing cannot be active together, controls expose loading/disabled states, and keyboard focus/order remain coherent.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before declaring the change ready to archive.

## Testing Strategy

### Unit Tests:

- Manual service insertion writes only owner, content, manual provenance, null generation, and scheduler-derived fields.
- Manual insertion returns the server timestamp, maps persistence failures, and never looks up or recounts a generation.
- Component state retains drafts on failure, clears them on cancel/success, prepends exactly one confirmed card, and enforces one active mutation mode.

### Integration Tests:

- The POST route distinguishes strict AI and manual payloads, preserves the existing AI behavior, and rejects mixed or malformed input before service work.
- Route handlers preserve static error responses for authentication, unavailable configuration, validation, and persistence failures.
- Existing database schema and RLS tests remain the regression boundary; no new database behavior is introduced.

### Manual Testing Steps:

1. Sign in, open a populated `/deck`, create a valid card, and confirm it appears first as `Ręczna` and persists after reload.
2. Edit and delete that manual card with the existing controls, confirming its source remains unchanged until deletion.
3. Delete all visible cards or use an empty account, then create from the empty state and confirm the AI-generation link remains available.
4. Try blank and boundary-length content, cancel a draft, and force a failed request to verify validation, draft retention, and absence of phantom cards.
5. Start editing an existing card and confirm creation is unavailable; then cancel editing, open creation, and confirm existing mutations are unavailable.
6. Save an AI proposal from `/generate` and confirm the pre-existing request path and acceptance recount still work.

## Performance Considerations

The deck remains capped at 50 cards, so prepending one object and rendering one inline form are bounded local operations. Manual creation adds one database insert and no generation lookup or recount; no caching, pagination, polling, or memoization is needed.

## Migration Notes

No database migration or data backfill is expected. The existing nullable `generation_id`, `manual` enum member, schedule columns, ownership RLS, constraints, and source-immutability trigger already express the required state.

## References

- Product requirement: `context/foundation/prd.md` (FR-005, Access Control, Guardrails)
- Roadmap scope: `context/foundation/roadmap.md` (S-04)
- API reservation: `docs/reference/contract-surfaces.md:53`
- Existing collection: `src/components/deck/FlashcardCollection.tsx:48`, `src/pages/deck.astro:7`
- Existing create service and API: `src/lib/flashcards/service.ts:47`, `src/pages/api/flashcards.ts:15`
- Existing AI client: `src/components/generate/GenerateView.tsx:113`
- Database contract: `supabase/migrations/20260824202259_flashcards_schema.sql:1`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Manual Creation Contract

#### Automated

- [x] 1.1 Pass service tests for owner-scoped manual insertion, SRS defaults, timestamps, errors, and no KPI recount
- [x] 1.2 Pass POST route tests for manual creation, validation, errors, and the unchanged AI request contract
- [x] 1.3 Pass the production build for service and API contracts

#### Manual

- [x] 1.5 Verify persisted manual provenance, null generation, ownership, and SRS schedule
- [x] 1.6 Verify manual creation leaves KPI counts unchanged and AI creation still succeeds

### Phase 2: Inline Collection Creation

#### Automated

- [ ] 2.1 Pass component tests for the inline form, local prepend, errors, empty state, and mode exclusion
- [ ] 2.2 Pass the complete TypeScript test suite, including AI creation and edit/delete regressions
- [ ] 2.3 Pass lint and production build

#### Manual

- [ ] 2.4 Verify create, reload persistence, edit/delete reuse, and empty-state behavior in Chromium
- [ ] 2.5 Verify cancel and forced failure preserve draft state without phantom cards
- [ ] 2.6 Verify accessible loading states and mutual exclusion between create and edit modes
