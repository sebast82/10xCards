import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";

export interface StubResult {
  data?: unknown;
  error?: unknown;
  count?: number;
}

export interface RecordedQuery {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  payload?: Record<string, unknown>;
  filters: [string, unknown][];
  order?: { column: string; ascending: boolean };
  limit?: number;
  range?: [number, number];
}

export interface RecordedRpc {
  name: string;
  args: unknown;
}

class StubQuery {
  constructor(
    private readonly recorded: RecordedQuery,
    private readonly result: StubResult,
  ) {}

  select(): this {
    return this;
  }

  insert(payload: Record<string, unknown>): this {
    this.recorded.operation = "insert";
    this.recorded.payload = payload;
    return this;
  }

  update(payload: Record<string, unknown>): this {
    this.recorded.operation = "update";
    this.recorded.payload = payload;
    return this;
  }

  delete(): this {
    this.recorded.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.recorded.filters.push([column, value]);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.recorded.filters.push([column, value]);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.recorded.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.recorded.order = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.recorded.limit = count;
    return this;
  }

  range(from: number, to: number): this {
    this.recorded.range = [from, to];
    return this;
  }

  single(): Promise<StubResult> {
    return Promise.resolve(this.result);
  }

  maybeSingle(): Promise<StubResult> {
    return Promise.resolve(this.result);
  }

  // Domyka `await` na łańcuchu bez terminatora, np. `update(...).eq(...)`.
  then<T>(onFulfilled: (value: StubResult) => T): Promise<T> {
    return Promise.resolve(this.result).then(onFulfilled);
  }
}

/** Atrapa klienta Supabase oddająca kolejne `results` w kolejności wywołań `from()`. */
export class SupabaseStub {
  readonly queries: RecordedQuery[] = [];
  readonly rpcCalls: RecordedRpc[] = [];

  private index = 0;

  constructor(private readonly results: StubResult[]) {}

  from(table: string): StubQuery {
    const recorded: RecordedQuery = { table, operation: "select", filters: [] };
    this.queries.push(recorded);
    return new StubQuery(recorded, this.results[this.index++] ?? { data: null, error: null });
  }

  rpc(name: string, args: unknown): Promise<StubResult> {
    this.rpcCalls.push({ name, args });
    return Promise.resolve(this.results[this.index++] ?? { data: null, error: null });
  }

  asClient(): SupabaseClient<Database> {
    return this as unknown as SupabaseClient<Database>;
  }
}
