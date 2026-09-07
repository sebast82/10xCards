import { test, expect } from "@playwright/test";

// risk: context/foundation/test-plan.md:122 — „zerwana główna ścieżka użytkownika"
// plan: context/changes/testing-e2e-critical-loop/plan.md — Faza 2
// seed: tests/e2e/seed.spec.ts (zakres po roli, ponawialna hydracja, waitForResponse, sprzątanie przez page.request)
//
// Bramka dymna na `login → deka → powtórka`. Nie dowodzi zachowania dostawcy (wywołanie
// OpenRouter jest server-side, `page.route` go nie sięga — src/lib/openrouter/client.ts:6),
// własności rekordów ani arytmetyki harmonogramu. Dowodzi jednego: że ekrany, trasy i linki
// nawigacji na głównej ścieżce nadal się ze sobą łączą.
test.describe("główna ścieżka użytkownika: kolekcja → powtórka", () => {
  // Jedyny uchwyt do sprzątania — `GET /api/flashcards` nie istnieje, więc kolekcji nie da się
  // wyliczyć po HTTP. Trzymany poza testem, bo sprząta hook, nie ciało testu.
  let createdId: string | null = null;
  let originForCleanup: string | null = null;

  // Sprzątanie w hooku, nie na końcu testu jak w `seed.spec.ts`. Fiszka utworzona przez
  // `/deck` jest wymagalna natychmiast, więc porzucona przez czerwony przebieg wchodzi do
  // kolejki i wywala warunek wstępny każdego następnego przebiegu. Inline'owe sprzątanie
  // pomija każda wcześniejsza nieudana asercja — jeden czerwony bieg zatruwałby konto.
  test.afterEach(async ({ page }) => {
    if (!createdId || !originForCleanup) return;

    // `page.request` (nie fixture `request`) dzieli ciasteczka z kartą — widzi token odświeżony
    // przez Supabase w trakcie testu. `Origin` przeglądarka dodaje sama; bez niego bramka
    // origin w Astro zwraca 403. Oba szczegóły: context/foundation/lessons.md:65-77.
    const deleted = await page.request.delete(`/api/flashcards/${createdId}`, {
      headers: { Origin: originForCleanup },
    });
    expect(deleted.ok(), `DELETE zwrócił ${String(deleted.status())}: ${await deleted.text()}`).toBe(true);

    createdId = null;
    originForCleanup = null;
  });

  test("fiszka dodana w kolekcji trafia do powtórki i zostaje oceniona po stronie serwera", async ({ page }) => {
    // 1. Unikalne dane — równoległe przebiegi i dwa ponowienia w CI nie kolidują ze sobą.
    const stamp = String(Date.now());
    const front = `E2E pętla przód ${stamp}`;
    const back = `E2E pętla tył ${stamp}`;

    // 2. Warunek wstępny: kolejka powtórek musi być pusta. To nie jest asekuracja —
    // `getReviewQueue` sortuje po `due` rosnąco (src/lib/reviews/service.ts:62-70), a wyspa
    // renderuje wyłącznie `queue[0]` (ReviewSession.tsx:96,295). Fiszka z `/deck` dostaje
    // `due = now`, czyli najpóźniejszą datę w kolejce, więc każda zaległa karta zasłania ją
    // całkowicie i krok 6 padłby na nieodnajdywalnym lokatorze. Padając tutaj, test nazywa
    // prawdziwą przyczynę: brudne konto, nie zepsuta aplikacja.
    const queueResponse = await page.request.get("/api/reviews");
    expect(queueResponse.ok(), `GET /api/reviews zwrócił ${String(queueResponse.status())}`).toBe(true);
    const { cards } = (await queueResponse.json()) as { cards: { front: string }[] };
    // Asercja na samej liczbie, nie na tablicy — inaczej raport zalewa zrzut całej kolejki,
    // a lista zaległych fiszek jest już w komunikacie.
    expect(
      cards.length,
      `Kolejka powtórek nie jest pusta (${String(cards.length)} zaległych kart: ` +
        `${cards.map((card) => card.front).join(" | ")}). ` +
        `Wyczyść zaległe powtórki na koncie testowym — test nie jest w stanie ich obejść.`,
    ).toBe(0);

    // 3. Kolekcja. Zakres po roli, bo ten sam tekst trafia też do zserializowanych propsów
    // wyspy Astro (context/foundation/lessons.md:51-63).
    await page.goto("/deck");
    const collection = page.getByRole("region", { name: "Kolekcja fiszek" });

    // 4. Utworzenie fiszki przez UI. Pierwsze kliknięcie w wyspę `client:load` potrafi trafić
    // w przycisk bez podpiętego handlera — akcja musi być ponawialna, nigdy `waitForTimeout`
    // (context/foundation/lessons.md:37-49).
    await expect(async () => {
      await collection.getByRole("button", { name: "Dodaj fiszkę" }).click();
      await expect(page.getByRole("heading", { name: "Nowa fiszka" })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    await page.getByLabel("Przód nowej fiszki").fill(front);
    await page.getByLabel("Tył nowej fiszki").fill(back);

    // Odpowiedź zapisu niesie naraz sygnał „zapisane" i `id` — jedyny uchwyt do sprzątania.
    const created = page.waitForResponse(
      (response) =>
        response.url().includes("/api/flashcards") &&
        response.request().method() === "POST" &&
        response.status() === 201,
    );
    await collection.getByRole("button", { name: "Zapisz fiszkę" }).click();
    const { id } = (await (await created).json()) as { id: string };
    createdId = id;
    originForCleanup = new URL(page.url()).origin;

    await expect(collection.getByText(front, { exact: true })).toBeVisible();

    // 5. Przejście na powtórki drogą użytkownika — deka nie ma własnego wejścia w sesję,
    // linkiem w nawigacji chodzi prawdziwy człowiek. To pełne przeładowanie strony, więc
    // wyspa `/review` hydruje się od zera.
    await page.getByRole("navigation", { name: "Główna nawigacja" }).getByRole("link", { name: "Powtórki" }).click();
    await page.waitForURL("**/review");

    // 6. Pod powtórką stoi dokładnie ta fiszka. Asercja idzie po jej własnym tekście, nigdy po
    // liczniku `Karta 1 z 1` ani po `To na dziś wszystko — powtórzono {n} fiszek.` — liczniki
    // czytają stan zaległy. Jest to poprawne tylko dlatego, że krok 2 przypiął kolejkę.
    const session = page.getByRole("region", { name: "Sesja powtórkowa" });
    await expect(session.getByText(front, { exact: true })).toBeVisible();

    // 7. Odsłonięcie odpowiedzi — kolejna pierwsza interakcja ze świeżo zhydrowaną wyspą.
    await expect(async () => {
      await session.getByRole("button", { name: "Pokaż odpowiedź" }).click();
      await expect(session.getByText(back, { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    // 8. Ocena. Status odpowiedzi czytamy PRZED jakąkolwiek asercją o DOM: ReviewSession.tsx:167
    // traktuje 409 jak sukces i przesuwa kolejkę, więc asercja „sesja poszła dalej" jest
    // spełnialna przez ocenę, której serwer nie przyjął. Nazwa przycisku to `{etykieta} · {interwał}`,
    // a interwał to dynamiczne wyjście FSRS — dopasowujemy po samej etykiecie (getByRole
    // dopasowuje nazwę jako podciąg, bez `exact`).
    const graded = page.waitForResponse(
      (response) => response.url().includes("/api/reviews") && response.request().method() === "POST",
    );
    await session.getByRole("button", { name: "Dobrze" }).click();
    const gradeResponse = await graded;
    expect(
      gradeResponse.status(),
      `POST /api/reviews zwrócił ${String(gradeResponse.status())}: ${await gradeResponse.text()}`,
    ).toBe(200);

    // Dopiero teraz UI: oceniona fiszka wychodzi z kolejki. Asercja po jej własnym tekście,
    // nie po komunikacie `To na dziś wszystko — powtórzono {n} fiszek.` ani po liczniku —
    // te czytają stan zaległy i przy brudnym koncie znaczyłyby coś innego.
    await expect(session.getByText(front, { exact: true })).toBeHidden();
  });
});
