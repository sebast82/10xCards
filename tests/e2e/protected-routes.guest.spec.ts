import { test, expect } from "@playwright/test";

// Ryzyko #4 z context/foundation/test-plan.md: żądanie bez ważnej sesji nigdy nie zwraca
// chronionego ekranu. Test roli „niezalogowany" — projekt `chromium-guest` startuje bez
// `storageState`, więc nie potrzebuje konta testowego.
const PROTECTED_ROUTES = ["/dashboard", "/generate", "/deck", "/review"];

for (const route of PROTECTED_ROUTES) {
  test(`niezalogowany użytkownik nie zobaczy ${route} — bramka przekierowuje na logowanie`, async ({ page }) => {
    await page.goto(route);

    await page.waitForURL("**/auth/signin");
    await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
  });
}
