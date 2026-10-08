import { readFileSync } from "node:fs";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
try {
  const migration = readFileSync(new URL("../migrate-inbound-deletion.sql", import.meta.url), "utf8");
  await db.execute(sql.raw(migration));
  console.log("Inbound deletion migration applied.");
} finally { await pool.end(); }
