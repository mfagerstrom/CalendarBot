import type { IGithubIssue } from "../../services/githubIssuesService.js";
import {
  TODO_LABELS,
  type ListDirection,
  type ListSort,
  type ListState,
  type TodoLabel,
} from "./todoConstants.js";
import { sanitizeTodoText } from "./todoTextUtils.js";

const TODO_LABEL_CODE_MAP: Record<TodoLabel, string> = {
  "New Feature": "N",
  Improvement: "I",
  Bug: "B",
  Blocked: "K",
  refactor: "R",
  documentation: "D",
  duplicate: "U",
  invalid: "V",
  wontfix: "W",
};

const TODO_LABEL_CODE_TO_LABEL: Record<string, TodoLabel> = {
  N: "New Feature",
  I: "Improvement",
  B: "Bug",
  K: "Blocked",
  R: "refactor",
  D: "documentation",
  U: "duplicate",
  V: "invalid",
  W: "wontfix",
};

export type TodoListPayload = {
  page: number;
  perPage: number;
  state: ListState;
  stateFilters: ListState[];
  labels: TodoLabel[];
  excludeBlocked: boolean;
  query?: string;
  sort: ListSort;
  direction: ListDirection;
  isPublic: boolean;
};

export const clampNumber = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const encodeTodoLabels = (labels: TodoLabel[]): string => {
  return labels.map((label) => TODO_LABEL_CODE_MAP[label]).sort().join("");
};

const decodeTodoLabels = (value: string): TodoLabel[] => {
  if (!value) return [];
  return value
    .split("")
    .map((token) => TODO_LABEL_CODE_TO_LABEL[token])
    .filter((label): label is TodoLabel => Boolean(label));
};

const decodeTodoQuery = (encoded: string | undefined): string | undefined => {
  if (!encoded) return undefined;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return decoded.length ? decoded : undefined;
  } catch {
    return undefined;
  }
};

const encodeTodoQuery = (query: string | undefined, maxLength: number): string => {
  if (!query) return "";
  let trimmed = query;
  let encoded = Buffer.from(trimmed, "utf8").toString("base64url");
  if (encoded.length <= maxLength) return encoded;
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    trimmed = trimmed.slice(0, i + 1);
    encoded = Buffer.from(trimmed, "utf8").toString("base64url");
    if (encoded.length <= maxLength) return encoded;
  }
  return "";
};

export const buildTodoPayloadToken = (
  payload: Omit<TodoListPayload, "page">,
  maxLength: number,
): string => {
  const stateCode = payload.state === "open"
    ? "o"
    : payload.state === "closed"
      ? "c"
      : "a";
  const sortCode = payload.sort === "created" ? "c" : "u";
  const dirCode = payload.direction === "asc" ? "a" : "d";
  const labelToken = encodeTodoLabels(payload.labels);
  const base = [
    `s${stateCode}`,
    `o${sortCode}`,
    `d${dirCode}`,
    `p${payload.perPage}`,
    `l${labelToken}`,
    `b${payload.excludeBlocked ? "1" : "0"}`,
    `u${payload.isPublic ? "1" : "0"}`,
    "q",
  ].join(";");
  const maxQueryLength = Math.max(maxLength - base.length, 0);
  const queryToken = encodeTodoQuery(payload.query, maxQueryLength);
  return `${base}${queryToken}`;
};

export const parseTodoPayloadToken = (
  token: string,
): Omit<TodoListPayload, "page"> | null => {
  if (!token) return null;
  const parts = token.split(";");
  const map = new Map<string, string>();
  parts.forEach((part) => {
    if (!part) return;
    const key = part.slice(0, 1);
    const value = part.slice(1);
    map.set(key, value);
  });

  const stateCode = map.get("s");
  const sortCode = map.get("o");
  const dirCode = map.get("d");
  if (!stateCode || !sortCode || !dirCode) return null;
  const perPage = Number(map.get("p"));
  const labelToken = map.get("l") ?? "";
  const excludeBlocked = map.get("b") === "1";
  const isPublic = map.get("u") === "1";
  const query = decodeTodoQuery(map.get("q"));

  const state = stateCode === "o" ? "open" : stateCode === "c" ? "closed" : "all";
  const sort = sortCode === "c" ? "created" : "updated";
  const direction = dirCode === "a" ? "asc" : "desc";

  if (!Number.isFinite(perPage) || perPage <= 0) return null;

  const labels = decodeTodoLabels(labelToken);
  const stateFilters = normalizeStateFilters(state === "all" ? ["open", "closed"] : [state]);

  return {
    perPage,
    state,
    stateFilters,
    labels,
    excludeBlocked,
    query,
    sort,
    direction,
    isPublic,
  };
};

export const parseTodoLabels = (rawValue: string | undefined): {
  labels: TodoLabel[];
  invalid: string[];
} => {
  if (!rawValue) {
    return { labels: [], invalid: [] };
  }

  const tokens = rawValue
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const invalid: string[] = [];
  const labels: TodoLabel[] = [];

  tokens.forEach((token) => {
    const match = TODO_LABELS.find((label) => label.toLowerCase() === token.toLowerCase());
    if (match) {
      if (!labels.includes(match)) {
        labels.push(match);
      }
    } else {
      invalid.push(token);
    }
  });

  return { labels, invalid };
};

export const normalizeQuery = (rawValue: string | undefined): string | undefined => {
  if (!rawValue) return undefined;
  const sanitized = sanitizeTodoText(rawValue, false);
  return sanitized.length ? sanitized : undefined;
};

export const matchesIssueQuery = (issue: IGithubIssue, query: string): boolean => {
  const haystackParts = [
    issue.title,
    issue.body ?? "",
    issue.labels.join(" "),
    issue.author ?? "",
    issue.state,
    String(issue.number),
    issue.createdAt,
    issue.updatedAt,
    issue.closedAt ?? "",
  ];

  const haystack = haystackParts.join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
};

export const matchesIssueLabels = (issue: IGithubIssue, labels: TodoLabel[]): boolean => {
  if (!labels.length) return true;
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return labels.some((label) => issueLabels.includes(label.toLowerCase()));
};

export const isBlockedIssue = (issue: IGithubIssue): boolean => {
  const issueLabels = issue.labels.map((label) => label.toLowerCase());
  return issueLabels.includes("blocked");
};

export const normalizeStateFilters = (filters: ListState[]): ListState[] => {
  const normalized = filters.filter((state) => state === "open" || state === "closed");
  if (!normalized.length) {
    return ["open"];
  }
  return Array.from(new Set(normalized));
};

export const toIssueState = (filters: ListState[]): ListState => {
  const normalized = normalizeStateFilters(filters);
  if (normalized.length > 1) return "all";
  return normalized[0] ?? "open";
};
