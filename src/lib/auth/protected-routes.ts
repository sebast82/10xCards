// Prefiksy tras stron egzekwowanych przez bramkę sesji w `src/middleware.ts`.
// Wydzielone z middleware, żeby bramka i jej test dzieliły jedno źródło prawdy.
// mirror of docs/reference/contract-surfaces.md rule #4 ("Ochrona" == chroniona page rows); update both together.
export const PROTECTED_ROUTES = ["/dashboard", "/generate", "/deck", "/review"] as const;
