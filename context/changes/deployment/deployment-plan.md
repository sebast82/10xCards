# Plan: Pierwsze wdrożenie 10xCards na Cloudflare Workers

## Cel

Pierwszy deploy Astro 7 + React 19 (adapter `@astrojs/cloudflare` 14.x) na Cloudflare Workers.
Ścieżka: smoke-deploy **BEZ Supabase** (auth wyłączone) → **ręczny `wrangler deploy`** →
**natywny auto-deploy na push do `master` przez Cloudflare Workers Builds** (NIE GitHub Actions).
Każda faza z checkboxami — stanowa i trackowalna.

## Decyzje (2026-08-17)

- **Supabase**: najpierw smoke-deploy bez sekretów; aplikacja degraduje się gracefully (banner „auth wyłączone”). Sekrety dodajemy później.
- **Deploy**: ręczny teraz + auto-deploy na push do `master` przez Workers Builds (bez GitHub Actions).
- **Cloudflare**: dołączamy kroki setupu konta i `wrangler login`.
- **SessionKV**: adapter `@astrojs/cloudflare` 14.x **nie ma** opcji `session: false` (istnieje tylko `sessionKVBindingName`). Aplikacja używa cookies Supabase i nigdy nie woła `Astro.session`, więc pozwalamy na auto-provisioning KV `SESSION` przy deployu — jest nieinteraktywny i nieszkodliwy. Namespace powstaje automatycznie, ale nie jest używany.

## Rozbieżności infrastructure.md vs realny kod (WAŻNE)

- Kod używa `SUPABASE_URL` + `SUPABASE_KEY` (anon), **NIE** `SUPABASE_ANON_KEY`. `wrangler secret put` musi zgadzać się co do nazwy ze schematem `astro:env`.
- Brak OpenRouter/AI w kodzie — pierwszy deploy **nie wymaga** `OPENROUTER_API_KEY`. Limity CPU/subrequestów/6-połączeń dotyczą dopiero przyszłej funkcji AI.
- Kroki „Getting Started” 1–2 z `infrastructure.md` (dodaj adapter, `nodejs_compat`) **już zrobione**.
- Adapter nie wspiera już Pages → deploy = `wrangler deploy` na Workers. Hint `cloudflare-pages` w `tech-stack.md` jest nieaktualny.
- CI `ci.yml` działa na branchu `master`, bez kroku deploy.
- Lokalny Supabase (`127.0.0.1:54321`) **nie zadziała** z wdrożonego Workera — do auth w prod potrzebny cloud project.

## Prerequisites

### Narzędzia bazowe

- [x] **Node.js 24.19.0** (zgodnie z `.nvmrc`) — `node -v` → `v24.19.0`. Projekt celuje w Node 24 (zaktualizowane `.nvmrc` i CI `node-version: 24`).
- [x] `npm ci` — zależności zainstalowane (700 paczek; `npm audit`: 8 podatności — poza zakresem tego deployu).
- [x] Git skonfigurowany i repo połączone z GitHub (potrzebne później dla Workers Builds).
- [x] **GitHub CLI (`gh`)** zainstalowane — przyda się do połączenia repo z Workers Builds (Faza 3).

### CLI: Cloudflare Wrangler

`wrangler` jest już w devDependencies (`^4.90.0`) — używaj przez `npx wrangler`, bez globalnej instalacji.

- [x] `npx wrangler --version` — potwierdza dostępność
- [x] `npx wrangler login` — otwiera OAuth w przeglądarce; autoryzuje CLI dla Twojego konta
- [x] `npx wrangler whoami` — potwierdza zalogowane konto i email
- [ ] (dla CI/automatyzacji, opcjonalnie) zamiast `login` użyj tokenu:
  - Dashboard → My Profile → API Tokens → Create Token → szablon **Edit Cloudflare Workers**, zawężony do 1 konta/projektu (bez DNS, bez billing)
  - Ustaw w env: `CLOUDFLARE_API_TOKEN` (+ ewentualnie `CLOUDFLARE_ACCOUNT_ID`)
  - **Nigdy** nie commituj tokenu do repo ani do `wrangler.jsonc`

