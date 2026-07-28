# Copilot Instructions — 10xCards

## Conventions

- **API endpoints**: Return redirects with error messages as query params (pattern in `src/pages/api/auth/`). Supabase client is created per-request from headers + cookies.
- **`context/` directory**: Project planning artifacts (PRD, tech-stack notes, shape notes). Not application code — do not import from it.
- **React**: Used only for interactive islands — not for full pages. Astro components are the default.
- **Supabase client**: `src/lib/supabase.ts` returns `null` when env vars are missing. All callers must handle the `null` case.

### What doesn't exist yet

The PRD (`context/foundation/prd.md`) describes AI-powered flashcard generation, spaced repetition, and full CRUD for flashcards. None of these features are implemented — the codebase currently has only the starter scaffold with auth.

## Commands

See `@README.md` for setup and `@package.json` for scripts. No test framework is configured yet.
