# Contract Surfaces

Rejestr **nazw nośnych** — tych, które muszą pozostać spójne między zmianami, bo odwołuje się do nich więcej niż jeden element roadmapy, kod i użytkownik.

**Po co ten plik.** `context/foundation/roadmap.md` celowo nie zawiera ścieżek, nazw endpointów ani schematów — sekwencja ma przetrwać zmianę decyzji technicznych. Bez rejestru każde `/10x-plan` wymyślałoby nazwy niezależnie i po trzech zmianach mielibyśmy trzy konwencje na jedną domenę. Tutaj nazwa powstaje raz.

**Zasady**

1. Wpis oznaczony `istnieje` jest **wiążący** — nie zmieniaj go bez świadomej decyzji i weryfikacji na produkcji.
2. Wpis oznaczony `proponowane` to rezerwacja nazwy. `/10x-plan` może ją zmienić, ale **musi zaktualizować ten plik w tym samym przebiegu**.
3. Nowa trasa albo endpoint pojawiające się w planie, a nieobecne tutaj, to sygnał ostrzegawczy — albo rejestr jest nieaktualny, albo zakres puchnie.
4. Kolumna „Ochrona" musi zgadzać się z `PROTECTED_ROUTES` w `src/middleware.ts`. Rozjazd między tabelą a kodem to błąd.

## Trasy

| Ścieżka               | Ochrona   | Rola                                              | Stan        | Wprowadza                       |
| --------------------- | --------- | ------------------------------------------------- | ----------- | ------------------------------- |
| `/`                   | publiczna | Strona wejściowa                                  | istnieje    | —                               |
| `/auth/signin`        | publiczna | Logowanie email + hasło                           | istnieje    | —                               |
| `/auth/signup`        | publiczna | Rejestracja                                       | istnieje    | —                               |
| `/auth/confirm-email` | publiczna | Powrót z linku potwierdzającego                   | istnieje    | —                               |
| `/dashboard`          | chroniona | Ekran po zalogowaniu                              | istnieje    | —                               |
| `/generate`           | chroniona | Wklejenie tekstu, przegląd propozycji, akceptacja | proponowane | S-02                            |
| `/deck`               | chroniona | Kolekcja fiszek użytkownika                       | proponowane | S-02, rozszerzana w S-03 i S-04 |
| `/review`             | chroniona | Sesja powtórkowa                                  | proponowane | S-05                            |

**Decyzja (2026-08-22):** ekran po zalogowaniu zostaje pod `/dashboard`. Rozważano `/home` — odrzucone, bo `/dashboard` działa, jest chroniony przez middleware i zweryfikowany na produkcji, a zmiana nazwy niosłaby ryzyko regresji w przepływie auth bez zysku dla użytkownika.

**Konwencja nazewnicza.** Ścieżki w liczbie pojedynczej, po angielsku, bez zagnieżdżeń poza `/auth/*`. Operacje na pojedynczym zasobie jako segment ścieżki (`/deck/:id`), nie jako osobna trasa czasownikowa (`/edit-card`).

S-06 nie wprowadza nowych tras — zmienia zachowanie `/generate`.

## Endpointy API

| Endpoint              | Metoda        | Rola                                                     | Ochrona                      | Stan        | Wprowadza  |
| --------------------- | ------------- | -------------------------------------------------------- | ---------------------------- | ----------- | ---------- |
| `/api/auth/signup`    | POST          | Rejestracja                                              | przepływ auth                | istnieje    | —          |
| `/api/auth/signin`    | POST          | Logowanie                                                | przepływ auth                | istnieje    | —          |
| `/api/auth/signout`   | POST          | Wylogowanie                                              | przepływ auth                | istnieje    | —          |
| `/api/generations`    | POST          | Zlecenie generowania propozycji z wklejonego tekstu      | `locals.user`, 401 bez sesji | istnieje    | S-02       |
| `/api/flashcards`     | GET, POST     | Odczyt kolekcji, zapis zaakceptowanej lub ręcznej fiszki | `locals.user`, 401 bez sesji | proponowane | S-02, S-04 |
| `/api/flashcards/:id` | PATCH, DELETE | Edycja i usunięcie zapisanej fiszki                      | `locals.user`, 401 bez sesji | proponowane | S-03       |
| `/api/reviews`        | GET, POST     | Pobranie fiszek na sesję, zapis oceny                    | `locals.user`, 401 bez sesji | proponowane | S-05       |

**Wzorzec odpowiedzi.** Istniejące endpointy auth zwracają przekierowanie z komunikatem błędu w parametrze zapytania (`src/pages/api/auth/`). Endpointy domenowe będą wołane z wysp React, więc zwracają JSON — to świadomy rozjazd, nie niespójność.

**Twarda zasada dla `/api/generations`.** Tekst źródłowy nie może trafić do trwałego zapisu ani do logów po zakończeniu żądania — wymaganie niefunkcjonalne z `context/foundation/prd.md`. Endpoint przetwarza i odrzuca.

