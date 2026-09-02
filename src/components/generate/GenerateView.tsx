import { useId, useState } from "react";
import { Loader2, Pencil, Save, ShieldAlert, Trash2, Wand2, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BACK_MAX_LENGTH, FRONT_MAX_LENGTH, SOURCE_TEXT_MAX, SOURCE_TEXT_MIN } from "@/lib/limits";

// Powyżej 45 s z adaptera: serwerowy komunikat błędu ma zdążyć dotrzeć przed przerwaniem po stronie klienta.
const GENERATE_TIMEOUT_MS = 60_000;

type ViewStatus = "idle" | "generating" | "reviewing" | "error";

type ProposalStatus = "pending" | "editing" | "saving" | "saved" | "rejected" | "error";

type PrivacyMode = "zdr" | "standard";

interface Proposal {
  id: string;
  front: string;
  back: string;
  draftFront: string;
  draftBack: string;
  status: ProposalStatus;
  error: string | null;
}

interface GenerationPayload {
  generationId: string;
  privacyMode: PrivacyMode;
  proposals: { front: string; back: string }[];
}

const FALLBACK_ERROR = "Coś poszło nie tak. Spróbuj ponownie.";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const message = payload.error;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return fallback;
}

function parseGeneration(payload: unknown): GenerationPayload | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { generationId, privacyMode, proposals } = payload as Record<string, unknown>;

  if (typeof generationId !== "string" || !Array.isArray(proposals)) return null;

  const parsed: { front: string; back: string }[] = [];
  for (const item of proposals) {
    if (typeof item !== "object" || item === null) return null;
    const { front, back } = item as Record<string, unknown>;
    if (typeof front !== "string" || typeof back !== "string") return null;
    parsed.push({ front, back });
  }

  return {
    generationId,
    privacyMode: privacyMode === "standard" ? "standard" : "zdr",
    proposals: parsed,
  };
}

