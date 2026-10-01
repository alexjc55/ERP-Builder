import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runValidationProcess } from "./run-validation-process.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await pause(20);
  }
  throw new Error("Timed out waiting for mock process");
}
async function exists(file) {
  try { await readFile(file); return true; } catch { return false; }
}
async function alive(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // Orphan zombies may await container init reaping, but cannot execute or
    // retain file descriptors. They are not surviving test runners.
    return !["Z", "X"].includes(stat.slice(stat.lastIndexOf(")") + 2)[0]);
  } catch { return false; }
}

test("normal completion allows cleanup and removes signal handlers", async () => {
  const before = process.listenerCount("SIGTERM");
  const result = await runValidationProcess(process.execPath, ["-e", "process.on('exit',()=>console.log('cleanup'));console.log('done')"]);
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.match(result.stdout, /done\ncleanup/);
  assert.equal(process.listenerCount("SIGTERM"), before);
});

test("spawn errors and output overflow fail closed", async () => {
  const missing = await runValidationProcess("/nonexistent-validation-command", []);
  assert.ok(missing.error);
  const overflowing = await runValidationProcess(process.execPath, ["-e", "setInterval(()=>console.log('x'.repeat(1000)),1)"], {
    maxBuffer: 100, graceMs: 50,
  });
  assert.match(overflowing.error.message, /output limit/);
});

for (const mode of ["timeout", "SIGTERM", "SIGINT", "leader-exits"]) {
  test(`${mode} stops grandchildren and releases their lock before returning`, { timeout: 15_000 }, async t => {
    const dir = await mkdtemp(path.join(tmpdir(), "validation-tree-"));
    const pidFile = path.join(dir, "leaf.pid");
    const leaderPidFile = path.join(dir, "leader.pid");
    const shellPidFile = path.join(dir, "shell.pid");
    const lock = path.join(dir, "mock.lock");
    const calls = path.join(dir, "calls");
    const leaf = path.join(dir, "leaf.mjs");
    const leader = path.join(dir, "leader.mjs");
    const harness = path.join(dir, "harness.mjs");
    let outer, leafPid;
    t.after(async () => {
      if (outer?.exitCode === null) outer.kill("SIGKILL");
      if (leafPid && await alive(leafPid)) process.kill(leafPid, "SIGKILL");
      await rm(dir, { recursive: true, force: true });
    });
    await writeFile(leaf, `
      import {writeFileSync} from 'node:fs';
      process.on('SIGTERM',()=>{});
      process.on('SIGINT',()=>{});
      writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
      setInterval(()=>{},1000);
    `);
    await writeFile(leader, `
      import {spawn} from 'node:child_process';
      import {existsSync,writeFileSync} from 'node:fs';
      writeFileSync(${JSON.stringify(leaderPidFile)},String(process.pid));
      spawn('bash',['-c','echo $$ > "$4"; exec 9>"$1"; flock 9; "$2" "$3"; true','bash',${JSON.stringify(lock)},process.execPath,${JSON.stringify(leaf)},${JSON.stringify(shellPidFile)}],{stdio:'ignore'});
      ${mode === "leader-exits"
        ? `const timer=setInterval(()=>{if(existsSync(${JSON.stringify(pidFile)})){clearInterval(timer);process.exit(0)}},10);`
        : "setInterval(()=>{},1000);"}
    `);
    const runnerUrl = new URL("./run-validation-process.mjs", import.meta.url).href;
    const gateUrl = new URL("./validate-formula-reports.mjs", import.meta.url).href;
    await writeFile(harness, `
      import {appendFileSync} from 'node:fs';
      import {runValidationProcess} from ${JSON.stringify(runnerUrl)};
      import {runValidation} from ${JSON.stringify(gateUrl)};
      try {
        await runValidation({
          env:{FORMULA_REPORTS_CONFIRMED_DEVELOPMENT:'1',FORMULA_REPORTS_DEV_FINGERPRINT:'a'.repeat(32)},
          run:()=> {
            appendFileSync(${JSON.stringify(calls)},'called\\n');
            return runValidationProcess(process.execPath,[${JSON.stringify(leader)}],{timeoutMs:${mode === "timeout" ? 1500 : 8000},graceMs:150});
          }
        });
        console.log('PASS');
      } catch { console.log('NOT VERIFIED'); process.exitCode=1; }
    `);
    outer = spawn(process.execPath, [harness], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    outer.stdout.on("data", chunk => { output += chunk; });
    const ended = new Promise(resolve => outer.on("close", resolve));
    await until(() => exists(pidFile));
    leafPid = Number(await readFile(pidFile, "utf8"));
    assert.equal(await alive(leafPid), true);
    if (mode.startsWith("SIG")) outer.kill(mode);
    assert.equal(await ended, 1);
    assert.match(output, /NOT VERIFIED/);
    assert.doesNotMatch(output, /PASS/);
    assert.equal(await readFile(calls, "utf8"), "called\n");
    assert.equal(spawnSync("flock", ["-n", lock, "true"]).status, 0, "descendant lock must be free");
    for (const pid of [leafPid, Number(await readFile(leaderPidFile, "utf8")), Number(await readFile(shellPidFile, "utf8"))]) {
      await until(async () => !(await alive(pid)));
    }
  });
}