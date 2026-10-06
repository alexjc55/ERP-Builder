import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import { db, pool, googleDriveConnectionTable, googleDriveFoldersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { signToken } from "../lib/jwt";
import { driveDisconnectPreview, disconnectDrive, driveConnectionVersion } from "../lib/drive-disconnect";
import { ensureFolder } from "../lib/googleDrive";
import { OAuth2Client } from "google-auth-library";
import { encryptSecret, decryptSecret } from "../lib/crypto";

test("Drive disconnect lifecycle and usage, isolated development schema", { timeout: 120000 }, async (t) => {
  assert.equal(process.env.REPLIT_ENVIRONMENT, "development");
  assert.equal(process.env.NODE_ENV, "test");
  const schema = `drive_disconnect_${randomBytes(8).toString("hex")}`;
  const bootstrap = await pool.connect();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    await bootstrap.query(`CREATE SCHEMA "${schema}"`);
    const tables = await bootstrap.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      await bootstrap.query(`CREATE TABLE "${schema}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
    pool.options.options = `-c search_path=${schema}`;
    await db.execute(sql`
      INSERT INTO roles(id,name_json,permissions_json) VALUES
        (1001,'{}','{"superAdmin":true,"admin":{},"records":{},"pageIds":[]}'),
        (1002,'{}','{"superAdmin":false,"admin":{},"records":{},"pageIds":[]}');
      INSERT INTO users(id,email,first_name,last_name,role_id) VALUES
        (1001,'admin@drive-test.invalid','Test','Admin',1001),
        (1002,'user@drive-test.invalid','Test','User',1002);
      INSERT INTO pages(id,mirror_entity_id) VALUES (1001,1001),(1002,1001);
      INSERT INTO entities(id,entity_key,page_id) VALUES(1001,'drive_test',1001);
      INSERT INTO google_drive_connection(id,key_mode,account_email,folder_id,folder_name,refresh_token_enc,own_client_secret_enc)
        VALUES(1,'own','fixture@drive-test.invalid','root','Root','token-sentinel','secret-sentinel');
      INSERT INTO google_drive_folders(id,drive_folder_id,name,is_default,parent_id,name_template_json) VALUES
        (1001,'root','Root',true,NULL,NULL),(1002,'child','Child',false,1001,'[{"kind":"text","text":"kept"}]');
      INSERT INTO entity_fields(id,entity_id,field_key,field_type,file_config_json) VALUES
        (1001,1001,'file_a','file','{"driveFolderId":"child","allowedSources":["gdrive","link"],"nameTemplateJson":[{"kind":"date"}]}'),
        (1002,1001,'file_b','file','{"driveFolderId":"child","allowedSources":["gdrive"]}'),
        (1003,1001,'default_file','file','{"allowedSources":["gdrive"]}'),
        (1004,1001,'orphan','file','{"driveFolderId":"missing","allowedSources":["gdrive"]}');
      INSERT INTO page_fields(id,page_id,field_key,field_type,file_config_json) VALUES
        (1001,1002,'page_file','file','{"driveFolderId":"child","allowedSources":["gdrive"],"localFolderId":7}');
      INSERT INTO entity_records(id,entity_id,values_json,archived_at) VALUES
        (1001,1001,'{"file_a":{"kind":"gdrive","fileId":"a"},"file_b":{"kind":"gdrive","fileId":"b"},"default_file":{"kind":"gdrive","fileId":"c"}}',NULL),
        (1002,1001,'{"file_a":{"kind":"gdrive","fileId":"d"}}',now()),
        (1003,1001,'{"file_a":{"kind":"link","url":"https://example.invalid"}}',NULL);
      INSERT INTO page_record_values(page_id,record_id,values_json) VALUES
        (1002,1001,'{"page_file":{"kind":"gdrive","fileId":"e"}}'),
        (1002,1003,'{"page_file":[{"kind":"gdrive","fileId":"f"}]}');
    `);
    const app = express();
    app.use(express.json());
    app.use("/api", (await import("./google-drive")).default);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/google-drive`;
    const admin = signToken({ userId: 1001, roleId: 1001 });
    const ordinary = signToken({ userId: 1002, roleId: 1002 });
    const request = async (path: string, token: string, body?: unknown) => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    const beforeValues = await db.execute(sql`SELECT values_json FROM entity_records ORDER BY id`);
    const beforePageValues = await db.execute(sql`SELECT values_json FROM page_record_values ORDER BY record_id`);
    await t.test("usage includes page fields, archive, default assignments, and deduplicates records", async () => {
      const preview = await driveDisconnectPreview();
      assert.deepEqual(preview.folders.find((f) => f.folderId === "child"), {
        folderId: "child", name: "Child", fields: 3, entities: 1, pages: 1, records: 3,
      });
      assert.equal(preview.folders.find((f) => f.folderId === "root")!.records, 1);
      assert.equal(preview.folders.find((f) => f.folderId === "missing")!.fields, 1);
      assert.ok(!JSON.stringify(preview).includes("secret-sentinel"));
    });
    await t.test("server requires privilege, explicit choice and current revision", async () => {
      assert.equal((await request("/disconnect-preview", ordinary)).status, 403);
      assert.equal((await request("/disconnect", ordinary, { folderAction: "forget", revision: "x" })).status, 403);
      assert.equal((await request("/disconnect", admin, {})).status, 400);
      assert.equal((await request("/disconnect", admin, { folderAction: "keep", revision: "stale" })).status, 409);
      assert.equal((await db.select().from(googleDriveFoldersTable)).length, 2);
    });
    await t.test("keep preserves folders, parent, templates, bindings, identity and OAuth secret", async () => {
      const folders = await db.select().from(googleDriveFoldersTable).orderBy(googleDriveFoldersTable.id);
      const preview = await driveDisconnectPreview();
      assert.equal((await request("/disconnect", admin, { folderAction: "keep", revision: preview.revision })).status, 200);
      const [conn] = await db.select().from(googleDriveConnectionTable);
      assert.equal(conn!.refreshTokenEnc, null);
      assert.equal(conn!.folderId, "root");
      assert.equal(conn!.accountEmail, "fixture@drive-test.invalid");
      assert.equal(conn!.ownClientSecretEnc, "secret-sentinel");
      assert.deepEqual(await db.select().from(googleDriveFoldersTable).orderBy(googleDriveFoldersTable.id), folders);
      assert.equal((await driveDisconnectPreview()).folders.find((f) => f.folderId === "child")!.fields, 3);
    });
    await t.test("health-only writes do not invalidate OAuth state, configuration changes do", async () => {
      const [conn] = await db.select().from(googleDriveConnectionTable);
      assert.equal(driveConnectionVersion(conn), driveConnectionVersion({ ...conn!, updatedAt: new Date(), healthReason: "network_error" }));
      assert.notEqual(driveConnectionVersion(conn), driveConnectionVersion({ ...conn!, folderId: "different" }));
    });
    await t.test("OAuth reconnect preserves folders, rejects another account and inaccessible folders, then refuses state replay", async (sub) => {
      await db.update(googleDriveConnectionTable).set({
        ownClientId: "fixture-client", ownClientSecretEnc: encryptSecret("fixture-secret"),
      });
      sub.mock.method(OAuth2Client.prototype, "getToken", async () => ({
        tokens: { access_token: "fixture-access", refresh_token: "fixture-refresh", id_token: "fixture-id" },
      }));
      let email = "wrong@drive-test.invalid";
      sub.mock.method(OAuth2Client.prototype, "verifyIdToken", async () => ({ getPayload: () => ({ email }) }));
      const originalFetch = globalThis.fetch;
      let unavailable = false;
      const providerMethods: string[] = [];
      globalThis.fetch = async (url, init) => {
        if (!String(url).startsWith("https://www.googleapis.com/drive/")) return originalFetch(url, init);
        providerMethods.push(init?.method ?? "GET");
        const id = new URL(String(url)).pathname.split("/").pop();
        return new Response(JSON.stringify({ id, name: id, trashed: false }), { status: unavailable && id === "child" ? 404 : 200 });
      };
      try {
        const start = await request("/oauth/start", admin, {});
        assert.equal(start.status, 200);
        const state = new URL(start.body.authUrl).searchParams.get("state")!;
        const callback = () => originalFetch(base + "/oauth/callback?code=fixture-code&state=" + encodeURIComponent(state), { redirect: "manual" });
        assert.ok((await callback()).headers.get("location")?.includes("account-mismatch"));
        assert.equal(providerMethods.length, 0);
        assert.equal((await db.select().from(googleDriveConnectionTable))[0]!.refreshTokenEnc, null);
        email = "fixture@drive-test.invalid"; unavailable = true;
        assert.ok((await callback()).headers.get("location")?.includes("folders-unavailable"));
        assert.equal((await db.select().from(googleDriveConnectionTable))[0]!.refreshTokenEnc, null);
        assert.equal((await db.select().from(googleDriveFoldersTable)).length, 2);
        unavailable = false;
        assert.ok((await callback()).headers.get("location")?.includes("drive=connected"));
        const [conn] = await db.select().from(googleDriveConnectionTable);
        assert.equal(conn!.folderId, "root");
        assert.equal(decryptSecret(conn!.refreshTokenEnc!), "fixture-refresh");
        const folders = await db.select().from(googleDriveFoldersTable);
        assert.equal(folders.length, 2);
        assert.deepEqual(folders.find((f) => f.driveFolderId === "child")!.nameTemplateJson, [{ kind: "text", text: "kept" }]);
        assert.ok(providerMethods.every((method) => method === "GET"));
        assert.ok((await callback()).headers.get("location")?.includes("drive=error"));
        // Restore sentinel only for the later preservation assertion.
        await db.update(googleDriveConnectionTable).set({ ownClientSecretEnc: "secret-sentinel" });
      } finally {
        globalThis.fetch = originalFetch;
        sub.mock.restoreAll();
      }
    });
    await t.test("same-count folder reassignments invalidate the confirmation", async () => {
      const stale = await driveDisconnectPreview();
      await db.execute(sql`UPDATE entity_fields SET file_config_json=file_config_json || '{"nameTemplateJson":[{"kind":"hash"}]}'::jsonb WHERE id=1002`);
      assert.equal(await disconnectDrive("forget", stale.revision), null);
      assert.equal((await db.select().from(googleDriveFoldersTable)).length, 2);
    });
    await t.test("forget clears all folder bindings, including orphans, but no stored values or unrelated config", async () => {
      const preview = await driveDisconnectPreview();
      assert.equal((await request("/disconnect", admin, { folderAction: "forget", revision: preview.revision })).status, 200);
      assert.equal((await db.select().from(googleDriveFoldersTable)).length, 0);
      const [conn] = await db.select().from(googleDriveConnectionTable);
      assert.equal(conn!.folderId, null); assert.equal(conn!.accountEmail, null);
      assert.equal(conn!.ownClientSecretEnc, "secret-sentinel");
      assert.deepEqual((await db.execute(sql`SELECT values_json FROM entity_records ORDER BY id`)).rows, beforeValues.rows);
      assert.deepEqual((await db.execute(sql`SELECT values_json FROM page_record_values ORDER BY record_id`)).rows, beforePageValues.rows);
      const configs = await db.execute(sql`SELECT file_config_json AS config FROM entity_fields UNION ALL SELECT file_config_json FROM page_fields`);
      for (const row of configs.rows) assert.ok(!("driveFolderId" in (row.config as object)));
      const page = await db.execute(sql`SELECT file_config_json FROM page_fields WHERE id=1001`);
      assert.equal((page.rows[0]!.file_config_json as { localFolderId: number }).localFolderId, 7);
    });
    await t.test("saved folder failures never create replacements; first connection can create a folder", async () => {
      const original = globalThis.fetch;
      try {
        for (const status of [403,404,429,500]) {
          const calls: string[] = [];
          globalThis.fetch = async (_url, init) => {
            calls.push(init?.method ?? "GET");
            return new Response("{}", { status });
          };
          await assert.rejects(ensureFolder("test-token", "old-folder"));
          assert.deepEqual(calls, ["GET"]);
        }
        globalThis.fetch = async () => new Response(JSON.stringify({ id: "old-folder", name: "Old", trashed: true }), { status: 200 });
        await assert.rejects(ensureFolder("test-token", "old-folder"));
        globalThis.fetch = async () => new Response(JSON.stringify({ id: "old-folder", name: "Old" }), { status: 200 });
        assert.equal((await ensureFolder("test-token", "old-folder")).id, "old-folder");
        let method: string | undefined;
        globalThis.fetch = async (_url, init) => { method = init?.method; return new Response(JSON.stringify({ id: "new-folder", name: "New" }), { status: 200 }); };
        assert.equal((await ensureFolder("test-token", null)).id, "new-folder");
        assert.equal(method, "POST");
      } finally { globalThis.fetch = original; }
    });
  } finally {
    if (server) await new Promise<void>((resolve) => { server!.close(() => resolve()); server!.closeAllConnections(); });
    await bootstrap.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    bootstrap.release();
    await pool.end();
  }
});
