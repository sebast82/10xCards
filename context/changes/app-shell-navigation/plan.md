# App Shell Navigation Implementation Plan

## Overview

Wprowadzamy wspólną powłokę dla zalogowanej części 10xCards, aby użytkownik mógł przechodzić między dashboardem, generowaniem i kolekcją bez używania przycisku „wstecz” ani ręcznego wpisywania adresu. Powłoka ma też stale udostępniać wylogowanie i jednoznacznie wskazywać bieżącą sekcję, pozostając prostym, serwerowo renderowanym elementem Astro gotowym na późniejsze dołączenie sesji nauki.

## Current State Analysis

Wspólny `Layout.astro` odpowiada obecnie wyłącznie za dokument HTML, bannery konfiguracji i slot treści. Publiczny ekran wejściowy renderuje własny `Topbar.astro`, natomiast chronione strony nie mają wspólnej powłoki: dashboard duplikuje linki i formularz wylogowania, kolekcja prowadzi do generowania tylko z pustego stanu, a ekran generowania nie oferuje przejścia do pozostałych funkcji.

Middleware już udostępnia `Astro.locals.user` i chroni wszystkie trzy istniejące trasy aplikacji. Nie trzeba zmieniać sesji, endpointu wylogowania ani kontraktu tras. Brak testów komponentów Astro, ale Vitest działa dla czystych modułów TypeScript; aktualny baseline to 41 przechodzących testów, 0 błędów `astro check`, poprawny lint i build.

## Desired End State

`/dashboard`, `/generate` i `/deck` korzystają z jednego aplikacyjnego layoutu. Na każdym z tych ekranów użytkownik widzi markę prowadzącą do dashboardu, wszystkie istniejące funkcje, swój identyfikator konta i wylogowanie; bieżąca sekcja ma widoczny stan oraz `aria-current="page"`. Nawigacja jest kompaktowa i dostępna na małych ekranach bez klientowego JavaScriptu, ale nie przykleja się podczas przewijania.

Rozwiązanie jest rozszerzalne: dodanie przyszłej chronionej sekcji, takiej jak `/review`, wymaga dopisania pozycji do centralnego kontraktu i użycia aplikacyjnego layoutu przez nową stronę. Segmentowe dopasowanie oznacza, że przyszłe podstrony, np. `/deck/:id`, zachowują aktywną sekcję Kolekcja.

### Key Discoveries:

- `src/layouts/Layout.astro:1-32` jest bazowym właścicielem dokumentu i slotu, ale nie rozróżnia publicznego oraz zalogowanego kontekstu.
- `src/components/Welcome.astro:2,28` renderuje publiczny `Topbar.astro`; nie należy przenosić tego wariantu do chronionej aplikacji.
- `src/middleware.ts:4-23` pobiera użytkownika i chroni `/dashboard`, `/generate` oraz `/deck`, więc app shell może korzystać z `Astro.locals.user` bez dodatkowego żądania.
- `src/pages/dashboard.astro:18-31` zawiera lokalne linki i wylogowanie, które po migracji byłyby duplikatem powłoki.
- `docs/reference/contract-surfaces.md:10-27` wiążąco rezerwuje istniejące trasy oraz przyszłe `/review`; S-07 nie wprowadza nowego URL.
- Oficjalna dokumentacja Astro 7 potwierdza użycie `Astro.url.pathname`, `Astro.locals`, typowanych propsów, slotów oraz zagnieżdżonych layoutów w serwerowych komponentach `.astro`.

## What We're NOT Doing

- Nie dodajemy `/review`, wyłączonego linku „Nauka” ani strony zastępczej; pozycja dołączy wraz z S-05.
- Nie zmieniamy publicznego `/`, ekranów `/auth/*` ani ich istniejącego `Topbar.astro`.
- Nie zmieniamy endpointu `/api/auth/signout`, middleware, modelu sesji ani przekierowań auth.
- Nie przebudowujemy dashboardu w centrum metryk lub kafli funkcji.
- Nie wykonujemy pełnego visual polish, dark-mode UX ani redesignu typografii i kolorów; te prace należą do S-08.
- Nie dodajemy menu hamburgerowego, dolnego paska, sticky headera, klientowego routera ani hydratacji nawigacji.
- Nie konfigurujemy frameworka E2E ani testów renderowania komponentów Astro.

