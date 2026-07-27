---
project: "10xCards"
version: 1
status: draft
created: 2026-07-10
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-08-31
  after_hours_only: true
---

## Vision & Problem Statement

Ręczne tworzenie wysokiej jakości fiszek edukacyjnych jest czasochłonne i żmudne — samouczek wie, czego chce się nauczyć, ale formatowanie materiału źródłowego w pary pytanie+odpowiedź zabiera więcej czasu niż sama nauka. To tarcie zniechęca do korzystania ze spaced repetition, jednej z najskuteczniejszych metod nauki.

Istniejące narzędzia (Anki, Quizlet) wymagają pełnego manualnego zaangażowania w proces tworzenia fiszek. AI może zautomatyzować żmudny krok przekształcania tekstu w fiszki, redukując barierę wejścia do efektywnej nauki.

## User & Persona

### Primary persona

Samouczek — osoba ucząca się samodzielnie, budująca narzędzie pod własne potrzeby. Ma materiał źródłowy (notatki, teksty), chce szybko zamienić go w fiszki i uczyć się metodą spaced repetition, ale ręczne formatowanie każdej fiszki jest barierą.

## Success Criteria

### Primary
- 75% fiszek wygenerowanych przez AI jest akceptowane przez użytkownika bez istotnych zmian
- 75% fiszek w kolekcji użytkownika jest tworzonych z wykorzystaniem generowania AI

### Secondary
- Użytkownik może manualnie tworzyć, edytować i usuwać fiszki (pełne zarządzanie kolekcją)

### Guardrails
- Mechanizm powtórek / algorytm nauki nie może zawieść — sesja nauki zawsze musi poprawnie funkcjonować, niezależnie od źródła fiszek (AI czy manualne)

## User Stories

### US-01: Generowanie fiszek z tekstu przez AI

- **Given** zalogowany użytkownik na stronie generowania
- **When** wkleja tekst źródłowy i zleca generowanie
- **Then** widzi listę propozycji fiszek, gdzie każdą może zaakceptować, edytować lub odrzucić

#### Acceptance Criteria
- Wygenerowane fiszki mają format pytanie+odpowiedź
- Użytkownik widzi podgląd każdej fiszki przed akceptacją
- Zaakceptowane fiszki trafiają do kolekcji użytkownika
- Odrzucone fiszki nie są zapisywane

## Functional Requirements

### Authentication
- FR-001: Użytkownik może się zarejestrować (email+hasło). Priority: must-have
  > Socrates: Kontrargument: rejestracja to zbędna złożoność dla samouczka — anonimowy dostęp z local storage byłby prostszy. Rozwiązanie: FR zachowany; konto potrzebne dla dostępu z wielu urządzeń i trwałości danych.
- FR-002: Użytkownik może się zalogować i wylogować. Priority: must-have
  > Socrates: Kontrargument: wylogowanie zbędne w narzędziu osobistym. Rozwiązanie: FR zachowany; pełen cykl auth jest standardem.

### AI Generation
- FR-003: Użytkownik może wkleić tekst źródłowy i zlecić AI wygenerowanie fiszek. Priority: must-have
  > Socrates: Kontrargument: jakość generowania może być za niska — użytkownik i tak poprawia każdą fiszkę. Rozwiązanie: FR zachowany; kryterium sukcesu 75% akceptacji pilnuje jakości.
- FR-004: Użytkownik może przejrzeć wygenerowane fiszki i zaakceptować, edytować lub odrzucić każdą. Priority: must-have
  > Socrates: Kontrargument: review per-fiszka to dużo pracy UI — może wystarczy bulk accept. Rozwiązanie: FR zachowany; review to krytyczny krok — bez niego użytkownik nie ufa fiszkom.

### Flashcard Management
- FR-005: Użytkownik może ręcznie utworzyć fiszkę (pytanie+odpowiedź). Priority: must-have
  > Socrates: Kontrargument: skoro AI generuje fiszki, manualne tworzenie to duplikacja. Rozwiązanie: FR zachowany; manualne tworzenie potrzebne gdy AI nie ogarnia specyficznego tematu.