### CLI: Supabase

`supabase` CLI jest w devDependencies (`^2.23.4`) — używaj przez `npx supabase`.

- [ ] `npx supabase --version` — potwierdza dostępność
- [ ] `npx supabase login` — potrzebne tylko przy pracy z projektem w chmurze (link/pull/push)

### Supabase — opcja A: projekt w chmurze (wymagany do auth w prod)

Wdrożony Worker działa na edge, więc **musi** wskazywać na hostowany Supabase (nie lokalny `127.0.0.1`).

- [x] Utwórz projekt na <https://supabase.com/dashboard> (region blisko użytkowników)
- [ ] Skopiuj z **Settings → API**:
  - `SUPABASE_URL` = Project URL (`https://<project-ref>.supabase.co`)
  - `SUPABASE_KEY` = klucz **anon public** (NIE `service_role`)
- [ ] **Authentication → Email**: skonfiguruj potwierdzanie emaila zgodnie z potrzebą (domyślnie wymagane przed pierwszym logowaniem)
- [ ] Te wartości trafiają do prod przez `wrangler secret put` (Faza 4), lokalnie do `.dev.vars`

### Supabase — opcja B: stack lokalny (tylko dev, wymaga Dockera)

Wystarczający do lokalnego `npm run dev`, ale **nie** do wdrożonego Workera.

- [ ] Docker uruchomiony (~7 GB RAM)
- [ ] `npx supabase init` (jeśli `supabase/` nie jest jeszcze skonfigurowane)
- [ ] `npx supabase start` — pobiera obrazy przy pierwszym uruchomieniu
- [ ] Skopiuj z outputu CLI do `.env` i `.dev.vars`:
  - `SUPABASE_URL=http://127.0.0.1:54321`
  - `SUPABASE_KEY=<anon key z outputu>`
- [ ] Studio UI: `http://localhost:54323`; stop: `npx supabase stop`
- [ ] (dev tip) Aby pominąć potwierdzanie emaila: Studio → **Authentication → Email → Confirm email → off**

### Sekrety lokalne (`.dev.vars`)

- [x] `.dev.vars` istnieje w rootcie (jest w `.gitignore` — nie commitować). Utworzony na bazie `.env.example`.
- [ ] Zawiera `SUPABASE_URL` i `SUPABASE_KEY` (z opcji A lub B) — nazwy MUSZĄ zgadzać się ze schematem `astro:env`. Aktualnie **puste** — uzupełnić z Supabase Settings → API przed testem auth.
- [x] Uwaga: na etapie smoke-deployu (Faza 1–3) sekrety mogą być puste — aplikacja degraduje się gracefully (auth off)

## Pliki

- `astro.config.mjs` — bez zmian dot. sesji (adapter 14.x nie wspiera `session: false`; KV `SESSION` jest auto-provisionowany i niewykorzystywany). (Opcjonalnie) `vite.build.minify: false` dla czytelnych błędów w preview.
- `package.json` — (opcjonalnie) skrypt `"deploy": "astro build && wrangler deploy"`.
- `wrangler.jsonc` — bez zmian (`nodejs_compat`, `ASSETS`, `observability` już OK). Nazwa Workera: `10x-cards`.
- `src/lib/supabase.ts`, `src/lib/config-status.ts`, `src/middleware.ts` — bez zmian; obsługują brak sekretów (`null` → auth off).
- `.github/workflows/ci.yml` — bez zmian (auto-deploy idzie przez Workers Builds, nie GitHub Actions).

## Fazy

### Faza 0 — Setup Cloudflare (ręczne, manual gate)

- [x] Konto Cloudflare (utworzone / zalogowane)
- [x] `npx wrangler login` (OAuth w przeglądarce) — lokalna autoryzacja
- [x] `npx wrangler whoami` potwierdza konto
- [ ] (jeśli automatyzacja) API token scoped tylko do Workers dla 1 projektu, bez DNS/billing, w env var (nie w repo)

### Faza 1 — Pre-flight lokalny

