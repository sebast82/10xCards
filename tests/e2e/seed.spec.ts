import { test, expect } from "@playwright/test";

// Test wzorcowy (seed). Każdy kolejny test e2e jest generowany „na obraz" tego pliku,
// więc pokazuje cztery rzeczy naraz: lokatory po roli/etykiecie, pełny cykl
// setup → akcja → asercja → sprzątanie w jednym teście, czekanie na stan (nigdy na czas)
// i nazwę związaną z konkretnym ryzykiem. Wzorce: context/foundation/test-plan.md §6.6
test("ręcznie dodana fiszka jest widoczna w kolekcji po przeładowaniu strony", async ({ page }) => {
  // Unikalny znacznik — równoległe przebiegi i powtórki nie kolidują ze sobą.
  const front = `E2E przód ${String(Date.now())}`;
  const back = `E2E tył ${String(Date.now())}`;

  await page.goto("/deck");

  // Zawężenie do regionu kolekcji (aria-label „Kolekcja fiszek"): ten sam tekst trafia też
  // do zserializowanych propsów wyspy Astro, więc goły getByText łapie dwa elementy.
  const collection = page.getByRole("region", { name: "Kolekcja fiszek" });

  // Wyspa Reacta (`client:load`) hydruje się dopiero po SSR — pierwsze kliknięcie potrafi
  // trafić w przycisk bez podpiętego handlera. Ponawiamy akcję, aż formularz się otworzy;
  // `toPass` czeka na stan, nie na czas.
  await expect(async () => {
    await page.getByRole("button", { name: "Dodaj fiszkę" }).click();
    await expect(page.getByRole("heading", { name: "Nowa fiszka" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await page.getByLabel("Przód nowej fiszki").fill(front);
  await page.getByLabel("Tył nowej fiszki").fill(back);

  // Czekamy na odpowiedź zapisu — daje jednocześnie sygnał „zapisane" i id do sprzątania.
  const created = page.waitForResponse(
    (response) =>
      response.url().includes("/api/flashcards") && response.request().method() === "POST" && response.status() === 201,
  );
  await page.getByRole("button", { name: "Zapisz fiszkę" }).click();
  const { id } = (await (await created).json()) as { id: string };

  await expect(collection.getByText(front, { exact: true })).toBeVisible();

  // Właściwe ryzyko: treść przetrwała zapis po stronie serwera, a nie tylko stan Reacta.
  await page.reload();
  await expect(collection.getByText(front, { exact: true })).toBeVisible();
  await expect(collection.getByText(back, { exact: true })).toBeVisible();

  // Sprzątanie — przez API, bo przycisk „Usuń" powtarza się przy każdej fiszce w kolekcji.
  // Dwa szczegóły, bez których to nie przechodzi: `page.request` (a nie fixture `request`)
  // dzieli ciasteczka z kartą, więc widzi token odświeżony przez Supabase w trakcie testu;
  // nagłówek `Origin` przeglądarka dodaje sama, a bez niego bramka Astro odrzuca zapis (403).
  const deleted = await page.request.delete(`/api/flashcards/${id}`, {
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(deleted.ok(), `DELETE zwrócił ${String(deleted.status())}: ${await deleted.text()}`).toBe(true);
});
