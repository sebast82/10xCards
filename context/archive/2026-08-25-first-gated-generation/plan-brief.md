# S-02 `first-gated-generation` — Plan Brief

> Pełny plan: `context/changes/first-gated-generation/plan.md`
> Research: `context/changes/first-gated-generation/research.md`

## What & Why

Użytkownik wkleja własny tekst, AI proponuje fiszki, a **żadna nie trafia do kolekcji bez jego świadomej akceptacji**. To jest gwiazda przewodnia MVP i jedyny przepływ weryfikujący główne kryterium sukcesu PRD — „75% fiszek wygenerowanych przez AI jest akceptowane bez istotnych zmian". Jakości propozycji nie da się przewidzieć z dokumentów, tylko zmierzyć na własnym materiale, a przy terminie 2026-08-31 każdy dzień zwłoki to jeden wieczór mniej na poprawę promptu.

## Starting Point

Warstwa danych jest kompletna i restrykcyjna (F-02): dwie tabele, RLS z kompletem polityk, trzy liczniki pomiarowe, `anon` odcięty. Silnik SRS gotowy (F-01). Auth działa i jest zweryfikowany na produkcji (S-01). Czego nie ma wcale: **endpointu zwracającego JSON, wywołania `fetch()` i walidacji wejścia po stronie serwera** — S-02 tworzy wszystkie trzy jako pierwszy. Dwa długi odłożone jawnie przez poprzednie zmiany (`App.Locals` z klientem Supabase, warstwa serwisów) są spłacane tutaj, bo to pierwszy konsument.

## Desired End State

Na `/generate` użytkownik wkleja 200–10 000 znaków, dostaje listę propozycji i przy każdej klika Zapisz, Edytuj albo Odrzuć. Zapisane widzi na `/deck`. Odrzucone nie istnieją nigdzie poza pamięcią przeglądarki. Z wklejonego tekstu w bazie zostaje wyłącznie długość i skrót SHA-256 — nie ma kolumny, która mogłaby go przechować, i nie ma linii logu, która mogłaby go ujawnić.

## Key Decisions Made

| Decyzja | Wybór | Dlaczego | Źródło |
| --- | --- | --- | --- |
| Model | `google/gemini-2.5-flash` | Latencja, nie cena, jest kryterium przy wymaganiu „30 sekund": 0,57 s do pierwszego tokenu wobec 3,79 s `gpt-5-mini` przy tej samej cenie. Rozumowanie jest w tym modelu domyślnie włączone — `max_tokens` musi mieścić jego tokeny, a przewaga latencyjna wymaga potwierdzenia w fazie 9 | Research + przegląd planu |
| Klient LLM | Czysty `fetch`, bez SDK | Limit 3 MB na Workera; SDK ciągnie zależności zakładające Node, a API to jeden POST z JSON-em | Research |
| Nietrwałość tekstu | Pięć niezależnych zamknięć | Transport tylko w ciele POST (logi zapisują URL, nie ciało), `no-console: "error"` w ścieżkach serwerowych, brak kolumny w bazie, ZDR u dostawcy, redakcja błędów | Research |
| Odczyt kolekcji | SSR na `/deck`, bez `GET /api/flashcards` | Wymaganie S-02 spełnia zwykły odczyt w frontmatterze; endpoint powstanie w S-03, gdy będzie znał swoje wymagania | Plan |
| Zapis fiszek | Per fiszka, nie zbiorczo | Natychmiastowa informacja zwrotna; błąd jednej karty nie przewraca całego przeglądu | Plan |
| Liczniki akceptacji | Funkcja RPC **przeliczająca** z `flashcards`, z `for update` na wierszu zlecenia | Przeliczanie daje idempotencję wobec retry; blokada wiersza domyka wyścig między równoległymi zapisami, który zaniżałby pomiar. `security invoker`, więc RLS obowiązuje | Plan + przegląd planu |
| Granice wejścia | 200–10 000 znaków, sufit `min(25, ⌈znaki/400⌉)` | Górna z budżetu CPU 10 ms, dolna z odwracalności SHA-256 dla krótkich tekstów; sufit 25 = `⌈10 000/400⌉`, więc obie wartości zmienia się razem | Plan + przegląd planu |
| Ochrona kosztu | Limit dobowy na użytkownika → `429` | Pierwszy endpoint, który kosztuje pieniądze za żądanie; indeks `(user_id, created_at desc)` już istnieje, więc to kilkanaście linii | Plan |
| Zero Data Retention | Fallback przy braku trasy, **widoczny** w odpowiedzi i UI | Generowanie zawsze działa, ale ciche obniżenie gwarancji prywatności byłoby gorsze niż jej brak — `privacyMode` żyje tyle, co odpowiedź | Plan |
| Model interakcji | Lista kart z edycją w miejscu | Jeden komponent na trzy akcje, zero nowych zależności; `ai` vs `ai_edited` wynika z porównania treści, nie z faktu wejścia w edycję | Plan |
| System stylów | Tokeny shadcn + migracja istniejących ekranów | Jeden system w całym projekcie; migracja wydzielona do ostatniej, odcinalnej fazy | Plan |

