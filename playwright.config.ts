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
  // Testy są niezależne (własny setup → akcja → asercja → sprzątanie), więc mogą biec równolegle.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      // Chromium jako jedyna przeglądarka: aplikacja nie ma ryzyk specyficznych dla silnika,
      // a każdy dodatkowy projekt mnoży czas bramki na PR. Dołóż firefox/webkit, gdy pojawi się powód.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${String(PORT)}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