## Implementation Approach

Pozostawiamy `Layout.astro` jako bazowy dokument używany przez strony publiczne i auth. Nowy, zagnieżdżony `AppLayout.astro` opakuje bazowy layout, aplikacyjną nawigację i semantyczny obszar główny; chronione strony będą wybierać go jawnie. Dzięki temu granica sesji jest widoczna w importach, a bazowy layout nie otrzymuje flag ani warunków zależnych od URL.

Centralny moduł TypeScript będzie źródłem prawdy dla działających pozycji oraz segmentowego dopasowania aktywnej ścieżki. Serwerowy komponent Astro wykorzysta ten moduł wraz z `Astro.url.pathname` i `Astro.locals.user`, więc nawigacja nie potrzebuje JavaScriptu w przeglądarce. Test jednostkowy obejmie dokładne trasy, podścieżki i fałszywe wspólne prefiksy.

## Critical Implementation Details

### User experience spec

Na mobile wszystkie działające funkcje i wylogowanie muszą pozostać dostępne bez otwierania menu; układ może się zawijać, ale nie może powodować poziomego przepełnienia strony. Nawigacja jest obecna na początku każdego chronionego ekranu, lecz przewija się razem z dokumentem.

Strefa konta musi móc się skurczyć wewnątrz układu, a długi email ma się łamać lub wizualnie skracać bez utraty dostępu użytkownika do pełnej wartości.

### State sequencing

Aktywność sekcji musi sprawdzać dokładną ścieżkę albo podścieżkę oddzieloną `/`, np. `pathname === href || pathname.startsWith(`${href}/`)`; surowe `startsWith(href)` błędnie uznałoby `/decking` za część `/deck`. Do kontraktu trafiają wyłącznie działające trasy, dlatego `/review` nie pojawia się przed S-05.

## Phase 1: Kontrakt Nawigacji i Powłoka

### Overview

Ta faza tworzy testowalne źródło prawdy dla nawigacji oraz nowy serwerowy layout zalogowanej aplikacji. Nie migruje jeszcze istniejących stron, dzięki czemu najpierw stabilizuje kontrakt rozszerzany przez kolejne slice’y.

### Changes Required:

#### 1. Kontrakt pozycji i aktywnej sekcji

**File**: `src/lib/navigation.ts`

**Intent**: Zdefiniować w jednym miejscu działające pozycje aplikacji i regułę ustalania bieżącej sekcji. Moduł ma być niezależny od Astro, aby można go było testować w obecnym środowisku Vitest.

**Contract**: Eksportowana, niemutowalna kolekcja obejmuje dashboard, generowanie i kolekcję wraz ze stabilnym identyfikatorem, polską etykietą i wiążącym `href`. Eksportowana funkcja dopasowania zwraca aktywność dla dokładnego `href` i jego podścieżek, ale nie dla tras dzielących tylko prefiks znakowy.

#### 2. Test kontraktu tras

**File**: `src/lib/navigation.test.ts`

**Intent**: Zabezpieczyć zachowanie, na którym opiera się widoczny stan bieżącej funkcji i przyszłe podstrony kolekcji. Test ma używać lokalnego stylu Vitest i importu względnego.

**Contract**: Przypadki obejmują dokładne dopasowanie każdej istniejącej trasy, podścieżkę `/deck/:id`, brak dopasowania między różnymi sekcjami, fałszywy prefiks w rodzaju `/decking` oraz neutralne zachowanie dla nieznanej ścieżki.

#### 3. Serwerowa nawigacja aplikacji

**File**: `src/components/AppNavigation.astro`

**Intent**: Renderować jeden dostępny nagłówek dla zalogowanej części aplikacji bez hydratacji. Komponent ma łączyć markę, główne funkcje, identyfikację konta i istniejącą akcję wylogowania.

**Contract**: Brand „10xCards” prowadzi do `/dashboard`; semantyczne `<nav>` ma dostępną nazwę; linki powstają z centralnego kontraktu i otrzymują widoczny stan aktywny oraz `aria-current="page"` zgodnie z `Astro.url.pathname`. Email pochodzi z `Astro.locals.user`, a wylogowanie pozostaje formularzem `POST` do `/api/auth/signout`. Układ jest kompaktowy, zawijalny i nie-sticky; strefa konta może się kurczyć (`min-width: 0`), a email łamie się lub jest elidowany z pełną wartością nadal dostępną dla użytkownika.

