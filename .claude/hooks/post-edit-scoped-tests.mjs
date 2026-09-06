#!/usr/bin/env node
// PostToolUse(Write|Edit) — testy POWIĄZANE z edytowanym plikiem, tylko w obszarze ryzyka #1.
//
// Dlaczego tylko #1: to jedyne ryzyko High × High w context/foundation/test-plan.md §2
// („dostawca modelu zwraca zły kształt / timeout / limit, a użytkownik widzi pustą listę
// zamiast rozróżnialnego błędu"). Pozostałe ryzyka mają bramki w pre-commit i CI.
//
// Dlaczego nie na każdym pliku: `vitest related` na współdzielonym prymitywie UI
// (src/components/ui/button.tsx) wciąga suity jsdom — 15 s na zimno. W obszarze #1
// ten sam mechanizm kosztuje ~0,7 s. Zakres jest tu bramką kosztu, nie ozdobą.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VITEST_BIN = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const TIMEOUT_MS = 90_000;

// Powierzchnia ryzyka #1 — łańcuch „granica HTTP dostawcy → serwis → trasa API → ekran".
// Ugruntowana w artefaktach §3 Fazy 1 (context/changes/testing-generation-error-contract/),
// nie zgadywana z nazw katalogów. Dopisując kolejne ryzyko, dodaj wpis z komentarzem-kotwicą.
const RISK_AREA = [
  /^src\/lib\/openrouter\//, //          klient + parser odpowiedzi dostawcy
  /^src\/lib\/generations\//, //         rezerwacja wiersza, liczniki, brak wycieku tekstu
  /^src\/pages\/api\/generations\./, //   translacja awarii na odpowiedź HTTP
  /^src\/components\/generate\//, //     komunikat, który faktycznie widzi użytkownik
];
const TESTABLE = new Set([".ts", ".tsx"]);

const quiet = () => process.exit(0);

let payload;
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  quiet();
}

const filePath = payload?.tool_input?.file_path;
if (typeof filePath !== "string" || filePath.length === 0) quiet();

const abs = path.resolve(payload.cwd ?? ROOT, filePath);
if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) quiet(); // poza repo
if (!TESTABLE.has(path.extname(abs))) quiet();

const rel = path.relative(ROOT, abs).replaceAll("\\", "/");
if (!RISK_AREA.some((pattern) => pattern.test(rel))) quiet(); // poza obszarem ryzyka — cisza

let output = "";
let status = 0;
try {
  output = execFileSync(
    process.execPath,
    [VITEST_BIN, "related", rel, "--run", "--passWithNoTests"],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      // Vitest 4.1+: kompaktowy reporter „agent" — bez ANSI i bez linii plików,
      // które przeszły. Ustawiamy jawnie, żeby hook nie zależał od tego, kto go odpalił.
      env: { ...process.env, AI_AGENT: "1" },
    }
  );
} catch (error) {
  if (error.killed || error.code === "ETIMEDOUT") {
    process.stderr.write(`[hook testy] vitest related przekroczył ${TIMEOUT_MS / 1000}s na ${rel} — pominięto.\n`);
    process.exit(1); // niablokujące: problem narzędzia, nie edycji
  }
  output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  status = typeof error.status === "number" ? error.status : 1;
}

if (status === 0) quiet();

process.stderr.write(
  `[hook testy] Testy powiązane z ${rel} są czerwone (obszar ryzyka #1 z test-plan.md §2):\n\n${output}\n` +
    `Jeśli to Twoja edycja zerwała kontrakt — napraw kod. Jeśli czerwień wynika z logiki biznesowej,\n` +
    `nie zgaduj poprawki w kółko: zgłoś to użytkownikowi (CLAUDE.md, "Exit codes and the feedback loop").\n`
);
process.exit(2); // blokujące: stderr wchodzi do kontekstu agenta
