import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool, translationsTable } from "@workspace/db";

type Entry = { key: string; ru: string; en: string; he: string };

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "data", "ui-translations.json");
const srcRoot = resolve(__dirname, "..", "..", "artifacts", "erp-platform", "src");

function loadCurated(): Entry[] {
  const raw = readFileSync(dataPath, "utf8");
  return JSON.parse(raw) as Entry[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Extract t("key", "russian default") calls from source (static literals only).
function extractSourceKeys(): Map<string, string> {
  const found = new Map<string, string>();
  const re =
    /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of walk(srcRoot)) {
    const text = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const key = m[1];
      const ru = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      if (!found.has(key)) found.set(key, ru);
    }
  }
  return found;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  const curated = loadCurated();
  const curatedMap = new Map<string, Entry>();
  for (const e of curated) curatedMap.set(e.key, e);

  const sourceKeys = extractSourceKeys();

  // Union of curated keys and source keys.
  const allKeys = new Set<string>([...curatedMap.keys(), ...sourceKeys.keys()]);

  const rows: { translationKey: string; translationsJson: { ru: string; en: string; he: string } }[] = [];
  let curatedOnly = 0;
  let sourceFallback = 0;
  for (const key of allKeys) {
    const c = curatedMap.get(key);
    const srcRu = sourceKeys.get(key);
    const ru = c?.ru ?? srcRu ?? key;
    const en = c?.en ?? srcRu ?? ru;
    const he = c?.he ?? srcRu ?? ru;
    if (!c && srcRu !== undefined) sourceFallback++;
    if (c && srcRu === undefined) curatedOnly++;
    rows.push({ translationKey: key, translationsJson: { ru, en, he } });
  }

  let upserts = 0;
  for (const row of rows) {
    await db
      .insert(translationsTable)
      .values(row)
      .onConflictDoUpdate({
        target: translationsTable.translationKey,
        set: { translationsJson: row.translationsJson, updatedAt: new Date() },
      });
    upserts++;
  }

  console.log(
    `Seeded ${upserts} translation keys (curated=${curatedMap.size}, source=${sourceKeys.size}, source-only fallbacks=${sourceFallback}, curated-only=${curatedOnly}).`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
