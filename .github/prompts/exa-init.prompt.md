---
mode: agent
description: Skonfiguruj serwer Exa MCP (web search + fetch) dla tego workspace'a i zweryfikuj połączenie.
---

# Exa MCP — inicjalizacja

> **Źródło prawdy:** https://docs.exa.ai/reference/exa-mcp
> Jeśli cokolwiek poniżej wygląda na nieaktualne lub sprzeczne z rzeczywistym zachowaniem MCP — pobierz ten URL i zgłoś rozbieżność użytkownikowi.

## Kontekst

| Ustawienie | Wartość |
|---|---|
| Narzędzie | VS Code + GitHub Copilot |
| Integracja | MCP (transport HTTP) |
| Cel | Eksploracja rozwiązań spaced-repetition |

## Zadanie

1. Sprawdź, czy istnieje `.vscode/mcp.json`. Jeśli nie — utwórz go.
2. Upewnij się, że zawiera wpis serwera `exa`:

```json
{
  "servers": {
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa,web_search_advanced_exa,agent_run"
    }
  }
}
```

3. Nie nadpisuj istniejących serwerów — dopisz `exa` obok nich.
4. Poinstruuj użytkownika, żeby uruchomił serwer przyciskiem **Start** nad blokiem `"exa"` w `.vscode/mcp.json`.

## Uwagi

- **Autoryzacja:** OAuth, bez klucza API. Przy pierwszym połączeniu otwiera się przeglądarka z logowaniem do konta Exa.
- **Dostępne narzędzia:**
  - domyślnie włączone: `web_search_exa`, `web_fetch_exa`
  - opcjonalne (tylko przez parametr `tools=`): `web_search_advanced_exa` (pełne filtry Search API), `agent_run` (Exa Agent — multi-step research, list building, structured output; rozliczany per użycie, wymaga autoryzacji)
  - usuń parametr `tools=` z URL, żeby zostać przy domyślnym zestawie
- **Rate limity:** darmowy plan zwraca 429 po przekroczeniu limitu. Żeby go podnieść, dodaj własny klucz z [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys) jako nagłówek `x-api-key`. Nie wklejaj klucza wprost do `.vscode/mcp.json`, jeśli plik trafia do repo — użyj sekcji `"inputs"` z `"password": true`:

  ```json
  {
    "inputs": [
      { "id": "exa-api-key", "type": "promptString", "description": "Exa API key", "password": true }
    ],
    "servers": {
      "exa": {
        "type": "http",
        "url": "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa",
        "headers": { "x-api-key": "${input:exa-api-key}" }
      }
    }
  }
  ```

- **Troubleshooting:** jeśli narzędzia nie pojawiają się na liście 🔧 w czacie, zrestartuj serwer MCP (`MCP: List Servers` → `Restart`).

## Zasoby

- Docs: https://exa.ai/docs
- Dashboard: https://dashboard.exa.ai
- Status API: https://status.exa.ai
