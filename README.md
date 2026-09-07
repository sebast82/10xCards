# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v24.19.0+ (24.x only; `.nvmrc` provides the local baseline)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm test` - Run unit and integration tests (Vitest)
- `npm run db:test` - Run database policy and procedure tests (pgTAP; needs a running local Supabase stack)
- `npm run test:e2e` - Run the Playwright end-to-end suite ([setup](#end-to-end-tests) required)
- `npm run test:e2e:ui` - Same suite in Playwright's interactive runner
- `npm run test:e2e:report` - Open the HTML report (traces, screenshots) from the last run

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

The repository uses database port `55432` for local Supabase because the default `54322` can be unavailable on Windows. Use the endpoints printed by `npx supabase status` when configuring local environment files.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Apply the schema and RLS policies to the local database:

```bash
npx supabase db reset
```

5. Regenerate the typed database contract used by the app:

```bash
npm run db:types
```

`src/db/database.types.ts` is generated output — never edit it by hand. Change the migration, then re-run `npx supabase db reset` and `npm run db:types`.

6. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

7. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

This project now includes a committed schema migration for flashcards and generation records, plus row-level security so each user only sees their own records.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, link and push the migration before running the app locally against the remote database:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push --dry-run
npx supabase db push
```

Then add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated) |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

## Testing

Unit and integration tests run under Vitest and need no services:

```bash
npm test
```

Database policy and procedure tests (pgTAP) run against the local stack:

```bash
npx supabase start
npm run db:test
```

### End-to-end tests

Playwright drives Chromium against a real `astro dev` server, which the runner starts for you (it
reuses one already listening on port 4321 if you have `npm run dev` open). Setup is a one-time step:

1. **Create a test account.** Sign up once through `/auth/signup` in the app. It must exist in
   whichever Supabase project the dev server actually reads — note that locally `.dev.vars` wins
   over `.env`, because the Cloudflare adapter loads it into `process.env` at startup.

2. **Create `.env.test`** with that account's credentials. The keys are the last two in
   `.env.example`; Playwright loads this file itself (`playwright.config.ts`), and it is gitignored:

   ```
   E2E_USERNAME=you+e2e@example.com
   E2E_PASSWORD=<password>
   ```

3. **Run the suite:**

   ```bash
   npm run test:e2e
   ```

**Precondition — the test account's review queue must be empty.** `tests/e2e/critical-loop.spec.ts`
creates a flashcard, which becomes due immediately, and `/review` renders only the first card of the
queue sorted by due date ascending — so any card left over from an earlier session hides it. The spec
checks this before doing anything else and fails with the fronts of the overdue cards listed. That
failure means the test account needs its reviews cleared (grade them in the app), not that the
application is broken.

After a failure, open the trace and screenshots:

```bash
npm run test:e2e:report
```

Optional environment overrides: `E2E_PORT` (default `4321`) and `E2E_BASE_URL` to point the suite at
an already-running server elsewhere.

## Deployment

GitHub Actions validates each push with `npm ci`, `astro sync`, `astro check`, lint, tests, and build.

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs three jobs:

| Job        | Runs on                       | What it does                                                                                                       |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ci`       | every push and PR to `master` | `astro check`, lint, `npm test`, build                                                                             |
| `db-tests` | pull requests only            | pgTAP policy suite against a local Supabase stack                                                                  |
| `e2e`      | pull requests only            | the Playwright suite against `astro dev`, with its own local Supabase stack and a test user provisioned in the job |

Repository secrets: `SUPABASE_URL` and `SUPABASE_KEY` for the `ci` build step, plus `E2E_USERNAME` and
`E2E_PASSWORD` for the `e2e` job — that job creates the account in its own throwaway stack, so the
values only need to be a valid email and password.

None of these jobs is a required status check: branch protection is unavailable on this repository's
plan, so a red run does not block the merge button. See `context/foundation/test-plan.md` §7.

## License

MIT
