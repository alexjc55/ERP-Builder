import { spawn } from "node:child_process";

// Linux/POSIX runner: descendants must remain in the inherited process group.
export function runValidationProcess(command, args, {
  cwd, env = process.env, timeoutMs = 300_000, graceMs = 2_000,
  maxBuffer = 16 * 1024 * 1024,
} = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", bytes = 0;
    let error, signal = null, status = null, closed = false, stopping = false;
    let escalated = false, escalationTimer;
    const signalGroup = value => {
      if (!child.pid) return;
      try { process.kill(-child.pid, value); }
      catch (failure) {
        if (failure.code !== "ESRCH") error = new Error("Unable to stop validation process group");
      }
    };
    const finish = () => {
      if (!closed || (stopping && !escalated)) return;
      clearTimeout(timeout);
      clearTimeout(escalationTimer);
      process.off("SIGTERM", onTerm);
      process.off("SIGINT", onInt);
      resolve({ status, signal, error, stdout, stderr });
    };
    const stop = reason => {
      if (stopping) return;
      stopping = true;
      error = new Error(reason);
      signalGroup("SIGTERM");
      // Do not cancel escalation when the leader exits: grandchildren may still
      // hold the validation lock, even after all output pipes have closed.
      escalationTimer = setTimeout(() => {
        signalGroup("SIGKILL");
        escalated = true;
        finish();
      }, graceMs);
    };
    const onTerm = () => stop("Validation interrupted by SIGTERM");
    const onInt = () => stop("Validation interrupted by SIGINT");
    process.on("SIGTERM", onTerm);
    process.on("SIGINT", onInt);
    const timeout = setTimeout(() => stop("Validation timed out"), timeoutMs);
    const collect = channel => chunk => {
      bytes += chunk.length;
      if (bytes > maxBuffer) { stop("Validation output limit exceeded"); return; }
      if (channel === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", () => { error = new Error("Unable to launch validation command"); });
    child.on("close", (code, exitSignal) => {
      closed = true;
      status = code;
      signal = exitSignal;
      if (!stopping && child.pid) {
        try {
          process.kill(-child.pid, 0);
          stop("Validation left descendant processes running");
        } catch (failure) {
          if (failure.code !== "ESRCH") stop("Unable to inspect validation process group");
        }
      }
      finish();
    });
  });
}