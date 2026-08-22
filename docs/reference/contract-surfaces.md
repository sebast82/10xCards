# Contract Surfaces

Rejestr **nazw nośnych** — tych, które muszą pozostać spójne między zmianami, bo odwołuje się do nich więcej niż jeden element roadmapy, kod i użytkownik.

**Po co ten plik.** `context/foundation/roadmap.md` celowo nie zawiera ścieżek, nazw endpointów ani schematów — sekwencja ma przetrwać zmianę decyzji technicznych. Bez rejestru każde `/10x-plan` wymyślałoby nazwy niezależnie i po trzech zmianach mielibyśmy trzy konwencje na jedną domenę. Tutaj nazwa powstaje raz.

**Zasady**

1. Wpis oznaczony `istnieje` jest **wiążący** — nie zmieniaj go bez świadomej decyzji i weryfikacji na produkcji.
2. Wpis oznaczony `proponowane` to rezerwacja nazwy. `/10x-plan` może ją zmienić, ale **musi zaktualizować ten plik w tym samym przebiegu**.
3. Nowa trasa albo endpoint pojawiające się w planie, a nieobecne tutaj, to sygnał ostrzegawczy — albo rejestr jest nieaktualny, albo zakres puchnie.
4. Kolumna „Ochrona" musi zgadzać się z `PROTECTED_ROUTES` w `src/middleware.ts`. Rozjazd między tabelą a kodem to błąd.

## Trasy

| Ścieżka | Ochrona | Rola | Stan | Wprowadza |
| --- | --- | --- | --- | --- |
| `/` | publiczna | Strona wejściowa | istnieje | — |
| `/auth/signin` | publiczna | Logowanie email + hasło | istnieje | — |
| `/auth/signup` | publiczna | Rejestracja | istnieje | — |
| `/auth/confirm-email` | publiczna | Powrót z linku potwierdzającego | istnieje | — |
| `/dashboard` | chroniona | Ekran po zalogowaniu | istnieje | — |
| `/generate` | chroniona | Wklejenie tekstu, przegląd propozycji, akceptacja | proponowane | S-02 |
| `/deck` | chroniona | Kolekcja fiszek użytkownika | proponowane | S-02, rozszerzana w S-03 i S-04 |
| `/review` | chroniona | Sesja powtórkowa | proponowane | S-05 |

**Decyzja (2026-08-22):** ekran po zalogowaniu zostaje pod `/dashboard`. Rozważano `/home` — odrzucone, bo `/dashboard` działa, jest chroniony przez middleware i zweryfikowany na produkcji, a zmiana nazwy niosłaby ryzyko regresji w przepływie auth bez zysku dla użytkownika.

**Konwencja nazewnicza.** Ścieżki w liczbie pojedynczej, po angielsku, bez zagnieżdżeń poza `/auth/*`. Operacje na pojedynczym zasobie jako segment ścieżki (`/deck/:id`), nie jako osobna trasa czasownikowa (`/edit-card`).

S-06 nie wprowadza nowych tras — zmienia zachowanie `/generate`.

## Endpointy API

| Endpoint | Metoda | Rola | Stan | Wprowadza |
| --- | --- | --- | --- | --- |
| `/api/auth/signup` | POST | Rejestracja | istnieje | — |
| `/api/auth/signin` | POST | Logowanie | istnieje | — |
| `/api/auth/signout` | POST | Wylogowanie | istnieje | — |
| `/api/generations` | POST | Zlecenie generowania propozycji z wklejonego tekstu | proponowane | S-02 |
| `/api/flashcards` | GET, POST | Odczyt kolekcji, zapis zaakceptowanej lub ręcznej fiszki | proponowane | S-02, S-04 |
| `/api/flashcards/:id` | PATCH, DELETE | Edycja i usunięcie zapisanej fiszki | proponowane | S-03 |
| `/api/reviews` | GET, POST | Pobranie fiszek na sesję, zapis oceny | proponowane | S-05 |

**Wzorzec odpowiedzi.** Istniejące endpointy auth zwracają przekierowanie z komunikatem błędu w parametrze zapytania (`src/pages/api/auth/`). Endpointy domenowe będą wołane z wysp React, więc zwracają JSON — to świadomy rozjazd, nie niespójność.

**Twarda zasada dla `/api/generations`.** Tekst źródłowy nie może trafić do trwałego zapisu ani do logów po zakończeniu żądania — wymaganie niefunkcjonalne z `context/foundation/prd.md`. Endpoint przetwarza i odrzuca.

## Nazwy w danych

| Nazwa | Rola | Stan | Wprowadza |
| --- | --- | --- | --- |
| znacznik pochodzenia fiszki | Odróżnia fiszkę wygenerowaną przez AI od utworzonej ręcznie; bez niego drugie kryterium sukcesu PRD jest niemierzalne | proponowane | F-02 |
| stan harmonogramu powtórek | Pola wymagane przez wybrany algorytm, żeby wyznaczyć termin kolejnego pokazania | proponowane | F-01 określa kontrakt, F-02 wprowadza do schematu |

Konkretne nazwy kolumn i typy ustala `/10x-plan` przy F-01 i F-02 — i zapisuje je tutaj.
