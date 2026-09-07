// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ReviewSession from "./ReviewSession";

const INTERVALS = { "1": "za 1 min", "2": "za 10 min", "3": "za 3 dni", "4": "za 8 dni" };

function card(id: string) {
  return { id, front: `Pytanie ${id}`, back: `Odpowiedź ${id}`, intervals: INTERVALS };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReviewSession", () => {
  it("exposes the session as a region named for E2E scoping", async () => {
    stubFetch(jsonResponse({ cards: [] }));
    render(<ReviewSession />);

    expect(await screen.findByRole("region", { name: "Sesja powtórkowa" })).toBeTruthy();
  });

  it("shows the empty state when nothing is due", async () => {
    stubFetch(jsonResponse({ cards: [] }));
    render(<ReviewSession />);

    expect(await screen.findByText("Nie masz dziś nic do powtórki.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Wróć do talii" }).getAttribute("href")).toBe("/deck");
  });

  it("runs a full session with the mouse and finishes when the re-fetch is empty", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse({ cards: [card("a")] }), jsonResponse({ id: "a" }), jsonResponse({ cards: [] }));
    render(<ReviewSession />);

    await user.click(await screen.findByRole("button", { name: "Pokaż odpowiedź" }));
    expect(screen.getByText("Odpowiedź a")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Dobrze · za 3 dni" }));

    expect(await screen.findByText("To na dziś wszystko — powtórzono 1 fiszek.")).toBeTruthy();
  });

  it("drives the whole loop by keyboard", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      jsonResponse({ cards: [card("a")] }),
      jsonResponse({ id: "a" }),
      jsonResponse({ cards: [] }),
    );
    render(<ReviewSession />);

    await screen.findByRole("button", { name: "Pokaż odpowiedź" });
    await user.keyboard(" ");
    expect(await screen.findByRole("button", { name: "Dobrze · za 3 dni" })).toBeTruthy();

    await user.keyboard("3");

    expect(await screen.findByText("To na dziś wszystko — powtórzono 1 fiszek.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reviews",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ flashcardId: "a", grade: 3 }) }),
    );
  });

  it("advances the progress counter as cards are graded", async () => {
    const user = userEvent.setup();
    stubFetch(jsonResponse({ cards: [card("a"), card("b")] }), jsonResponse({ id: "a" }));
    render(<ReviewSession />);

    expect((await screen.findAllByText("Karta 1 z 2")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Pokaż odpowiedź" }));
    await user.click(screen.getByRole("button", { name: "Dobrze · za 3 dni" }));

    expect((await screen.findAllByText("Karta 2 z 2")).length).toBeGreaterThan(0);
    expect(screen.getByText("Pytanie b")).toBeTruthy();
  });

  it("does not grade the card when Space is pressed again after the reveal", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(jsonResponse({ cards: [card("a"), card("b")] }), jsonResponse({ id: "a" }));
    render(<ReviewSession />);

    await user.click(await screen.findByRole("button", { name: "Pokaż odpowiedź" }));
    await screen.findByRole("button", { name: "Znowu · za 1 min" });
    await user.keyboard(" ");

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
    expect(screen.getByText("Pytanie a")).toBeTruthy();
  });

  it("absorbs a 409 conflict without surfacing an error", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse({ cards: [card("a"), card("b")] }),
      jsonResponse({ error: "Ta fiszka została już oceniona." }, 409),
    );
    render(<ReviewSession />);

    await user.click(await screen.findByRole("button", { name: "Pokaż odpowiedź" }));
    await user.click(screen.getByRole("button", { name: "Dobrze · za 3 dni" }));

    expect(await screen.findByText("Pytanie b")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces a failed grade and retries the last action", async () => {
    const user = userEvent.setup();
    stubFetch(
      jsonResponse({ cards: [card("a")] }),
      jsonResponse({ error: "Nie udało się zapisać oceny." }, 500),
      jsonResponse({ id: "a" }),
      jsonResponse({ cards: [] }),
    );
    render(<ReviewSession />);

    await user.click(await screen.findByRole("button", { name: "Pokaż odpowiedź" }));
    await user.click(screen.getByRole("button", { name: "Dobrze · za 3 dni" }));

    expect(await screen.findByText("Nie udało się zapisać oceny.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByText("To na dziś wszystko — powtórzono 1 fiszek.")).toBeTruthy();
  });
});
