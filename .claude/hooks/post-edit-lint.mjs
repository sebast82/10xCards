#!/usr/bin/env node
// PostToolUse(Write|Edit) — ESLint na JEDNYM edytowanym pliku.
//
// Sygnał zwrotny do agenta (patrz CLAUDE.md "Exit codes and the feedback loop"):
//   exit 0            — czysto, cisza.
//   exit 0 + JSON     — `--fix` zmienił plik na dysku; additionalContext mówi agentowi, żeby go przeczytał ponownie.
//   exit 2 + stderr   — zostały błędy, których --fix nie naprawił; stderr trafia do kontekstu agenta.
//   exit 1 + stderr   — awaria samego narzędzia (nie wina edycji) — niablokujące.
//
// Uruchamiamy binarkę ESLinta przez `node` zamiast `npx`/`npm run lint`:
// npx dokłada ~20 s narzutu na wywołanie, a to jest hook per-edit.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ESLINT_BIN = path.join(ROOT, "node_modules", "eslint", "bin", "eslint.js");
const LINTABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".astro"]);
const TIMEOUT_MS = 60_000;

const quiet = () => process.exit(0);

function hash(file) {
  try {
    return createHash("sha1").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  quiet(); // brak/zły stdin — nie blokujemy pracy agenta z powodu hooka
}

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== "string" || filePath.length === 0) quiet();

const abs = path.resolve(payload.cwd ?? ROOT, filePath);
// Poza repo (np. scratchpad sesji) — nie nasza sprawa.
if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) quiet();
if (!LINTABLE.has(path.extname(abs))) quiet();

const before = hash(abs);
if (before === null) quiet(); // plik zniknął / to katalog

let stdout = "";
let status = 0;
try {
  stdout = execFileSync(
    process.execPath,
    [ESLINT_BIN, "--fix", "--no-warn-ignored", "--format", "stylish", abs],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: TIMEOUT_MS }
  );
} catch (error) {
  if (error.killed || error.code === "ETIMEDOUT") {
    process.stderr.write(`[hook lint] ESLint przekroczył ${TIMEOUT_MS / 1000}s na ${path.relative(ROOT, abs)} — pominięto.\n`);
    process.exit(1); // niablokujące: problem narzędzia, nie edycji
  }
  stdout = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  status = typeof error.status === "number" ? error.status : 1;
}

const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
const fixed = hash(abs) !== before;

// ESLint: 0 = czysto, 1 = zostały błędy/ostrzeżenia, 2 = fatal (zła konfiguracja).
if (status >= 2) {
  process.stderr.write(`[hook lint] ESLint nie wystartował dla ${rel}:\n${stdout}\n`);
  process.exit(1);
}

if (status === 1) {
  process.stderr.write(
    `[hook lint] ESLint zgłasza błędy w ${rel}${fixed ? " (część naprawiono automatycznie przez --fix)" : ""}:\n\n${stdout}\n` +
      `Napraw je w tym pliku przed dalszą pracą. Plik na dysku mógł się zmienić — przeczytaj go ponownie przed kolejną edycją.\n`
  );
  process.exit(2); // blokujące: stderr wchodzi do kontekstu agenta
}

if (fixed) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `ESLint --fix poprawił formatowanie w ${rel}. Zawartość na dysku różni się od tego, co zapisałeś — przeczytaj plik ponownie przed kolejną edycją.`,
      },
    })
  );
}
process.exit(0);