- [x] `astro.config.mjs`: bez `session: false` (opcja nie istnieje w adapterze 14.x; KV `SESSION` auto-provisionowany, niewykorzystywany — app używa cookies Supabase)
- [x] `npx wrangler types` (typy bindingsów)
- [x] `npm run build` — sukces bez sekretów (są `optional`)
- [x] `npm run preview` (workerd) — strona wstaje (200, banner „Supabase nieskonfigurowany”), `/dashboard` → 302 `location: /auth/signin`
- [x] lint / błędy czyste (0 błędów; `endOfLine: "auto"` w `.prettierrc.json` neutralizuje szum CRLF na Windows; 2 nieblokujące warningi w generowanym `worker-configuration.d.ts`)

### Faza 2 — Pierwsze ręczne wdrożenie

- [ ] `npx wrangler deploy` (lub `astro build && wrangler deploy`)
- [ ] Zapisać URL `https://10x-cards.<subdomena>.workers.dev`
- [ ] Smoke prod: strona główna + banner + redirect `/dashboard`
- [ ] `npx wrangler tail` — brak błędów runtime (1101/1102), brak błędów `node:*`
- [ ] Znać rollback: `npx wrangler rollback`
- [ ] (opcjonalnie) skrypt `deploy` w `package.json`

### Faza 3 — Auto-deploy przez Workers Builds (natywne, bez GitHub Actions)

- [ ] Dashboard → Workers & Pages → `10x-cards` → Settings → Builds → Connect repo (GitHub)
- [ ] Production branch: `master`
- [ ] Build command: `npm run build`; Deploy command: `npx wrangler deploy`
- [ ] Non-prod branche → preview deployments
- [ ] Test: push do `master` → auto-build → auto-deploy; sprawdzić w dashboard / `wrangler deployments list`

### Faza 4 — (Później) Podpięcie Supabase w prod

- [ ] Cloud Supabase project (URL + anon key)
- [ ] `npx wrangler secret put SUPABASE_URL`
- [ ] `npx wrangler secret put SUPABASE_KEY`
- [ ] (Workers Builds) te same sekrety w Build settings, jeśli build ich wymaga (są `optional` → zwykle nie)
- [ ] Redeploy + weryfikacja auth (signup / signin / protected)

## Support / edge cases integracji zewnętrznych

1. **Supabase build na `workerd`**: `nodejs_compat` już ON; potwierdzić w `astro preview`, że klient buduje się bez `Could not resolve "node:..."`. Fallback: `prerenderEnvironment: 'node'` lub `optimizeDeps.include`.
2. **Nazwa sekretu** MUSI = schema `astro:env` (`SUPABASE_URL` / `SUPABASE_KEY`), inaczej `undefined` w runtime.
3. **Lokalny Supabase URL** nie działa z prod Workera → cloud project do auth.
4. **Cloudflare Auto Minify** łamie hydration React → wyłączyć w dashboard.
5. **KV `SESSION` auto-provision** → adapter 14.x nie ma `session: false`; namespace powstaje automatycznie przy deployu, ale app nie używa `Astro.session` (tylko cookies Supabase), więc jest nieszkodliwy.
6. **`astro dev` ≠ prod** → walidacja przez `astro preview` / `wrangler dev` przed deployem.
7. **`.dev.vars`** untracked (jest w `.gitignore`); sekrety prod tylko przez `wrangler secret put`.
8. **Przyszłe AI (OpenRouter)**: 10 ms CPU free-tier, 50 subrequestów, 6 równoległych połączeń — poza zakresem tego deployu.

## Weryfikacja

- `npm run build` + `npm run preview` lokalnie
- `wrangler deploy` → `workers.dev` URL 200, banner, redirect
- `wrangler tail` bez błędów
- push do `master` → auto-deploy działa
- rollback znany

## Poza zakresem

- Implementacja generowania AI / OpenRouter
- Sekrety Supabase w prod (Faza 4, gdy będzie cloud project)
- GitHub Actions deploy (świadomie: używamy Workers Builds)
- Dockerfile, multi-region / HA
