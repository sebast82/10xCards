import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";

type Status = "loading" | "question" | "answer" | "grading" | "finished" | "empty" | "error";

type GradeValue = 1 | 2 | 3 | 4;

// Lokalny typ — wyspa nie importuje niczego z `@/lib/srs` ani z serwisu (Zod + ts-fsrs są server-only).
interface ReviewCard {
  id: string;
  front: string;
  back: string;
  intervals: Record<GradeValue, string>;
}

const GRADES: readonly GradeValue[] = [1, 2, 3, 4];
const GRADE_LABELS: Record<GradeValue, string> = {
  1: "Znowu",
  2: "Trudno",
  3: "Dobrze",
  4: "Łatwo",
};

const FALLBACK_ERROR = "Coś poszło nie tak. Spróbuj ponownie.";
const CONNECTION_ERROR = "Nie udało się połączyć z serwerem. Spróbuj ponownie.";

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

// Ręczny type-guard dla `{ cards: ReviewCard[] }` — bez Zod, bo to kod tylko po stronie klienta.
function parseQueue(payload: unknown): ReviewCard[] | null {
  if (typeof payload !== "object" || payload === null || !("cards" in payload)) return null;
  const { cards } = payload as Record<string, unknown>;
  if (!Array.isArray(cards)) return null;

  const parsed: ReviewCard[] = [];
  for (const item of cards) {
    if (typeof item !== "object" || item === null) return null;
    const { id, front, back, intervals } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof front !== "string" || typeof back !== "string") return null;
    if (typeof intervals !== "object" || intervals === null) return null;
    const raw = intervals as Record<string, unknown>;
    if (
      typeof raw["1"] !== "string" ||
      typeof raw["2"] !== "string" ||
      typeof raw["3"] !== "string" ||
      typeof raw["4"] !== "string"
    ) {
      return null;
    }
    parsed.push({
      id,
      front,
      back,
      intervals: { 1: raw["1"], 2: raw["2"], 3: raw["3"], 4: raw["4"] },
    });
  }
  return parsed;
}

