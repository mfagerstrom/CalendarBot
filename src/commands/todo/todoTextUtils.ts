import { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, TextDisplayBuilder } from "@discordjs/builders";
import type { IGithubIssue, IGithubIssueComment } from "../../services/githubIssuesService.js";

export const MAX_ISSUE_BODY = 4000;
export const MAX_COMMENT_PREVIEW_LENGTH = 500;
export const MAX_TODO_IMAGES_PER_VIEW = 10;
export const MAX_TEXT_DISPLAY_CONTENT = 4000;
export const MAX_COMPONENT_DISPLAYABLE_TEXT_SIZE = 4000;

/* eslint-disable no-control-regex */
const CONTROL_CHAR_REGEX = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000D\\u000E-\\u001F\\u007F-\\u009F]",
  "g",
);
/* eslint-enable no-control-regex */

type SanitizeOptions = {
  maxLength?: number;
  preserveNewlines?: boolean;
  allowPattern?: RegExp;
  allowUnderscore?: boolean;
  blockSql?: boolean;
  blockSqlKeywords?: boolean;
};

export const sanitizeUserInput = (value: string, options?: SanitizeOptions): string => {
  const opts = {
    maxLength: options?.maxLength,
    preserveNewlines: options?.preserveNewlines ?? true,
    allowPattern: options?.allowPattern,
    allowUnderscore: options?.allowUnderscore ?? false,
    blockSql: options?.blockSql ?? true,
    blockSqlKeywords: options?.blockSqlKeywords ?? false,
  };

  let sanitized = value ?? "";
  const boldPlaceholder = "BOLDMARKER";
  const spoilerPlaceholder = "SPOILERMARKER";
  const starPlaceholder = "STARMARKER";
  try {
    sanitized = sanitized.normalize("NFKC");
  } catch {
    // ignore normalization errors
  }

  sanitized = sanitized.replace(/\r\n/g, "\n");
  sanitized = sanitized.replace(/\*\*/g, boldPlaceholder);
  sanitized = sanitized.replace(/\|\|/g, spoilerPlaceholder);
  sanitized = sanitized.replace(/\*/g, starPlaceholder);
  sanitized = sanitized.replace(CONTROL_CHAR_REGEX, "");
  sanitized = sanitized.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");
  sanitized = sanitized.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  sanitized = sanitized.replace(/<[^>]+>/g, "");
  sanitized = sanitized.replace(/```[\s\S]*?```/g, "");
  sanitized = sanitized.replace(/`[^`]*`/g, "");
  sanitized = sanitized.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  sanitized = sanitized.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s{0,3}#+\s?/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s*>\s?/g, "$1");
  sanitized = sanitized.replace(/(^|\n)\s*[-*+]\s+/g, "$1");
  sanitized = sanitized.replace(opts.allowUnderscore ? /[*~]/g : /[*_~]/g, "");
  sanitized = sanitized.replace(/<@!?(\d+)>/g, "");
  sanitized = sanitized.replace(/<@&(\d+)>/g, "");
  sanitized = sanitized.replace(/<#(\d+)>/g, "");
  sanitized = sanitized.replace(/@(everyone|here)/gi, "");

  if (opts.blockSql) {
    sanitized = sanitized.replace(/--/g, "");
    sanitized = sanitized.replace(/\/\*/g, "");
    sanitized = sanitized.replace(/\*\//g, "");
    sanitized = sanitized.replace(/;/g, "");
  }
  if (opts.blockSqlKeywords) {
    sanitized = sanitized.replace(
      /\b(select|insert|update|delete|drop|alter|create|truncate|exec|union|merge)\b/gi,
      "",
    );
  }

  if (opts.allowPattern) {
    const pattern = new RegExp(opts.allowPattern.source, opts.allowPattern.flags.replace("g", ""));
    sanitized = sanitized.split("").filter((ch) => pattern.test(ch)).join("");
  }

  if (opts.preserveNewlines) {
    sanitized = sanitized
      .split("\n")
      .map((line) => line.trim().replace(/[ \t]+/g, " "))
      .join("\n");
    sanitized = sanitized.replace(/\n{3,}/g, "\n\n");
  } else {
    sanitized = sanitized.replace(/\s+/g, " ");
  }

  sanitized = sanitized.replace(new RegExp(boldPlaceholder, "g"), "**");
  sanitized = sanitized.replace(new RegExp(spoilerPlaceholder, "g"), "||");
  sanitized = sanitized.replace(new RegExp(starPlaceholder, "g"), "*");

  sanitized = sanitized.trim();
  if (opts.maxLength && sanitized.length > opts.maxLength) {
    sanitized = sanitized.slice(0, opts.maxLength);
  }

  return sanitized.trim();
};

export const sanitizeTodoText = (value: string, preserveNewlines: boolean): string => {
  return sanitizeUserInput(value, { preserveNewlines, allowUnderscore: true });
};

export const sanitizeTodoRichText = (value: string): string => {
  return (value ?? "").replace(/\r\n/g, "\n");
};

export const formatDiscordTimestamp = (value: string | null | undefined): string => {
  if (!value) return "Unknown";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return "Unknown";
  const adjustedMs = ms + 5 * 60 * 60 * 1000;
  return `<t:${Math.floor(adjustedMs / 1000)}:f>`;
};

export const formatIssueLink = (issue: IGithubIssue): string => {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const linkText = `#${issue.number}: ${issue.title}`;
  if (issue.htmlUrl) {
    return `[${linkText}](${issue.htmlUrl})${labelText}`;
  }
  return `${linkText}${labelText}`;
};

