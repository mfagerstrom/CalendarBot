import oracledb from "oracledb";
import { DB_CONFIG } from "../../config/database.js";

// Ensure result sets are returned as objects instead of arrays
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
// Auto-commit is generally convenient for simple bot operations, but be careful with transactions
oracledb.autoCommit = true;

let pool: oracledb.Pool | null = null;

export const initDB = async (): Promise<oracledb.Pool> => {
  if (!pool) {
    try {
      console.log(`Connecting to Oracle DB at ${DB_CONFIG.connectionString} as ${DB_CONFIG.user}...`);
      pool = await oracledb.createPool({
        user: DB_CONFIG.user,
        password: DB_CONFIG.password,
        connectString: DB_CONFIG.connectionString,
      });
      console.log("Oracle DB Pool initialized");
    } catch (err) {
      console.error("Failed to initialize Oracle DB Pool", err);
      throw err;
    }
  }
  return pool;
};

export const getPool = (): oracledb.Pool => {
  if (!pool) {
    throw new Error("Database pool not initialized. Call initDB() first.");
  }
  return pool;
};

export const query = async <T = any>(
  sql: string,
  params: oracledb.BindParameters = []
): Promise<T[]> => {
  const connection = await getPool().getConnection();
  try {
    const result = await connection.execute<T>(sql, params);
    return (result.rows as T[]) || [];
  } catch (err) {
    console.error("Query Error:", err, "SQL:", sql);
    throw err;
  } finally {
    try {
      await connection.close();
    } catch {
      // ignore
    }
  }
};
