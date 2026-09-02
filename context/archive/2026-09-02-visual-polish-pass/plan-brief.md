# Visual Polish Pass — Plan Brief

> Full plan: `context/changes/visual-polish-pass/plan.md`
> Research: `context/changes/visual-polish-pass/research.md`

## What & Why

Ujednolicamy warstwę prezentacji wszystkich ekranów zalogowanej aplikacji do języka wizualnego
`/auth/signin` (minimalistyczna karta na tokenach shadcn/ui). To S-08 z roadmapy — przebieg
wykończeniowy przed publicznym debiutem, ostatni bufor terminu 2026-09-07. System tokenów i prymitywy
są już wdrożone i spójne; problem jest **kompozycyjny, nie palety**: `AppLayout`'s `<main>` jest bez
klas, więc każdy ekran wymyśla własny kontener, skala nagłówków dryfuje, panele stanów pustych
wyglądają płasko.

## Starting Point

`AppLayout.astro` owija `AppNavigation` + goły `<main>`. Cztery ekrany (`dashboard`, `generate`, `deck`,
`review`) każdy ma inny `max-w`, inne wyrównanie w pionie (dashboard i login centrowane pełnoekranowo,
reszta top-aligned) i inny rytm odstępów. Dashboard ma jedyny `text-3xl` w apce, review nie ma `<h1>`.
Panele „pusta kolekcja" / „koniec sesji" to gołe `<div>` bez `bg-card`/`shadow-sm`. Przycisk „Wyloguj"
omija prymityw `<Button>`. Brak webfontu. Teksty auth + dashboard po angielsku, reszta po polsku.

## Desired End State

Użytkownik przechodząc między ekranami aplikacji widzi jeden układ: treść w kolumnie `max-w-3xl`
wyrównana do góry pod nawigacją tej samej szerokości, jedna skala nagłówków (`text-2xl` h1 wszędzie),
te same karty, panele stanów wyglądające jak karty. Po fazach bufora: krój Inter (self-hosted, bez
FOUC), polskie teksty auth i dashboard, brak martwych `dark:` w prymitywach. Ekrany `/auth/*` zachowują
swój wyśrodkowany minimalizm — to wzorzec, nie cel zmian. Landing `/` (kosmiczny) nietknięty.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Co to „ekran startowy z logowaniem" | `/auth/signin` (tokenowa karta), nie kosmiczny landing | Mieści się w zakresie i terminie S-08; landing to redesign poza zakresem | Research |
| Dark mode | Light-only; tokeny `.dark` zostają uśpione | Roadmap S-08 Risk sugeruje przycinanie głębokości; bezpieczniejszy default na termin | Research |
| Warstwa typografii | Wchodzi realna (webfont + tokeny + skala) | Największy brakujący fundament wizualny | Research |
| Gdzie kontener treści | Jeden w `AppLayout` `<main>`, `max-w-3xl` | Jedna zmiana ustawia 4 ekrany + przyszłe; najtańszy skuteczny punkt wg badania | Plan |
| Szerokość treści + nav | `max-w-3xl` dla obu (nav zwężony z `max-w-6xl`) | Krawędzie treści i nav w jednej osi | Plan |
| Font | Inter przez Astro Fonts API (Fontsource, self-hosted) | Zero FOUC, zero third-party CDN, działa na Cloudflare Workers; domyślny język shadcn | Plan |
| Panele stanów | Wspólny `<Card>` + nowy `<EmptyState>` | Jeden wygląd na wszystkich ekranach; usuwa 3 implementacje `div` | Plan |
| Przycisk wylogowania | `buttonVariants({outline, sm})` na `<button>`, bez nowych prymitywów | Zero ryzyka regresji nav (bez JS, 320px, klawiatura); zgodne z „copy-don't-abstract" | Plan |
| Dashboard | Top-aligned jak rodzeństwo, zostaje kartą powitalną | Badanie: „dashboard ostylowany jak login, nie jak rodzeństwo" | Plan |
| Język auth + dashboard | Tłumaczymy na PL (nagłówki, etykiety, walidacja) | Mieszany PL/EN na ekranie logowania to złe pierwsze wrażenie na debiut | Plan |
| Priorytet cięcia | Rdzeń: kontener + nav + typo-skala + stany. Bufor: webfont, PL, `dark:` | Rdzeń = Outcome S-08; bufor = najlepszy stosunek pracy do ryzyka | Plan |

## Scope

