---
date: 2026-09-02T13:12:44+02:00
researcher: Sebastian Urbański
git_commit: c1b72986c68ed991d1907c952d973e0a2260c840
branch: master
repository: 10xCards
topic: "Ujednolicenie wyglądu aplikacji — spójność ekranu startowego/logowania z dashboardem i pozostałymi ekranami"
tags: [research, codebase, styling, design-system, shadcn, tailwind, app-shell, visual-polish]
status: complete
last_updated: 2026-09-02
last_updated_by: Sebastian Urbański
last_updated_note: "Dodano rozstrzygnięcia zakresu (Open Questions #1–#3) po decyzji użytkownika"
---

# Research: Ujednolicenie wyglądu aplikacji

**Date**: 2026-09-02T13:12:44+02:00
**Researcher**: Sebastian Urbański
**Git Commit**: c1b72986c68ed991d1907c952d973e0a2260c840
**Branch**: master
**Repository**: 10xCards

## Research Question

> Chciałbym ujednolicić wygląd aplikacji. Ekran startowy z logowaniem ma inny wygląd niż
> dashboard. Niech całość wygląda spójnie z ekranem logowania.

Zakres uzgodniony: **wszystkie ekrany aplikacji** (dashboard, generate, deck, review, app shell),
pełny dokument badawczy jako wejście do `/10x-plan`.

## Summary

**Ekran logowania (`/auth/signin`) i ekrany zalogowanej aplikacji już dziś dzielą ten sam system
stylów** — tokeny shadcn/ui w Tailwind v4 (`bg-card`, `border`, `shadow-sm`, `rounded-xl`,
`text-muted-foreground`, komponent `Button`). Migracja warstwy auth + `/dashboard` z „kosmicznego"
glassmorphizmu na tokeny została **celowo wykonana i zamknięta** w S-02 (faza 8,
commit `535db36`). To nie jest rozjazd dwóch design-systemów.

Wrażenie „innego wyglądu" bierze się z **niespójności układu, nie palety**:

1. **Różne szerokości kontenera na każdym ekranie** — nav `max-w-6xl`, dashboard wyśrodkowany bez
   `max-w`, generate/deck `max-w-3xl`, review `max-w-2xl`. Krawędzie treści nigdy nie są w jednej linii.
2. **Różne wyrównanie w pionie** — login **i dashboard** są wyśrodkowane pionowo
   (`min-h-screen items-center justify-center`), a generate/deck/review są wyrównane do góry (`py-10`).
   Dashboard jest ostylowany jak ekran logowania, a nie jak jego rodzeństwo.
3. **Różne źródło paddingu karty** — ręczne `div` (login, dashboard) mają `p-8`; komponent `<Card>`
   ma `py-6 px-6`.
4. **Dryf skali typografii** — `dashboard` ma `text-3xl` (jedyny w aplikacji), review nie ma `<h1>`
   w ogóle, nagłówki sekcji to raz `text-lg` raz `text-base`.
5. **Panele stanów pustych / info gubią `bg-card` i `shadow-sm`** — wyglądają „płasko" obok kart.
6. **Przycisk wylogowania w nawigacji jest ręcznie sklecony**, omija komponent `<Button>`.
7. **Brak warstwy typografii** — zero ładowania fontów, brak tokenów `--font-*`; aplikacja renderuje
   się systemowym sans.
8. **Dark mode zdefiniowany, ale martwy** — pełna paleta `.dark` istnieje, nic nigdy nie ustawia klasy
   `.dark`, brak przełącznika.

**Uwaga dot. „ekranu startowego":** jeśli chodzi o `src/pages/index.astro` → `Welcome.astro`
(marketingowy landing z gradientem `bg-cosmic`, orbami i hardkodowanymi kolorami `purple-*`/`blue-*`),
to jest to **jedyny ekran z prawdziwie odmiennym językiem wizualnym**, celowo trzymany poza systemem
tokenów, a jego redesign jest **explicite poza zakresem S-08** i poza terminem 2026-09-07
([roadmap.md](../../foundation/roadmap.md), S-08 Risk). Jeśli „ekran logowania" = `/auth/signin`
(czysta wyśrodkowana biała karta), to cel pokrywa się z zapisanym zakresem S-08. **Ta dwuznaczność
jest pierwszym pytaniem do rozstrzygnięcia w planie** — patrz Open Questions.

