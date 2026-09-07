import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // `tests/e2e` należy do Playwrighta — domyślny glob vitesta łapie `*.spec.ts`,
    // a `lint-staged` puszcza `vitest related` na każdym zmienionym `*.ts`.
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