## Scope

**In scope:** sekret OpenRoutera i status konfiguracji · `App.Locals` z klientem Supabase · `no-console: "error"` w ścieżkach serwerowych · migracja z funkcją przeliczającą liczniki + test pgTAP · adapter OpenRoutera jako czyste funkcje z testami · `POST /api/generations` · `POST /api/flashcards` · ekran `/generate` (wyspa React) · ekran `/deck` (SSR) · ochrona obu tras · ujednolicenie stylów · weryfikacja na produkcji

**Out of scope:** strumieniowanie i widoczny postęp (S-06) · `GET /api/flashcards` (S-03) · edycja i usuwanie zapisanych fiszek (S-03) · ręczne tworzenie (S-04) · utrwalanie propozycji i sesji przeglądu · dzielenie długiego tekstu na kawałki · testy komponentów React · bindingi KV/D1/R2 · automatyczne ponowienie przy błędzie modelu

## Architecture / Approach

```
/generate (wyspa React)
   │  POST /api/generations  { sourceText }
   ▼
endpoint → serwis generowania
   ├─ limit dobowy (RLS + indeks user_id, created_at)
   ├─ SHA-256 przez crypto.subtle
   ├─ adapter OpenRoutera (fetch, json_schema, zdr → fallback, timeout 45 s)
   └─ insert generations (z jawnym generated_count)
   ▼  { generationId, model, privacyMode, proposals[] }
przegląd w pamięci przeglądarki — odrzucenie nie wywołuje niczego
   │  POST /api/flashcards  { generationId, front, back, edited }   ← raz na kartę
   ▼
endpoint → serwis fiszek
   ├─ weryfikacja własności generation_id (FK nie przechodzi przez RLS)
   ├─ insert flashcards (front, back, source + 9 pól z createNewCard())
   └─ rpc recount_generation_acceptance (for update → count → update)
   ▼
/deck — odczyt SSR, izolacja przez RLS
```

Kolejność faz wynika z jednej zasady: **wszystko, co da się zweryfikować automatycznie, powstaje przed czymkolwiek, co wymaga oczu.** Stąd czyste funkcje adaptera przed endpointami i endpointy przed interfejsem — inaczej ta slice nie dołożyłaby ani jednego testu do bramki `npm test`, bo reszta to sieć i DOM.

## Phases at a Glance

| Faza | Co dostarcza | Kluczowe ryzyko |
| --- | --- | --- |
| 1. Fundament serwerowy | Sekret, `Locals` z Supabase, reguła lintu | `App.Locals` dotyka middleware obsługującego działający na produkcji auth |
| 2. Funkcja przeliczająca liczniki | Migracja RPC + test pgTAP | Test, który przechodzi po usunięciu mechanizmu, nie jest testem (lekcja z F-02) |
| 3. Adapter OpenRoutera | Prompt, schemat, parsowanie — czyste funkcje z testami | Kształt promptu, nie wybór modelu, decyduje o 75% akceptacji |
| 4. `POST /api/generations` | Zlecenie generowania | `generated_count` pominięty przy inserie wywala pierwszą akceptację — na produkcji |
| 5. `POST /api/flashcards` | Zapis zaakceptowanej fiszki | FK `generation_id` **nie** przechodzi przez RLS — własność trzeba sprawdzić ręcznie |
| 6. Ekran `/generate` | Pierwszy widoczny przepływ end-to-end | Pierwsza wyspa wołająca JSON API — ustala wzorzec dla S-03…S-06 |
| 7. Ekran `/deck` + nawigacja | Domknięcie wymagania S-02 | Niskie |
| 8. Ujednolicenie stylów | Jeden system stylów w projekcie | Regresja w zweryfikowanym na produkcji auth — **faza odcinalna** |
| 9. Weryfikacja na produkcji | Sekret, migracja w chmurze, pierwszy pomiar | `astro dev` ≠ `workerd`; pula ZDR nieznana do pierwszego wywołania |

