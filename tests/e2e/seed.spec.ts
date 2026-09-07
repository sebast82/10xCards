import { test, expect } from "@playwright/test";

// Test wzorcowy (seed). Każdy kolejny test e2e jest generowany „na obraz" tego pliku,
// więc pokazuje cztery rzeczy naraz: lokatory po roli/etykiecie, pełny cykl
// setup → akcja → asercja → sprzątanie w jednym teście, czekanie na stan (nigdy na czas)
// i nazwę związaną z konkretnym ryzykiem. Szczegóły: .claude/skills/10x-e2e/references/seed-test-pattern.md
test("ręcznie dodana fiszka jest widoczna w kolekcji po przeładowaniu strony", async ({ page, request }) => {
  // Unikalny znacznik — równoległe przebiegi i powtórki nie kolidują ze sobą.
  const front = `E2E przód ${String(Date.now())}`;
  const back = `E2E tył ${String(Date.now())}`;

  await page.goto("/deck");

  await page.getByRole("button", { name: "Dodaj fiszkę" }).click();
  await page.getByLabel("Przód nowej fiszki").fill(front);
  await page.getByLabel("Tył nowej fiszki").fill(back);

  // Czekamy na odpowiedź zapisu — daje jednocześnie sygnał „zapisane" i id do sprzątania.
  const created = page.waitForResponse(
    (response) =>
      response.url().includes("/api/flashcards") && response.request().method() === "POST" && response.status() === 201,
  );
  await page.getByRole("button", { name: "Zapisz fiszkę" }).click();
  const { id } = (await (await created).json()) as { id: string };

  await expect(page.getByText(front)).toBeVisible();

  // Właściwe ryzyko: treść przetrwała zapis po stronie serwera, a nie tylko stan Reacta.
  await page.reload();
  await expect(page.getByText(front)).toBeVisible();
  await expect(page.getByText(back)).toBeVisible();

  // Sprzątanie — przez API, bo przycisk „Usuń" powtarza się przy każdej fiszce w kolekcji.
  const deleted = await request.delete(`/api/flashcards/${id}`);
  expect(deleted.ok()).toBe(true);
});
