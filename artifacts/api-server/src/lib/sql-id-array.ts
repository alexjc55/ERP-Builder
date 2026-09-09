import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/** One PostgreSQL array parameter, never one bind placeholder per id. */
export function idArrayAny(column: SQLWrapper, ids: readonly number[]): SQL {
  return ids.length === 0
    ? sql`false`
    : sql`${column} = ANY(${sql.param([...ids])}::int[])`;
}