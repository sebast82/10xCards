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