#### 4. Zagnieżdżony layout zalogowanej aplikacji

**File**: `src/layouts/AppLayout.astro`

**Intent**: Ustanowić jawny punkt wejścia dla obecnych i przyszłych chronionych ekranów, bez dokładania warunków auth do bazowego dokumentu.

**Contract**: Layout przyjmuje typowany `title`, przekazuje go do `Layout.astro`, renderuje `AppNavigation.astro` przed treścią i umieszcza domyślny slot w pojedynczym semantycznym `<main>`. Nie wykonuje własnego pobierania użytkownika ani przekierowania; te obowiązki pozostają w middleware.

### Success Criteria:

#### Automated Verification:

- Test kontraktu nawigacji przechodzi: `npm test -- src/lib/navigation.test.ts`
- Pełny zestaw testów przechodzi: `npm test`
- Astro i TypeScript nie raportują błędów: `npm run astro -- check`
- Lint przechodzi: `npm run lint`

**Implementation Note**: Ta faza nie ma ręcznego kryterium, ponieważ nowy layout nie jest jeszcze używany przez trasę. Po przejściu wszystkich kontroli automatycznych można przejść bez osobnej pauzy do fazy 2.

---

## Phase 2: Adopcja Przez Chronione Ekrany

### Overview

Ta faza przełącza wszystkie istniejące strony zalogowanej aplikacji na wspólną powłokę, usuwa duplikaty nawigacji z dashboardu i potwierdza zachowanie w prawdziwej przeglądarce na desktopie oraz mobile.

### Changes Required:

#### 1. Dashboard jako lekki ekran startowy

**File**: `src/pages/dashboard.astro`

**Intent**: Podpiąć wiążący ekran startowy pod app shell i usunąć kontrolki, które po migracji dublowałyby wspólną nawigację. Zachować istniejącą informację powitalną bez rozbudowy dashboardu w nową funkcję.

**Contract**: Strona importuje `AppLayout.astro` zamiast bazowego layoutu. Lokalny `<nav>` z linkami do generowania i kolekcji oraz lokalny formularz wylogowania zostają usunięte; email użytkownika może pozostać w treści powitalnej.

#### 2. Ekran generowania w powłoce

**File**: `src/pages/generate.astro`

**Intent**: Udostępnić przejście z generowania do wszystkich pozostałych działających funkcji bez ingerencji w stan i logikę Reactowej wyspy.

**Contract**: Strona zmienia wyłącznie używany layout na `AppLayout.astro`; `GenerateView client:load` i tytuł dokumentu zachowują obecne kontrakty.

#### 3. Kolekcja w powłoce

**File**: `src/pages/deck.astro`

**Intent**: Zapewnić stałe wejścia do dashboardu i generowania niezależnie od tego, czy kolekcja jest pusta, pełna, czy zwraca błąd. Zachować kontekstowy przycisk generowania w pustym stanie, ponieważ jest akcją stanu pustego, a nie substytutem nawigacji.

**Contract**: Strona zmienia bazowy layout na `AppLayout.astro`; zapytanie Supabase, limit, renderowanie danych i link CTA pustego stanu pozostają bez zmian.

### Success Criteria:

#### Automated Verification:

- Pełny zestaw testów, w tym kontrakt tras, przechodzi: `npm test`
- Astro i TypeScript nie raportują błędów: `npm run astro -- check`
- Lint przechodzi: `npm run lint`
- Produkcyjny build Cloudflare kończy się poprawnie: `npm run build`

#### Manual Verification:

- Zalogowany użytkownik przechodzi przez `/dashboard`, `/generate` i `/deck` wyłącznie linkami powłoki; na każdym ekranie dokładnie jedna właściwa pozycja jest widocznie aktywna i ma `aria-current="page"`.
- Przy szerokości 320 px w najnowszym Chromium brand, trzy funkcje, długi testowy email i wylogowanie pozostają dostępne bez poziomego przepełnienia, nakładania tekstu ani klientowego menu; pełna wartość emaila pozostaje dostępna także przy wizualnej elizji.
- Wylogowanie z poziomu chronionego ekranu kończy sesję i kieruje zgodnie z istniejącym kontraktem endpointu, a ponowne wejście bez sesji na każdą chronioną trasę prowadzi do logowania.
- Publiczny `/` oraz `/auth/signin`, `/auth/signup` i `/auth/confirm-email` zachowują dotychczasowy układ i nie renderują aplikacyjnej nawigacji.

