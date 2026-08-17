---
project: 10xCards
researched_at: 2026-08-17
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 (React 19 islands)
  runtime: Cloudflare Workers (workerd)
---

## Recommendation

**Deploy on Cloudflare Workers.**

For a solo, after-hours 3-week MVP built on Astro 7 + `@astrojs/cloudflare` 14.x, Workers is the only candidate that passes all five agent-friendly criteria, is the registered default for this starter, and is the platform the developer already knows. The AI generation flow streams from OpenRouter (I/O-bound), so the free tier's 10 ms CPU limit — which excludes time spent waiting on `fetch` — is not a blocker for streaming responses. External Supabase + OpenRouter mean co-located services are irrelevant, and single-region reach makes Workers' edge network a free bonus rather than a requirement.

## Platform Comparison

Hard filters applied first: interview confirmed **no persistent server-side connections** are required, so no platform was dropped for serverless-only limitations. All six candidates support Astro 7 SSR (via official adapters or a Node container), so none were dropped on runtime grounds.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | 5 Pass |
| **Vercel** | Pass | Pass | Pass | Pass | Partial | 4P / 1 partial |
| **Netlify** | Pass | Pass | Pass | Pass | Pass | 5 Pass* |
| **Fly.io** | Pass | Partial | Pass | Pass | Partial | 3P / 2 partial |
| **Railway** | Pass | Pass | Partial | Pass | Partial | 3P / 2 partial |
| **Render** | Partial | Pass | Partial | Partial | Fail | 2P |

\* Netlify ties Cloudflare on raw criteria but loses on the interview weights (see below).

**Notes per platform:**

- **Cloudflare Workers** — `wrangler` covers the full loop (`wrangler deploy`, `wrangler rollback`, `wrangler tail`). Managed serverless with automatic TLS/routing/static-assets. Docs published as `llms.txt` + markdown (`View as Markdown` on every page). Deploy is one deterministic command. Multiple GA MCP servers (docs, Workers, observability). The registered starter default and the developer's known platform.
- **Vercel** — Best-in-class Astro DX via `@astrojs/vercel`, `vercel deploy` / `vercel rollback` / `vercel logs`. Docs are MDX with agent-oriented `.graph.md` cross-link maps. Scored Partial on integration only because **Vercel MCP is beta (checked 2026-08-17)**. Serverless function max-duration limits are a real risk for long AI streams on the Hobby tier.
- **Netlify** — `@astrojs/netlify` is mature; Netlify MCP is GA. Strong on paper, but `netlify deploy` is **draft by default and requires `--prod`** (a foot-gun for an agent), and it's less Astro-native than Vercel. Loses the tie on familiarity (Cloudflare) and adds no edge advantage the recommendation lacks.
- **Fly.io** — Container model (`flyctl deploy`, `fly releases`, `fly logs`). A persistent container removes any serverless streaming-timeout worry, but scores Partial on "managed" because containers add operational surface (Dockerfile, always-on billing or autostop tuning) that the MVP scope doesn't need.
- **Railway** — Good DX and co-located Postgres, but **no free tier (usage-based, ~$5 trial credit)** and co-location is moot since the project uses external Supabase. Docs less agent-structured.
- **Render** — Free tier **spins down and cold-starts**, deploy is via deploy hooks/API rather than a first-class scriptable CLI loop, and no notable agent/MCP integration. Weakest fit.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Passes all five criteria, is the starter's registered default (`deployment_target: cloudflare-pages` in tech-stack — see the Pages→Workers note below), and is the platform the developer already knows. Generous free tier (100k req/day), no response-body size limit for streaming, `llms.txt` docs the agent can read directly, and GA MCP servers for operating live state.

#### 2. Vercel

The smoothest Astro deployment experience and excellent agent-readable docs. Held to runner-up because its serverless function duration limits are a genuine risk for a >30 s AI stream on the free tier, its MCP is still beta, and it offers no advantage over Cloudflare for a Cloudflare-familiar developer.

#### 3. Fly.io

The escape hatch: a persistent container has no serverless CPU/duration ceiling, so if streaming generation ever bumps into Workers' free-tier CPU limit, Fly.io removes that class of problem entirely. The gap vs. the recommendation is higher operational overhead (container image, always-on/autostop billing) that an MVP shouldn't pay for up front.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`workerd` is not Node.js.** `@supabase/supabase-js` and transitive deps assume Node APIs. Without `nodejs_compat` (and occasionally specific polyfills) the build fails with `Could not resolve "node:..."`. This is a concrete, recurring pitfall for this exact stack.
2. **The 10 ms free-tier CPU limit is deceptively "safe."** Parsing large AI responses, `JSON.parse` of big payloads, or transforming many generated flashcards synchronously counts as *CPU time* (network wait does not). Heavy result transformation can exceed 10 ms and fail only under load.
3. **50 subrequests/request on the free tier.** If a single generation request fans out into many OpenRouter + Supabase calls, it can hit the limit.
4. **Pages vs Workers drift.** tech-stack.md hints `cloudflare-pages`, but the current `@astrojs/cloudflare` adapter and Astro docs target **Workers** (`wrangler deploy`). Following older "Pages" tutorials (`wrangler pages deploy`) yields an incorrect flow.
5. **Secret access pattern differs from `process.env`.** Env/secrets are read via `cloudflare:workers` / `astro:env`. A secret set only in local `.dev.vars` but never via `wrangler secret put` shows up as `undefined` in production.

### Pre-Mortem — How This Could Fail

