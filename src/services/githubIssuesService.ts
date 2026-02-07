import axios from "axios";
import crypto from "crypto";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

const GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "";
const GITHUB_REPO_NAME = process.env.GITHUB_REPO_NAME ?? "";
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "";
const GITHUB_APP_INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID ?? "";
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY ?? "";

type GithubIssueState = "open" | "closed";

export interface IGithubIssue {
  number: number;
  title: string;
  body: string | null;
  state: GithubIssueState;
  labels: string[];
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  author: string | null;
  assignee: string | null;
}

export interface IGithubIssueComment {
  id: number;
  author: string | null;
  body: string;
  createdAt: string;
}

type IssueListParams = {
  state?: "open" | "closed" | "all";
  labels?: string[];
  sort?: "created" | "updated";
  direction?: "asc" | "desc";
  page?: number;
  perPage?: number;
};

type IssueUpdateInput = {
  title?: string;
  body?: string | null;
};

type IssueCreateInput = {
  title: string;
  body?: string | null;
  labels?: string[];
  assignees?: string[];
};

let cachedToken: { token: string; expiresAt: number } | null = null;

const normalizePrivateKey = (rawKey: string): string => {
  const trimmed = rawKey.trim();
  if (!trimmed) return trimmed;

  const headerMatch = trimmed.match(/-----BEGIN [^-]+-----/);
  const footerMatch = trimmed.match(/-----END [^-]+-----/);
  if (!headerMatch || !footerMatch) {
    return trimmed;
  }

  const header = headerMatch[0];
  const footer = footerMatch[0];
  const body = trimmed
    .replace(header, "")
    .replace(footer, "")
    .replace(/\s+/g, "");

  const wrappedBody = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `${header}\n${wrappedBody}\n${footer}`;
};

const requireGithubConfig = (): void => {
  const missing = [
    GITHUB_REPO_OWNER ? null : "GITHUB_REPO_OWNER",
    GITHUB_REPO_NAME ? null : "GITHUB_REPO_NAME",
    GITHUB_APP_ID ? null : "GITHUB_APP_ID",
    GITHUB_APP_INSTALLATION_ID ? null : "GITHUB_APP_INSTALLATION_ID",
    GITHUB_APP_PRIVATE_KEY ? null : "GITHUB_APP_PRIVATE_KEY",
  ].filter((value): value is string => Boolean(value));

  if (missing.length) {
    throw new Error(`Missing GitHub App config: ${missing.join(", ")}`);
  }
};

const toBase64Url = (input: string | Buffer): string => {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
};

const buildAppJwt = (): string => {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: GITHUB_APP_ID,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const headerToken = toBase64Url(JSON.stringify(header));
  const payloadToken = toBase64Url(JSON.stringify(payload));
  const data = `${headerToken}.${payloadToken}`;
  const key = normalizePrivateKey(GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(data)
    .sign(key);
  return `${data}.${toBase64Url(signature)}`;
};

const getInstallationToken = async (): Promise<string> => {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.token;
  }

  requireGithubConfig();
  const jwt = buildAppJwt();
  const url = `${GITHUB_API_BASE}/app/installations/${GITHUB_APP_INSTALLATION_ID}/access_tokens`;
  const response = await axios.post(
    url,
    {},
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );

  const token = response.data?.token as string | undefined;
  const expiresAt = response.data?.expires_at as string | undefined;
  if (!token || !expiresAt) {
    throw new Error("Failed to acquire GitHub installation token.");
  }

  cachedToken = {
    token,
    expiresAt: Date.parse(expiresAt),
  };

  return token;
};

const githubRequest = async <T>(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  data?: unknown,
  params?: Record<string, unknown>,
): Promise<T> => {
  const token = await getInstallationToken();
  const response = await axios.request<T>({
    method,
    url: `${GITHUB_API_BASE}${path}`,
    data,
    params,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  return response.data;
};

const toIssue = (raw: any): IGithubIssue => {
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? null,
    state: raw.state === "closed" ? "closed" : "open",
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((label: any) => label?.name).filter(Boolean)
      : [],
    htmlUrl: raw.html_url ?? "",
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    closedAt: raw.closed_at ?? null,
    author: raw.user?.login ?? null,
    assignee: raw.assignee?.login ?? null,
  };
};

const toIssueComment = (raw: any): IGithubIssueComment => {
  return {
    id: raw.id ?? 0,
    author: raw.user?.login ?? null,
    body: raw.body ?? "",
    createdAt: raw.created_at ?? "",
  };
};

export const listAllIssues = async (params: IssueListParams): Promise<IGithubIssue[]> => {
  const perPage = 100;
  const allIssues: IGithubIssue[] = [];

  for (let page = 1; page <= 100; page += 1) {
    const response = await githubRequest<any[]>(
      "get",
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`,
      undefined,
      {
        state: params.state ?? "open",
        labels: params.labels?.join(",") || undefined,
        sort: params.sort ?? "updated",
        direction: params.direction ?? "desc",
        page,
        per_page: perPage,
      },
    );

    const pageIssues = (response ?? [])
      .filter((issue) => !issue.pull_request)
      .map((issue) => toIssue(issue));
    allIssues.push(...pageIssues);

    if (!response || response.length < perPage) {
      break;
    }
  }

  return allIssues;
};

export const listIssueComments = async (
  issueNumber: number,
): Promise<IGithubIssueComment[]> => {
  const response = await githubRequest<any[]>(
    "get",
    `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}/comments`,
  );
  return (response ?? []).map((comment) => toIssueComment(comment));
};

export const getIssue = async (issueNumber: number): Promise<IGithubIssue | null> => {
  try {
    const response = await githubRequest<any>(
      "get",
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
    );
    if (response?.pull_request) {
      return null;
    }
    return toIssue(response);
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
};

export const createIssue = async (input: IssueCreateInput): Promise<IGithubIssue> => {
  const assignees = input.assignees && input.assignees.length
    ? input.assignees
    : (GITHUB_REPO_OWNER ? [GITHUB_REPO_OWNER] : []);
  const response = await githubRequest<any>(
    "post",
    `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`,
    {
      title: input.title,
      body: input.body ?? null,
      labels: input.labels ?? [],
      assignees,
    },
  );
  return toIssue(response);
};

export const updateIssue = async (
  issueNumber: number,
  input: IssueUpdateInput,
): Promise<IGithubIssue | null> => {
  try {
    const response = await githubRequest<any>(
      "patch",
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
      {
        title: input.title,
        body: input.body,
      },
    );
    return toIssue(response);
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
};

export const setIssueLabels = async (
  issueNumber: number,
  labels: string[],
): Promise<IGithubIssue | null> => {
  try {
    const response = await githubRequest<any>(
      "patch",
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
      { labels },
    );
    return toIssue(response);
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
};

export const closeIssue = async (issueNumber: number): Promise<IGithubIssue | null> => {
  try {
    const response = await githubRequest<any>(
      "patch",
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
      { state: "closed" },
    );
    return toIssue(response);
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
};

export const reopenIssue = async (issueNumber: number): Promise<IGithubIssue | null> => {
  try {
    const response = await githubRequest<any>(
      "patch",
      `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
      { state: "open" },
    );
    return toIssue(response);
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
};

export const addComment = async (issueNumber: number, body: string): Promise<void> => {
  await githubRequest(
    "post",
    `/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}/comments`,
    { body },
  );
};

export const getRepoDisplayName = (): string => {
  return `${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;
};
