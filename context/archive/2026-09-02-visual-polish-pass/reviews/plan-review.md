<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Visual Polish Pass

- **Plan**: context/changes/visual-polish-pass/plan.md
- **Mode**: Deep
- **Date**: 2026-09-02
- **Verdict**: REVISE → SOUND after triage (all 5 findings fixed in plan)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING → PASS (F3 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F1, F2, F4, F5 fixed) |
| Plan Completeness | PASS |

## Grounding

19/19 paths ✓, line references accurate, Astro Fonts API config verified against current docs ✓,
Progress↔Phase mechanical contract consistent ✓, contract surfaces (Trasy / Endpointy API / Nazwy w
danych) not broken — visible copy only, routes unchanged ✓, brief↔plan consistent ✓.
Riskiest claims spot-checked: island double-container trap (covered in Critical Implementation
Details), font-token name collision (covered), `grep dark: src/components/ui/` returns zero after
Phase 6 (only button.tsx + textarea.tsx carry `dark:`), tests query by text/role not layout classes
(Phase 1 root-wrapper edits safe), EmptyState reuses exact panel strings (existing RTL assertions
still pass).

## Findings

### F1 — Dashboard welcome card stretches to full 48rem

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §3 + Phase 3 §5
- **Detail**: Phase 1 removes the dashboard's shrink-wrap centering and drops the card into
  `max-w-3xl` `<main>`; Phase 3 converts it to a full-width `<Card>`. Neither phase constrains the
  card. Result: a 768px box with three `text-center` lines and large empty margins. The auth
  "pattern screen" it echoes uses `max-w-sm`.
- **Fix A ⭐ Recommended**: Constrain the dashboard card (`mx-auto w-full max-w-sm`), top-aligned in
  the shared container — keeps the auth card's proportions.
- **Fix B**: Accept full-width; document as a known sparse state in Desired End State pending
  dashboard content.
- **Decision**: FIXED via Fix A — `max-w-sm` added to Phase 1 §3 Contract, Phase 3 §5 Contract
  (`<Card class="mx-auto w-full max-w-sm">`), Manual Verification 3.8, and Progress 3.8.

### F2 — `<html lang="en">` never switched to `pl`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 5 (Layout.astro:14)
- **Detail**: The app is already majority-Polish (nav, generate, deck, review); Phase 5 makes it
  fully Polish under an English document language — wrong screen-reader pronunciation, hyphenation,
  `:lang()` behavior. Pre-existing bug; Phase 5 is its natural home.
- **Fix**: Set `lang="pl"` in Layout.astro as part of Phase 5; add a success-criteria bullet.
- **Decision**: FIXED — Phase 5 §5 added (`<html lang="en">` → `<html lang="pl">`), Manual
  Verification bullet added, Progress row 5.6 inserted (Welcome check renumbered to 5.7).

### F3 — Roadmap Outcome names "jednolite formularze" but no phase closes it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State / Current State Analysis
- **Detail**: S-08 Outcome lists "jednolite formularze" as something the user should encounter. The
  plan scopes form-primitive work out (defensible, research decision #7) but never cites the
  evidence that forms are already uniform, leaving a reviewer no evidence line at S-08 close.
- **Fix**: Add a "forms already uniform" line to Current State Analysis (FormField inputBase +
  Textarea on tokens, per research) plus a closing manual-verification bullet.
- **Decision**: FIXED — "Formularze już jednolite" bullet added to Current State Analysis,
  Phase 3 closing verification bullet added, Progress row 3.10 added.

### F4 — Nav narrowed to `max-w-3xl`; `max-w-5xl` fallback contradicts the "one axis" goal

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2, Manual Verification 1.8
- **Detail**: Manual check 1.8 offered `max-w-5xl` for the nav alone if `max-w-3xl` looked cramped —
  but that breaks the "content edges and nav on one axis" end state, with no clean resolution if the
  check failed. Real nav content fits 48rem; visible change on wide screens is harder email
  truncation.
- **Fix**: Pre-commit the nav width; drop the `max-w-5xl` escape hatch, or restate the "one axis"
  criterion.
- **Decision**: FIXED — `max-w-3xl` committed in Phase 1 §2 with rationale, `max-w-5xl` fallback
  removed from Manual Verification 1.8 and Progress 1.8, plan-brief.md Open Risks line updated to
  match.

### F5 — Phase 1 pulls `button.tsx` into Astro SSR frontmatter

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §2 (AppNavigation.astro)
- **Detail**: `buttonVariants` lives in `button.tsx`, which top-level-imports `react` +
  `@radix-ui/react-slot`. Importing it into `.astro` frontmatter for a non-hydrated button drags
  those onto the server path under the Cloudflare adapter. Almost certainly fine (both SSR-safe).
- **Fix**: Add a fallback note — if `npm run build` fails on the import, extract `buttonVariants` to
  `src/components/ui/button-variants.ts` and import it from both `button.tsx` and the frontmatter.
- **Decision**: FIXED — fallback note added to Critical Implementation Details ("Nawigacja bez JS").