export const formatIssueTitle = (issue: IGithubIssue): string => {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  return `#${issue.number}: ${issue.title}${labelText}`;
};

export const formatIssueSelectLabel = (issue: IGithubIssue): string => {
  const labelText = issue.labels.length ? ` [${issue.labels.join(", ")}]` : "";
  const text = `#${issue.number} ${issue.title}${labelText}`;
  if (text.length <= 100) return text;
  return `${text.slice(0, 97)}...`;
};

const extractImageUrlsFromHtml = (text: string): string[] => {
  const urls: string[] = [];
  const imageTagPattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null = imageTagPattern.exec(text);
  while (match) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    const decoded = raw.replace(/&amp;/gi, "&").trim();
    try {
      const parsed = new URL(decoded);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(parsed.toString());
      }
    } catch {
      // ignore invalid image URLs
    }
    match = imageTagPattern.exec(text);
  }
  return urls;
};

const extractImageUrlsFromMarkdown = (text: string): string[] => {
  const urls: string[] = [];
  const markdownPattern = /!\[[^\]]*]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/gi;
  let match: RegExpExecArray | null = markdownPattern.exec(text);
  while (match) {
    const value = match[1] ?? "";
    const trimmed = value.split(" ")[0]?.trim() ?? "";
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        urls.push(parsed.toString());
      }
    } catch {
      // ignore invalid image URLs
    }
    match = markdownPattern.exec(text);
  }
  return urls;
};

export const extractTodoImageUrls = (text: string): string[] => {
  const unique = new Set<string>();
  [...extractImageUrlsFromHtml(text), ...extractImageUrlsFromMarkdown(text)]
    .forEach((url) => unique.add(url));
  return Array.from(unique);
};

const stripInlineImagesForText = (value: string): string => {
  return value
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[[^\]]*]\((https?:\/\/[^)\s]+(?:\s+"[^"]*")?)\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const renderTodoContent = (rawValue: string, maxTextLength: number): {
  text: string;
  imageUrls: string[];
} => {
  const imageUrls = extractTodoImageUrls(rawValue);
  const plainText = sanitizeTodoRichText(stripInlineImagesForText(rawValue))
    .slice(0, maxTextLength);
  return {
    text: plainText,
    imageUrls,
  };
};

export const clampTextDisplayContent = (value: string): string => {
  if (value.length <= MAX_TEXT_DISPLAY_CONTENT) {
    return value;
  }
  return `${value.slice(0, MAX_TEXT_DISPLAY_CONTENT - 3)}...`;
};

export const trimToBudget = (value: string, maxLength: number): string => {
  if (maxLength <= 0) return "";
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
};

export const addTextDisplayWithBudget = (
  container: ContainerBuilder,
  budget: { remaining: number },
  content: string,
): void => {
  if (budget.remaining <= 0) {
    return;
  }
  const normalized = clampTextDisplayContent(content);
  const clipped = trimToBudget(normalized, budget.remaining);
  if (!clipped.length) {
    return;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(clipped));
  budget.remaining -= clipped.length;
};

export const buildIssueCommentsDisplay = (
  comments: IGithubIssueComment[],
): { text: string; imageUrls: string[] } => {
  if (!comments.length) {
    return { text: "", imageUrls: [] };
  }

  const lines: string[] = ["**Comments:**"];
  const imageUrls: string[] = [];
  comments.forEach((comment) => {
    const author = comment.author ?? "Unknown";
    const createdAt = formatDiscordTimestamp(comment.createdAt);
    const rendered = renderTodoContent(comment.body, MAX_COMMENT_PREVIEW_LENGTH);
    imageUrls.push(...rendered.imageUrls);
    lines.push(`**${author}** ${createdAt}`);
    if (rendered.text) {
      lines.push(rendered.text);
    } else if (rendered.imageUrls.length) {
      lines.push("*Image-only comment.*");
    } else {
      lines.push("*No comment content.*");
    }
  });

  return {
    text: lines.join("\n"),
    imageUrls,
  };
};

export const addIssueImagesToContainer = (
  container: ContainerBuilder,
  imageUrls: string[],
  budget?: { remaining: number },
): void => {
  const uniqueImages = Array.from(new Set(imageUrls)).slice(0, MAX_TODO_IMAGES_PER_VIEW);
  if (!uniqueImages.length) return;

  const galleryItems = uniqueImages.map((url, index) =>
    new MediaGalleryItemBuilder()
      .setURL(url)
      .setDescription(`Issue image ${index + 1}`),
  );
  if (budget) {
    addTextDisplayWithBudget(container, budget, "### Images");
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("### Images"),
    );
  }
  container.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(galleryItems),
  );
};