**Ochrona endpointów domenowych.** `PROTECTED_ROUTES` w `src/middleware.ts` obejmuje wyłącznie trasy stron i nie chroni `/api/**`. Każdy endpoint domenowy musi samodzielnie zweryfikować `locals.user` i zwrócić 401 bez sesji.

## Nazwy w danych

### Tabela `public.flashcards`

| Nazwa            | Typ PostgreSQL                                    | Rola                                                   | Stan    | Wprowadza  |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------ | ------- | ---------- |
| `id`             | `uuid`                                            | Unikalny identyfikator fiszki                          | istnieje | F-02       |
| `user_id`        | `uuid not null`                                   | Właściciel rekordu                                     | istnieje | F-02       |
| `generation_id`  | `uuid`                                            | Odniesienie do zlecenia AI, jeśli istnieje             | istnieje | F-02       |
| `front`          | `text not null`                                   | Treść przodu fiszki                                    | istnieje | F-02       |
| `back`           | `text not null`                                   | Treść tyłu fiszki                                      | istnieje | F-02       |
| `source`         | `flashcard_source`                                | Pochodzenie: `ai`, `ai_edited` albo `manual`           | istnieje | F-02       |
| `due`            | `timestamptz not null`                            | Termin kolejnego pokazania; po tym polu filtruje sesja | istnieje | F-01, F-02 |
| `stability`      | `double precision not null`                       | Siła pamięci                                           | istnieje | F-01, F-02 |
| `difficulty`     | `double precision not null`                       | Trudność w skali 1–10                                  | istnieje | F-01, F-02 |
| `scheduled_days` | `integer not null`                                | Liczba dni do kolejnej powtórki                        | istnieje | F-01, F-02 |
| `learning_steps` | `smallint not null`                               | Indeks kroku nauki, nie tablica kroków                 | istnieje | F-01, F-02 |
| `reps`           | `integer not null`                                | Łączna liczba powtórek                                 | istnieje | F-01, F-02 |
| `lapses`         | `integer not null`                                | Liczba zapomnień                                       | istnieje | F-01, F-02 |
| `state`          | `smallint not null check (state between 0 and 3)` | Etap: New, Learning, Review albo Relearning            | istnieje | F-01, F-02 |
| `last_review`    | `timestamptz`                                     | Czas ostatniej oceny; może być `null` dla nowej fiszki | istnieje | F-01, F-02 |
| `created_at`     | `timestamptz not null`                            | Czas utworzenia rekordu                                | istnieje | F-02       |
| `updated_at`     | `timestamptz not null`                            | Ostatnia modyfikacja rekordu                           | istnieje | F-02       |

### Tabela `public.generations`

| Nazwa                       | Typ PostgreSQL                  | Rola                                             | Stan    | Wprowadza |
| --------------------------- | ------------------------------- | ------------------------------------------------ | ------- | --------- |
| `id`                        | `uuid`                          | Unikalny identyfikator zlecenia                   | istnieje | F-02      |
| `user_id`                   | `uuid not null`                 | Właściciel zlecenia                               | istnieje | F-02      |
| `model`                     | `text not null`                 | Model AI użyty do wygenerowania                   | istnieje | F-02      |
| `source_text_length`        | `integer not null`              | Długość wejściowego tekstu źródłowego            | istnieje | F-02      |
| `source_text_hash`          | `text not null`                 | SHA-256 w formacie 64 znaków                     | istnieje | F-02      |
| `generated_count`           | `integer not null default 0`    | Łączna liczba wygenerowanych propozycji          | istnieje | F-02      |
| `accepted_unedited_count`   | `integer not null default 0`    | Liczba zaakceptowanych bez edycji                | istnieje | F-02      |
| `accepted_edited_count`     | `integer not null default 0`    | Liczba zaakceptowanych po edycji                 | istnieje | F-02      |
| `generation_duration`       | `integer not null`              | Czas generowania w milisekundach                 | istnieje | F-02      |
| `created_at`                | `timestamptz not null`          | Czas utworzenia zlecenia                         | istnieje | F-02      |
| `updated_at`                | `timestamptz not null`          | Ostatnia modyfikacja zlecenia                    | istnieje | F-02      |

`flashcard_source` jest enumem PostgreSQL z wartościami `ai`, `ai_edited`, `manual`. `source` zapisuje się raz przy tworzeniu fiszki; późniejsza edycja nie zmienia tej wartości.

Liczniki w `public.generations` aktualizuje S-02 przy akceptacji propozycji. `generation_id` pozostaje `null` dla fiszek ręcznie utworzonych w S-04.

Sesja wybiera fiszki zapytaniem `WHERE user_id = ? AND due <= now() ORDER BY due`, dlatego tabela wymaga indeksu `(user_id, due)`.

`elapsed_days` i `last_elapsed_days` są wykluczone ze schematu jako pola deprecated. W MVP używamy przypiętego pakietu `ts-fsrs` `5.4.1` (algorytm FSRS-6.0). `@open-spaced-repetition/binding` służący do trenowania wag i WASM pozostaje poza zakresem, ponieważ nie wspiera edge runtime.
