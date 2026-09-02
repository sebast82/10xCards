# Visual Polish Pass — Implementation Plan

## Overview

Ujednolicenie warstwy prezentacji wszystkich ekranów zalogowanej aplikacji do języka wizualnego
`/auth/signin` (minimalistyczna, wyśrodkowana karta na tokenach shadcn/ui). System tokenów, prymitywy
i migracja z glassmorphizmu są **już wdrożone i spójne** (S-02 faza 8, commit `535db36`). Wrażenie
„innego wyglądu" bierze się z **niespójności kompozycji, nie palety**: `AppLayout`'s `<main>` jest bez
klas, więc każdy ekran wymyśla własny kontener (`max-w`, wyrównanie w pionie, rytm odstępów), skala
typografii dryfuje, a panele stanów pustych gubią `bg-card`/`shadow-sm`.

To przebieg wykończeniowy (S-08, roadmap) — ostatni przed publicznym debiutem i ostatni bufor terminu
2026-09-07. Zakres jest domknięty listą ekranów istniejących dziś; przeprojektowanie interfejsu od nowa
jest poza zakresem.

## Current State Analysis

**Co jest już spójne (nie ruszamy):**

- Tailwind v4 CSS-first, tokeny oklch w `:root` ([src/styles/global.css:6-39](../../../src/styles/global.css)),
  `@theme inline` mostkuje tokeny do `--color-*` i wyprowadza skalę `--radius-*`.
- Prymitywy `ui/`: `button.tsx` (cva, warianty, `h-9`/`h-8`, `rounded-md`, `shadow-xs`), `card.tsx`
  (`rounded-xl border py-6 shadow-sm`, sub-części `px-6`), `alert.tsx` (`bg-card`, `variant=destructive`),
  `alert-dialog.tsx`, `textarea.tsx`.
- `AppNavigation.astro` i 4 ekrany aplikacji w 100% na tokenach — zero literałów hex/gray.
- Konwencja domu: brak toastów/optimistic/skeletonów, błąd = `<Alert variant="destructive">` + retry,
  ładowanie = `<Loader2 className="animate-spin" />`, komunikaty PL mrożone w stałych.
