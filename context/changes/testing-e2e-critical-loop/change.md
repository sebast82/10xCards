---
change_id: testing-e2e-critical-loop
title: Testing e2e critical loop
status: impl_reviewed
created: 2026-09-07
updated: 2026-09-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

**Progress 3.7 — domknięte 2026-09-08.** Pozycja stała otworem od Fazy 3, bo branch protection
zwracała na prywatnym repo 403 (`Upgrade to GitHub Pro or make this repository public`). Repozytorium
zostało przełączone na publiczne, a gałąź `master` dostała regułę z trzema required status checks:
`ci`, `db-tests` i `e2e`, z `enforce_admins: true` — czerwony przebieg blokuje przycisk merge również
właścicielowi repo. Weryfikacja: `gh api repos/:owner/:repo/branches/master/protection`.

Zakres wyszedł poza literalne 3.7 (samo `e2e`) o `ci` i `db-tests`, bo §5 test-plan.md oznaczała jako
`required` także lint, typecheck, testy i build — a te mieszczą się w jobie `ci`. Wymaganie samego
`e2e` zostawiłoby cztery wiersze §5 nadal nieprawdziwe.

Odwrócone zapisy o braku egzekwowania: `test-plan.md` §4, §5 (dwa wiersze + nowa nota pod tabelą),
§6.4, §6.7 Faza 2, §7 i §8; `README.md` sekcja CI; komentarze obu jobów w `.github/workflows/ci.yml`.

Dwie konsekwencje zapisane w dokumentacji, nie w tej notatce: bezpośredni push na `master` jest
od teraz odrzucany (`db-tests` i `e2e` biegną tylko na `pull_request`, więc commit z pusha nigdy
nie dostanie tych checków), a zachowanie bramki na PR-ach z forka jest niesprawdzone — nowy wpis §7
opisuje pytanie i to, co je rozstrzygnie.
