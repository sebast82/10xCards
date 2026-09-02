# Kontrakt błędów generowania — Plan Brief

> Full plan: `context/changes/testing-generation-error-contract/plan.md`
> Research: `context/changes/testing-generation-error-contract/research.md`

## What & Why

Rollout Phase 1 z `context/foundation/test-plan.md`. Dwa kontrakty bez pokrycia:
**#1** — każda klasa awarii dostawcy modelu kończy się rozróżnialnym, nie-pustym komunikatem i zerem
zapisów propozycji; **#5** — wklejony tekst źródłowy nie przeżywa żądania (brak w bazie, logach, ciałach
błędu). Oba są dziś bronione strukturalnie i mechanicznie, ale nikt tego nie testuje — pierwsza migracja
tknąca `generations` albo zmiana serwera przepuszczająca pustą tablicę cofnie ochronę po cichu.

## Starting Point

`src/lib/openrouter/client.ts`, `src/pages/api/generations.ts` i `src/components/generate/GenerateView.tsx`
mają **zero testów**. `client.ts` przeszedł w trakcie researchu zmianę (nowy kod `rate_limited`, zawężona
detekcja braku trasy ZDR) — bez trwałych testów. `parse.ts` i `generations/service.ts` są przetestowane, ale
service mockuje wewnętrzny moduł klienta zamiast granicy sieci. Dwa CHECK-i anty-wyciekowe w bazie —
niepokryte.

## Desired End State

