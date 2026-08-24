---
change_id: srs-algorithm-contract
doc_type: external-library-research
date: 2026-08-23
topic: "Wybór gotowej biblioteki spaced repetition dla F-01"
method: Exa MCP (`web_search_exa`, `web_search_advanced_exa`, `web_fetch_exa`)
status: decided
decision: ts-fsrs
---

# Research: biblioteki spaced repetition

> Research **zewnętrzny** — porównanie kandydatów i uzasadnienie wyboru biblioteki.
> Research **wewnętrzny** (baza kodu, weryfikacja empiryczna) żyje w `research.md`.
> Wyciąg z API wybranej biblioteki: `ts-fsrs-api-doc.md`.

- **Data:** 2026-08-23
- **Roadmap ref:** F-01 `srs-algorithm-contract` (fundament dla S-05 `srs-review-session`)
- **PRD refs:** FR-009, Non-Goals, Success Criteria §Guardrails
- **Metoda:** Exa MCP (`web_search_exa`, `web_search_advanced_exa`, `web_fetch_exa`)
- **Kryteria doboru:** cztery bramy agent-friendly z `context/foundation/tech-stack.md` (typed, convention-based, popular, well-documented) + wymóg F-01: algorytm musi uruchomić się na workerd (Cloudflare Workers)

## Kandydaci

| Pakiet | Algorytm | Licencja | Pobrania/tydz. | Zależności runtime | Typed | Uwagi |
| --- | --- | --- | --- | --- | --- | --- |
| `ts-fsrs` | FSRS v6 | MIT | ~114 000 | brak (`decimal.js` tylko dev) | natywny TS | 742★, org. open-spaced-repetition, ostatnia aktualizacja 2026-05 |
| `@squeakyrobot/fsrs` | FSRS v4.5 (opcj. v6) | MIT | ~7 | 0 | natywny TS | Deklaruje wprost Cloudflare Workers / edge runtime; znikoma adopcja |
| `supermemo` | SM-2 | MIT | ~1 800 | 0 | TS | 12,5 KB; ostatnie wydanie 2020 |
| `@open-spaced-repetition/sm-2` | SM-2 | MIT | ~7 | 0 | TS | Wydany 2025, ta sama organizacja co `ts-fsrs` |
| `@x1ee7/sm2-spaced-repetition` | SM-2 | — | niszowe | 0 | TS | „bring your own storage", ESM + CJS |

## Rekomendacja: `ts-fsrs`

1. **Brama „popular" — jedyny kandydat z zapasem.** 114k pobrań tygodniowo wobec 1,8k u drugiego w kolejce. Pozostałe pakiety FSRS mają ~7 pobrań/tydz., więc agent kodujący nie zna ich z danych treningowych — a to bezpośrednio uderza w cel `speed`.
2. **FSRS > SM-2 na retencji.** SM-2 pochodzi z 1987 r.; wybór go dziś to świadome cofnięcie się bez zysku po stronie zakresu.
3. **Zero zależności runtime.** Mały bundle, brak natywnych bindingów, brak ryzyka na workerd.
4. **Czysty TypeScript**, ESM/CJS/UMD, wbudowany `afterHandler` do mapowania wyniku na własny typ storage — pasuje do warstwy Supabase bez kodu pośredniczącego.
5. **Zgodne z PRD §Non-Goals** — używamy gotowego rozwiązania, nie piszemy własnego algorytmu.

### Ryzyko do zweryfikowania empirycznie

`ts-fsrs` deklaruje `engines: node >=20`. To pole `engines`, a nie realne użycie API Node — kod nie sięga po builtiny `node:`, a `nodejs_compat` jest już włączone w `wrangler.jsonc`. Mimo to F-01 musi domknąć to **smoke testem w endpoint SSR na wdrożonej instancji**, nie założeniem — dokładnie tak, jak S-01 zdjęło ryzyko klienta Supabase na workerd empirycznie.

**Fallback, gdyby test padł:** `@squeakyrobot/fsrs` — jawne wsparcie edge runtime, zero zależności, kosztem starszej wersji algorytmu (v4.5) i praktycznie zerowej adopcji.

> **Rozstrzygnięte 2026-08-23:** smoke test na `workerd` przeszedł (`wrangler dev`, HTTP 200, `navigator.userAgent === "Cloudflare-Workers"`). Fallback jest zbędny. Szczegóły: `research.md` §1.

## Kontrakt stanu

Rozstrzyga niewiadomą z F-01: *„Czy algorytm trzyma stan wyłącznie per fiszka, czy potrzebuje też stanu per sesja lub per kolekcja?"*

**Wyłącznie per fiszka.** Scheduler jest bezstanowy i czysty: `scheduler.next(card, now, rating)` zwraca nową kartę oraz `ReviewLog`. Nie istnieje stan per sesja ani per kolekcja.

```ts
interface Card {
  due: Date
  stability: number
  difficulty: number
  elapsed_days: number      // @deprecated — usuwane w 6.0.0
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: State              // New | Learning | Review | Relearning
  last_review?: Date
}
```

Jedyny stan globalny to `FSRSParameters` (`request_retention`, `maximum_interval`, `enable_fuzz`, `learning_steps`, `relearning_steps`). W MVP jest stały dla wszystkich użytkowników, więc **żyje w kodzie, nie w bazie**.

### Konsekwencje dla schematu w F-02

- Kolumny harmonogramu = pola `Card` **minus `elapsed_days`**. Pole jest oznaczone jako deprecated z usunięciem w 6.0.0 i daje się wyliczyć z `last_review` — wprowadzanie go do migracji oznacza zaplanowaną z góry migrację usuwającą. (Uzupełnienie z `research.md` §3.3: `ReviewLog` ma **drugie** deprecated pole `last_elapsed_days` — również nie wchodzi do schematu.)
- `state` jako liczba lub enum — `CardInput` przyjmuje zarówno `State` (numeryczny), jak i `StateType` (stringowy).
- `due` oraz `last_review` jako `timestamptz`; konwersję `Date ↔ ISO/epoch` obsługuje `afterHandler` przekazany do `next()`.
- Znacznik pochodzenia fiszki (AI / ręczna, decyzja z 2026-08-21) jest **ortogonalny** wobec stanu FSRS — algorytm nie zna źródła fiszki. To automatycznie spełnia warunek brzegowy z S-05: sesja nauki działa tak samo dla obu rodzajów fiszek.

## Parked

- **`@open-spaced-repetition/binding`** (optymalizator parametrów FSRS trenowany na logach powtórek) — działa przez WASM/WASI, wymaga zebranych danych treningowych i nie daje nic przy skali `users: small`. Poza MVP.

## Źródła

- https://www.npmjs.com/package/ts-fsrs
- https://github.com/open-spaced-repetition/ts-fsrs
- https://open-spaced-repetition.github.io/ts-fsrs/interfaces/Card.html
- https://www.npmjs.com/package/@squeakyrobot/fsrs
- https://www.npmjs.com/package/supermemo
- https://github.com/open-spaced-repetition/sm-2-ts
- https://github.com/x1ee7/sm2-spaced-repetition
