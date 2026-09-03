// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import GenerateView from "./GenerateView";

// Komunikaty serwera pochodzą z drabiny S-02 / `ERROR_MESSAGES` w client.ts (tekst napisany przed kodem),
// nie z kształtu GenerateView.tsx. Komponent renderuje `payload.error` dosłownie — te stringi SĄ kontraktem
// rozróżnialności po stronie UI ([GenerateView.tsx:109-113] nigdy nie czyta `response.status`).
const TIMEOUT_MESSAGE = "Model nie odpowiedział na czas. Spróbuj ponownie.";
const RATE_LIMITED_MESSAGE = "Dostawca modelu chwilowo ogranicza liczbę żądań. Odczekaj chwilę i spróbuj ponownie.";

// Stałe UI zacytowane z GenerateView.tsx — jedyny dozwolony lekki odnośnik do modułu testowanego.
const FALLBACK_ERROR = "Coś poszło nie tak. Spróbuj ponownie.";
const OFFLINE_ERROR = "Nie udało się połączyć z serwerem. Spróbuj ponownie.";

// Sentinel ryzyka #5 — jedyny marker w tym pliku; nie może pojawić się nigdzie poza polem wejścia.
const SENTINEL = "SEKRET-";
const SOURCE_TEXT = `${SENTINEL}${"x".repeat(300)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// jsdom `DOMException` nie dziedziczy po `Error`, więc rozłączna ścieżka odrzucenia (nie sniffing typu).
function stubFetchRejection(error: unknown) {
  const fetchMock = vi.fn().mockRejectedValue(error);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Wpisuje tekst (jednym `paste`, nie znak po znaku) i klika „Generuj fiszki".
async function generate(sourceText = SOURCE_TEXT) {
  const user = userEvent.setup();
  const textarea = screen.getByLabelText("Tekst źródłowy");
  await user.click(textarea);
  await user.paste(sourceText);
  await user.click(screen.getByRole("button", { name: "Generuj fiszki" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GenerateView — dokładny komunikat serwera dociera do DOM", () => {
  it("renderuje pełny tekst błędu i różni się między klasami awarii (dwie odpowiedzi → dwa teksty)", async () => {
    // Dowód rozróżnialności: te same 502, różne ciała → różny, dokładny tekst w DOM. `getByText` na pełnym
    // stringu, nie `queryByRole("alert")` — asercja przeszłaby po zwinięciu wszystkich awarii do jednego komunikatu.
    stubFetch(jsonResponse({ error: TIMEOUT_MESSAGE }, 502));
    const first = render(<GenerateView />);
    await generate();

    expect(await screen.findByText(TIMEOUT_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(RATE_LIMITED_MESSAGE)).toBeNull();

    first.unmount();
    vi.unstubAllGlobals();

    stubFetch(jsonResponse({ error: RATE_LIMITED_MESSAGE }, 502));
    render(<GenerateView />);
    await generate();

    expect(await screen.findByText(RATE_LIMITED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(TIMEOUT_MESSAGE)).toBeNull();
  });

  it("test pęka, gdy zmieni się komunikat serwera — asercja jest na tekst, nie na obecność alertu", async () => {
    // Świadomie: gdyby serwer zaczął zwracać inny string, `findByText(TIMEOUT_MESSAGE)` rzuci.
    stubFetch(jsonResponse({ error: TIMEOUT_MESSAGE }, 502));
    render(<GenerateView />);
    await generate();

    expect(await screen.findByText(TIMEOUT_MESSAGE)).toBeTruthy();
  });
});

describe("GenerateView — degradacja do fallbacku, ale nadal błąd (nie pusty ekran)", () => {
  it('ciało bez pola `error` oraz `error: ""` → FALLBACK_ERROR w DOM', async () => {
    for (const body of [{}, { error: "" }]) {
      stubFetch(jsonResponse(body, 502));
      const view = render(<GenerateView />);
      await generate();

      expect(await screen.findByText(FALLBACK_ERROR)).toBeTruthy();

      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it("200 o złym kształcie → FALLBACK_ERROR, brak ekranu review (zły kształt nie zamienia się w pustkę)", async () => {
    stubFetch(jsonResponse({ proposals: "nie-tablica" }, 200));
    render(<GenerateView />);
    await generate();

    expect(await screen.findByText(FALLBACK_ERROR)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Propozycje" })).toBeNull();
  });
});

describe("GenerateView — tripwire'y (przypięcie dzisiejszego zachowania, NIE kontrakt docelowy)", () => {
  it("200 z `proposals: []` renderuje się dziś jako ekran review z zerem kart i bez błędu", async () => {
    // PRZYPIĘCIE, nie kontrakt docelowy: dziś pusta tablica przechodzi przez `parseGeneration` i daje
    // nagłówek „Propozycje" + „zapisano 0 z 0", bez błędu i bez pustego stanu. Regresja serwera
    // przepuszczająca pustą tablicę odtworzy scenariusz ryzyka #1 — ten test wtedy pęknie. Obrona
    // klienta = Faza 2+ (patrz plan §What We're NOT Doing).
    stubFetch(jsonResponse({ generationId: "gen-1", privacyMode: "zdr", proposals: [] }, 200));
    render(<GenerateView />);
    await generate();

    expect(await screen.findByRole("heading", { name: "Propozycje" })).toBeTruthy();
    expect(screen.getByText(/zapisano 0 z 0/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("klientowy timeout (`AbortError`) daje ten sam komunikat co offline — timeout etykietowany jako awaria sieci", async () => {
    // PRZYPIĘCIE, nie kontrakt docelowy: `AbortSignal.timeout` po stronie klienta wpada w `catch`
    // razem z odrzuceniem offline, więc użytkownik nie odróżni „za wolno" od „brak sieci".
    stubFetchRejection(new DOMException("", "AbortError"));
    render(<GenerateView />);
    await generate();

    expect(await screen.findByText(OFFLINE_ERROR)).toBeTruthy();
  });
});

describe("GenerateView — ostrzeżenie o trybie standard", () => {
  const proposal = { front: "Pytanie?", back: "Odpowiedź." };

  it("privacyMode: standard → zdanie ostrzeżenia w DOM", async () => {
    stubFetch(jsonResponse({ generationId: "gen-1", privacyMode: "standard", proposals: [proposal] }, 200));
    render(<GenerateView />);
    await generate();

    await screen.findByRole("heading", { name: "Propozycje" });
    expect(screen.getByText(/bez trybu Zero Data Retention/)).toBeTruthy();
  });

  it("privacyMode śmieciowy → koercja do zdr → BRAK ostrzeżenia (asercja bez przepisywania ternary)", async () => {
    stubFetch(jsonResponse({ generationId: "gen-1", privacyMode: "smiec", proposals: [proposal] }, 200));
    render(<GenerateView />);
    await generate();

    await screen.findByRole("heading", { name: "Propozycje" });
    expect(screen.queryByText(/bez trybu Zero Data Retention/)).toBeNull();
  });
});

describe("GenerateView — brak wycieku tekstu źródłowego (ryzyko #5)", () => {
  it("po błędzie 502 sentinel nie trafia do Alertu ani nigdzie poza pole wejścia", async () => {
    stubFetch(jsonResponse({ error: TIMEOUT_MESSAGE }, 502));
    render(<GenerateView />);
    await generate();

    await screen.findByText(TIMEOUT_MESSAGE);
    // Sentinel wolno żyć wyłącznie w polu wejścia (`<textarea value>`). Nie w Alercie i nie w żadnym
    // innym elemencie drzewa — jsdom odbija wartość textarea do `textContent`, więc porównujemy
    // `document.body.textContent` z wykluczeniem treści pól tekstowych.
    expect(screen.getByLabelText<HTMLTextAreaElement>("Tekst źródłowy").value).toContain(SENTINEL);
    expect(screen.getByRole("alert").textContent).not.toContain(SENTINEL);

    const inputText = screen.getAllByRole<HTMLTextAreaElement>("textbox").map((el) => el.value);
    let rendered = document.body.textContent;
    for (const value of inputText) rendered = rendered.replace(value, "");
    expect(rendered).not.toContain(SENTINEL);
  });
});