export default function ReviewSession() {
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [activeGrade, setActiveGrade] = useState<GradeValue | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [lastAction, setLastAction] = useState<"load" | GradeValue>("load");

  // `startedRef` rozróżnia pustą kolejkę na wejściu (empty) od pustej po ocenach (finished).
  const startedRef = useRef(false);
  // Blokuje równoległą ocenę tej samej karty (szybki podwójny klik / dubel z klawiatury).
  const submittingRef = useRef(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const currentCard: ReviewCard | null = queue.length > 0 ? queue[0] : null;
  const currentCardId = currentCard ? currentCard.id : null;

  const loadQueue = useCallback(async (baseReviewed: number) => {
    setLastAction("load");
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/reviews");
      const payload = await readJson(response);

      if (!response.ok) {
        setError(readError(payload, FALLBACK_ERROR));
        setStatus("error");
        return;
      }

      const cards = parseQueue(payload);
      if (!cards) {
        setError(FALLBACK_ERROR);
        setStatus("error");
        return;
      }

      if (cards.length === 0) {
        setStatus(startedRef.current ? "finished" : "empty");
        return;
      }

      startedRef.current = true;
      setQueue(cards);
      setStatus("question");
      setAnnouncement(`Karta ${baseReviewed + 1} z ${baseReviewed + cards.length}`);
    } catch {
      setError(CONNECTION_ERROR);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // Pierwsze pobranie kolejki — realny setState następuje dopiero po rundzie sieciowej.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch na mount, nie kaskada renderów
    void loadQueue(0);
  }, [loadQueue]);

  const handleReveal = useCallback(() => {
    setStatus("answer");
    setAnnouncement("Odpowiedź odsłonięta");
  }, []);

  const handleGrade = useCallback(
    async (grade: GradeValue) => {
      if (submittingRef.current) return;
      if (queue.length === 0) return;
      const card = queue[0];

      submittingRef.current = true;
      setLastAction(grade);
      setStatus("grading");
      setActiveGrade(grade);
      setError(null);

      try {
        const response = await fetch("/api/reviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ flashcardId: card.id, grade }),
        });

        // 409 = karta oceniona w innej karcie/zakładce — traktujemy jak "już zrobione", przechodzimy dalej.
        if (!response.ok && response.status !== 409) {
          const payload = await readJson(response);
          setError(readError(payload, FALLBACK_ERROR));
          setStatus("error");
          return;
        }

        const remaining = queue.slice(1);
        const nextReviewed = reviewedCount + 1;
        setReviewedCount(nextReviewed);

        if (remaining.length === 0) {
          setQueue([]);
          await loadQueue(nextReviewed);
        } else {
          setQueue(remaining);
          setStatus("question");
          setAnnouncement(`Karta ${nextReviewed + 1} z ${nextReviewed + remaining.length}`);
        }
      } catch {
        setError(CONNECTION_ERROR);
        setStatus("error");
      } finally {
        setActiveGrade(null);
        submittingRef.current = false;
      }
    },
    [queue, reviewedCount, loadQueue],
  );

  // Pierwszy `document`-listener w projekcie: efekt re-subskrybuje przy każdej zmianie `status`
  // + id karty, więc handler zawsze domyka się nad świeżym stanem; cleanup zdejmuje własny listener.
  useEffect(() => {
    if (status !== "question" && status !== "answer") return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;

      if (status === "question") {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          handleReveal();
        }
        return;
      }

      // status === "answer": ocena tylko klawiszami 1–4. Space/Enter tłumimy —
      // fokus stoi na przycisku oceny, więc natywna aktywacja oceniłaby "Znowu" po cichu.
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        return;
      }

      if (event.key === "1" || event.key === "2" || event.key === "3" || event.key === "4") {
        event.preventDefault();
        void handleGrade(Number(event.key) as GradeValue);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [status, currentCardId, handleReveal, handleGrade]);

  // Fokus wędruje na główny przycisk przy każdej zmianie karty/fazy.
  useEffect(() => {
    primaryRef.current?.focus();
  }, [currentCardId, status]);

  const retry = useCallback(() => {
    if (typeof lastAction === "number") {
      void handleGrade(lastAction);
    } else {
      void loadQueue(reviewedCount);
    }
  }, [lastAction, handleGrade, loadQueue, reviewedCount]);

  const inSession = status === "question" || status === "answer" || status === "grading";

  return (
    <div className="flex flex-col gap-8">
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      {status === "loading" && (
        <div className="text-muted-foreground flex justify-center py-10">
          <Loader2 className="animate-spin" />
        </div>
      )}

      {status === "empty" && (
        <div className="text-muted-foreground flex flex-col items-start gap-3 rounded-xl border p-6">
          <p className="text-sm">Nie masz dziś nic do powtórki.</p>
          <Button asChild>
            <a href="/deck">Wróć do talii</a>
          </Button>
        </div>
      )}

      {status === "finished" && (
        <div className="text-muted-foreground flex flex-col items-start gap-3 rounded-xl border p-6">
          <p className="text-sm">To na dziś wszystko — powtórzono {reviewedCount} fiszek.</p>
          <Button asChild>
            <a href="/deck">Wróć do talii</a>
          </Button>
        </div>
      )}

      {status === "error" && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>Coś poszło nie tak</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={retry}>
              Spróbuj ponownie
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {inSession && currentCard && (
        <>
          <span className="text-muted-foreground text-sm">
            Karta {reviewedCount + 1} z {reviewedCount + queue.length}
          </span>

          <Card>
            <CardContent className="flex flex-col gap-4">
              <p className="text-lg font-medium">{currentCard.front}</p>
              {(status === "answer" || status === "grading") && (
                <>
                  <hr className="border-border" />
                  <p className="text-muted-foreground">{currentCard.back}</p>
                </>
              )}
            </CardContent>

            <CardFooter className="flex flex-wrap gap-2">
              {status === "question" ? (
                <Button ref={primaryRef} type="button" onClick={handleReveal}>
                  Pokaż odpowiedź
                </Button>
              ) : (
                GRADES.map((grade, index) => (
                  <Button
                    key={grade}
                    ref={index === 0 ? primaryRef : undefined}
                    type="button"
                    variant="outline"
                    disabled={status === "grading"}
                    onClick={() => {
                      void handleGrade(grade);
                    }}
                  >
                    {status === "grading" && activeGrade === grade ? <Loader2 className="animate-spin" /> : null}
                    {GRADE_LABELS[grade]} · {currentCard.intervals[grade]}
                  </Button>
                ))
              )}
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}
