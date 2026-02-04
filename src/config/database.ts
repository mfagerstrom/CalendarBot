export const DB_CONFIG = {
  user: process.env.ORACLE_USER || "system",
  password: process.env.ORACLE_PASSWORD || "password",
  connectionString: process.env.ORACLE_CONNECT_STRING || "localhost:1521/XEPDB1",
};
