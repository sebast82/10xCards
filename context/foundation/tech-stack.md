---
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
---

## Why this stack

Solo developer budujący MVP aplikacji do fiszek z generowaniem AI w 3 tygodnie (after-hours) potrzebuje battle-tested startera z auth, bazą danych i deploy gotowym od startu. Astro + Supabase + Cloudflare to rekomendowany default dla (web, js) i przechodzi wszystkie cztery bramy agent-friendly: typed (TypeScript + Zod), convention-based (opinionated layout), popular in training data (Astro 50k stars, React 19), well-documented (pinned docs). Confidence first-class — starter zarejestrowany z validnym CLI, oczekiwany smooth scaffolding. Auth i AI feature flags ustawione zgodnie z PRD (FR-001/002, FR-003); payments, realtime i background jobs poza zakresem per Non-Goals. CI na GitHub Actions z auto-deploy-on-merge — standardowy flow dla solo developera.