**In scope:**
- Wspólny kontener treści w `AppLayout` `<main>`; nav wyrównany do osi
- Zdjęcie własnych wrapperów z `dashboard`/`deck`/`generate`/`review`
- Ujednolicona skala nagłówków; `<h1>` w review; `text-3xl` → `text-2xl` w dashboard
- Przycisk „Wyloguj" na `buttonVariants`; marka nav dostaje rozmiar
- Nowy `<EmptyState>`; panele stanów pustych przez `<Card>`
- (bufor) Webfont Inter przez Astro Fonts API
- (bufor) Lokalizacja PL: `src/pages/auth/*` + `src/components/auth/*` + `dashboard.astro`
- (bufor) Usunięcie `dark:` z prymitywów `ui/`

**Out of scope:**
- `index.astro` / `Welcome.astro` (kosmiczny landing)
- `Topbar.astro` (martwy kod)
- Dark mode UX (przełącznik, persystencja, anty-FOUC); blok `.dark` w `global.css` zostaje
- Nowe prymitywy `<Input>`/`<Label>`/`<Badge>`; przepisanie `FormField`
- Funkcje na dashboardzie (kafelki-skróty)
- Zmiana zachowania nawigacji (sticky, hamburger, router klienta)
- Zmiana logiki komponentów; komunikaty serwerowe API auth; tłumaczenie landing

## Architecture / Approach

Jeden punkt interwencji: kontener w `<main>`. Wszystkie ekrany aplikacji tracą własną powłokę
i dziedziczą szerokość/wyrównanie/rytm z layoutu. Na tym: ujednolicona typografia, potem karty
i panele stanów przez prymityw `<Card>` + nowy `<EmptyState>`. Webfont wchodzi wbudowanym Astro Fonts
API (pobiera w buildzie, serwuje z własnego origin) i podpina się do Tailwind v4 przez
`@theme inline { --font-sans: var(--font-inter) }`. Auth zostaje wzorcem — dotykamy go tylko w fazie
lokalizacji.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Kontener + powłoka nav | Wspólny `<main>` `max-w-3xl`, nav do osi, „Wyloguj" jak `outline`, dashboard top-aligned | Regresja nav bez JS na 320px; podwójny kontener po przeniesieniu wrapperów wysp |
| 2. Skala typografii | `text-2xl` h1 wszędzie, `<h1>` w review, jeden rozmiar h2 | Niski — czyste klasy |
| 3. Karty i panele stanów | `<EmptyState>`, panele przez `<Card>`, dashboard jako `<Card>` | Testy asertujące na tekstach paneli pustych; drobne złamanie „copy-don't-abstract" |
| 4. Webfont Inter (BUFOR) | Self-hosted Inter, token `--font-sans` | Build fontów na Cloudflare; FOUC; rozmiar `latin-ext` |
| 5. Lokalizacja PL (BUFOR) | Polskie auth + dashboard, walidacja w stałych | Dotyka komponentów auth poza zakresem wizualnym; testy walidacji |
| 6. Sprzątanie `dark:` (BUFOR) | Prymitywy `ui/` bez martwych `dark:` | Najniższy priorytet; pierwszy do wycięcia |

**Prerequisites:** S-03, S-04, S-05, S-07 (wszystkie `done`). Konto testowe z fiszkami i bez fiszek do
weryfikacji stanów.
**Estimated effort:** ~3-4 sesje. Rdzeń (fazy 1-3): ~2 sesje. Bufor (fazy 4-6): ~1-2 sesje, tnie się
od dołu przy presji terminu 2026-09-07.

## Open Risks & Assumptions

- Nav zwężony do `max-w-3xl` — wartość rozstrzygnięta (treść nav mieści się w 48rem, email skraca
  `truncate`). „Oś nav = oś treści" to kryterium twarde; nav nie dostaje własnej szerszej wartości.
- Astro Fonts API + adapter Cloudflare zakładane jako zgodne (Fonts API stabilne w Astro 7, self-hosting)
  — potwierdzane empirycznie w `npm run preview` fazy 4.
- Istniejące testy komponentów mogą asertować na angielskich tekstach / tekstach paneli pustych —
  aktualizacja selektorów (nie logiki) wliczona w fazy 3 i 5.
- `latin-ext` subset zakładany jako wystarczający dla polskich diakrytyków.

## Success Criteria (Summary)

- Przechodząc `/dashboard` → `/generate` → `/deck` → `/review` użytkownik widzi jeden układ: ta sama
  szerokość, wyrównanie do góry, ta sama skala nagłówków, te same karty.
- Panele „pusta kolekcja" / „koniec sesji" wyglądają jak karty, nie płaskie ramki.
- Nav działa bez JS na 320px; „Wyloguj" wygląda jak przycisk `outline`.
- (bufor) Aplikacja renderuje się krojem Inter bez FOUC; teksty auth i dashboard po polsku.