**Prerequisites:** F-02 i S-01 zamknięte (są) · konto OpenRouter z kluczem API · dostęp do Dashboardu Supabase i `wrangler` do sekretów produkcyjnych
**Estimated effort:** 9 faz, z czego 1–5 serwerowe i weryfikowalne automatycznie, 6–7 interfejs, 8 odcinalna, 9 operacyjna

## Open Risks & Assumptions

- **Pula dostawców ZDR dla `google/gemini-2.5-flash` jest nieznana do pierwszego żywego wywołania.** Jeśli fallback włącza się zawsze, trzeba wybrać między zmianą modelu a przyjęciem `data_collection: "deny"` jako wystarczającej gwarancji. `privacyMode` w odpowiedzi jest właśnie po to, żeby ta sytuacja nie przeszła niezauważona.
- **Rozpoznanie „brak trasy ZDR" opiera się na kodzie `404` z komunikatem o dostawcy** — do potwierdzenia empirycznie. Zbyt szeroki warunek zamieniłby każdy błąd `404` w ciche obniżenie prywatności.
- **75% akceptacji jest hipotezą, nie ustaleniem.** Prompt realizuje sześć reguł ze zbieżnych źródeł, ale pierwszy pomiar (faza 9) może wymusić iterację. Dlatego `generations.model` zapisuje slug — bez tego nie da się porównać modeli między sobą.
- **Limit dobowy 20 wybrany „z sufitu".** Jego sens to zamiana nieograniczonego kosztu w policzalny, nie precyzja; do korekty po pierwszym tygodniu.
- **Odświeżenie strony gubi niezapisany przegląd.** Świadomy kompromis: brak utrwalania propozycji jest tym, co spełnia twarde ograniczenie „odrzucone nie trafiają do bazy" — z definicji, a nie przez czyszczenie.
- **Rola `authenticated` nadal ma domyślne `TRUNCATE`/`TRIGGER`/`REFERENCES`** (otwarte ustalenie z przeglądu F-02). Poza zakresem S-02, ale warte wiedzy przy dotykaniu uprawnień w fazie 2.
- **Koszt i latencja są nieoszacowane, dopóki nie znamy udziału tokenów rozumowania.** `gemini-2.5-flash` ma rozumowanie włączone domyślnie, a rozlicza je po stawce wyjścia — szacunek ~0,006 $ za generowanie i przewaga 0,57 s TTFT są dolnymi granicami, nie prognozami. `max_tokens = 8_000 + cap * 400` daje zapas; pomiar `reasoning_tokens` w fazie 9 rozstrzyga, czy zostać przy tym modelu, wyłączyć rozumowanie, czy zejść na `flash-lite`.
- **Podział `ai` / `ai_edited` jest deklarowany przez klienta, nie zmierzony.** Serwer nie utrwala propozycji, więc flagi `edited` nie ma czym zweryfikować. Bez znaczenia przy pomiarze na własnym materiale, istotne przy porównywaniu modeli.

## Success Criteria (Summary)

- Użytkownik przechodzi od wklejonego tekstu do fiszki w kolekcji **na wdrożonej instancji**, decydując o każdej propozycji z osobna.
- Po przejściu przez przegląd trzy liczniki w `generations` odpowiadają rzeczywistości — łącznie z rozróżnieniem fiszek edytowanych i nieedytowanych. To jedyny instrument pomiaru obu kryteriów PRD.
- Wklejony tekst nie jest odnajdywalny nigdzie po zakończeniu żądania — ani w bazie, ani w `wrangler tail`, ani w komunikacie błędu.
