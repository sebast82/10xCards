import type { ToolSet } from 'ai';

// The reviewer is intentionally tool-less for now, so the agent loop finishes in a single step.
// Adding a tool? Set an explicit `stopWhen` in `createReviewerAgent` — the default allows 20 paid steps. Also
// sum the cost over `result.steps` in `runReview`: it returns only the final step's `providerMetadata`, so the
// eval provider's `cost` (and its `numRequests: 1`) would cover one step while `usage` covers all of them.
export const reviewerTools = {} satisfies ToolSet;
