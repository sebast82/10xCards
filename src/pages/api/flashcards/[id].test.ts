import { describe, expect, it } from "vitest";

import { DELETE, PATCH } from "./[id]";
import { SupabaseStub } from "@/lib/test-support/supabase-stub";

const FLASHCARD_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function context({
  id = FLASHCARD_ID,
  user = { id: USER_ID },
  supabase = new SupabaseStub([]).asClient(),
  request = new Request(`http://localhost/api/flashcards/${id}`, { method: "DELETE" }),
}: {
  id?: string;
  user?: { id: string } | null;
  supabase?: ReturnType<SupabaseStub["asClient"]> | null;
  request?: Request;
} = {}) {
  return { locals: { user, supabase }, params: { id }, request } as never;
}

describe("flashcard item API", () => {
  it("updates valid trimmed card content", async () => {
    const supabase = new SupabaseStub([{ data: { id: FLASHCARD_ID }, error: null }]);
    const request = new Request(`http://localhost/api/flashcards/${FLASHCARD_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ front: "  Pytanie? ", back: " Odpowiedź.  " }),
    });

    const response = await PATCH(context({ supabase: supabase.asClient(), request }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: FLASHCARD_ID });
    expect(supabase.queries[0].payload).toEqual({ front: "Pytanie?", back: "Odpowiedź." });
  });

  it("deletes a valid card", async () => {
    const supabase = new SupabaseStub([
      { data: { generation_id: null }, error: null },
      { data: { id: FLASHCARD_ID }, error: null },
    ]);

    const response = await DELETE(context({ supabase: supabase.asClient() }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: FLASHCARD_ID });
  });

  it("rejects malformed IDs and patch bodies", async () => {
    const invalidId = await DELETE(context({ id: "not-a-uuid" }));
    const invalidBody = await PATCH(
      context({
        request: new Request(`http://localhost/api/flashcards/${FLASHCARD_ID}`, {
          method: "PATCH",
          body: JSON.stringify({ front: "", back: "Odpowiedź." }),
        }),
      }),
    );

    expect(invalidId.status).toBe(400);
    expect(invalidBody.status).toBe(400);
  });

  it("rejects unauthenticated and unavailable requests", async () => {
    const supabase = new SupabaseStub([]);
    const unauthenticated = await DELETE(context({ user: null, supabase: supabase.asClient() }));
    const unavailable = await DELETE(context({ supabase: null }));

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
    // O4-6: the handler denies before touching data — no query, no rpc on the unauthenticated path.
    expect(supabase.queries).toHaveLength(0);
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it("denies cross-account PATCH and DELETE without leaking the row", async () => {
    // Cross-account access is simulated as an RLS miss: the owner-scoped mutation matches 0 rows → { data: null }.
    // Contract-surface regression guard, not the isolation oracle — see supabase/tests/rls_flashcards.test.sql.
    const patch = await PATCH(
      context({
        supabase: new SupabaseStub([{ data: null, error: null }]).asClient(),
        request: new Request(`http://localhost/api/flashcards/${FLASHCARD_ID}`, {
          method: "PATCH",
          body: JSON.stringify({ front: "Cudza treść?", back: "Cudza odpowiedź." }),
        }),
      }),
    );
    const del = await DELETE(context({ supabase: new SupabaseStub([{ data: null, error: null }]).asClient() }));

    for (const response of [patch, del]) {
      expect(response.status).toBe(404);
      const body: unknown = await response.json();
      expect(body).toEqual({ error: "Nie znaleziono fiszki." });
      expect(Object.keys(body as Record<string, unknown>)).toEqual(["error"]); // no card fields (id/front/back) leak
    }
  });

  it("scopes PATCH and DELETE mutations to the owner", async () => {
    // Regression guard that scoping did not disappear — cross-account proof is pgTAP.
    const patchStub = new SupabaseStub([{ data: { id: FLASHCARD_ID }, error: null }]);
    await PATCH(
      context({
        supabase: patchStub.asClient(),
        request: new Request(`http://localhost/api/flashcards/${FLASHCARD_ID}`, {
          method: "PATCH",
          body: JSON.stringify({ front: "Pytanie?", back: "Odpowiedź." }),
        }),
      }),
    );
    expect(patchStub.queries[0].filters).toContainEqual(["user_id", USER_ID]);

    const deleteStub = new SupabaseStub([
      { data: { generation_id: null }, error: null },
      { data: { id: FLASHCARD_ID }, error: null },
    ]);
    await DELETE(context({ supabase: deleteStub.asClient() }));
    expect(deleteStub.queries[0].filters).toContainEqual(["user_id", USER_ID]);
    expect(deleteStub.queries[1].filters).toContainEqual(["user_id", USER_ID]);
  });

  it("maps inaccessible cards and persistence failures without exposing internals", async () => {
    const inaccessible = await PATCH(
      context({
        supabase: new SupabaseStub([{ data: null, error: null }]).asClient(),
        request: new Request(`http://localhost/api/flashcards/${FLASHCARD_ID}`, {
          method: "PATCH",
          body: JSON.stringify({ front: "Pytanie?", back: "Odpowiedź." }),
        }),
      }),
    );
    const failed = await DELETE(
      context({ supabase: new SupabaseStub([{ data: null, error: { message: "boom" } }]).asClient() }),
    );

    expect(inaccessible.status).toBe(404);
    await expect(inaccessible.json()).resolves.toEqual({ error: "Nie znaleziono fiszki." });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toEqual({ error: "Nie udało się zmienić fiszki. Spróbuj ponownie." });
  });
});
