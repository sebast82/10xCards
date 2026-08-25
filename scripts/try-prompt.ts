/* eslint-disable no-console -- jednorazowy skrypt diagnostyczny, poza ścieżką żądania */
import { readFileSync } from "node:fs";
import { generateFlashcards } from "../src/lib/openrouter/client";
import { proposalCap, SOURCE_TEXT_MAX, SOURCE_TEXT_MIN } from "../src/lib/openrouter/limits";
import { buildChatRequest } from "../src/lib/openrouter/prompt";

const USAGE = "Użycie: npm run try:prompt -- <ścieżka-do-pliku-z-tekstem> [--dry]";

function readApiKey(): string {
  const fromEnv = process.env.OPENROUTER_API_KEY;
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const match = /^OPENROUTER_API_KEY\s*=\s*"?(.+?)"?\s*$/m.exec(readFileSync(".dev.vars", "utf8"));
    if (match) {
      return match[1];
    }
  } catch {
    // brak .dev.vars — obsłużone niżej
  }

  throw new Error("Brak OPENROUTER_API_KEY — ustaw zmienną środowiskową albo wpis w .dev.vars");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

async function main(): Promise<void> {
  const sourcePath = process.argv[2];
  if (!sourcePath || sourcePath.startsWith("--")) {
    throw new Error(USAGE);
  }

  const sourceText = readFileSync(sourcePath, "utf8").trim();
  if (sourceText.length < SOURCE_TEXT_MIN || sourceText.length > SOURCE_TEXT_MAX) {
    throw new Error(`Tekst ma ${sourceText.length} znaków — dozwolone ${SOURCE_TEXT_MIN}–${SOURCE_TEXT_MAX}.`);
  }

  const request = buildChatRequest(sourceText);

  console.log(`model       ${request.model}`);
  console.log(`znaków      ${sourceText.length}`);
  console.log(`sufit       ${proposalCap(sourceText.length)}`);
  console.log(`max_tokens  ${request.max_tokens}`);
  console.log("");

  if (process.argv.includes("--dry")) {
    console.log(JSON.stringify(request, null, 2));
    return;
  }

  const startedAt = Date.now();
  const outcome = await generateFlashcards(readApiKey(), sourceText);
  const elapsedMs = Date.now() - startedAt;

  console.log(`czas        ${elapsedMs} ms`);
  console.log(`model zwr.  ${outcome.model}`);
  console.log(`prywatność  ${outcome.privacyMode}${outcome.privacyMode === "standard" ? "  ← fallback bez ZDR" : ""}`);
  console.log(`propozycji  ${outcome.proposals.length}`);
  console.log("");

  outcome.proposals.forEach((proposal, index) => {
    const words = countWords(proposal.back);
    const flag = words > 30 ? "  ← tył dłuższy niż 30 słów" : "";
    console.log(
      `#${index + 1}  przód ${proposal.front.length}/500 · tył ${proposal.back.length}/2000 · ${words} sł.${flag}`,
    );
    console.log(`   P: ${proposal.front}`);
    console.log(`   O: ${proposal.back}`);
    console.log("");
  });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
