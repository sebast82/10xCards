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
