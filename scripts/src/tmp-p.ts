import { db, pagesTable, entitiesTable, pageFieldsTable, relationsTable } from "@workspace/db";
const pages = await db.select().from(pagesTable);
const ents = await db.select().from(entitiesTable);
const rel = await db.select().from(relationsTable);
const pf = await db.select().from(pageFieldsTable);
const find = (s:string) => pages.filter(p=>JSON.stringify(p.nameJson).toLowerCase().includes(s));
for (const p of [...find("эпокол"), ...find("логист")]) {
  console.log("PAGE", p.id, JSON.stringify(p.nameJson), "mirrorEntityId:", (p as any).mirrorEntityId);
  const ent = ents.find(e=>e.pageId===p.id);
  if (ent) console.log("  bound entity:", ent.id, JSON.stringify(ent.nameJson));
  for (const f of pf.filter(f=>f.pageId===p.id)) console.log("  pf", f.id, f.fieldKey, f.fieldType, JSON.stringify(f.nameJson), "cfg:", JSON.stringify((f as unknown as { configJson?: unknown }).configJson ?? null)?.slice(0,400));
}
console.log("relations:", rel.map(r=>({id:r.id, src:r.sourceEntityId, tgt:r.targetEntityId, type:r.relationType})));
