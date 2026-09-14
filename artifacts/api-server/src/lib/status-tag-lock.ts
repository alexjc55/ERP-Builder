import { sql, type SQL } from "drizzle-orm";

// A single transaction-scoped PostgreSQL advisory lock serializes the rare
// operations that can create/delete JSON references to a global status tag.
// Using one stable key also covers a writer referencing several tags at once.
export const STATUS_TAG_REFERENCE_LOCK = 8_147_203;

type TransactionExecutor = {
  execute(query: SQL): unknown;
};

export async function lockStatusTagReferences(tx: TransactionExecutor): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${STATUS_TAG_REFERENCE_LOCK})`);
}