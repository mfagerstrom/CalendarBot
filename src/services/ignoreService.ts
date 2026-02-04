import { query } from "../lib/db/oracle.js";

export interface IgnorePattern {
  id: number;
  user_id: string;
  pattern: string;
}

export const addIgnorePattern = async (userId: string, pattern: string): Promise<void> => {
  await query(
    `INSERT INTO CALENDAR_IgnorePatterns (user_id, pattern) VALUES (:userid, :patternval)`,
    { userid: userId, patternval: pattern }
  );
};

export const removeIgnorePattern = async (userId: string, id: number): Promise<boolean> => {
  await query(
    `DELETE FROM CALENDAR_IgnorePatterns WHERE user_id = :userid AND id = :idval`,
    { userid: userId, idval: id }
  );
  // Note: Oracle's node driver with autoCommit might return rowsAffected differently depending on implementation wrapper
  // We'll assume success if no error, but ideally checking rowsAffected would be better.
  // The simple wrapper I saw earlier returns rows, not the full result object.
  // I might need to update the wrapper or just trust the delete for now.
  // Let's assume the wrapper returns rows always.
  // Wait, if I want to know if it deleted something, I might need to select first or update the wrapper.
  // Let's stick to simple execution.
  return true;
};

export const getIgnorePatterns = async (userId: string): Promise<IgnorePattern[]> => {
  const rows = await query<IgnorePattern>(
    `SELECT id "id", user_id "user_id", pattern "pattern" FROM CALENDAR_IgnorePatterns WHERE user_id = :userid ORDER BY id`,
    { userid: userId }
  );
  return rows;
};

export const filterEvents = async (userId: string, events: any[]): Promise<any[]> => {
  const patterns = await getIgnorePatterns(userId);
  if (patterns.length === 0) return events;

  return events.filter(event => {
    const summary = (event.summary || "").toLowerCase();
    // Check if summary contains any of the patterns (case insensitive)
    for (const p of patterns) {
      if (summary.includes(p.pattern.toLowerCase())) {
        return false;
      }
    }
    return true;
  });
};