Trzy nowe pliki Vitest (`client.test.ts`, `generations.test.ts`, `GenerateView.test.tsx`) w CI, jeden nowy
plik pgTAP jako bramka ad hoc, jeden świadomy przebieg Stryker na dwóch plikach z logiką rozróżnialności.
Każda klasa awarii ma asercję na **konkretny tekst** na co najmniej jednej warstwie; klasy niosące
instrukcję (`timeout`, `network`, `rate_limited`, `truncated`) są rozróżnialne wzajemnie. Istnieje asercja
„żadne zapytanie nie dotyka `flashcards`" i „sentinel nie wychodzi w żadnym błędzie". Cookbook §6.1/§6.2
wypełniony.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Substrat testów „integration" | `SupabaseStub` + `vi.mock("astro:env/server")` + stub `fetch`; realne Supabase tylko dla pgTAP | Trasa pisze wyłącznie do `generations`; jedyne asercje, przy których stub kłamie (constrainty), są tańsze i mocniejsze w pgTAP | Research |
| Zakres fazy | Wszystkie 4 pakiety (P1–P4) + Stryker + cookbook | Rozróżnialność ginie na każdej z 4 warstw — test na jednej nie dowodzi kontraktu | Plan |
| `GenerateView` renderujący `proposals: []` jako review | Tylko test — przypięcie obecnego zachowania jako regresyjny tripwire | Faza jest testowa; obrona klienta to zmiana zachowania na Fazę 2+ | Plan |
| Q3 — `markFailed` sam zawodzi, wiersz `pending` na zawsze | Asercja tylko na obserwowalny kontrakt (błąd przerzucony → 502); osierocony wiersz jako znany dług | Żadne źródło nie mówi, co powinno się stać — asercja fixu byłaby wymyślaniem oracle | Plan |
| Głębokość asercji fallbacku ZDR w P1 | Pełna: bez `zdr`, z `data_collection: "deny"`, jeden `AbortSignal`, brak ponowienia dla `"Resource not found"`, `privacyMode` flip tylko przy drugim żądaniu | To load-bearing gwarancje z planu S-02 („ciche obniżenie prywatności gorsze niż jej brak") | Plan |
| Stryker | Jeden selektywny przebieg na `client.ts` + `generations.ts` po zazielenieniu P1/P2 | CLAUDE.md wprost zaleca Stryker jako selektywną bramkę po fazie ryzyka; te pliki niosą logikę rozróżnialności | Plan |
| 5. pakiet („`/api/flashcards` odrzuca `failed` generationId") | Odłożony do Fazy 2 | Strażnik aplikacyjny splata się z własnością rekordu (ryzyko #2 = Faza 2) | Research |
| Literalny timeout 45 000 ms | Nie testujemy — tylko rozróżnienie `timeout` vs `network` po `error.name` | `AbortSignal.timeout` używa timera nieprzechwytywanego przez fake timers, stała nie eksportowana | Research |

## Scope

**In scope:**
- `client.test.ts` — klasy awarii A–D, `rate_limited` z obu sygnałów, pełny kontrakt fallbacku ZDR, brak wycieku
- `generations.test.ts` — drabina 401/503/400/429/500/502, stałe ciała, zakaz `issues`, zero dotknięcia `flashcards`, Q3 obserwowalny, brak wycieku
- `GenerateView.test.tsx` — dokładny komunikat w DOM różny między klasami, tripwire pustej tablicy, tripwire timeout=sieć, ostrzeżenie trybu standard
- pgTAP — kształt `source_text_hash`, kształt `error_code`, biwarunek `error_code ⟺ status='failed'`
- Selektywny Stryker + cookbook §6.1/§6.2/§6.7

**Out of scope:**
- Jakakolwiek zmiana zachowania produkcyjnego (obrona klienta, naprawa `markFailed`, eksport stałych)
- Wpięcie pgTAP do CI (Faza 2)
- Pakiet „`/api/flashcards` odrzuca `failed` generationId" (Faza 2)
- Ocena odwracalności hasha SHA-256
- Zmiany w `service.test.ts`, `docs/reference/contract-surfaces.md`, strategii test-planu §1–§5

## Architecture / Approach

Dwie warstwy, od najtańszej. `vi.stubGlobal("fetch")` w pełni steruje `client.ts` (goły globalny `fetch`,
brak wstrzykiwanego zależnika). `vi.mock("astro:env/server")` (jednolinijkowe, zweryfikowane) odblokowuje
import trasy. `SupabaseStub` rejestruje zapytania — kolejka pozycyjna, więc asercje liczą sekwencję
`select → insert → update`. Fixture'y budowane z ciał cytowanych w docach OpenRoutera / planie S-02, nie z
kształtu implementacji. pgTAP dla tego, przy czym stub kłamie: constrainty bazy. Stryker na końcu weryfikuje,
że „linia wykonana" ≠ „test by pękł".

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. P1 `client.test.ts` | Hermetyczny test granicy dostawcy + pokrycie zmiany z researchu | Asercja współdzielonego sygnału zbyt implementacyjna — mitygacja: to nazwany kontrakt |
| 2. P2 `generations.test.ts` | Pełna drabina statusów, stałe ciała, zero zapisów fiszek | Pozycyjna kolejka `SupabaseStub` — przesunięcie indeksów po zmianie serwisu |
| 3. P3 `GenerateView.test.tsx` | Dokładny komunikat w DOM różny między klasami; tripwire'y luk | Pokusa asercji „alert istnieje" zamiast tekstu — jawnie zakazane |
| 4. P4 pgTAP | Trzy asercje na CHECK-i anty-wyciekowe (bramka ad hoc) | Wymaga lokalnego `supabase start`; nie w CI (Faza 2) |
| 5. Stryker | Jeden selektywny przebieg + triage przeżywających mutantów | Pogoń za wynikiem % zamiast pytania „czy zaszkodzi użytkownikowi" |
| 6. Cookbook + sync | §6.1/§6.2/§6.7 wypełnione, statusy przesunięte | — |

**Prerequisites:** dostęp do repo; do P4/P5 — `supabase start` lokalnie, `npx`/devDependency Stryker.
**Estimated effort:** ~3–4 sesje przez 6 faz; P1–P3 to gros pracy, P4–P6 krótkie.

## Open Risks & Assumptions

- **Zastrzeżenie środowiskowe**: testy dowodzą semantyki `DOMException` w Node 24, produkcja to workerd —
  rozróżnienie `timeout`/`network` po `error.name` weryfikowane wyłącznie w Node.
- **Q2 niepewność resztkowa**: dokumentacja pokazuje wariant komunikatu 404 dla `provider.only`, nie
  dosłownie dla `zdr`; zdanie wiodące jest udokumentowane jako wspólne. Jedno żywe wywołanie zamknęłoby to
  ostatecznie — nieblokujące.
- **Q3 przyjęte ryzyko**: osierocony wiersz `pending` po podwójnej awarii pozostaje nienaprawiony do Fazy 2.
- **Stryker nie jest dziś zależnością** — instalacja albo `npx` jednorazowo.

## Success Criteria (Summary)

- Każda klasa awarii dostawcy ma asercję na rozróżnialny, konkretny komunikat; `npm test` obejmuje 3 nowe
  pliki i przechodzi w CI.
- Istnieje dowód, że przy awarii żadne zapytanie nie idzie do `flashcards` i sentinel nie wychodzi w żadnym
  błędzie ani zapisie.
- `npm run db:test` obejmuje CHECK-i anty-wyciekowe; jeden przebieg Stryker wykonany i przetriagowany;
  cookbook §6.1/§6.2 wypełniony.
