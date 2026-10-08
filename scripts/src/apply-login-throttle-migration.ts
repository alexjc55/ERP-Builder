import { readFileSync } from "node:fs";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
try {
  const migration = readFileSync(new URL("../migrate-login-throttle.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration));
  console.log("Login throttle migration applied.");
} finally {
  await pool.end();
}
