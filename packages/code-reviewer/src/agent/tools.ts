import type { ToolSet } from 'ai';

// The reviewer is intentionally tool-less for now, so the agent loop finishes in a single step.
// Adding a tool? Set an explicit `stopWhen` in `createReviewerAgent` — the default allows 20 paid steps.
export const reviewerTools = {} satisfies ToolSet;
