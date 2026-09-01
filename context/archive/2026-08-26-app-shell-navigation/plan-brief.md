# App Shell Navigation — Plan Brief

> Full plan: `context/changes/app-shell-navigation/plan.md`

## What & Why

Budujemy wspólną powłokę zalogowanej części 10xCards. Użytkownik ma przechodzić między dashboardem, generowaniem i kolekcją z jednej nawigacji obecnej na każdym ekranie, bez polegania na przycisku „wstecz”, oraz zawsze widzieć bieżącą funkcję.

## Starting Point

Bazowy layout zawiera dokument, bannery konfiguracji i slot, ale nie nawigację. Dashboard ma własne linki i wylogowanie, generowanie nie ma przejść do innych funkcji, a kolekcja odsyła do generowania tylko w pustym stanie; publiczny ekran wejściowy ma osobny `Topbar`, który pozostaje poza zakresem.

## Desired End State

Trzy istniejące chronione strony korzystają z jednego `AppLayout`. Shell pokazuje markę, wszystkie działające funkcje, email użytkownika i wylogowanie, a aktywna sekcja ma widoczny stan oraz `aria-current`. Rozwiązanie jest serwerowe, responsywne bez menu JavaScript i gotowe na dopisanie `/review` wraz z S-05.

## Key Decisions Made

| Decision         | Choice                           | Why (1 sentence)                                                             |
| ---------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Zasięg           | Tylko zalogowana aplikacja       | Chroniony shell nie narusza działającego publicznego wejścia ani auth.       |
| Widoczne funkcje | Tylko istniejące trasy           | Każda pozycja działa; Nauka dołączy razem z `/review`.                       |
| Dashboard        | Lekki ekran startowy             | Zachowujemy wiążącą trasę bez budowania nowej funkcji.                       |
| Brand            | Link do `/dashboard`             | Marka prowadzi do początku zalogowanego kontekstu.                           |
| Mobile           | Zawsze widoczny kompaktowy układ | Trzy funkcje nie uzasadniają stanu menu ani hydratacji.                      |
| Pozycja          | Obecna w shellu, nie sticky      | Wymaganie dotyczy trwałej struktury, nie przyklejenia do viewportu.          |
| Aktywna sekcja   | Dokładna trasa lub podścieżka    | Przyszłe `/deck/:id` zachowa kontekst Kolekcji bez fałszywych prefiksów.     |
| Testy            | Logika tras + check/lint/build   | Chronimy ryzykowny kontrakt bez dokładania infrastruktury E2E.               |
| Architektura     | Zagnieżdżony `AppLayout`         | Jawnie oddziela chronioną powłokę od bazowego dokumentu i publicznych stron. |

## Scope

**In scope:**

- Centralny kontrakt działających pozycji i segmentowego dopasowania tras.
- Serwerowy komponent nawigacji z aktywnym stanem, kontem i wylogowaniem.
- Zagnieżdżony layout chronionej aplikacji.
- Migracja `/dashboard`, `/generate` i `/deck` oraz usunięcie duplikatów z dashboardu.
- Test jednostkowy kontraktu i manualna kontrola desktop/mobile, auth i dostępności.

**Out of scope:**

- `/review`, placeholder lub wyłączona pozycja Nauka.
- Publiczny `/`, strony auth i ich `Topbar`.
- Redesign, sticky header, hamburger, dolny pasek i klientowy router.
- Zmiany sesji, middleware, endpointów, danych oraz nowa infrastruktura E2E.

## Architecture / Approach

`AppLayout.astro` zagnieżdża istniejący `Layout.astro`, renderuje `AppNavigation.astro` i semantyczny `<main>`. Nawigacja czyta `Astro.url.pathname` oraz `Astro.locals.user`, a definicje pozycji i czysta reguła dopasowania żyją w `src/lib/navigation.ts`, dzięki czemu Vitest zabezpiecza dokładne trasy, podścieżki i kolizje prefiksów bez hydratacji komponentu.

## Phases at a Glance

| Phase                             | What it delivers                                            | Key risk                                                   |
| --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Kontrakt Nawigacji i Powłoka   | Testowalne trasy, serwerową nawigację i nowy app layout     | Błędne dopasowanie prefiksu lub zbyt ciasny mobile layout  |
| 2. Adopcja Przez Chronione Ekrany | Wspólny shell na wszystkich działających ekranach aplikacji | Duplikaty kontrolek albo regresja publicznego/auth layoutu |

**Prerequisites:** S-02 jest ukończone; istnieją `/dashboard`, `/generate`, `/deck`, middleware z `locals.user` oraz `POST /api/auth/signout`.

**Estimated effort:** Około 1 sesja implementacyjna w 2 fazach plus krótka ręczna weryfikacja w Chromium.

## Open Risks & Assumptions

- Zakładamy maksymalnie trzy widoczne funkcje w S-07; po dodaniu Nauki S-05 może wymagać ponownej oceny układu mobile, a pełne dopracowanie należy do S-08.
- Brak E2E oznacza, że responsywność, widoczny aktywny stan i pełny przepływ wylogowania wymagają manualnego potwierdzenia.
- `AppLayout` jest kontraktem dla chronionych stron; użycie go na publicznym ekranie bez użytkownika byłoby błędem integracji.

## Success Criteria (Summary)

- Użytkownik przechodzi między wszystkimi istniejącymi funkcjami wyłącznie przez shell i zawsze widzi aktywną sekcję.
- Nawigacja działa bez klientowego JavaScriptu, mieści się na mobile i zachowuje dostęp klawiaturą oraz `aria-current`.
- Wylogowanie, ochrona tras, publiczny ekran wejściowy i strony auth zachowują dotychczasowe działanie; testy, check, lint i build przechodzą.