**Implementation Note**: Po przejściu automatycznej weryfikacji zatrzymaj się i poproś człowieka o potwierdzenie wszystkich czterech scenariuszy manualnych przed uznaniem fazy za ukończoną.

---

## Testing Strategy

### Unit Tests:

- Testować centralny kontrakt pozycji oraz segmentową regułę aktywności jako czysty moduł TypeScript.
- Pokryć dokładne ścieżki, podścieżki, nieznane ścieżki i kolizje prefiksów.
- Uruchamiać pełny istniejący zestaw, aby wykryć wpływ zmian importów i konfiguracji.

### Integration Tests:

- Nie dodawać nowego runnera integracyjnego ani E2E w S-07.
- Traktować `astro check`, lint i produkcyjny build Cloudflare jako automatyczne sprawdzenie integracji komponentów Astro, layoutów i tras.

### Manual Testing Steps:

1. Uruchomić aplikację, zalogować się i wejść na dashboard; sprawdzić brand, email, wylogowanie oraz aktywny stan „Start”.
2. Przejść z powłoki do generowania, następnie do kolekcji i z powrotem do dashboardu; nie używać przycisku „wstecz”.
3. Powtórzyć przejścia w najnowszym Chromium przy typowej szerokości desktopowej i mobilnej; sprawdzić fokus klawiatury, zawijanie i brak przepełnienia.
4. Wylogować się z chronionej strony, a następnie bez sesji otworzyć bezpośrednio każdą z trzech chronionych tras.
5. Otworzyć stronę wejściową oraz trzy ekrany auth i potwierdzić brak aplikacyjnego shella.

## Performance Considerations

Nawigacja jest renderowana po stronie serwera i nie dodaje wyspy, event listenerów ani bundla klientowego. Korzysta z użytkownika już pobranego przez middleware, więc nie wykonuje dodatkowego zapytania do Supabase. Lista pozycji jest stała i ma pomijalny koszt renderowania.

## Migration Notes

Brak migracji danych, zmian API i nowych tras. Wdrożenie można cofnąć przez przywrócenie trzech stron do bazowego `Layout.astro` i usunięcie nowych plików; endpoint auth i middleware pozostają nietknięte.

## References

- Wymaganie produktu: `context/foundation/prd.md:93-101`
- Pozycja roadmapy: `context/foundation/roadmap.md` — S-07
- Wiążące trasy: `docs/reference/contract-surfaces.md:10-27`
- Bazowy layout: `src/layouts/Layout.astro:1-32`
- Obecny publiczny topbar: `src/components/Topbar.astro:1-31`
- Ochrona tras i locals: `src/middleware.ts:1-23`
- Oficjalne Astro API: `https://docs.astro.build/en/reference/api-reference/`
- Oficjalny wzorzec layoutów Astro: `https://docs.astro.build/en/basics/layouts/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Kontrakt Nawigacji i Powłoka

#### Automated

- [x] 1.1 Test kontraktu nawigacji przechodzi — 35fce3f
- [x] 1.2 Pełny zestaw testów przechodzi — 35fce3f
- [x] 1.3 Astro i TypeScript nie raportują błędów — 35fce3f
- [x] 1.4 Lint przechodzi — 35fce3f

### Phase 2: Adopcja Przez Chronione Ekrany

#### Automated

- [x] 2.1 Pełny zestaw testów, w tym kontrakt tras, przechodzi
- [x] 2.2 Astro i TypeScript nie raportują błędów
- [x] 2.3 Lint przechodzi
- [x] 2.4 Produkcyjny build Cloudflare kończy się poprawnie

#### Manual

- [x] 2.5 Nawigacja łączy wszystkie chronione ekrany i wskazuje aktywną sekcję
- [x] 2.6 Układ przy 320 px obsługuje długi email bez przepełnienia i nakładania treści
- [x] 2.7 Wylogowanie i przekierowania bez sesji zachowują istniejący kontrakt
- [x] 2.8 Publiczne i auth ekrany pozostają poza aplikacyjnym shellem
