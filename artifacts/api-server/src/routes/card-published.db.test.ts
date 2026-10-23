import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import { db, pool, rolesTable, usersTable, entitiesTable, entityFieldsTable, NO_ACCESS_PERMS } from "@workspace/db";
import { signToken } from "../lib/jwt";

test("published edits are atomic, validated, scope-locked and revision-checked", async () => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  assert.equal(process.env.NODE_ENV, "test");
  const schema = `card_edit_${randomBytes(8).toString("hex")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    const { default: router } = await import("./card-templates");
    const { default: styleRouter } = await import("./card-style-presets");
    const [entity, other] = await db.insert(entitiesTable).values([
      { entityKey: "test", nameJson: {} }, { entityKey: "other", nameJson: {} },
    ]).returning();
    await db.insert(entityFieldsTable).values({ entityId: entity.id, fieldKey: "name", nameJson: {} });
    const [role] = await db.insert(rolesTable).values({ nameJson: {}, permissionsJson: { ...NO_ACCESS_PERMS, superAdmin: true } }).returning();
    const [user] = await db.insert(usersTable).values({ email: "fixture@example.invalid", firstName: "Test", lastName: "Admin", roleId: role.id }).returning();
    const app = express(); app.use(express.json()); app.use(router);
    app.use(styleRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const token = signToken({ userId: user.id, roleId: role.id });
    const styleCall = async (path: string, body?: unknown, method = body ? "POST" : "GET", authToken: string | null = token) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/card-style-presets${path}`, {
        method, headers: { "content-type": "application/json", ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json().catch(() => null) as any };
    };
    const appearance = { style: "custom", presentation: "side", customStyle: {
      background: "#ffffff", sectionBackground: "#eeeeee", accent: "#112233", textColor: "#223344",
      spacing: 14, radius: 10, fontSize: 15, border: true, shadow: false,
    } };
    assert.equal((await styleCall("", undefined, "GET", null)).status, 401);
    const [limitedRole] = await db.insert(rolesTable).values({ nameJson: {}, permissionsJson: NO_ACCESS_PERMS }).returning();
    const [limited] = await db.insert(usersTable).values({ email: "limited@example.invalid", firstName: "Limited", lastName: "", roleId: limitedRole.id }).returning();
    const limitedToken = signToken({ userId: limited.id, roleId: limitedRole.id });
    assert.equal((await styleCall("", undefined, "GET", limitedToken)).status, 403);
    assert.equal((await styleCall("", { name: "Bad", appearance: { ...appearance, tabs: [] } })).status, 400);
    const preset = await styleCall("", { name: "Shared", appearance });
    assert.equal(preset.status, 201);
    assert.deepEqual(preset.body.appearance, appearance);
    assert.equal((await styleCall("")).body.length, 1);
    const changed = await styleCall(`/${preset.body.id}`, { name: "Renamed", appearance, expectedRevision: 1 }, "PUT");
    assert.equal(changed.body.revision, 2);
    assert.equal((await styleCall(`/${preset.body.id}`, { name: "Lost update", appearance, expectedRevision: 1 }, "PUT")).status, 409);
    assert.equal((await styleCall(`/${preset.body.id}?expectedRevision=1`, undefined, "DELETE")).status, 409);
    assert.equal((await styleCall(`/${preset.body.id}?expectedRevision=2`, undefined, "DELETE")).status, 204);
    assert.deepEqual((await styleCall("")).body, []);
    const call = async (path: string, data?: unknown, method = "POST", authenticated = true) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/card-templates${path}`, { method,
        headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const layout = { version: 1, style: "standard", customStyle: {}, tabs: [{ id: "tab", title: {}, sections: [{
      id: "section", title: {}, columns: 1, blocks: [{ id: "field", kind: "field", fieldKey: "name", span: 1, modes: ["view", "edit", "create"], columns: [] }],
    }] }] };
    const input = { name: "Original", entityId: entity.id, pageId: null, layout };
    const draft = await call("", input); assert.equal(draft.status, 201);
    const published = await call(`/${draft.body.id}/publish`, { expectedRevision: draft.body.revision });
    assert.equal(published.status, 200);
    const id = published.body.id, revision = published.body.revision;
    const resolve = () => call("/resolve", { entityId: entity.id, mode: "create" });
    assert.equal((await resolve()).body.template.name, "Original");
    assert.equal((await call(`/${id}`, { ...input, entityId: other.id, expectedRevision: revision }, "PUT")).status, 400);
    const invalid = structuredClone(layout);
    invalid.tabs[0].sections[0].blocks.push({ ...invalid.tabs[0].sections[0].blocks[0], id: "duplicate" });
    assert.equal((await call(`/${id}`, { ...input, layout: invalid, expectedRevision: revision }, "PUT")).status, 400);
    assert.equal((await resolve()).body.template.revision, revision);
    assert.equal((await call(`/${id}`, { ...input, expectedRevision: revision }, "PUT", false)).status, 401);
    const edits = await Promise.all(["A", "B"].map(name => call(`/${id}`, { ...input, name, expectedRevision: revision }, "PUT")));
    assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
    const winner = edits.find(r => r.status === 200)!.body;
    assert.equal(winner.state, "published"); assert.equal(winner.revision, revision + 1);
    assert.equal((await resolve()).body.template.name, winner.name);
    assert.equal((await call(`/${id}/unpublish`, { expectedRevision: revision })).status, 409);
    const nextDraft = await call("", { ...input, name: "Draft" });
    const saved = await call(`/${nextDraft.body.id}`, { ...input, name: "Draft edited", expectedRevision: nextDraft.body.revision }, "PUT");
    assert.equal(saved.body.state, "draft");
    assert.equal((await resolve()).body.template.id, id);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release();
    await pool.end();
  }
});
