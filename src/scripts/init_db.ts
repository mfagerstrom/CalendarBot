import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDB, getPool } from "../lib/db/oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const run = async () => {
    await initDB();
    const pool = getPool();

    const sqlPath = path.join(__dirname, "../../db/20260203_create_calendar_tables.sql");
    const sqlContent = fs.readFileSync(sqlPath, "utf-8");

    // Simple split by subclassing semicolon. 
    // WARN: This is brittle if SQL contains semicolons in strings, but for DDL it is usually fine.
    const statements = sqlContent
        .split(";")
        .map(s => s.trim())
        .filter(s => s.length > 0);

    const connection = await pool.getConnection();

    try {
        for (const sql of statements) {
            console.log(`Executing: ${sql.substring(0, 50)}...`);
            try {
                await connection.execute(sql);
                console.log("Success.");
            } catch (err: any) {
                if (err.message && err.message.includes("ORA-00955")) {
                    console.log("Table already exists (ORA-00955), skipping.");
                } else {
                    console.error("Error executing statement:", err);
                    throw err;
                }
            }
        }
        await connection.commit();
        console.log("All tables initialized.");
    } finally {
        await connection.close();
        await pool.close();
    }
};

run().catch(err => {
    console.error(err);
    process.exit(1);
});
