---
bootstrapped_at: 2026-07-27T11:54:42Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: 10x-cards
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: 10x-cards
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Solo developer budujący MVP aplikacji do fiszek z generowaniem AI w 3 tygodnie (after-hours) potrzebuje battle-tested startera z auth, bazą danych i deploy gotowym od startu. Astro + Supabase + Cloudflare to rekomendowany default dla (web, js) i przechodzi wszystkie cztery bramy agent-friendly: typed (TypeScript + Zod), convention-based (opinionated layout), popular in training data (Astro 50k stars, React 19), well-documented (pinned docs). Confidence first-class — starter zarejestrowany z validnym CLI, oczekiwany smooth scaffolding. Auth i AI feature flags ustawione zgodnie z PRD (FR-001/002, FR-003); payments, realtime i background jobs poza zakresem per Non-Goals. CI na GitHub Actions z auto-deploy-on-merge — standardowy flow dla solo developera.

## Pre-scaffold verification

| Signal        | Value                                         | Severity | Notes                          |
| ------------- | --------------------------------------------- | -------- | ------------------------------ |
| npm package   | not run                                       | —        | cmd_template uses git clone    |
| GitHub repo   | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url             |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 31,514
**Conflicts (.scaffold siblings)**: CLAUDE.md
**.gitignore handling**: moved silently (no pre-existing .gitignore in cwd)
**.bootstrap-scaffold/.git/ deleted**: yes (upstream history removed)
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 1 CRITICAL, 12 HIGH, 7 MODERATE, 2 LOW (22 total)
**Direct vs transitive**: 0/1/2/0 direct of total 1/12/7/2

#### CRITICAL findings

- **tar** <=7.5.20 — transitive; fix available

#### HIGH findings

- **astro** <=7.0.9 — direct; fix available
- **brace-expansion** <=5.0.7 — transitive; fix available
- **devalue** 5.6.3–5.8.0 — transitive; fix available
- **fast-uri** 3.0.0–3.1.3 — transitive; fix available
- **js-yaml** 4.0.0–4.2.0 — transitive; fix available
- **miniflare** <=0.0.0-fff677e35 || 3.20250204.0–4.20260721.0 — transitive; fix available
- **postcss** <=8.5.17 — transitive; fix available
- **sharp** <0.35.0 — transitive; fix available
- **svgo** 4.0.0–4.0.1 — transitive; fix available
- **undici** 7.0.0–7.27.2 — transitive; fix available
- **vite** 7.0.0–7.3.3 — transitive; fix available
- **ws** 8.0.0–8.20.1 — transitive; fix available

#### MODERATE findings

- **@astrojs/language-server** 2.14.0–2.16.10 — transitive
- **@cloudflare/vite-plugin** 0.0.7–1.41.0 — transitive
- **supabase** 1.1.6–2.98.2 — direct
- **volar-service-yaml** <=0.0.70 — transitive
- **wrangler** 3.108.0–4.101.0 — direct
- **yaml** 2.0.0–2.8.2 — transitive
- **yaml-language-server** — transitive

#### LOW / INFO findings

- **@babel/core** <=7.29.0 — transitive
- **esbuild** 0.27.3–0.28.0 — transitive

## Hints recorded but not acted on

| Hint                       | Value                |
| -------------------------- | -------------------- |
| bootstrapper_confidence    | first-class          |
| quality_override           | false                |
| path_taken                 | standard             |
| self_check_answers         | null                 |
| team_size                  | solo                 |
| deployment_target          | cloudflare-pages     |
| ci_provider                | github-actions       |
| ci_default_flow            | auto-deploy-on-merge |
| has_auth                   | true                 |
| has_payments               | false                |
| has_realtime               | false                |
| has_ai                     | true                 |
| has_background_jobs        | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
