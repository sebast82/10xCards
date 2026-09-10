import type { ToolSet } from 'ai';

// The reviewer is intentionally tool-less for now, so the agent loop finishes in a single step.
export const reviewerTools = {} satisfies ToolSet;