- FR-006: Użytkownik może edytować istniejącą fiszkę. Priority: must-have
  > Socrates: Kontrargument: edycja inline to złożona funkcja UI — może wystarczy „usuń i stwórz nową". Rozwiązanie: FR zachowany; edycja niezbędna bo AI nie zawsze trafia w punkt.
- FR-007: Użytkownik może usunąć fiszkę. Priority: must-have
  > Socrates: Kontrargument: usunięcie jest destrukcyjne i nieodwracalne — lepiej soft delete. Rozwiązanie: FR zachowany; usuwanie to higiena — bez niego kolekcja się zaśmieca.
- FR-008: Użytkownik może przeglądać swoją kolekcję fiszek. Priority: must-have
  > Socrates: Kontrargument: osobna lista fiszek to dodatkowy ekran — może wystarczy widok sesji nauki. Rozwiązanie: FR zachowany; przeglądanie to podstawa — musisz widzieć co masz.

### Spaced Repetition
- FR-009: Użytkownik może rozpocząć sesję nauki z algorytmem powtórek. Priority: must-have
  > Socrates: Kontrargument: budowanie własnego algorytmu to za dużo. Rozwiązanie: FR zachowany; użyć gotowej biblioteki zamiast budować własny algorytm.

## Non-Functional Requirements

- Użytkownik widzi pierwsze wygenerowane fiszki w ciągu 30 sekund od zlecenia, z ciągłym widocznym postępem podczas generowania. Kolejne fiszki mogą pojawiać się przyrostowo, a użytkownik może przeglądać już przygotowane.
- Tekst źródłowy wklejony przez użytkownika nie pozostaje w storage aplikacji po zakończeniu operacji generowania — nie jest dostępny dla operatora ani użytkownika po zakończeniu żądania, które go przetworzyło.
- Produkt działa poprawnie na najnowszych wersjach przeglądarek z silnikiem Chromium.
- Fiszki i dane konta użytkownika są retencjonowane bez ograniczenia czasowego (dopóki użytkownik nie usunie konta lub fiszek).

## Business Logic

Aplikacja analizuje tekst źródłowy i przekształca jego kluczowe fragmenty w gotowe fiszki zawierające pytanie i odpowiedź.

Wejściem jest tekst wklejony przez użytkownika (kopiuj-wklej). Wynikiem jest zestaw propozycji fiszek w formacie pytanie+odpowiedź. Użytkownik napotyka wynik na ekranie review, gdzie może każdą fiszkę zaakceptować, odrzucić lub ręcznie poprawić. Pierwsze fiszki pojawiają się przyrostowo — użytkownik może rozpocząć review zanim generowanie się zakończy, a kolejne fiszki pojawiają się sukcesywnie.

## Access Control

Logowanie (email + hasło / OAuth / passwordless). Płaski model użytkowników — wszyscy użytkownicy mają te same uprawnienia, bez ról. Każdy użytkownik widzi i zarządza wyłącznie swoimi fiszkami. Niezalogowany użytkownik jest przekierowywany na stronę logowania.

## Non-Goals

- Budowanie własnego, zaawansowanego algorytmu powtórek (SuperMemo, Anki) — MVP korzysta z gotowej biblioteki/algorytmu. Tworzenie własnego wykracza poza zakres i timeline.
- Import wielu formatów plików (PDF, DOCX, itp.) — w MVP jedynym wejściem jest tekst wklejony kopiuj-wklej. Import plików to osobna funkcjonalność na przyszłość.
- Współdzielenie zestawów fiszek między użytkownikami — MVP jest narzędziem osobistym, bez funkcji społecznościowych.
- Integracje z innymi platformami edukacyjnymi — MVP jest samodzielną aplikacją, bez łączenia z zewnętrznymi systemami.
- Aplikacja mobilna — na początek tylko aplikacja webowa. Natywna apka mobilna jest poza zakresem MVP.

## Open Questions

1. **Które metody logowania wdrożyć w MVP?** — Shape-notes wymieniają email+hasło, OAuth i passwordless. Czy MVP wspiera wszystkie trzy, czy podzbiór? Owner: user. Block: no (dowolna z trzech wystarczy na start).
