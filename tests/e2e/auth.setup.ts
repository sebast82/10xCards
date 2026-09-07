import { existsSync } from "node:fs";
import { test as setup, expect } from "@playwright/test";
import { STORAGE_STATE } from "../../playwright.config";

// Logowanie raz na przebieg, przez prawdziwy formularz — cookies Supabase ustawia serwer
// (`POST /api/auth/signin`), więc skrót przez API klienta zapisałby niepełny stan.
setup("zapisuje stan zalogowania testowego użytkownika", async ({ page }) => {
  const email = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  const hasCredentials = Boolean(email && password);

  // Most na czas przejściowy: stan zapisany ręcznie (`playwright-cli state-save`) wystarcza
  // do przebiegu lokalnego. W CI nigdy — tam pliku nie ma i logowanie musi odtworzyć się
  // z .env.test, inaczej suite wisi na artefakcie, którego nikt nie umie odtworzyć.
  setup.skip(
    !hasCredentials && !process.env.CI && existsSync(STORAGE_STATE),
    `Brak E2E_USERNAME / E2E_PASSWORD — używam stanu zapisanego w ${STORAGE_STATE}.`,
  );

  if (!email || !password) {
    throw new Error(`Brak E2E_USERNAME / E2E_PASSWORD w .env.test i brak zapisanego stanu w ${STORAGE_STATE}.`);
  }

  await page.goto("/auth/signin");

  // Bramka środowiska, nie danych logowania — i jedyne miejsce, gdzie da się ją postawić:
  // dev server startuje `webServer` Playwrighta, nie krok CI, więc żaden krok joba tego nie złapie.
  // Bez SUPABASE_URL / SUPABASE_KEY aplikacja nie pada: `astro.config.mjs:31-32` deklaruje je jako
  // opcjonalne, `src/lib/supabase.ts:7-10` zwraca `null`, a `POST /api/auth/signin` przekierowuje
  // z błędem — Playwright zameldowałby wtedy nieudane logowanie i szukalibyśmy przyczyny w koncie
  // testowym zamiast w env. Baner z `src/lib/config-status.ts:14` renderuje się po stronie serwera,
  // więc jest już w pierwszym HTML-u; jego brak znaczy, że aplikacja widzi konfigurację.
  await expect(
    page.getByRole("alert").filter({ hasText: "Supabase nie jest skonfigurowany" }),
    "Aplikacja pod testem nie widzi konfiguracji Supabase — SUPABASE_URL / SUPABASE_KEY nie dotarły " +
      "do `astro dev`. To awaria środowiska, nie danych logowania konta testowego.",
  ).toHaveCount(0);

  // `exact`, bo przycisk podglądu hasła ma aria-label „Pokaż hasło".
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();

  // Po zalogowaniu serwer przekierowuje na stronę główną.
  await page.waitForURL("/");

  // Dowód, że sesja faktycznie działa — trasa chroniona renderuje się zamiast przekierować na login.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Start" })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
