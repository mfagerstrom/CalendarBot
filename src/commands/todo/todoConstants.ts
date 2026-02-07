export const TODO_LABELS = [
  "New Feature",
  "Improvement",
  "Bug",
  "Blocked",
  "refactor",
  "documentation",
  "duplicate",
  "invalid",
  "wontfix",
] as const;

export const LIST_STATES = ["open", "closed", "all"] as const;
export const LIST_SORTS = ["created", "updated"] as const;
export const LIST_DIRECTIONS = ["asc", "desc"] as const;

export type TodoLabel = (typeof TODO_LABELS)[number];
export type ListState = (typeof LIST_STATES)[number];
export type ListSort = (typeof LIST_SORTS)[number];
export type ListDirection = (typeof LIST_DIRECTIONS)[number];
