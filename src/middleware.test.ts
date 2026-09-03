import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROTECTED_ROUTES } from "@/lib/auth/protected-routes";

// `astro:middleware` to moduł wirtualny — pod Vitestem nie istnieje. `defineMiddleware` jest tożsamością.
vi.mock("astro:middleware", () => ({ defineMiddleware: (fn: unknown) => fn }));

// `SupabaseStub` nie modeluje `.auth`, a `@/lib/supabase` importuje `astro:env/server`.
// Mockujemy cały moduł: `createClient` oddaje klienta z samym `auth.getUser()` albo `null` (misconfig).
// `getUser()` waliduje token z serwerem auth, więc "brak sesji" / "wygasła" / "sfałszowana" kolapsują do `user: null`.
interface AuthState {
  client: "configured" | "missing";
  user: { id: string } | null;
}

const authState = vi.hoisted<AuthState>(() => ({ client: "configured", user: null }));

vi.mock("@/lib/supabase", () => ({
  createClient: () =>
    authState.client === "missing"
      ? null
      : { auth: { getUser: () => Promise.resolve({ data: { user: authState.user } }) } },
}));

import { onRequest } from "./middleware";

const USER = { id: "22222222-2222-4222-8222-222222222222" };

function context(path: string) {
  const url = new URL(path, "http://localhost");
  return {
    url,
    request: new Request(url),
    cookies: {},
    locals: {} as { user: unknown; supabase: unknown },
    redirect: (location: string) => new Response(null, { status: 302, headers: { Location: location } }),
  };
}

const next = () => new Response("ok");

async function run(path: string) {
  const ctx = context(path);
  const response = (await onRequest(ctx as never, next as never)) as Response;
  return { ctx, response };
}

const PUBLIC_ROUTES = ["/", "/auth/signin", "/auth/signup", "/auth/confirm-email", "/api/auth/signin"];

beforeEach(() => {
  authState.client = "configured";
  authState.user = null;
});

describe("session gate — middleware", () => {
  it("pins the protected route set (mirror of contract-surfaces.md rule #4 — update both together)", () => {
    expect(PROTECTED_ROUTES).toEqual(["/dashboard", "/generate", "/deck", "/review"]);
  });

  it("lets an authenticated request through a protected route and records the user", async () => {
    authState.user = USER;

    const { ctx, response } = await run("/deck");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
    expect(ctx.locals.user).toEqual(USER);
  });

  it.each(PROTECTED_ROUTES)("redirects an unauthenticated request for %s to /auth/signin", async (route) => {
    const { ctx, response } = await run(route);

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/signin");
    expect(ctx.locals.user).toBeNull();
  });

  it("treats an invalid/expired session identically to an absent one (getUser collapses all three to null)", async () => {
    // No dedicated 'expired' branch exists: a cookie whose token is expired/forged/revoked
    // makes `getUser()` resolve `{ data: { user: null } }`, same as no cookie at all (O4-3 / O4-4).
    authState.user = null;

    const { response } = await run("/dashboard");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/signin");
  });

  it.each(PUBLIC_ROUTES)("lets an unauthenticated request through the public route %s", async (route) => {
    const { response } = await run(route);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("does not gate /api/** — domain endpoints self-deny (contract-surfaces.md rule, not middleware)", async () => {
    const { response } = await run("/api/flashcards");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
  });

  it("redirects on a protected route when the Supabase client is missing (misconfig → user null)", async () => {
    authState.client = "missing";

    const { ctx, response } = await run("/review");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/auth/signin");
    expect(ctx.locals.user).toBeNull();
    expect(ctx.locals.supabase).toBeNull();
  });

  it("lets a public route through even when the Supabase client is missing", async () => {
    authState.client = "missing";

    const { response } = await run("/");

    expect(response.status).toBe(200);
  });
});
