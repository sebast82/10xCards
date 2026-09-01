// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import FlashcardCollection from "./FlashcardCollection";

const CARDS = [
  {
    id: "card-1",
    front: "Pierwsze pytanie",
    back: "Pierwsza odpowiedź",
    source: "ai" as const,
    created_at: "2026-09-01T10:00:00Z",
  },
  {
    id: "card-2",
    front: "Drugie pytanie",
    back: "Druga odpowiedź",
    source: "manual" as const,
    created_at: "2026-09-01T11:00:00Z",
  },
];

function renderCollection(cards = CARDS) {
  return render(<FlashcardCollection flashcards={cards} pageSize={50} />);
}

function renderCappedCollection(cards = CARDS, pageSize = 50) {
  return render(<FlashcardCollection flashcards={cards} pageSize={pageSize} />);
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FlashcardCollection", () => {
  it("opens and cancels a manual create draft", async () => {
    const user = userEvent.setup();
    renderCollection();

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    await user.type(screen.getByRole("textbox", { name: "Przód nowej fiszki" }), "Draft przodu");
    await user.type(screen.getByRole("textbox", { name: "Tył nowej fiszki" }), "Draft tyłu");
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    expect(screen.queryByRole("textbox", { name: "Przód nowej fiszki" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Przód nowej fiszki" }).value).toBe("");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Tył nowej fiszki" }).value).toBe("");
  });

  it("validates manual create content on the client", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderCollection();

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    await user.click(screen.getByRole("button", { name: "Zapisz fiszkę" }));

    expect(screen.getByText("Przód fiszki może mieć do 500 znaków, a tył do 2000.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains a manual create draft after a failed request", async () => {
    const user = userEvent.setup();
    mockFetch(new Response(JSON.stringify({ error: "Nie udało się utworzyć fiszki." }), { status: 500 }));
    renderCollection();

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    await user.type(screen.getByRole("textbox", { name: "Przód nowej fiszki" }), "Nowe pytanie");
    await user.type(screen.getByRole("textbox", { name: "Tył nowej fiszki" }), "Nowa odpowiedź");
    await user.click(screen.getByRole("button", { name: "Zapisz fiszkę" }));

    expect(await screen.findByText("Nie udało się utworzyć fiszki.")).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Przód nowej fiszki" }).value).toBe("Nowe pytanie");
    expect(screen.queryByText("Nowe pytanie")).toBeTruthy();
  });

  it("posts the exact manual payload and prepends the confirmed card", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ id: "card-new", created_at: "2026-09-01T12:00:00Z" }), { status: 201 }),
    );
    renderCollection();

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    await user.type(screen.getByRole("textbox", { name: "Przód nowej fiszki" }), "  Nowe pytanie  ");
    await user.type(screen.getByRole("textbox", { name: "Tył nowej fiszki" }), "  Nowa odpowiedź  ");
    await user.click(screen.getByRole("button", { name: "Zapisz fiszkę" }));

    await waitFor(() => {
      expect(screen.getByText("Nowe pytanie")).toBeTruthy();
    });
    expect(screen.queryByRole("textbox", { name: "Przód nowej fiszki" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/flashcards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ front: "Nowe pytanie", back: "Nowa odpowiedź" }),
      }),
    );
    expect(screen.getAllByText("Ręczna")).toHaveLength(2);
  });

  it("preserves the page-size cap after a successful manual prepend", async () => {
    const user = userEvent.setup();
    mockFetch(new Response(JSON.stringify({ id: "card-new", created_at: "2026-09-01T12:00:00Z" }), { status: 201 }));
    renderCappedCollection(CARDS, 2);

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    await user.type(screen.getByRole("textbox", { name: "Przód nowej fiszki" }), "Nowe pytanie");
    await user.type(screen.getByRole("textbox", { name: "Tył nowej fiszki" }), "Nowa odpowiedź");
    await user.click(screen.getByRole("button", { name: "Zapisz fiszkę" }));

    await waitFor(() => {
      expect(screen.getByText("Nowe pytanie")).toBeTruthy();
    });
    expect(screen.getByText("Pierwsze pytanie")).toBeTruthy();
    expect(screen.queryByText("Drugie pytanie")).toBeNull();
    expect(screen.getByText("2 fiszek (najnowsze)")).toBeTruthy();
  });

  it("creates a manual card from the empty collection state", async () => {
    const user = userEvent.setup();
    mockFetch(new Response(JSON.stringify({ id: "card-new", created_at: "2026-09-01T12:00:00Z" }), { status: 201 }));
    renderCollection([]);

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    expect(screen.getByRole("link", { name: "Generuj fiszki" }).getAttribute("href")).toBe("/generate");
    await user.type(screen.getByRole("textbox", { name: "Przód nowej fiszki" }), "Pytanie z pustej listy");
    await user.type(screen.getByRole("textbox", { name: "Tył nowej fiszki" }), "Odpowiedź z pustej listy");
    await user.click(screen.getByRole("button", { name: "Zapisz fiszkę" }));

    expect(await screen.findByText("Pytanie z pustej listy")).toBeTruthy();
    expect(screen.queryByText("Nie masz jeszcze żadnych fiszek.")).toBeNull();
    expect(screen.getByText("Ręczna")).toBeTruthy();
  });

  it("keeps manual create and card editing mutually exclusive", async () => {
    const user = userEvent.setup();
    renderCollection();

    await user.click(screen.getAllByRole("button", { name: "Edytuj" })[0]);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Dodaj fiszkę" }).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Anuluj" }));

    await user.click(screen.getByRole("button", { name: "Dodaj fiszkę" }));
    for (const button of screen.getAllByRole<HTMLButtonElement>("button", { name: "Edytuj" })) {
      expect(button.disabled).toBe(true);
    }
    for (const button of screen.getAllByRole<HTMLButtonElement>("button", { name: "Usuń" })) {
      expect(button.disabled).toBe(true);
    }
  });

  it("retains a draft and shows a card-specific error after a failed save", async () => {
    const user = userEvent.setup();
    mockFetch(new Response(JSON.stringify({ error: "Nie udało się zapisać fiszki." }), { status: 500 }));
    renderCollection();

    await user.click(screen.getAllByRole("button", { name: "Edytuj" })[0]);
    const front = screen.getByRole("textbox", { name: "Przód fiszki" });
    fireEvent.change(front, { target: { value: "Zmieniony draft" } });
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByText("Nie udało się zapisać fiszki.")).toBeTruthy();
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Przód fiszki" }).value).toBe("Zmieniony draft");
  });

  it("replaces only the edited card after a successful save", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch(new Response(JSON.stringify({ id: "card-1" }), { status: 200 }));
    renderCollection();

    await user.click(screen.getAllByRole("button", { name: "Edytuj" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Przód fiszki" }), { target: { value: "Nowe pytanie" } });
    await user.click(screen.getByRole("button", { name: "Zapisz" }));

    await waitFor(() => {
      expect(screen.getByText("Nowe pytanie")).toBeTruthy();
    });
    expect(screen.getByText("Drugie pytanie")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/flashcards/card-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ front: "Nowe pytanie", back: "Pierwsza odpowiedź" }),
      }),
    );
  });

  it("removes only the confirmed card", async () => {
    const user = userEvent.setup();
    mockFetch(new Response(JSON.stringify({ id: "card-1" }), { status: 200 }));
    renderCollection();

    await user.click(screen.getAllByRole("button", { name: "Usuń" })[0]);
    await user.click(screen.getByRole("button", { name: "Usuń trwale" }));

    await waitFor(() => {
      expect(screen.queryAllByText("Pierwsze pytanie")).toHaveLength(0);
    });
    expect(screen.getByText("Drugie pytanie")).toBeTruthy();
  });

  it("shows the empty collection state after deleting the final card", async () => {
    const user = userEvent.setup();
    mockFetch(new Response(JSON.stringify({ id: "card-1" }), { status: 200 }));
    renderCollection([CARDS[0]]);

    await user.click(screen.getByRole("button", { name: "Usuń" }));
    await user.click(screen.getByRole("button", { name: "Usuń trwale" }));

    expect(await screen.findByText("Nie masz jeszcze żadnych fiszek.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Generuj fiszki" }).getAttribute("href")).toBe("/generate");
  });
});
