# Review fixes — tool-loop-agent

Queued from `reviews/impl-review.md`. These are deliberately out of scope for this change. Carry them into the
plan for the promptfoo change, the first real consumer of `reviewCode`.

## F3 — `reviewCode` seam: call bounds and types

Nothing imports the library yet, and each item below can be added without breaking callers.

- [ ] `reviewCode` options accept `abortSignal?: AbortSignal` (and/or a timeout) and pass it to `agent.generate()`
      (`packages/code-reviewer/src/agent/reviewer.ts:31-33`). First check whether promptfoo's per-test timeout
      cancels the underlying request.
- [ ] Choose an input-size cap from eval data. Throw a readable `Error` before any network call.
- [ ] Set `maxRetries` explicitly. The SDK default of 2 means up to 3 paid attempts per failing review.
- [ ] If the provider imports `dist/`, set `declaration: true` in `tsconfig.json` and add
      `"types": "dist/index.d.ts"` to `package.json`. Not needed if it imports `src` through tsx.
- [ ] The provider logs `error.message` only. `APICallError.requestBodyValues` carries the full reviewed code.