- **Formularze już jednolite** (kryterium Outcome S-08 „jednolite formularze" — spełnione przed
  przebiegiem): auth używa `inputBase` z `FormField.tsx` (`h-9 rounded-md border shadow-xs`, label
  `mb-1 block text-sm font-medium`, stan błędu `border-destructive` + `text-destructive text-xs`),
  wyspy używają prymitywu `<Textarea>` z tą samą skalą (`rounded-md shadow-xs px-3 py-2 text-base
  md:text-sm`), przyciski w 100% na `<Button>`. Zero literałów hex — wszystko na tokenach
  (badanie: `research.md` sekcje „Skala typografii", „Przyciski"). Ten przebieg **nie tyka**
  pól/inputów — brak prymitywu `<Input>`/`<Label>` jest świadomą decyzją (patrz „What We're NOT Doing").

**Co się rozjeżdża (naprawiamy):**

| Problem | Dowód |
|---|---|
| `<main>` bez klas — każdy ekran wymyśla kontener | [src/layouts/AppLayout.astro:14](../../../src/layouts/AppLayout.astro) |
| Pionowe centrowanie: dashboard + login vs top-aligned reszta | [dashboard.astro:8](../../../src/pages/dashboard.astro), [signin.astro:9](../../../src/pages/auth/signin.astro) vs [GenerateView.tsx:178](../../../src/components/generate/GenerateView.tsx) |
| Szerokości: nav `max-w-6xl`, dashboard brak, deck/generate `max-w-3xl`, review `max-w-2xl` | [AppNavigation.astro:9](../../../src/components/AppNavigation.astro), [deck.astro:23](../../../src/pages/deck.astro), [ReviewSession.tsx:247](../../../src/components/review/ReviewSession.tsx) |
| `text-3xl` (jedyny w apce) w dashboard; brak `<h1>` w review; nagłówki sekcji raz `text-lg` raz `text-base` | [dashboard.astro:10](../../../src/pages/dashboard.astro), [ReviewSession.tsx](../../../src/components/review/ReviewSession.tsx), [FlashcardCollection.tsx:243](../../../src/components/deck/FlashcardCollection.tsx) |
| Panele stanów pustych bez `bg-card`/`shadow-sm` — płaskie obok kart | [FlashcardCollection.tsx:284](../../../src/components/deck/FlashcardCollection.tsx), [ReviewSession.tsx:259](../../../src/components/review/ReviewSession.tsx), [:268](../../../src/components/review/ReviewSession.tsx) |
| Przycisk „Wyloguj" ręcznie sklecony, omija `buttonVariants()` | [AppNavigation.astro:36-42](../../../src/components/AppNavigation.astro) |
| Marka nav `font-bold` bez rozmiaru | [AppNavigation.astro:10](../../../src/components/AppNavigation.astro) |
| Zero warstwy typografii — systemowy sans, brak `--font-*` | [global.css](../../../src/styles/global.css) |
| Teksty auth + dashboard po angielsku, reszta apki po polsku | [signin.astro:11](../../../src/pages/auth/signin.astro), [dashboard.astro:10](../../../src/pages/dashboard.astro), [SignInForm.tsx:20-28](../../../src/components/auth/SignInForm.tsx) |
| `dark:` warianty w prymitywach mimo light-only | [button.tsx:14-18](../../../src/components/ui/button.tsx), [textarea.tsx:10](../../../src/components/ui/textarea.tsx) |

**Ograniczenia:**

- `AppNavigation.astro` renderuje się **bez JS klienta** (PRD v3 NFR): każda zmiana musi zachować
  działanie bez hydratacji, mieszczenie na 320px bez poziomego przepełnienia, `aria-current="page"` na
  dokładnie jednej pozycji, dostęp klawiaturą.
- `generate.astro` i `review.astro` mają **puste ciała** (`<Island client:load />`) — wrapper żyje
  w komponencie React. `deck.astro` trzyma wrapper w stronie Astro.
- Adapter Cloudflare (`@astrojs/cloudflare`), `output: "server"` — webfont musi być self-hosted albo
  bezpieczny na workerd; brak CSP dziś, ale third-party CDN i tak niepożądany.
- `astro@^7.1.3` — Fonts API (`fonts:` w configu) jest stabilne, pobiera pliki w buildzie i serwuje
  z własnego origin.

## Desired End State

Użytkownik przechodzący między `/dashboard`, `/generate`, `/deck`, `/review` widzi **jeden układ**:
treść w kolumnie tej samej szerokości, wyrównana do góry pod tą samą nawigacją, ta sama skala
nagłówków, te same karty. Panele „pusta kolekcja" / „koniec sesji" wyglądają jak karty (`bg-card`,
`shadow-sm`), nie jak płaskie ramki. Przycisk „Wyloguj" jest wizualnie przyciskiem `outline`.
Ekrany auth (`/auth/*`) zachowują swój wyśrodkowany, minimalistyczny język — to wzorzec, nie cel zmian.

Po fazach bufora: aplikacja renderuje się krojem Inter (self-hosted, bez FOUC), teksty auth
i dashboard są po polsku, a martwe warianty `dark:` zniknęły z dotkniętych prymitywów.

### Weryfikacja:

- `npm run lint` i `npx astro check` przechodzą.
- `npm test` (vitest) przechodzi — istniejące testy komponentów bez regresji.
- `npm run build` przechodzi (w tym build fontów w fazie 4).
- Ręczny przegląd 4 ekranów: krawędzie treści i nav w jednej osi, jeden rytm w pionie.
- Nav na 320px bez poziomego scrolla, klawiaturą, `aria-current` na jednej pozycji.

### Key Discoveries:

- Pattern screen = `/auth/signin` (rozstrzygnięcie badania #1): karta
  `bg-card text-card-foreground w-full max-w-sm rounded-xl border p-8 shadow-sm`, h1 `text-2xl font-bold`,
  tekst drugorzędny `text-muted-foreground text-sm` ([signin.astro:9-15](../../../src/pages/auth/signin.astro)).
- Light-only (rozstrzygnięcie badania #2): nie budujemy przełącznika ani anty-FOUC; `<html>` bez `.dark`
  to stan docelowy.
- Warstwa typografii wchodzi (rozstrzygnięcie badania #3): realny webfont + tokeny `--font-*`.
- Astro renderuje komponent React (`<Card>`) w pliku `.astro` do statycznego HTML bez dyrektywy klienta
  — `dashboard.astro` może użyć `<Card>` bez hydratacji.
- Astro Fonts API + Tailwind v4: `cssVariable: "--font-inter"` w configu, potem
  `@theme inline { --font-sans: var(--font-inter); }` w `global.css` (wzorzec z dokumentacji Astro).
- `buttonVariants` z [button.tsx:50](../../../src/components/ui/button.tsx) to czysta funkcja — importowalna
  we frontmatterze `.astro` do wygenerowania klas na `<button type="submit">` bez React.

## What We're NOT Doing

- **Nie ruszamy `index.astro` / `Welcome.astro`** (kosmiczny landing, `bg-cosmic`, paleta `purple-*`) —
  explicite poza zakresem S-08 i poza terminem.
- **Nie wpinamy ani nie stylujemy `Topbar.astro`** — zostaje martwym kodem.
- **Nie budujemy dark mode UX** — przełącznik, persystencja, skrypt anty-FOUC. Tokeny `.dark`
  w `global.css` zostają jako uśpiony kod (usuwamy tylko `dark:` z dotkniętych prymitywów).
- **Nie przepisujemy `FormField` na prymityw `<Input>`/`<Label>`** ani nie dodajemy `<Badge>` —
  zostajemy przy „copy-don't-abstract" (rozstrzygnięcie pytania planistycznego #7).
- **Nie dodajemy funkcji do dashboardu** (kafelki-skróty) — zostaje kartą powitalną.
- **Nie zmieniamy zachowania nawigacji** — brak sticky, hamburgera, routera klienta, JS klienta.
- **Nie zmieniamy logiki komponentów** (stany, fetch, walidacja) — przebieg czysto prezentacyjny.
  Wyjątek: teksty komunikatów walidacji w fazie 5 (przeniesienie do stałych, ta sama logika).
- **Nie tłumaczymy `Welcome.astro` ani komunikatów serwerowych API auth** — tylko stringi widoczne
  w `src/pages/auth/*` i komponentach `src/components/auth/*`.

## Implementation Approach

Trzy fazy **rdzenia** dowożą Outcome S-08 („spójność tego, co jest") i są nie do przycięcia. Trzy fazy
**bufora** (webfont, lokalizacja PL, sprzątanie `dark:`) mają najwyższy stosunek pracy do ryzyka i
tną się od dołu, jeśli termin zacznie napierać (roadmap S-08 Risk; rozstrzygnięcie pytania
planistycznego #6).

Kolejność rdzenia jest odgórna: najpierw wspólny kontener (jeden punkt interwencji, wg badania
najtańszy i najskuteczniejszy), potem skala typografii na tym kontenerze, potem karty i panele stanów.

Każda faza kończy się pauzą na ręczne potwierdzenie przed następną.

## Critical Implementation Details

**Puste ciała wysp.** `generate.astro` i `review.astro` renderują tylko `<Island client:load />`.
Po przeniesieniu kontenera do `<main>`, korzeń `GenerateView.tsx` i `ReviewSession.tsx` musi stracić
`mx-auto w-full max-w-* p-4 py-10`, zostawiając tylko wewnętrzny `flex flex-col gap-*`. Inaczej
podwójny kontener / podwójny padding.

**Nawigacja bez JS.** Przycisk „Wyloguj" jest w `<form method="POST">` w `.astro`. Zamiana na wygląd
`Button` musi użyć `buttonVariants({ variant: "outline", size: "sm" })` jako string klas na
`<button type="submit">` — **nie** komponentu React, **nie** `client:*`. Po zmianie zweryfikować
tabulację i submit klawiszem.

`buttonVariants` mieszka w `button.tsx`, który w module importuje `react` i `@radix-ui/react-slot`
(oba SSR-safe — `<Button>` renderowany bez hydratacji już działa w `dashboard`/`deck`). Import
`buttonVariants` we frontmatterze `.astro` ściąga ten moduł na ścieżkę serwerową adaptera Cloudflare.
Powinno przejść. **Jeśli `npm run build` się wywali na tym imporcie** — wydzielić czystą funkcję do
`src/components/ui/button-variants.ts` i importować ją z `button.tsx` **oraz** z frontmatteru
(zero zmian w API `<Button>`).

**Token fontu — kolizja nazw.** Astro `<Font>` ustawia swój `cssVariable` na `:root` na realny stack.
Tailwind v4 `font-sans` czyta `--font-sans` z `@theme`. Użyć **rozłącznych** nazw: Astro
`cssVariable: "--font-inter"`, potem `@theme inline { --font-sans: var(--font-inter); }`. Nazwanie obu
`--font-sans` daje rekurencyjną definicję.

## Phase 1: Wspólny kontener treści + powłoka nawigacji

### Overview

Jeden kontener w `AppLayout`'s `<main>`; wszystkie 4 ekrany aplikacji tracą własne wrappery; nav
wyrównany do tej samej osi; przycisk „Wyloguj" na `buttonVariants`; dashboard traci pionowe centrowanie.

### Changes Required:

#### 1. Kontener treści w powłoce

**File**: `src/layouts/AppLayout.astro`

**Intent**: Dać `<main>` jeden standardowy kontener, żeby każdy ekran dziedziczył szerokość, wyrównanie
i rytm zamiast wymyślać własny.

**Contract**: `<main>` (dziś bez klas) dostaje `class="mx-auto w-full max-w-3xl px-4 py-10"`. Bez zmian
w strukturze slotów. `max-w-3xl` = 48rem — wartość wspólna generate/deck, review się do niej rozszerza
(rozstrzygnięcie pytania planistycznego #4/#5).

#### 2. Nawigacja — szerokość, marka, przycisk wylogowania

**File**: `src/components/AppNavigation.astro`

**Intent**: Wyrównać wewnętrzny kontener nav do osi treści, nadać marce jawny rozmiar, zamienić ręcznie
sklecony przycisk „Wyloguj" na wygląd prymitywu.

**Contract**:
- Wewnętrzny `<div>` (`:9`): `max-w-6xl` → `max-w-3xl`. **Wartość rozstrzygnięta, nie warunkowa** —
  treść nav (marka „10xCards" + 4 etykiety PL + email z `truncate min-w-0` + „Wyloguj") mieści się
  w 48rem; jedyny widoczny skutek na szerokim ekranie to mocniejsze skrócenie emaila (`truncate` już
  działa dziś). „Krawędzie nav i treści w jednej osi" to twarde kryterium — nav nie dostaje własnej,
  szerszej wartości.
- Marka (`:10`): `class="shrink-0 font-bold"` → dodać rozmiar `text-base` (wyrównanie do skali —
  `font-bold` bez rozmiaru dziedziczy `text-sm` z rodzica).
- Przycisk „Wyloguj" (`:36-41`): zamiast ręcznej listy klas użyć
  `buttonVariants({ variant: "outline", size: "sm" })`. Import `buttonVariants` z
  `@/components/ui/button` we frontmatterze. `<button type="submit">` i `<form method="POST">` bez zmian.

#### 3. Dashboard — zdjęcie własnego wrappera i centrowania

**File**: `src/pages/dashboard.astro`

**Intent**: Dashboard przestaje być ostylowany jak ekran logowania (pełnoekranowe centrowanie), dołącza
do top-aligned rodzeństwa (rozstrzygnięcie pytania planistycznego #6).

**Contract**: Usunąć zewnętrzny `<div class="flex min-h-screen items-center justify-center p-4">`.
Treść renderuje się bezpośrednio w kontenerze `<main>`. Karta powitalna trafia do fazy 3 (`<Card>`).
Na razie zostaje ręczny `<div>` karty — tu tylko usunięcie **pionowego** centrowania.

Karta zostaje **węższa niż kontener**: dodać `mx-auto w-full max-w-sm` na `<div>` karty (dziś jest
szeroka tylko dzięki shrink-wrap w usuwanym flexie — bez ograniczenia rozlałaby się na całe `max-w-3xl`
i `text-center` na 48rem wyglądałby pusto). `max-w-sm` = proporcje karty wzorcowej `/auth/signin`.
Karta jest wyśrodkowana w poziomie, wyrównana do góry.

#### 4. Deck — zdjęcie wrappera ze strony Astro

**File**: `src/pages/deck.astro`

**Intent**: Usunąć duplikat kontenera; zostawić tylko wewnętrzny rytm.

**Contract**: `<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 py-10">` (`:23`) →
`<div class="flex flex-col gap-8">`. Reszta (`<header>`, warunek błędu, `<FlashcardCollection>`) bez zmian.

#### 5. Generate — zdjęcie wrappera z korzenia wyspy

**File**: `src/components/generate/GenerateView.tsx`

**Intent**: Korzeń wyspy przestaje być kontenerem strony.

**Contract**: Root `<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-4 py-10">` (`:178`)
→ `<div className="flex flex-col gap-8">`. Logika, stany, handlery bez zmian.

#### 6. Review — zdjęcie wrappera z korzenia wyspy

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Jak wyżej; ujednolicenie rytmu pionowego do `gap-8` (dziś `gap-6`).

**Contract**: Root `<div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 py-10">` (`:247`)
→ `<div className="flex flex-col gap-8">`. `<span role="status" aria-live="polite">` i cała logika
bez zmian.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typecheck przechodzi: `npx astro check`
- Testy przechodzą: `npm test`
- Build przechodzi: `npm run build`

#### Manual Verification:

- Krawędzie treści na `/dashboard`, `/generate`, `/deck`, `/review` są w jednej pionowej osi z nav.
- Wszystkie 4 ekrany wyrównane do góry (brak pełnoekranowego centrowania).
- Nav na 320px: brak poziomego scrolla, przycisk „Wyloguj" wygląda jak `outline`, tabulacja i submit
  klawiszem działają, `aria-current` na dokładnie jednej pozycji.
- Nav na szerokim ekranie: krawędzie w jednej osi z treścią przy `max-w-3xl`; email skraca się
  `truncate`, nav nie zawija się na desktopie. (Nav nie dostaje własnej szerszej wartości — oś jest
  kryterium twardym. Jeśli `max-w-3xl` naprawdę dławi nav, to sygnał do przeprojektowania nav, nie
  do rozjechania osi — i wychodzi poza ten przebieg.)

**Implementation Note**: Po tej fazie i przejściu automatycznej weryfikacji — pauza na ręczne
potwierdzenie przed fazą 2.

---

## Phase 2: Skala typografii i nagłówki

### Overview

Jedna skala nagłówków spójna z kartą `/auth/signin` (`text-2xl font-bold`), bez wprowadzania webfontu.

### Changes Required:

#### 1. Dashboard h1

**File**: `src/pages/dashboard.astro`

**Intent**: Usunąć jedyny `text-3xl` w aplikacji.

**Contract**: `<h1 class="mb-4 text-3xl font-bold">` → `text-2xl font-bold` (margines zostaje).

#### 2. Review — dodanie h1

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Ekran review nie ma `<h1>` w ogóle — złamana hierarchia dokumentu i niespójność z rodzeństwem.

**Contract**: Dodać `<h1 className="text-2xl font-bold">Sesja powtórkowa</h1>` jako pierwszy element
w root `<div>` (przed `<span role="status">`). Widoczny we wszystkich stanach (`loading`/`empty`/
`finished`/`error`/`inSession`). Tekst spójny z `title` w [review.astro:6](../../../src/pages/review.astro).

#### 3. Nagłówki sekcji — jeden rozmiar

**File**: `src/components/deck/FlashcardCollection.tsx`

**Intent**: Ujednolicić nagłówki drugiego poziomu do `text-lg font-semibold` (wartość z `GenerateView`).

**Contract**: `<h2 className="text-base font-semibold">Nowa fiszka</h2>` (`:243`) → `text-lg font-semibold`.
`GenerateView.tsx:246` (`text-lg font-semibold`) już zgodny — bez zmian.

#### 4. Rytm marginesów nagłówków (opcjonalny porządek)

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: `confirm-email` h1 ma `mb-3`, `signin`/`signup` mają `mb-6`. Ujednolicić do `mb-6` dla
formularzowej rodziny; `confirm-email` (ekran komunikatu, nie formularz) może zostać przy `mb-3` —
**decyzja: zostawić `mb-3`**, bo to inny typ ekranu (centrowany komunikat). Bez zmian w tym pliku.

> Ta pozycja jest notatką, nie zmianą — rytm marginesów auth jest już wystarczająco spójny.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typecheck przechodzi: `npx astro check`
- Testy przechodzą: `npm test`

#### Manual Verification:

- Żaden ekran nie ma nagłówka większego niż `text-2xl`.
- `/review` ma widoczny `<h1>` w każdym stanie (pusto / w sesji / koniec / błąd).
- Nagłówki sekcji („Propozycje", „Nowa fiszka") mają ten sam rozmiar.

**Implementation Note**: Po tej fazie — pauza na ręczne potwierdzenie przed fazą 3.

---

## Phase 3: Karty i panele stanów

### Overview

Dashboard jako `<Card>`; nowy `<EmptyState>` dla paneli pustej listy / końca sesji (odzyskują
`bg-card`+`shadow-sm`); spójne wyśrodkowanie stanu ładowania.

### Changes Required:

#### 1. Nowy prymityw stanu pustego

**File**: `src/components/ui/empty-state.tsx` (nowy)

**Intent**: Jeden komponent na płaskie dziś panele „nie masz nic" — z kartą, opcjonalną ikoną, tekstem
i slotem na akcję (CTA).

**Contract**: Komponent React (używany w wyspach `FlashcardCollection`, `ReviewSession`). Props:
`{ title: string; action?: ReactNode; icon?: ReactNode }` (lub `children` zamiast `title` — do
uznania implementera). Renderuje `<Card>` z [card.tsx](../../../src/components/ui/card.tsx) z zawartością
`flex flex-col items-start gap-3 px-6` (odtworzenie dzisiejszego układu `p-6`, ale przez `<Card>` →
`bg-card` + `shadow-sm` + `rounded-xl border` gratis). Bez klas animacji (konwencja domu — patrz
`alert-dialog.tsx` bez `data-[state=*]` animacji). Tekst w domyślnym `text-sm text-muted-foreground`.

#### 2. Deck — panel pustej kolekcji

**File**: `src/components/deck/FlashcardCollection.tsx`

**Intent**: Zamienić ręczny płaski `<div>` na `<EmptyState>`.

**Contract**: Blok `flashcards.length === 0` (`:283-290`):
`<div className="text-muted-foreground flex flex-col items-start gap-3 rounded-xl border p-6">…</div>`
→ `<EmptyState title="Nie masz jeszcze żadnych fiszek." action={<Button asChild><a href="/generate">Generuj fiszki</a></Button>} />`.

#### 3. Review — panele „pusto" i „koniec sesji"

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Oba płaskie `<div>` → `<EmptyState>`.

**Contract**:
- `status === "empty"` (`:258-265`): → `<EmptyState title="Nie masz dziś nic do powtórki." action={<Button asChild><a href="/deck">Wróć do talii</a></Button>} />`.
- `status === "finished"` (`:267-274`): → `<EmptyState title={\`To na dziś wszystko — powtórzono ${reviewedCount} fiszek.\`} action={<Button asChild><a href="/deck">Wróć do talii</a></Button>} />`.

#### 4. Review — stan ładowania

**File**: `src/components/review/ReviewSession.tsx`

**Intent**: Ujednolicić wygląd `loading` z resztą (dziś goły `<div>` z `<Loader2>`).

**Contract**: `status === "loading"` (`:252-256`) — zostaje `<Loader2 className="animate-spin" />`
wyśrodkowany, ale w kontenerze spójnym z `<Card>` (`bg-card rounded-xl border shadow-sm py-10
flex justify-center text-muted-foreground`) **albo** owinięty w `<Card>`. Do uznania implementera —
kryterium: wizualnie „pudełko", nie płaski obszar.

#### 5. Dashboard — karta powitalna przez `<Card>`

**File**: `src/pages/dashboard.astro`

**Intent**: Zastąpić ręczny `<div>` karty prymitywem `<Card>` (Astro renderuje go do statycznego HTML).

**Contract**: `import { Card, CardContent } from "@/components/ui/card"` we frontmatterze.
`<div class="bg-card text-card-foreground rounded-xl border p-8 text-center shadow-sm">…</div>` →
`<Card class="mx-auto w-full max-w-sm"><CardContent class="flex flex-col gap-2 text-center">…</CardContent></Card>`
(ograniczenie `max-w-sm` z fazy 1 zostaje — `<Card>` bez niego rozlałby się na `max-w-3xl`). Treść (h1
„Start" / „Dashboard" + powitanie + zdanie o dostępie) bez zmian semantycznych. Uwaga na `class` vs
`className` — w `.astro` na komponencie React Astro akceptuje `class`.

#### 6. Reconcyliacja paddingu karty (notatka)

**File**: — (bez zmian pliku)

**Intent**: Karta login ma `p-8`, `<Card>` ma `py-6` + sub-części `px-6`. Wzorcem jest `/auth/signin`,
ale auth używa ręcznych `<div>`, a aplikacja `<Card>`. **Decyzja: nie ruszamy ani auth, ani `<Card>`** —
delta ~8px w paddingu jest akceptowalna, a zmiana `<Card>` dotknęłaby każdego ekranu z fiszkami bez
realnej korzyści przed debiutem. Auth `p-8` zostaje wzorcem języka (typografia, `max-w`, centrowanie),
nie wartości paddingu.

### Success Criteria:

#### Automated Verification:

- Lint przechodzi: `npm run lint`
- Typecheck przechodzi: `npx astro check`
- Testy przechodzą: `npm test` — w szczególności testy `FlashcardCollection` / `ReviewSession`, jeśli
  asertują na tekstach paneli pustych (zaktualizować selektory, nie logikę).
- Build przechodzi: `npm run build`

#### Manual Verification:

- Panel „Nie masz jeszcze żadnych fiszek" (deck, pusta kolekcja) ma tło karty i cień — nie wygląda
  płasko obok kart fiszek.
- Panele „pusto" / „koniec sesji" w review wyglądają identycznie jak panel w deck.
- Stan ładowania review to wizualnie pudełko, nie płaski obszar.
- Dashboard to karta powitalna `max-w-sm` wyśrodkowana w poziomie, wyrównana do góry, `text-2xl` h1 —
  nie rozlewa się na całą szerokość kontenera.
- Brak regresji w kartach propozycji / fiszek / sesji.
- Formularze auth + generate + deck wyglądają jak jedna rodzina: etykiety `text-sm font-medium`,
  input/textarea `h-9`/`rounded-md`/`shadow-xs` na tokenach, akcje na `<Button>` — potwierdzenie
  kryterium Outcome S-08 „jednolite formularze" (nic nie tykaliśmy, ale rdzeń nie mógł go zepsuć).

**Implementation Note**: Po tej fazie kończy się **rdzeń**. Pauza na ręczne potwierdzenie. Decyzja
przed fazą 4: kontynuować bufor czy zamknąć przebieg (jeśli termin napiera).

---

## Phase 4: Webfont Inter przez Astro Fonts API (BUFOR)

### Overview

Self-hosted Inter przez wbudowane Astro Fonts API; token `--font-sans` w Tailwind wskazuje Inter.

### Changes Required:

#### 1. Konfiguracja fontu

**File**: `astro.config.mjs`

**Intent**: Zadeklarować Inter jako font pobierany w buildzie i serwowany z własnego origin.

**Contract**: Import `fontProviders` z `astro/config`. Dodać do `defineConfig`:
```js
fonts: [{
  name: "Inter",
  cssVariable: "--font-inter",
  provider: fontProviders.fontsource(),
  weights: [400, 500, 600, 700],
  styles: ["normal"],
  subsets: ["latin", "latin-ext"],
}]
```
`latin-ext` pokrywa polskie diakrytyki (ą, ć, ę, ł, ń, ó, ś, ź, ż). `cssVariable` **musi** być rozłączny
z `--font-sans` (patrz Critical Implementation Details).

#### 2. Wstrzyknięcie fontu w `<head>`

**File**: `src/layouts/Layout.astro`

**Intent**: `<Font>` generuje `@font-face` + ustawia `--font-inter` na `:root`; `preload` skraca czas
do pierwszego renderu właściwym krojem.

**Contract**: `import { Font } from "astro:assets"` we frontmatterze. W `<head>` (po `<title>`):
`<Font cssVariable="--font-inter" preload />`. `Layout.astro` jest bazą dla wszystkich layoutów
(w tym `AppLayout` i auth), więc font ładuje się globalnie.

#### 3. Podpięcie tokenu do Tailwind

**File**: `src/styles/global.css`

**Intent**: `font-sans` w Tailwind v4 ma wskazywać Inter zamiast systemowego stacka Preflight.

**Contract**: W bloku `@theme inline` dodać `--font-sans: var(--font-inter);`. Fallbacki (`sans-serif`
itd.) dokłada Astro Fonts API do wartości `--font-inter`. Body już ma `@apply … text-foreground`
i dziedziczy `font-sans` z Preflight — po tej zmianie dziedziczy Inter.

### Success Criteria:

#### Automated Verification:

- Build przechodzi z pobraniem fontów: `npm run build` (sprawdzić brak błędów providera Fontsource).
- Lint / typecheck / testy: `npm run lint`, `npx astro check`, `npm test`.
- Pliki fontów obecne w output buildu (`dist/_astro/` lub katalog fontów Astro).

#### Manual Verification:

- Aplikacja renderuje się krojem Inter (nie systemowym sans) na wszystkich ekranach, w tym auth.
- Polskie znaki diakrytyczne renderują się poprawnie (ą, ę, ł, ó, ś, ż w „Sesja powtórkowa",
  „Kolekcja", „Wyloguj").
- Brak widocznego FOUC / przeskoku layoutu przy ładowaniu (`preload` + self-hosting).
- `preview` produkcyjnego buildu (`npm run preview`) — font serwowany lokalnie, brak żądań do
  zewnętrznych domen w Network.

**Implementation Note**: Po tej fazie — pauza na ręczne potwierdzenie.

---

## Phase 5: Lokalizacja PL — auth + dashboard (BUFOR)

### Overview

Widoczne teksty ekranów auth i dashboardu na polski, komunikaty walidacji mrożone w stałych
(konwencja domu).

### Changes Required:

#### 1. Strony auth

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Nagłówki, teksty pomocnicze i linki po polsku.

**Contract**: Stringi widoczne: „Sign in" → „Zaloguj się", „Sign up" → „Załóż konto", „Don't have an
account?" → „Nie masz konta?", „Already have an account?" → „Masz już konto?", „Sign in"/„Sign up"
(linki) odpowiednio, `confirm-email` „Registration successful" / „Check your email" / opisy / „Go to
sign in" / „Back to sign in". `title` w `<Layout title=…>` też na PL. Bez zmian w strukturze.

#### 2. Komponenty formularzy auth

**File**: `src/components/auth/SignInForm.tsx`, `src/components/auth/SignUpForm.tsx`

**Intent**: Etykiety pól, placeholdery, teksty przycisków i **komunikaty walidacji** po polsku,
zebrane w stałym obiekcie na górze modułu (wzorzec z `GenerateView`/`ReviewSession` — `FALLBACK_ERROR`
itd.).

**Contract**:
- Etykiety `FormField`: „Email" → „Email" (bez zmian), „Password" → „Hasło".
- Placeholdery: „you@example.com" zostaje, „Your password" → „Twoje hasło".
- `pendingText`: „Signing in..." → „Logowanie…", „Signing up…" → analogicznie.
- Komunikaty `validate()`: „Email is required" → „Podaj adres email", „Enter a valid email address" →
  „Podaj poprawny adres email", „Password is required" → „Podaj hasło" (+ analogiczne w `SignUpForm`,
  w tym reguły siły hasła jeśli są). Zebrać w `const MESSAGES = { … } as const` na górze pliku.

#### 3. Pozostałe komponenty auth (jeśli niosą widoczny tekst)

**File**: `src/components/auth/SubmitButton.tsx`, `src/components/auth/ServerError.tsx`, `src/components/auth/PasswordToggle.tsx`

**Intent**: Sprawdzić i przetłumaczyć wszelkie zaszyte stringi (`aria-label` toggle hasła, domyślne
teksty). `ServerError` renderuje komunikat z serwera — jeśli ma własny fallback string, na PL.

**Contract**: Przejść pliki, przetłumaczyć widoczne/`aria-label` stringi. Nie zmieniać kontraktu
komponentów.

#### 4. Dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: „Dashboard" / „Welcome" / zdanie o dostępie na PL, spójnie z etykietą nav „Start".

**Contract**: h1 „Dashboard" → „Start". „Welcome, {email}" → „Witaj, {email}". „This page is only for
authenticated users." → „Ta strona jest dostępna tylko dla zalogowanych." `<AppLayout title="Dashboard">`
→ `title="Start"`.

#### 5. Język dokumentu

**File**: `src/layouts/Layout.astro`

**Intent**: Po lokalizacji cały interfejs jest polski (nav/generate/deck/review już są), więc
`<html lang="en">` jest błędny — psuje wymowę czytników ekranu, dzielenie wyrazów i `:lang()`.

**Contract**: `<html lang="en">` (`:14`) → `<html lang="pl">`. Bez innych zmian w pliku.
`Welcome.astro` (landing) dziedziczy ten layout — akceptowalne, bo landing i tak jest kandydatem do
tłumaczenia poza tym przebiegiem; alternatywnie ustawić `lang` per-strona, ale to rozszerza zakres.

### Success Criteria:

#### Automated Verification:

- Lint / typecheck / testy: `npm run lint`, `npx astro check`, `npm test`.
- Testy formularzy auth (jeśli asertują na komunikatach walidacji) — zaktualizować oczekiwane teksty.

#### Manual Verification:

- `/auth/signin`, `/auth/signup`, `/auth/confirm-email` — zero tekstu angielskiego widocznego dla
  użytkownika.
- Wymuszona walidacja (pusty submit) pokazuje polskie komunikaty pod polami.
- Dashboard: „Start", „Witaj, …", polskie zdanie o dostępie; nav „Start" spójne z h1.
- `<html lang="pl">` w wyrenderowanym dokumencie (DevTools → Elements) na każdym ekranie aplikacji.
- `Welcome.astro` (landing) **niezmieniony** — nadal po angielsku, poza zakresem (dziedziczy `lang="pl"` —
  akceptowalne odstępstwo, landing to osobny przebieg tłumaczenia).

**Implementation Note**: Po tej fazie — pauza na ręczne potwierdzenie.

---

## Phase 6: Wyciszenie szumu `dark:` w dotkniętych prymitywach (BUFOR)

### Overview

Usunięcie martwych wariantów `dark:` z prymitywów, które i tak dotykamy. Tokeny `.dark`
w `global.css` **zostają** jako uśpiony kod (zerowy koszt, grunt pod przyszłość).

### Changes Required:

#### 1. Button

**File**: `src/components/ui/button.tsx`

**Intent**: Usunąć `dark:*` z wariantów — aplikacja jest light-only, `<html>` nigdy nie dostaje `.dark`.

**Contract**: Z `buttonVariants` usunąć: `dark:aria-invalid:ring-destructive/40` (baza),
`dark:focus-visible:ring-destructive/40 dark:bg-destructive/60` (destructive),
`dark:bg-input/30 dark:border-input dark:hover:bg-input/50` (outline), `dark:hover:bg-accent/50` (ghost).
Zachować całą resztę (fokus, `aria-invalid` bez `dark:`, warianty light).

#### 2. Textarea

**File**: `src/components/ui/textarea.tsx`

**Contract**: Usunąć `dark:bg-input/30 dark:aria-invalid:ring-destructive/40`. Reszta bez zmian.

#### 3. Alert (jeśli dotknięty w fazie 3) i inne

**File**: `src/components/ui/alert.tsx`, `src/components/auth/FormField.tsx`

**Contract**: `alert.tsx` nie ma dziś `dark:` — sprawdzić i zostawić. `FormField.tsx` `inputBase` —
sprawdzić, brak `dark:` obecnie. Przejść wszystkie prymitywy `ui/` grep-em `dark:` i usunąć wystąpienia;
**nie** ruszać `@custom-variant dark` ani bloku `.dark {}` w `global.css`.

#### 4. Notatka w global.css

**File**: `src/styles/global.css`

**Intent**: Oznaczyć blok `.dark` jako świadomie uśpiony, żeby następny czytelnik nie wziął go za
funkcję do dokończenia.

**Contract**: Dodać komentarz nad `.dark {` (`:41`): np.
`/* Light-only (S-08). Tokeny .dark zachowane jako uśpiony grunt — nic nie ustawia klasy .dark. */`.

### Success Criteria:

#### Automated Verification:

- Lint / typecheck / testy / build: `npm run lint`, `npx astro check`, `npm test`, `npm run build`.
- `grep -rn "dark:" src/components/ui/` zwraca zero wyników.

#### Manual Verification:

- Wygląd wszystkich przycisków, textarea, alertów, formularzy bez zmian w trybie jasnym (jedyny tryb).
- Brak wizualnej regresji na `/generate`, `/deck`, `/review`, `/auth/*`.

**Implementation Note**: Ostatnia faza. Po niej — pełny przegląd wizualny wszystkich ekranów przed
zamknięciem S-08.

---

## Testing Strategy

### Unit Tests:

- Przebieg jest prezentacyjny — nowych testów jednostkowych logiki nie ma.
- `<EmptyState>` (faza 3): jeśli dom zwykle testuje prymitywy, dodać lekki test renderu (tytuł + slot
  akcji). Jeśli prymitywy `ui/` nie mają testów — pominąć (spójność z konwencją).
- Zaktualizować istniejące testy `FlashcardCollection` / `ReviewSession` / formularzy auth **tylko**
  w zakresie selektorów tekstu (panele stanów, komunikaty walidacji PL) — nie logiki.

### Integration Tests:

- Brak nowych. Istniejące testy komponentów są liniami obrony przed regresją logiki.

### Manual Testing Steps:

1. Przejść `/dashboard` → `/generate` → `/deck` → `/review` i sprawdzić, że treść jest w jednej osi
   z nav i wyrównana do góry.
2. Zwęzić okno do 320px — nav bez poziomego scrolla, „Wyloguj" jak `outline`, tabulacja działa.
3. Pusta kolekcja (`/deck` na koncie bez fiszek) — panel wygląda jak karta.
4. Sesja review: pusto / w trakcie / koniec — panele spójne, `<h1>` widoczny.
5. (Po fazie 4) Sprawdzić Inter i polskie diakrytyki; `npm run preview` → brak żądań do zewnętrznych
   domen fontów w Network.
6. (Po fazie 5) `/auth/signin` pusty submit — polskie komunikaty walidacji.
7. Landing `/` niezmieniony (kosmiczny, angielski).

## Performance Considerations

- Webfont (faza 4): self-hosting + `preload` + tylko wagi 400/500/600/700 + subsety `latin`/`latin-ext`
  ogranicza transfer. `styles: ["normal"]` (bez italic) połowi liczbę plików. Bez tego kroku aplikacja
  zostaje na systemowym foncie (zerowy koszt) — dlatego faza jest w buforze.
- Reszta zmian to klasy Tailwind — zerowy wpływ na bundle (te same utility, częściowo mniej klas po
  fazie 6).

## Migration Notes

- Brak migracji danych, brak zmian API, brak zmian schematu.
- Rollback dowolnej fazy = rewert commita fazy; fazy są niezależne w tył (faza N nie zależy od
  artefaktów fazy N-1 poza wspólnym kontenerem z fazy 1).

## References

- Badanie wewnętrzne: [context/changes/visual-polish-pass/research.md](./research.md)
- Wzorzec: [src/pages/auth/signin.astro:9-15](../../../src/pages/auth/signin.astro)
- Roadmap S-08: [context/foundation/roadmap.md:194-205](../../foundation/roadmap.md)
- Konwencje domu / luka a11y: `context/archive/2026-09-01-srs-review-session/research.md:207-224`
- Astro Fonts API + Tailwind v4: dokumentacja Astro (`fonts:` config, `<Font>` component, `@theme inline`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Wspólny kontener treści + powłoka nawigacji

#### Automated

- [x] 1.1 Lint przechodzi: `npm run lint`
- [x] 1.2 Typecheck przechodzi: `npx astro check`
- [x] 1.3 Testy przechodzą: `npm test`
- [x] 1.4 Build przechodzi: `npm run build`

#### Manual

- [ ] 1.5 Krawędzie treści 4 ekranów w jednej osi z nav
- [ ] 1.6 Wszystkie 4 ekrany wyrównane do góry (brak pełnoekranowego centrowania)
- [ ] 1.7 Nav 320px: brak poziomego scrolla, „Wyloguj" jak `outline`, klawiatura, `aria-current` na jednej pozycji
- [ ] 1.8 Nav na szerokim ekranie: krawędzie w jednej osi z treścią przy `max-w-3xl`, email `truncate`, brak zawijania na desktopie

### Phase 2: Skala typografii i nagłówki

#### Automated

- [ ] 2.1 Lint przechodzi: `npm run lint`
- [ ] 2.2 Typecheck przechodzi: `npx astro check`
- [ ] 2.3 Testy przechodzą: `npm test`

#### Manual

- [ ] 2.4 Żaden ekran nie ma nagłówka większego niż `text-2xl`
- [ ] 2.5 `/review` ma widoczny `<h1>` w każdym stanie
- [ ] 2.6 Nagłówki sekcji mają ten sam rozmiar

### Phase 3: Karty i panele stanów

#### Automated

- [ ] 3.1 Lint przechodzi: `npm run lint`
- [ ] 3.2 Typecheck przechodzi: `npx astro check`
- [ ] 3.3 Testy przechodzą: `npm test` (zaktualizowane selektory tekstu paneli pustych)
- [ ] 3.4 Build przechodzi: `npm run build`

#### Manual

- [ ] 3.5 Panel pustej kolekcji (deck) ma tło karty i cień
- [ ] 3.6 Panele „pusto" / „koniec sesji" w review identyczne z panelem deck
- [ ] 3.7 Stan ładowania review to wizualnie pudełko
- [ ] 3.8 Dashboard to karta powitalna `max-w-sm` wyśrodkowana w poziomie, wyrównana do góry, `text-2xl` h1
- [ ] 3.9 Brak regresji w kartach propozycji / fiszek / sesji
- [ ] 3.10 Formularze auth + generate + deck wyglądają jak jedna rodzina (Outcome „jednolite formularze")

### Phase 4: Webfont Inter przez Astro Fonts API (BUFOR)

#### Automated

- [ ] 4.1 Build przechodzi z pobraniem fontów: `npm run build`
- [ ] 4.2 Lint / typecheck / testy przechodzą
- [ ] 4.3 Pliki fontów obecne w output buildu

#### Manual

- [ ] 4.4 Aplikacja renderuje się krojem Inter na wszystkich ekranach
- [ ] 4.5 Polskie diakrytyki renderują się poprawnie
- [ ] 4.6 Brak widocznego FOUC / przeskoku layoutu
- [ ] 4.7 `npm run preview` — brak żądań do zewnętrznych domen fontów

### Phase 5: Lokalizacja PL — auth + dashboard (BUFOR)

#### Automated

- [ ] 5.1 Lint / typecheck / testy przechodzą
- [ ] 5.2 Testy formularzy auth zaktualizowane o polskie komunikaty

#### Manual

- [ ] 5.3 `/auth/*` — zero widocznego tekstu angielskiego
- [ ] 5.4 Wymuszona walidacja pokazuje polskie komunikaty
- [ ] 5.5 Dashboard: „Start", „Witaj, …", polskie zdanie o dostępie
- [ ] 5.6 `<html lang="pl">` w wyrenderowanym dokumencie na każdym ekranie aplikacji
- [ ] 5.7 `Welcome.astro` niezmieniony

### Phase 6: Wyciszenie szumu `dark:` w dotkniętych prymitywach (BUFOR)

#### Automated

- [ ] 6.1 Lint / typecheck / testy / build przechodzą
- [ ] 6.2 `grep -rn "dark:" src/components/ui/` zwraca zero wyników

#### Manual

- [ ] 6.3 Wygląd przycisków / textarea / alertów / formularzy bez zmian w trybie jasnym
- [ ] 6.4 Brak wizualnej regresji na `/generate`, `/deck`, `/review`, `/auth/*`
