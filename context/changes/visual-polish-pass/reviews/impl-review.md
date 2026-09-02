<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Visual Polish Pass

- **Plan**: context/changes/visual-polish-pass/plan.md
- **Scope**: All phases (1–6 of 6)
- **Date**: 2026-09-02
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation
- **Triage**: F1 fixed, F2 fixed, F3 dismissed (plan note was wrong — `className` is correct). `astro check` / lint / tests re-verified green.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — EmptyState primitive does not accept `className` / forward props

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ui/empty-state.tsx:10
- **Detail**: Every other primitive in `src/components/ui/` (`card.tsx`, `button.tsx`, `textarea.tsx`) accepts `className` and merges it via `cn(...)`, plus spreads `...props`. `EmptyState` takes only `{ title, icon, action }` with no `className` passthrough and no `cn` import. Both current call sites (deck, review) use it bare, so nothing breaks — but the primitive is less reusable than its siblings and diverges from the house pattern. The plan's contract defined exactly these props, so this is plan-compliant; it's a convention drift, not a plan violation.
- **Fix**: Add `className?: string` to the props and pass it to `<Card className={cn(className)}>` (import `cn` from `@/lib/utils`), matching `card.tsx`.
- **Decision**: FIXED

### F2 — Dashboard h1 keeps `mb-2` inside a `flex flex-col gap-2` container

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:12
- **Detail**: Phase 3 wrapped the welcome card body in `<CardContent className="flex flex-col gap-2 text-center">`, which already spaces children by 8px. The `<h1 class="mb-2 ...">` adds another 8px below the heading, so the gap under the h1 (16px) is inconsistent with the 8px between the other two lines. Phase 2's "margines zostaje" note (`mb-4` → keep) predates the Phase 3 flex-gap wrapper that made the margin redundant. Purely cosmetic; no layout break.
- **Fix**: Drop `mb-2` from the h1 so `gap-2` is the single source of vertical rhythm in the card.
- **Decision**: FIXED

### F3 — `className` used instead of `class` on Astro-rendered React components

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:10-11
- **Detail**: `<Card className="mx-auto w-full max-w-sm">` / `<CardContent className="...">`. The plan's Critical Implementation Details and Phase 3 contract explicitly specified `class=` ("w `.astro` na komponencie React Astro akceptuje `class`"). `className` also works here — `astro check` and `npm run build` both pass and the static HTML renders correctly — so this is a trivial deviation from the written contract with no functional impact. Noted only because the plan called the choice out by name.
- **Fix**: Rename `className` → `class` on both elements to match the plan and the `.astro` convention elsewhere in the file tree.
- **Decision**: DISMISSED — attempted `class` during triage; `npx astro check` fails with TS2322 (`class` not on the React div props type). The implementer's `className` is correct; the plan's Critical Implementation Details note ("Astro akceptuje `class`") is wrong for a typed React component. No code change; plan note superseded.