## Detailed Findings

### Fundamenty design systemu (już wdrożone i spójne)

- **Tailwind v4, CSS-first, bez pliku konfiguracyjnego JS.** `tailwindcss@^4.2.4` +
  `@tailwindcss/vite`, konfiguracja w [src/styles/global.css](../../../src/styles/global.css) przez
  `@import "tailwindcss"` + `@theme inline`. Wpięte w [astro.config.mjs](../../../astro.config.mjs)
  jako plugin Vite.
- **Tokeny (oklch, neutralna szarość, shadcn „neutral")** w `:root` — `global.css:6-39`:
  `--background`/`--foreground` `oklch(1 0 0)` / `oklch(0.145 0 0)`, `--card`, `--primary`
  `oklch(0.205 0 0)`, `--muted-foreground` `oklch(0.556 0 0)`, `--border`/`--input` `oklch(0.922 0 0)`,
  `--ring` `oklch(0.708 0 0)`, `--destructive`, `--radius: 0.625rem`.
- **`@theme inline`** (`global.css:75-111`) mostkuje każdy token do utility `--color-*` i wyprowadza
  skalę promienia `--radius-sm/md/lg/xl` z jednego `--radius`.
- **`@layer base`** (`global.css:117-124`): `* { @apply border-border outline-ring/50 }` oraz
  `body { @apply bg-background text-foreground }`. To jedyne globalne stylowanie `body`.
- **shadcn/ui**: [components.json](../../../components.json) — styl `new-york`, `baseColor: neutral`,
  `cssVariables: true`, ikony `lucide`. W [src/components/ui/](../../../src/components/ui/) jest
  **tylko 5 prymitywów**: `button.tsx`, `card.tsx`, `alert.tsx`, `alert-dialog.tsx`, `textarea.tsx`
  (+ `LibBadge.astro` — dekoracja ze startera, nie prymityw).
- **`cn`** = `twMerge(clsx(...))` w [src/lib/utils.ts](../../../src/lib/utils.ts).
- **Konwencja domu** (z prior changes): brak toastów (`sonner` nie jest zależnością), brak
  optymistycznych update'ów (każda mutacja pesymistyczna), brak skeletonów, odświeżanie = mutacja
  stanu lokalnego (nigdy `location.reload()` ani refetch), ładowanie = `<Loader2 className="animate-spin" />`
  w zablokowanym przycisku, błąd = `<Alert variant="destructive">` z przyciskiem ponowienia,
  komunikaty PL zamrożone w stałym obiekcie. Lokalna konwencja **usuwa klasy animacji** z prymitywów
  dodawanych przez `npx shadcn add` (patrz `alert-dialog.tsx`).

### Profil wizualny ekranu logowania (kandydat na „wzorzec")

Layout: [src/layouts/Layout.astro](../../../src/layouts/Layout.astro) — `<html>`/`<body>` **bez klas**,
tło z `@layer base`. Scoped `<style>` (`Layout.astro:42-49`) resetuje `html,body { margin:0; width:100%; height:100% }`.
Renderuje `<Banner>` dla brakującej konfiguracji nad `<slot/>`.

| Aspekt | Wartość | Ref |
|---|---|---|
| Tło strony | `bg-background` (białe) dziedziczone z `<body>` | — |
| Wyśrodkowanie | `flex min-h-screen items-center justify-center p-4` | `signin.astro:9` |
| Karta | `bg-card text-card-foreground w-full max-w-sm rounded-xl border p-8 shadow-sm` | `signin.astro:10` |
| Szerokość karty | `max-w-sm` (24rem) | — |
| H1 | `text-2xl font-bold text-center`, `mb-6` (formularze) / `mb-3` (confirm) | `signin.astro:11` |
| Tekst drugorzędny | `text-muted-foreground`, `text-sm` / `text-xs` | `signin.astro:13` |
| Linki | `text-primary underline-offset-4 hover:underline` | `signin.astro:14` |
| Rytm formularza | `space-y-4` | `SignInForm.tsx:43` |
| Label | `mb-1 block text-sm font-medium` | `FormField.tsx:37` |
| Input | `h-9 w-full rounded-md border bg-transparent px-3 py-2 pl-10 text-base md:text-sm shadow-xs`, focus `ring-[3px] ring-ring/50` | `FormField.tsx:5-6` |
| Stan błędu inputa | `border-destructive focus-visible:ring-destructive/20` + `text-destructive text-xs` z `CircleAlert size-3` | `FormField.tsx:51-59` |
| Ikony pól | lucide `size-4`, `text-muted-foreground`, absolutne `left-3` | `FormField.tsx:41` |
| Przycisk główny | shadcn `<Button>` default: `w-full h-9 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 shadow-xs` | `SubmitButton.tsx:15` |
| Błąd serwera | shadcn `<Alert variant="destructive">`: `rounded-lg border px-4 py-3 text-sm bg-card text-destructive` | `ServerError.tsx` |
| Font | brak — systemowy sans | — |
| Dark mode | tokeny w `.dark` zdefiniowane, nigdy nie aktywowane | — |
| Logo / znak marki | **brak** — tylko tekstowy `<h1>` (i emoji `text-5xl` na confirm-email) | — |

`confirm-email.astro` = ta sama karta + `text-center`, `mb-3` zamiast `mb-6`, opis w domyślnym
`text-base` zamiast `text-sm`.

### Profil wizualny ekranów zalogowanych (co się różni)

Dwie rodziny layoutów:
- [Layout.astro](../../../src/layouts/Layout.astro) (bazowy) → `index.astro` (kosmiczny landing) + wszystkie `auth/*`.
- [AppLayout.astro](../../../src/layouts/AppLayout.astro) → owija `Layout.astro`, dodaje
  `<AppNavigation />` + `<main>` (bez klas), używany przez `dashboard`, `generate`, `deck`, `review`.

**`AppLayout` nie dodaje żadnego stylowania `<html>`/`<body>`/`<main>`** — `<main>` (`AppLayout.astro:14`)
jest całkowicie bez klas, więc każda strona wymyśla własną powłokę.

**Nawigacja** — [src/components/AppNavigation.astro](../../../src/components/AppNavigation.astro):
- `<header class="bg-background border-b px-4 py-3">` (`:8`) — brak wysokości, brak cienia, tylko dolny border.
- Kontener wewnętrzny: `mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-3` (`:9`).
- Marka: `class="shrink-0 font-bold"` (`:10`) — **bez rozmiaru fontu**.
- Linki: baza `rounded-md px-3 py-2 text-sm font-medium transition-colors` (`:22`), aktywny
  `bg-accent text-accent-foreground` + `aria-current="page"`, nieaktywny `text-muted-foreground hover:text-foreground` (`:23`).
- **Przycisk wylogowania (`:38`)**: `hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-2 font-medium transition-colors`
  — ręcznie sklecony, **nie** komponent `<Button>`, bez `h-9`, dziedziczy `text-sm` z rodzica.
  Z grubsza wariant `outline`, ale nie komponent.
- Definicje pozycji i reguła dopasowania trasy: `src/lib/navigation.ts`.

**Szerokości kontenera / układ:**

| Ekran | Klasy wrappera | Ref |
|---|---|---|
| Nav (wewnętrzny) | `mx-auto ... max-w-6xl` | `AppNavigation.astro:9` |
| `AppLayout` `<main>` | *(brak)* | `AppLayout.astro:14` |
| **login** | `flex min-h-screen items-center justify-center p-4` + karta `max-w-sm` | `signin.astro:9-10` |
| **dashboard** | `flex min-h-screen items-center justify-center p-4` (wyśrodkowany, brak `max-w`) | `dashboard.astro:8-9` |
| **generate** | wrapper w wyspie: `mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 py-10` | `GenerateView.tsx:178` |
| **deck** | wrapper w `.astro`: `mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 py-10` | `deck.astro:23` |
| **review** | wrapper w wyspie: `mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 py-10` | `ReviewSession.tsx:247` |

`generate.astro` i `review.astro` mają **puste ciała** — tylko `<Island client:load />`; wrapper żyje
w komponencie React. `deck.astro` trzyma wrapper w stronie Astro. Niespójna warstwa.

**Karty / panele — trzy różne implementacje:**

| Źródło | Klasy | Ref |
|---|---|---|
| karta login (ręczny div) | `bg-card text-card-foreground w-full max-w-sm rounded-xl border p-8 shadow-sm` | `signin.astro:10` |
| karta dashboard (ręczny div) | `bg-card text-card-foreground rounded-xl border p-8 text-center shadow-sm` | `dashboard.astro:9` |
| shadcn `<Card>` (generate/deck/review) | `bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm`; `CardContent`/`CardFooter` = `px-6` | `card.tsx:9` |
| panel stanu pustego (deck) | `text-muted-foreground flex flex-col items-start gap-3 rounded-xl border p-6` — **bez `bg-card`, bez `shadow-sm`** | `FlashcardCollection.tsx:284` |
| panel pusty/koniec (review) | `... rounded-xl border p-6` — **bez `bg-card`, bez `shadow-sm`** | `ReviewSession.tsx:259, :268` |
| badge źródła (deck) | `text-muted-foreground rounded-full border px-2 py-0.5 text-xs` | `FlashcardCollection.tsx:304` |

**Typografia — dryf:**

| Miejsce | Nagłówek | Ref |
|---|---|---|
| login h1 | `text-2xl font-bold`, `mb-6` | `signin.astro:11` |
| confirm-email h1 | `text-2xl font-bold`, `mb-3` | `confirm-email.astro:25` |
| **dashboard h1** | `text-3xl font-bold`, `mb-4` ← **jedyny `text-3xl`** | `dashboard.astro:10` |
| generate h1 | `text-2xl font-bold` | `GenerateView.tsx:180` |
| deck h1 | `text-2xl font-bold` | `deck.astro:25` |
| **review** | **brak `<h1>`** | `ReviewSession.tsx` |
| generate h2 | `text-lg font-semibold` | `GenerateView.tsx:246` |
| deck „nowa karta" h2 | `text-base font-semibold` | `FlashcardCollection.tsx:243` |
| nav marka | `font-bold` (bez rozmiaru) | `AppNavigation.astro:10` |

**Przyciski:** aplikacja standaryzuje na shadcn `<Button>` (`h-9` default / `h-8` sm, `rounded-md`,
`shadow-xs`, `text-sm font-medium`). Warianty: `default` (CTA główne), `outline` (drugorzędne, oceny
w review), `ghost` (anuluj/odrzuć/usuń), `destructive` (dialogi). Jedyne odstępstwo w powłoce:
przycisk wylogowania w `AppNavigation` (patrz wyżej). Formularz logowania używa własnego `inputBase`
z `FormField.tsx` (brak prymitywu `input` w `ui/`); wyspy aplikacji używają `<Textarea>`.

**Kolory:** `AppNavigation.astro` i wszystkie 4 ekrany aplikacji są **w 100% na tokenach** — zero
literałów hex/gray. Jedyne hardkodowane kolory w plikach powłoki to `Topbar.astro` (patrz niżej),
który **nie jest wpięty** w `AppLayout`.

### `Topbar.astro` — martwy komponent, nie brać za wzór

[src/components/Topbar.astro](../../../src/components/Topbar.astro) importowany **wyłącznie** przez
[Welcome.astro](../../../src/components/Welcome.astro) (marketing landing). Pełni rolę „szklanej
pigułki": `mb-4 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80`,
linki `text-purple-300 hover:text-purple-100`. Zakłada permanentnie ciemne tło (biały tekst).
Prior changes nazywają go wprost „martwym komponentem ze startera — nie brać za wzór"
(`context/archive/2026-09-01-srs-review-session/research.md:196`).

### Landing `index.astro` → `Welcome.astro` — jedyny prawdziwie odmienny język wizualny

`bg-cosmic` (gradient `#0a0e1a → #0f1529 → #0a0e1a`, `global.css:113-115`), rozmyte orby
`bg-purple-500/20 blur-[120px]`, pole gwiazd (inline radial-gradient), nagłówek z gradientowym
tekstem `from-blue-200 via-purple-200 to-pink-200 bg-clip-text text-transparent`, CTA
`bg-purple-600 hover:bg-purple-500`, karty funkcji `border-white/10 bg-white/5 backdrop-blur-xl`.
**Zero tokenów** — surowa paleta Tailwind. To ekran marketingowy, nie „ekran logowania".

## Code References

- [src/styles/global.css:1-124](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/styles/global.css) — jedyny plik CSS: `@theme inline`, tokeny `:root`/`.dark`, `@layer base`, `bg-cosmic`
- [src/layouts/Layout.astro:14-49](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/layouts/Layout.astro#L14-L49) — bazowy layout, `<html>`/`<body>` bez klas, scoped reset `<style>`, `<Banner>`
- [src/layouts/AppLayout.astro:12-17](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/layouts/AppLayout.astro#L12-L17) — powłoka zalogowana: `<AppNavigation />` + `<main>` bez klas
- [src/components/AppNavigation.astro:8-40](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/AppNavigation.astro#L8-L40) — nav `max-w-6xl`, marka bez rozmiaru, przycisk wylogowania ręczny
- [src/pages/dashboard.astro:8-13](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/dashboard.astro#L8-L13) — wyśrodkowany pionowo jak login, `text-3xl` h1, karta `p-8`
- [src/pages/auth/signin.astro:9-15](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/auth/signin.astro#L9-L15) — profil „wzorcowy": centrowanie + karta `max-w-sm rounded-xl border p-8 shadow-sm`
- [src/pages/auth/signup.astro](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/auth/signup.astro) — identyczny z signin
- [src/pages/auth/confirm-email.astro:22-28](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/auth/confirm-email.astro#L22-L28) — ta sama karta + `text-center`, inne marginesy
- [src/pages/deck.astro:23-25](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/deck.astro#L23-L25) — wrapper `max-w-3xl ... py-10` w stronie Astro
- [src/pages/generate.astro](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/generate.astro) — puste ciało, tylko wyspa
- [src/pages/review.astro](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/pages/review.astro) — puste ciało, tylko wyspa
- [src/components/generate/GenerateView.tsx:178-180](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/generate/GenerateView.tsx#L178-L180) — wrapper `max-w-3xl flex-col gap-8 p-4 py-10`
- [src/components/deck/FlashcardCollection.tsx:223-284](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/deck/FlashcardCollection.tsx#L223-L284) — bare `<section>`, panel pustego stanu bez `bg-card`/`shadow`
- [src/components/review/ReviewSession.tsx:247-300](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/review/ReviewSession.tsx#L247-L300) — wrapper `max-w-2xl gap-6`, brak h1, panele pustego stanu bez `bg-card`/`shadow`
- [src/components/ui/button.tsx:7-33](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/ui/button.tsx#L7-L33) — `cva`, warianty, `rounded-md`
- [src/components/ui/card.tsx:5-13](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/ui/card.tsx#L5-L13) — `rounded-xl border py-6 shadow-sm`, `px-6` w sub-częściach
- [src/components/auth/FormField.tsx:5-59](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/auth/FormField.tsx#L5-L59) — własny `inputBase`, label, stany błędu
- [src/components/Welcome.astro:5-58](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/Welcome.astro#L5-L58) — kosmiczny landing, zero tokenów
- [src/components/Topbar.astro:5-31](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/src/components/Topbar.astro#L5-L31) — martwy, hardkodowane kolory
- [components.json](https://github.com/sebast82/10xCards/blob/c1b72986c68ed991d1907c952d973e0a2260c840/components.json) — shadcn `new-york`, `neutral`, `cssVariables`
- `src/lib/navigation.ts` — definicje pozycji nav + reguła aktywnej trasy

## Architecture Insights

- **Jeden system stylów jest już ustalony i wdrożony.** Decyzja „tokeny shadcn + migracja
  istniejących ekranów, jeden system w całym projekcie" zapadła w S-02
  (`context/archive/2026-08-25-first-gated-generation/plan-brief.md:32`). Faza 8 tego planu
  zmigrowała `auth/*`, `components/auth/*.tsx` i `dashboard.astro` z glassmorphizmu na tokeny
  (commit `535db36`, manualny check „8.7 Ekrany wyglądają spójnie" odhaczony).
- **Problem jest kompozycyjny, nie palety.** Brakuje wspólnej powłoki treści: `AppLayout`'s `<main>`
  jest bez klas, więc każdy ekran wymyśla własny kontener (`max-w`, wyrównanie w pionie, rytm
  odstępów). To najtańszy i najskuteczniejszy punkt interwencji — jeden kontener w `<main>` +
  wyrównanie nav do tej samej szerokości.
- **Tokeny są wpięte, ale przyjęte tylko częściowo:**
  - Brak warstwy typografii (zero fontów, zero `--font-*`).
  - Dark mode: pełne tokeny `.dark` + warianty `dark:` w prymitywach, ale **nic nie ustawia klasy
    `.dark`** — martwy kod. Decyzja: dokończyć albo świadomie zostać przy „light-only" i wyciszyć szum `dark:`.
  - Niespójny promień w prymitywach: button/textarea `rounded-md`, card `rounded-xl`, alert
    `rounded-lg`, alert-dialog bez promienia. Skala `--radius-*` istnieje, ale prymitywy używają
    statycznych klas.
  - Brak `--destructive-foreground` — button/alert-dialog hardkodują `text-white`.
  - Bardzo mały zestaw prymitywów (5). Realna unifikacja list/formularzy/paneli może potrzebować
    `input`, `label`, `badge`, ewentualnie `dialog` — dziś ręcznie sklejane w komponentach feature.
- **Konwencja „copy-don't-abstract"** i „usuń klasy animacji z prymitywów CLI" to zapisane reguły
  domu — plan unifikacji nie powinien wprowadzać abstrakcji HTTP ani zostawiać animacji z `npx shadcn add`.
- **Nawigacja jest funkcjonalną kotwicą (S-07), nie kosmetyką** — PRD v3 NFR: „Każda funkcja
  osiągalna z trwałej nawigacji obecnej na każdym ekranie ... w każdej chwili widzi, w której się
  znajduje" (`context/foundation/prd.md:87`). Zmiany wizualne nav nie mogą naruszyć: działania bez
  JS klienta, mieszczenia się na mobile (320px bez poziomego przepełnienia), `aria-current="page"`
  na dokładnie jednej pozycji, dostępu klawiaturą.

## Historical Context (from prior changes)

- **`context/foundation/roadmap.md` — S-08 `visual-polish-pass` (ten change):**
  - Outcome (`roadmap.md:196`): „użytkownik napotyka spójny wygląd na wszystkich ekranach — **jedną
    skalę typografii i odstępów, jednolite formularze, przyciski i listy** — oraz czytelne stany:
    pusta kolekcja, trwające ładowanie, błąd operacji."
  - Risk (`roadmap.md:204`): „Jedyny element roadmapy, który nie daje użytkownikowi nowej możliwości
    ... **przeprojektowanie interfejsu od nowa nie mieści się w terminie 2026-09-07** ... jako
    ostatni element ... jeśli czas się skończy, **przycina się jego głębokość**." Prerequisites:
    S-03/S-04/S-05/S-07. Unlocks: publiczny debiut.
  - `roadmap.md:232` (rozstrzygnięte 2026-08-26): nawigacja (S-07) = luka funkcjonalna;
    wygląd (S-08) = „przebieg wykończeniowy na końcu".
- **`context/archive/2026-08-26-app-shell-navigation/`** — powstał `AppLayout.astro` zagnieżdżony w
  `Layout.astro` + `AppNavigation.astro` + `src/lib/navigation.ts`. Jawne non-goale
  (`plan.md:34`): „Nie wykonujemy pełnego visual polish, dark-mode UX ani redesignu typografii
  i kolorów; te prace należą do S-08." Nie sticky, bez hamburgera, bez klienta routera. Impl-review: APPROVED.
- **`context/archive/2026-08-25-first-gated-generation/plan.md:604-616`** (faza 8) — „Aplikacja ma
  dziś dwa systemy stylów: tokeny shadcn ... i zahardkodowany glassmorphism (`bg-cosmic`,
  `bg-white/10 backdrop-blur-xl`) w warstwie auth i na `/dashboard`." Migracja auth+dashboard na
  tokeny **wykonana**. „Odłożenie nie zostawia długu technicznego — zostawia dług estetyczny."
- **`context/archive/2026-09-01-srs-review-session/research.md:207-224`** — inwentarz konwencji domu
  (brak toastów/optimistic/skeletonów; błąd = `Alert` + retry; ładowanie = `Loader2` w przycisku)
  oraz: „**Luka dostępności jest realna i jest największym pojedynczym obszarem nowej pracy w UI**"
  (brak zarządzania fokusem poza review, brak `aria-live` w wyspach, `prefers-reduced-motion`
  nieużyte; `eslint-plugin-jsx-a11y` łapie naruszenia w lincie).
- **Odłożone do S-08 explicite:** card-flip animation + `prefers-reduced-motion`
  (`srs-review-session/plan.md:44`), redesign typografii/kolorów, dark-mode UX
  (`app-shell-navigation/plan.md:34`).
- **`Topbar.astro`** nazwany „martwym komponentem ze startera — nie brać za wzór"
  (`srs-review-session/research.md:196`); stary look auth (glassmorphism) to „jednorazówka celowo
  znormalizowana, nie wzorzec do naśladowania" — ale dotyczy to **starego** wyglądu, obecny
  `/auth/signin` jest już na tokenach.

## Related Research

- `context/archive/2026-08-26-app-shell-navigation/research.md` — powłoka i nawigacja zalogowana
- `context/archive/2026-08-25-first-gated-generation/plan.md` (faza 8) — pierwsza unifikacja stylów
- `context/archive/2026-09-01-srs-review-session/research.md` — najpełniejszy inwentarz konwencji UI domu + luka a11y

## Open Questions

1. **Co dokładnie znaczy „ekran startowy z logowaniem"?**
   - (a) `/auth/signin` — czysta wyśrodkowana biała karta na tokenach. Cel = wyrównać
     kontener/typografię/odstępy pozostałych ekranów do tego minimalistycznego, tokenowego języka.
     Mieści się w zakresie i terminie S-08.
   - (b) `index.astro` / `Welcome.astro` — kosmiczny landing z gradientem i hardkodowaną paletą.
     Rozszerzenie tego na całą aplikację = redesign, **explicite poza zakresem S-08** i poza
     terminem 2026-09-07.
   Plan musi to rozstrzygnąć na wejściu (rekomendacja: (a)).
2. **Dark mode — dokończyć czy świadomie zostać przy light-only?** Tokeny i warianty `dark:`
   istnieją, brak tylko przełącznika + skryptu anty-FOUC. Roadmap S-08 Risk sugeruje przycinanie
   głębokości — light-only jest bezpieczniejszym domyślnym wyborem na termin.
3. **Czy wprowadzać warstwę typografii (font + tokeny `--font-*`)?** Największy brakujący fundament,
   ale też najbardziej „redesignowy". Alternatywa minimalna: zostać przy systemowym sans i tylko
   ujednolicić skalę rozmiarów/wag.
4. **Gdzie ma żyć standardowy kontener treści** — w `AppLayout`'s `<main>` (jednorazowo, wszystkie
   ekrany dziedziczą) czy per-strona? Wsypy `generate`/`review` mają puste ciała `.astro`, więc
   kontener w `<main>` wymagałby przeniesienia paddingu/`max-w` z komponentów React.
5. **Jaka jedna szerokość treści** — `max-w-3xl` (generate/deck) czy `max-w-2xl` (review)? I czy
   nav ma się zwęzić z `max-w-6xl` do tej samej wartości, czy zostać szerszy.
6. **Czy dashboard ma przestać być wyśrodkowany pionowo** i dołączyć do top-aligned rodzeństwa,
   czy to celowy „ekran startowy" i ma zostać wyśrodkowany jak login?
7. **Zakres nowych prymitywów** — czy dodać `input`/`label`/`badge` jako prymitywy `ui/`, czy
   zostać przy ręcznym sklejaniu zgodnie z „copy-don't-abstract".
8. **Przycisk wylogowania** — zamienić na `<Button variant="outline" size="sm">` (wymaga wyspy lub
   `<Button asChild>` wokół formularza/linku wylogowania — dziś to `AppNavigation.astro` bez JS klienta).

## Follow-up Research 2026-09-02T13:12:44+02:00 — rozstrzygnięcia zakresu

Decyzje użytkownika po przeglądzie Open Questions:

### #1 → wariant (a): wzorcem jest `/auth/signin`

„Ekran startowy z logowaniem" = **`/auth/signin`** — minimalistyczna, wyśrodkowana biała karta na
tokenach shadcn. Cel unifikacji: wyrównać kontener, skalę typografii i rytm odstępów pozostałych
ekranów do tego języka.

- **`index.astro` / `Welcome.astro` (kosmiczny landing) — POZA ZAKRESEM.** Nie ruszamy gradientu
  `bg-cosmic`, orbów ani hardkodowanej palety `purple-*`/`blue-*`. To ekran marketingowy, jego
  redesign nie mieści się w S-08 ani w terminie 2026-09-07.
- `Topbar.astro` pozostaje martwym kodem (nie wpinamy go, nie stylujemy).
- Powłoką aplikacji zostaje `AppNavigation.astro` — dostrajamy ją do wzorca (rozmiar marki,
  przycisk wylogowania, szerokość kontenera), bez zmiany zachowania (bez JS klienta, mobile 320px,
  `aria-current`, dostęp klawiaturą).

### #2 → tylko light mode

Aplikacja jest **light-only**. Nie budujemy przełącznika motywu, skryptu anty-FOUC ani persystencji.

- Tokeny `.dark` w `global.css:41-73` oraz `@custom-variant dark` — do rozważenia w planie: zostawić
  jako uśpiony kod (zerowy koszt, potencjalny grunt pod przyszłość) albo usunąć szum `dark:` z
  lokalnych prymitywów przy okazji ich dotykania. Nie jest to cel sam w sobie — priorytet niski,
  do przycięcia jeśli zabraknie czasu.
- `<html>` renderuje się bez klasy `.dark` — stan docelowy, nie wada.

### #3 → dodać warstwę typografii (font + tokeny)

Wprowadzamy **realną warstwę typografii**:

- Ładowanie webfontu (mechanizm do wyboru w planie: Astro Fonts API / `@fontsource` / `<link>` do
  Google Fonts z `preconnect` — decyzja z uwzględnieniem Cloudflare Pages i braku FOUC).
- Token(y) `--font-sans` (i ewentualnie `--font-mono`) w `@theme` w `global.css`, tak by
  `font-sans` w Tailwind v4 wskazywało wybraną rodzinę zamiast systemowego stacka Preflight.
- Ujednolicona skala rozmiarów/wag nagłówków (usunięcie `text-3xl` z dashboardu, dodanie `<h1>` w
  review, jeden rozmiar dla nagłówków sekcji) — spójna z kartą `/auth/signin` (`text-2xl font-bold`).
- Wybór konkretnej rodziny fontu: do zaproponowania w planie (kandydaci: Inter / Geist / IBM Plex
  Sans — czytelne, dobrze pokrywają polskie znaki diakrytyczne, dostępne na dozwolonych CDN-ach).

### Pozostałe Open Questions (#4–#8) — do rozstrzygnięcia w `/10x-plan`

Bez zmian; wchodzą do planu jako decyzje projektowe. Wstępne nachylenie z badania:
- #4: standardowy kontener w `AppLayout`'s `<main>` (jednorazowo), z przeniesieniem paddingu/`max-w`
  z wysp `generate`/`review`.
- #5: jedna szerokość treści — kandydat `max-w-3xl`; nav wyrównany do tej samej osi.
- #6: dashboard przestaje być wyśrodkowany pionowo, dołącza do top-aligned rodzeństwa (wzorzec
  `/auth/signin` dotyczy stylu karty i typografii, nie pełnoekranowego centrowania treści aplikacji).
- #7: minimalny zestaw — rozważyć `label`/`badge` tylko jeśli redukują realne duplikaty.
- #8: przycisk wylogowania → wygląd `Button variant="outline" size="sm"` przy zachowaniu formularza
  POST bez JS klienta (np. `buttonVariants()` na `<button type="submit">`).
