import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "..");
const artifactDirectory = path.join(workspaceRoot, "artifacts/erp-platform");
const argumentsList = process.argv.slice(2);
const fullSpec = argumentsList.includes("--full-spec");
const grepIndex = argumentsList.indexOf("--grep");
if (fullSpec && grepIndex >= 0) {
  throw new Error("--full-spec and --grep cannot be used together");
}
if (grepIndex >= 0 && !argumentsList[grepIndex + 1]) {
  throw new Error("--grep requires a pattern");
}
const grep =
  grepIndex >= 0
    ? argumentsList[grepIndex + 1]
    : "profile: measures select reopen while a projection is held";

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${path.basename(command)} terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

let temporaryBuildDirectory;
let server;

try {
  let distDirectory;
  if (process.env.INLINE_EDITOR_PROFILE_DIST_DIR) {
    distDirectory = path.resolve(
      workspaceRoot,
      process.env.INLINE_EDITOR_PROFILE_DIST_DIR,
    );
  } else {
    temporaryBuildDirectory = await mkdtemp(
      path.join(os.tmpdir(), "erp-inline-profile-"),
    );
    distDirectory = temporaryBuildDirectory;
    const viteCli = path.join(
      artifactDirectory,
      "node_modules/vite/bin/vite.js",
    );
    const buildExitCode = await run(
      process.execPath,
      [
        viteCli,
        "build",
        "--config",
        "vite.config.ts",
        "--outDir",
        distDirectory,
        "--emptyOutDir",
      ],
      {
        cwd: artifactDirectory,
        env: {
          ...process.env,
          PORT: "5199",
          BASE_PATH: "/",
          NODE_ENV: "production",
        },
        stdio: "inherit",
      },
    );
    if (buildExitCode !== 0) {
      throw new Error(`Production Vite build failed with exit code ${buildExitCode}`);
    }
  }

  const indexPath = path.join(distDirectory, "index.html");
  await access(indexPath);
  const indexHtml = await readFile(indexPath, "utf8");
  const assetPaths = [
    ...indexHtml.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g),
  ].map((match) => match[1]);
  const assets = await Promise.all(
    assetPaths.map(async (assetPath) => {
      const filePath = path.join(distDirectory, assetPath.replace(/^\/+/, ""));
      const body = await readFile(filePath);
      return {
        file: path.relative(distDirectory, filePath),
        bytes: body.byteLength,
        sha256: createHash("sha256").update(body).digest("hex"),
      };
    }),
  );
  console.log(
    `INLINE_EDITOR_PROFILE_ARTIFACT ${JSON.stringify({
      source:
        process.env.INLINE_EDITOR_PROFILE_DIST_DIR !== undefined
          ? "override"
          : "fresh-production-build",
      distDirectory,
      assets,
    })}`,
  );

  const contentTypes = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".woff2", "font/woff2"],
  ]);

  server = http.createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://127.0.0.1").pathname,
      );
    } catch {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Invalid request path");
      return;
    }
    if (pathname.startsWith("/api/")) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: "API escaped Playwright interception; live API access is disabled",
        }),
      );
      return;
    }

    let filePath = path.join(
      distDirectory,
      pathname === "/" ? "index.html" : pathname,
    );
    if (!filePath.startsWith(`${distDirectory}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(filePath)).isFile()) throw new Error("not a file");
    } catch {
      filePath = indexPath;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type":
          contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine isolated static server address");
  }

  const playwrightCli = path.join(
    workspaceRoot,
    "node_modules/@playwright/test/cli.js",
  );
  const playwrightArguments = [
    playwrightCli,
    "test",
    "tests/e2e/stable-background-refresh.spec.ts",
    "--config=playwright.inline-editor-profile.config.ts",
  ];
  if (!fullSpec) playwrightArguments.push(`--grep=${grep}`);

  const exitCode = await run(process.execPath, playwrightArguments, {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      RUN_INLINE_EDITOR_PROFILE: fullSpec ? "0" : "1",
      INLINE_EDITOR_PROFILE_BASE_URL: `http://127.0.0.1:${address.port}`,
      ...(fullSpec
        ? {}
        : {
            INLINE_EDITOR_PROFILE_BUDGET_MS:
              process.env.INLINE_EDITOR_PROFILE_BUDGET_MS ?? "250",
          }),
    },
    stdio: "inherit",
  });
  process.exitCode = exitCode;
} finally {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (temporaryBuildDirectory) {
    await rm(temporaryBuildDirectory, { recursive: true, force: true });
  }
}