The team shipped Astro on Workers in a week; everything worked locally. A month in, users reported truncated generations — under load, transforming the AI response exceeded the 10 ms free-tier CPU budget and a fraction of requests failed with error 1102. Upgrading to Workers Paid fixed CPU, but then the Supabase client's auth/realtime paths behaved differently on `workerd` than in local Node, because `astro dev` had silently used a Node fallback for some code paths. The developer burned days chasing runtime differences the local environment never surfaced. Compounding it, the tutorials the agent leaned on described the deprecated "Pages" flow, so `wrangler.jsonc` and static-asset routing were subtly inconsistent. What was scoped as "deploy in 3 weeks" slipped a week on infrastructure alone.

### Unknown Unknowns

- **The adapter targets Workers + Static Assets, not Pages** — despite the `cloudflare-pages` hint in tech-stack.md. The canonical 2025/2026 deploy is `wrangler deploy`, not `wrangler pages deploy`. Adopt this consciously.
- **`astro dev` ≠ production `workerd`.** Local dev doesn't always mirror `workerd` 1:1 for prerender (`prerenderEnvironment: 'workerd' | 'node'`). Validate with `astro build && wrangler dev` to catch runtime mismatches before deploy.
- **Cloudflare Auto Minify breaks React island hydration** (`Hydration completed but contains mismatches`) — must be disabled in Cloudflare settings.
- **Free tier allows only 6 simultaneous outgoing connections per request** — relevant if generation fans out multiple concurrent OpenRouter calls.
- **KV auto-provisioning.** The adapter can auto-provision a `SESSION` KV binding on deploy — a resource appears that you never declared explicitly.

## Operational Story

- **Preview deploys**: Wrangler prints a preview URL after every `wrangler deploy`; each version gets a `*.workers.dev` subdomain. With Workers Builds (CI on push) you get per-commit builds; branch/PR previews are configured in the Workers Builds settings. Protect non-production preview URLs with Cloudflare Access if the MVP handles real user data.
- **Secrets**: Production secrets (Supabase service key, OpenRouter API key) are set with `wrangler secret put <KEY>` — encrypted, not visible in the dashboard or config afterward. Local dev reads them from an untracked `.dev.vars` file. Non-sensitive vars live in `wrangler.jsonc`. Never commit `.dev.vars`. Rotation = re-run `wrangler secret put`.
- **Rollback**: `wrangler rollback [--message "reason"]` reverts to the previous deployed version; near-instant since it re-points to an existing version. Caveat: rollback reverts *code*, not external state — Supabase schema/data migrations do not roll back automatically.
- **Approval**: The agent may run `wrangler deploy`, `wrangler tail`, and `wrangler rollback` unattended for the MVP. Human-only actions: creating/rotating the primary OpenRouter/Supabase secrets, deleting the Worker or KV namespaces, and any Supabase-side destructive migration. Use a Cloudflare API token scoped to Workers for one project (no DNS, no billing) — stored in an env var, never committed in `.mcp.json` or the repo.
- **Logs**: `wrangler tail` streams live runtime logs (read-only). For structured/historical access, the Cloudflare observability MCP server exposes logs and analytics as typed tools the agent can query.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Supabase JS / deps fail to build on `workerd` (`node:*` unresolved) | Devil's advocate | M | H | Enable `nodejs_compat` in `wrangler.jsonc`; verify the Supabase client works under `wrangler dev` before first deploy; swap incompatible deps. |
| Free-tier 10 ms CPU exceeded by AI-response transformation under load | Pre-mortem | M | M | Keep post-generation processing lean; stream/pass-through instead of buffering; upgrade to Workers Paid (5 min CPU) if 1102 errors appear. |
| 50 subrequests / 6 concurrent-connection limit hit by generation fan-out | Devil's advocate | L | M | Batch/serialize OpenRouter calls; cap concurrency; monitor via `wrangler tail`. |
| Agent follows deprecated "Pages" flow instead of Workers | Unknown unknowns | M | M | Standardize on `wrangler deploy`; record in AGENTS.md that this project targets Workers + Static Assets, not Pages. |
| Secret set only in `.dev.vars`, missing in prod (`undefined` at runtime) | Devil's advocate | M | H | Checklist: every secret set via `wrangler secret put` before deploy; validate with `astro:env` typed access at startup. |
| `astro dev` masks `workerd`/Node runtime differences | Unknown unknowns | M | M | Pre-deploy smoke test via `astro build && wrangler dev`; set `prerenderEnvironment` appropriately. |
| Auto Minify breaks React island hydration | Unknown unknowns | L | M | Disable Auto Minify in Cloudflare dashboard settings. |
| Source text leaks into logs/storage (PRD NFR: paste must not persist) | Research finding | L | H | Do not log request bodies in `wrangler tail` sessions; ensure no KV/D1 write of source text; process-and-discard in the request handler. |

## Getting Started

Commands validated against the current `@astrojs/cloudflare` adapter (Workers + Static Assets target, not Pages):

1. **Add the adapter** (installs `@astrojs/cloudflare` and wires `astro.config.mjs` + `wrangler.jsonc`):
   ```
   npx astro add cloudflare
   ```
2. **Enable Node compat** for the Supabase client — add to `wrangler.jsonc`:
   ```jsonc
   "compatibility_flags": ["nodejs_compat"],
   "compatibility_date": "2026-08-17"
   ```
3. **Set secrets** (production) and mirror them locally in an untracked `.dev.vars`:
   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_ANON_KEY
   npx wrangler secret put OPENROUTER_API_KEY
   ```
4. **Validate against the real runtime** before deploying:
   ```
   npx astro build && npx wrangler dev
   ```
5. **Deploy** (and note the rollback/logs commands for operations):
   ```
   npx astro build && npx wrangler deploy
   # rollback:  npx wrangler rollback
   # live logs: npx wrangler tail
   ```

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
