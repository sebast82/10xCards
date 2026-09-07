import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Playwright nie czyta plików .env sam z siebie. `.env.test` trzyma dane konta testowego
// (E2E_USERNAME / E2E_PASSWORD); `.env` dokłada resztę konfiguracji potrzebnej dev serwerowi.
for (const file of [".env", ".env.test"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// Stan zalogowania zapisywany raz przez projekt `setup` i współdzielony przez wszystkie testy.
export const STORAGE_STATE = "playwright/.auth/user.json";

const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Testy są niezależne (własny setup → akcja → asercja → sprzątanie), ale nie wszystkie zasoby są.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Jeden worker także lokalnie, nie tylko w CI. Kolejka powtórek jest globalna dla konta:
  // każda fiszka utworzona przez `/deck` dostaje `due = now`, a `/review` renderuje wyłącznie
  // `queue[0]` posortowaną po `due` rosnąco. Równoległy `seed.spec.ts` wstawia więc własną kartę
  // przed kartę `critical-loop.spec.ts` i zasłania ją w trakcie testu — warunek wstępny sprawdza
  // kolejkę raz, na starcie, i nie ma jak objąć okna, w którym rośnie ona pod nim.
  // Suite ma kilka testów i biegnie ~10 s, więc szeregowanie nic nie kosztuje.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Jednorazowe logowanie — reszta projektów startuje z gotowym `storageState`.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      // Testy roli „niezalogowany": bez `storageState` i bez zależności od `setup`,
      // więc biegną także wtedy, gdy nie ma konta testowego w .env.test.
      name: "chromium-guest",
      testMatch: /.*\.guest\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Chromium jako jedyna przeglądarka: aplikacja nie ma ryzyk specyficznych dla silnika,
      // a każdy dodatkowy projekt mnoży czas bramki na PR. Dołóż firefox/webkit, gdy pojawi się powód.
      name: "chromium",
      testIgnore: /.*\.guest\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${String(PORT)}`,
    // Astro 7 demonizuje dev server, gdy wykryje agenta AI — proces rodzica kończy się
    // natychmiast, a Playwright melduje "webServer exited early". Wymuszamy pierwszy plan.
    env: { ASTRO_DEV_BACKGROUND: "0" },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
