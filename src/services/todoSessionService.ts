import { query } from "../lib/db/oracle.js";

export interface ITodoCreateSession {
  sessionId: string;
  userId: string;
  payloadToken: string;
  page: number;
  channelId: string;
  messageId: string;
  title: string;
  body: string;
  labels: string[];
}

const LABEL_SEPARATOR = ",";

const parseLabels = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split(LABEL_SEPARATOR)
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
};

const joinLabels = (labels: string[]): string => {
  return labels.map((label) => label.trim()).filter(Boolean).join(LABEL_SEPARATOR);
};

export const createTodoCreateSession = async (
  userId: string,
  payloadToken: string,
  page: number,
  channelId: string,
  messageId: string,
  title: string,
  body: string,
): Promise<string> => {
  const rows = await query<{ NEXTVAL: number }>(
    "SELECT CALENDAR_TODO_CREATE_SESSIONS_SEQ.NEXTVAL AS NEXTVAL FROM DUAL",
  );
  const sessionId = String(rows[0]?.NEXTVAL ?? "");
  if (!sessionId) {
    throw new Error("Unable to allocate todo create session.");
  }

  await query(
    `
      INSERT INTO CALENDAR_TodoCreateSessions (
        SESSION_ID,
        USER_ID,
        PAYLOAD_TOKEN,
        PAGE_NUMBER,
        CHANNEL_ID,
        MESSAGE_ID,
        TITLE,
        BODY,
        LABELS,
        CREATED_AT,
        UPDATED_AT
      )
      VALUES (
        :sessionId,
        :userId,
        :payloadToken,
        :pageNumber,
        :channelId,
        :messageId,
        :title,
        :body,
        :labels,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
    {
      sessionId,
      userId,
      payloadToken,
      pageNumber: page,
      channelId,
      messageId,
      title,
      body,
      labels: "",
    },
  );

  return sessionId;
};

export const getTodoCreateSession = async (
  sessionId: string,
): Promise<ITodoCreateSession | null> => {
  const rows = await query<any>(
    `
      SELECT
        SESSION_ID,
        USER_ID,
        PAYLOAD_TOKEN,
        PAGE_NUMBER,
        CHANNEL_ID,
        MESSAGE_ID,
        TITLE,
        BODY,
        LABELS
      FROM CALENDAR_TodoCreateSessions
      WHERE SESSION_ID = :sessionId
    `,
    { sessionId },
  );

  if (!rows.length) {
    return null;
  }

  const row = rows[0];
  return {
    sessionId: String(row.SESSION_ID),
    userId: String(row.USER_ID ?? ""),
    payloadToken: String(row.PAYLOAD_TOKEN ?? ""),
    page: Number(row.PAGE_NUMBER ?? 1),
    channelId: String(row.CHANNEL_ID ?? ""),
    messageId: String(row.MESSAGE_ID ?? ""),
    title: String(row.TITLE ?? ""),
    body: String(row.BODY ?? ""),
    labels: parseLabels(row.LABELS as string | null | undefined),
  };
};

export const updateTodoCreateSessionLabels = async (
  sessionId: string,
  labels: string[],
): Promise<void> => {
  await query(
    `
      UPDATE CALENDAR_TodoCreateSessions
      SET LABELS = :labels,
          UPDATED_AT = CURRENT_TIMESTAMP
      WHERE SESSION_ID = :sessionId
    `,
    {
      sessionId,
      labels: joinLabels(labels),
    },
  );
};

export const deleteTodoCreateSession = async (sessionId: string): Promise<void> => {
  await query(
    "DELETE FROM CALENDAR_TodoCreateSessions WHERE SESSION_ID = :sessionId",
    { sessionId },
  );
};