export default function GenerateView() {
  const sourceTextId = useId();
  const [sourceText, setSourceText] = useState("");
  const [status, setStatus] = useState<ViewStatus>("idle");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("zdr");
  const [proposals, setProposals] = useState<Proposal[]>([]);

  const trimmedLength = sourceText.trim().length;
  const lengthOk = trimmedLength >= SOURCE_TEXT_MIN && trimmedLength <= SOURCE_TEXT_MAX;
  const generating = status === "generating";
  const savedCount = proposals.filter((proposal) => proposal.status === "saved").length;

  function updateProposal(id: string, patch: Partial<Proposal>) {
    setProposals((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function handleGenerate() {
    setStatus("generating");
    setGenerationError(null);

    try {
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Tekst źródłowy wyłącznie w ciele POST — URL trafia do Workers Logs, ciało nie.
        body: JSON.stringify({ sourceText: sourceText.trim() }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });

      const payload = await readJson(response);

      if (!response.ok) {
        setGenerationError(readError(payload, FALLBACK_ERROR));
        setStatus("error");
        return;
      }

      const generation = parseGeneration(payload);
      if (!generation) {
        setGenerationError(FALLBACK_ERROR);
        setStatus("error");
        return;
      }

      setGenerationId(generation.generationId);
      setPrivacyMode(generation.privacyMode);
      setProposals(
        generation.proposals.map((proposal, index) => ({
          id: `${generation.generationId}-${index}`,
          front: proposal.front,
          back: proposal.back,
          draftFront: proposal.front,
          draftBack: proposal.back,
          status: "pending",
          error: null,
        })),
      );
      setStatus("reviewing");
    } catch {
      setGenerationError("Nie udało się połączyć z serwerem. Spróbuj ponownie.");
      setStatus("error");
    }
  }

  async function handleSave(proposal: Proposal) {
    if (!generationId) return;

    const front = proposal.draftFront.trim();
    const back = proposal.draftBack.trim();
    // `edited` porównuje treść, a nie fakt wejścia w tryb edycji — inaczej wyjście bez zmian
    // fałszowałoby `accepted_unedited_count`.
    const edited = front !== proposal.front.trim() || back !== proposal.back.trim();

    updateProposal(proposal.id, { status: "saving", error: null });

    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId, front, back, edited }),
      });

      if (!response.ok) {
        const payload = await readJson(response);
        updateProposal(proposal.id, { status: "error", error: readError(payload, FALLBACK_ERROR) });
        return;
      }

      updateProposal(proposal.id, { status: "saved", draftFront: front, draftBack: back, error: null });
    } catch {
      updateProposal(proposal.id, {
        status: "error",
        error: "Nie udało się połączyć z serwerem. Spróbuj ponownie.",
      });
    }
  }

  const visibleProposals = proposals.filter((proposal) => proposal.status !== "rejected");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Generuj fiszki</h1>
        <p className="text-muted-foreground text-sm">
          Wklej materiał, z którego chcesz się uczyć. Propozycje przejrzysz przed zapisaniem — odrzucone nigdzie nie
          trafiają.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <label htmlFor={sourceTextId} className="text-sm font-medium">
          Tekst źródłowy
        </label>
        <Textarea
          id={sourceTextId}
          value={sourceText}
          onChange={(event) => {
            setSourceText(event.target.value);
          }}
          disabled={generating}
          rows={12}
          className="min-h-64"
          placeholder="Wklej tutaj fragment notatek, artykułu albo podręcznika…"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={lengthOk ? "text-muted-foreground text-sm" : "text-destructive text-sm"}>
            {trimmedLength} / {SOURCE_TEXT_MAX} znaków
            {!lengthOk &&
              (trimmedLength < SOURCE_TEXT_MIN
                ? ` — potrzeba co najmniej ${SOURCE_TEXT_MIN}`
                : ` — przekroczono limit o ${trimmedLength - SOURCE_TEXT_MAX}`)}
          </span>
          <Button
            type="button"
            disabled={!lengthOk || generating}
            onClick={() => {
              void handleGenerate();
            }}
          >
            {generating ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {generating ? "Generuję…" : "Generuj fiszki"}
          </Button>
        </div>
      </section>

      {status === "error" && generationError && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Nie udało się wygenerować fiszek</AlertTitle>
          <AlertDescription>
            <p>{generationError}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void handleGenerate();
              }}
            >
              Spróbuj ponownie
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {status === "reviewing" && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Propozycje</h2>
            <span className="text-muted-foreground text-sm">
              zapisano {savedCount} z {proposals.length}
            </span>
          </div>

          {privacyMode === "standard" && (
            <p className="text-muted-foreground text-xs">
              To generowanie wykonano bez trybu Zero Data Retention — nie było dostępnej trasy spełniającej to
              ograniczenie.
            </p>
          )}

          {visibleProposals.map((proposal) => (
            <Card key={proposal.id}>
              <CardContent className="flex flex-col gap-3">
                {proposal.status === "editing" ? (
                  <>
                    <Textarea
                      aria-label="Przód fiszki"
                      value={proposal.draftFront}
                      maxLength={FRONT_MAX_LENGTH}
                      onChange={(event) => {
                        updateProposal(proposal.id, { draftFront: event.target.value });
                      }}
                    />
                    <Textarea
                      aria-label="Tył fiszki"
                      value={proposal.draftBack}
                      maxLength={BACK_MAX_LENGTH}
                      onChange={(event) => {
                        updateProposal(proposal.id, { draftBack: event.target.value });
                      }}
                    />
                  </>
                ) : (
                  <>
                    <p className="font-medium">{proposal.draftFront}</p>
                    <p className="text-muted-foreground text-sm">{proposal.draftBack}</p>
                  </>
                )}

                {proposal.error && <p className="text-destructive text-sm">{proposal.error}</p>}
              </CardContent>

              <CardFooter className="flex flex-wrap gap-2">
                {proposal.status === "saved" ? (
                  <span className="text-muted-foreground text-sm">Zapisano w kolekcji</span>
                ) : proposal.status === "editing" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        void handleSave(proposal);
                      }}
                    >
                      <Save /> Zapisz
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        updateProposal(proposal.id, {
                          status: "pending",
                          draftFront: proposal.front,
                          draftBack: proposal.back,
                        });
                      }}
                    >
                      <X /> Anuluj
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={proposal.status === "saving"}
                      onClick={() => {
                        void handleSave(proposal);
                      }}
                    >
                      {proposal.status === "saving" ? <Loader2 className="animate-spin" /> : <Save />} Zapisz
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={proposal.status === "saving"}
                      onClick={() => {
                        updateProposal(proposal.id, { status: "editing", error: null });
                      }}
                    >
                      <Pencil /> Edytuj
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={proposal.status === "saving"}
                      onClick={() => {
                        // Odrzucenie nie wysyła żądania — karta znika wyłącznie ze stanu komponentu.
                        updateProposal(proposal.id, { status: "rejected" });
                      }}
                    >
                      <Trash2 /> Odrzuć
                    </Button>
                  </>
                )}
              </CardFooter>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
