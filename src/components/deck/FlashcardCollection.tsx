import { useState } from "react";
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BACK_MAX_LENGTH, FRONT_MAX_LENGTH } from "@/lib/limits";

interface Flashcard {
  id: string;
  front: string;
  back: string;
  source: "ai" | "ai_edited" | "manual";
  created_at: string;
}

interface FlashcardCollectionProps {
  flashcards: Flashcard[];
  pageSize: number;
}

interface Draft {
  front: string;
  back: string;
}

const SOURCE_LABELS: Record<Flashcard["source"], string> = {
  ai: "AI",
  ai_edited: "AI (edytowana)",
  manual: "Ręczna",
};
const FALLBACK_ERROR = "Coś poszło nie tak. Spróbuj ponownie.";
const dateFormatter = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" });

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function parseCreateResult(payload: unknown): { id: string; created_at: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { id, created_at } = payload as Record<string, unknown>;

  if (typeof id !== "string" || typeof created_at !== "string") return null;
  return { id, created_at };
}

export default function FlashcardCollection({ flashcards: initialFlashcards, pageSize }: FlashcardCollectionProps) {
  const [flashcards, setFlashcards] = useState(initialFlashcards);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<Draft>({ front: "", back: "" });
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<string, Draft>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cardBusy = savingId !== null || deletingId !== null;
  const createBlocksCards = createOpen || creating;
  const canStartCreate = editingId === null && !cardBusy && !createBlocksCards;

  function setError(id: string, message: string | null) {
    setErrors((previous) => {
      if (message === null) {
        const { [id]: _removed, ...remaining } = previous;
        return remaining;
      }
      return { ...previous, [id]: message };
    });
  }

  function startEditing(card: Flashcard) {
    if (createBlocksCards) return;

    setEditingId(card.id);
    setDrafts((previous) => ({ ...previous, [card.id]: { front: card.front, back: card.back } }));
    setError(card.id, null);
  }

  function startCreating() {
    if (!canStartCreate) return;

    setCreateOpen(true);
    setCreateError(null);
  }

  function cancelCreating() {
    setCreateOpen(false);
    setCreateDraft({ front: "", back: "" });
    setCreateError(null);
  }

  async function saveNewCard() {
    const front = createDraft.front.trim();
    const back = createDraft.back.trim();
    if (!front || !back || front.length > FRONT_MAX_LENGTH || back.length > BACK_MAX_LENGTH) {
      setCreateError(`Przód fiszki może mieć do ${FRONT_MAX_LENGTH} znaków, a tył do ${BACK_MAX_LENGTH}.`);
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setCreateError(readError(payload, FALLBACK_ERROR));
        return;
      }

      const created = parseCreateResult(payload);
      if (!created) {
        setCreateError(FALLBACK_ERROR);
        return;
      }

      setFlashcards((previous) =>
        [{ ...created, front, back, source: "manual" as const }, ...previous].slice(0, pageSize),
      );
      setCreateDraft({ front: "", back: "" });
      setCreateOpen(false);
    } catch {
      setCreateError("Nie udało się połączyć z serwerem. Spróbuj ponownie.");
    } finally {
      setCreating(false);
    }
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((previous) => ({ ...previous, [id]: { ...(previous[id] ?? { front: "", back: "" }), ...patch } }));
  }

  function cancelEditing(card: Flashcard) {
    setEditingId(null);
    setDrafts((previous) => ({ ...previous, [card.id]: { front: card.front, back: card.back } }));
    setError(card.id, null);
  }

  async function saveCard(card: Flashcard) {
    const draft = drafts[card.id];
    if (!draft) return;

    const front = draft.front.trim();
    const back = draft.back.trim();
    if (!front || !back || front.length > FRONT_MAX_LENGTH || back.length > BACK_MAX_LENGTH) {
      setError(card.id, `Przód fiszki może mieć do ${FRONT_MAX_LENGTH} znaków, a tył do ${BACK_MAX_LENGTH}.`);
      return;
    }

    setSavingId(card.id);
    setError(card.id, null);
    try {
      const response = await fetch(`/api/flashcards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back }),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        setError(card.id, readError(payload, FALLBACK_ERROR));
        return;
      }

      setFlashcards((previous) => previous.map((item) => (item.id === card.id ? { ...item, front, back } : item)));
      setDrafts((previous) => ({ ...previous, [card.id]: { front, back } }));
      setEditingId(null);
    } catch {
      setError(card.id, "Nie udało się połączyć z serwerem. Spróbuj ponownie.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteCard(card: Flashcard) {
    setDeletingId(card.id);
    setError(card.id, null);
    try {
      const response = await fetch(`/api/flashcards/${card.id}`, { method: "DELETE" });
      const payload = await readJson(response);
      if (!response.ok) {
        setError(card.id, readError(payload, FALLBACK_ERROR));
        return;
      }

      setFlashcards((previous) => previous.filter((item) => item.id !== card.id));
      setEditingId((previous) => (previous === card.id ? null : previous));
    } catch {
      setError(card.id, "Nie udało się połączyć z serwerem. Spróbuj ponownie.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Kolekcja fiszek">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-muted-foreground text-sm">
          {flashcards.length} fiszek{flashcards.length === pageSize && " (najnowsze)"}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={!canStartCreate}
          onClick={() => {
            startCreating();
          }}
        >
          <Plus /> Dodaj fiszkę
        </Button>
      </div>

      {createOpen && (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Nowa fiszka</h2>
            <Textarea
              aria-label="Przód nowej fiszki"
              value={createDraft.front}
              maxLength={FRONT_MAX_LENGTH}
              disabled={creating}
              onChange={(event) => {
                setCreateDraft((previous) => ({ ...previous, front: event.target.value }));
              }}
            />
            <Textarea
              aria-label="Tył nowej fiszki"
              value={createDraft.back}
              maxLength={BACK_MAX_LENGTH}
              disabled={creating}
              onChange={(event) => {
                setCreateDraft((previous) => ({ ...previous, back: event.target.value }));
              }}
            />
            {createError && <p className="text-destructive text-sm">{createError}</p>}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={creating}
              onClick={() => {
                void saveNewCard();
              }}
            >
              {creating ? <Loader2 className="animate-spin" /> : <Save />}
              {creating ? "Zapisuję…" : "Zapisz fiszkę"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={creating} onClick={cancelCreating}>
              <X /> Anuluj
            </Button>
          </CardFooter>
        </Card>
      )}

      {flashcards.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-start gap-3 rounded-xl border p-6">
          <p className="text-sm">Nie masz jeszcze żadnych fiszek.</p>
          <Button asChild>
            <a href="/generate">Generuj fiszki</a>
          </Button>
        </div>
      )}

      {flashcards.map((card) => {
        const isEditing = editingId === card.id;
        const isSaving = savingId === card.id;
        const isDeleting = deletingId === card.id;
        const draft = drafts[card.id] ?? { front: card.front, back: card.back };
        const busy = isSaving || isDeleting;
        const actionDisabled = busy || editingId !== null || createBlocksCards;

        return (
          <Card key={card.id}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground rounded-full border px-2 py-0.5 text-xs">
                  {SOURCE_LABELS[card.source]}
                </span>
                <span className="text-muted-foreground text-xs">{dateFormatter.format(new Date(card.created_at))}</span>
              </div>
              {isEditing ? (
                <>
                  <Textarea
                    aria-label="Przód fiszki"
                    value={draft.front}
                    maxLength={FRONT_MAX_LENGTH}
                    disabled={busy}
                    onChange={(event) => {
                      updateDraft(card.id, { front: event.target.value });
                    }}
                  />
                  <Textarea
                    aria-label="Tył fiszki"
                    value={draft.back}
                    maxLength={BACK_MAX_LENGTH}
                    disabled={busy}
                    onChange={(event) => {
                      updateDraft(card.id, { back: event.target.value });
                    }}
                  />
                </>
              ) : (
                <>
                  <p className="font-medium">{card.front}</p>
                  <p className="text-muted-foreground text-sm">{card.back}</p>
                </>
              )}
              {errors[card.id] && <p className="text-destructive text-sm">{errors[card.id]}</p>}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              {isEditing ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      void saveCard(card);
                    }}
                  >
                    {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                    {isSaving ? "Zapisuję…" : "Zapisz"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      cancelEditing(card);
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
                    variant="outline"
                    disabled={actionDisabled}
                    onClick={() => {
                      startEditing(card);
                    }}
                  >
                    <Pencil /> Edytuj
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" size="sm" variant="ghost" disabled={actionDisabled}>
                        <Trash2 /> Usuń
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Usunąć tę fiszkę?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Ta operacja jest nieodwracalna. Fiszka zostanie trwale usunięta z Twojej kolekcji.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Anuluj</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={isDeleting}
                          onClick={(event) => {
                            event.preventDefault();
                            void deleteCard(card);
                          }}
                        >
                          {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          {isDeleting ? "Usuwam…" : "Usuń trwale"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </CardFooter>
          </Card>
        );
      })}
    </section>
  );
}
