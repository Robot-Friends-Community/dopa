// Resolve the owning PROJECT for a listening port (dopa rew).
//
// The registry's `project` field is authoritative for CLAIMED ports. For an
// UNCLAIMED process (e.g. a raw `next dev -pNNNN` orphan — the case that made
// `dopa patrol` unhelpful: it showed the PID but not which project owned it), we
// infer the project from the owning PID:
//   - the command line — a dev-server binary lives under <project>/node_modules
//   - on unix, the process working directory (which for `next dev` IS the project)
//
// The derivation parsers are pure so they're unit-testable with fixtures (like
// the ports.js parsers). The platform lookups are best-effort and never throw —
// on any failure the project simply reads as unknown ("—").

import { execFileSync } from "node:child_process";
import fs from "node:fs";

// Always an argument array — never a shell string (no command-injection surface).
const runTool = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });

// ── pure derivation (unit-tested) ───────────────────────────────────────────

// The project is the path segment immediately before `node_modules` — where a
// dev server's binary is resolved from. Handles both \ and / separators and
// quoted paths. Returns null when no node_modules path is present.
export function deriveProjectFromCommandLine(cmdline) {
  if (!cmdline || typeof cmdline !== "string") return null;
  const norm = cmdline.replace(/\\/g, "/");
  const m = norm.match(/([^/\s"]+)\/node_modules\//);
  return m ? m[1] : null;
}

// A process cwd resolves to its project: the dir before node_modules if the cwd
// is inside one, else the cwd's own basename (for `next dev`, the app/repo dir).
export function deriveProjectFromCwd(cwdPath) {
  if (!cwdPath || typeof cwdPath !== "string") return null;
  const norm = cwdPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const nm = norm.match(/([^/]+)\/node_modules(?:\/|$)/);
  if (nm) return nm[1];
  const parts = norm.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// ── platform PID → project (best-effort, never throws) ──────────────────────

// One CIM call for every process → Map<pid, commandLine>. Cheaper than probing
// each PID separately, and windowsHide keeps it silent.
function winCommandLineMap() {
  try {
    const json = runTool("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ]);
    const data = JSON.parse(json);
    const arr = Array.isArray(data) ? data : [data];
    const map = new Map();
    for (const p of arr) if (p && p.ProcessId != null) map.set(Number(p.ProcessId), p.CommandLine || "");
    return map;
  } catch {
    return new Map();
  }
}

function unixCwd(pid) {
  if (!pid) return null;
  try {
    if (process.platform === "linux") return fs.readlinkSync(`/proc/${pid}/cwd`);
    // darwin
    const out = runTool("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
    const line = out.split(/\r?\n/).find((l) => l.startsWith("n"));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

// Build a resolver over a set of rows, doing any one-time platform fetch up front
// (a single CIM call on Windows) so per-row lookups are cheap. Returns
// (row, entry) => projectName | null, with the registry entry taking precedence.
export function buildProjectResolver(rows = []) {
  const winMap = process.platform === "win32" ? winCommandLineMap() : null;
  const cwdCache = new Map();
  return (row, entry) => {
    if (entry && entry.project) return entry.project;
    const pid = row && row.pid;
    if (!pid) return null;
    if (winMap) return deriveProjectFromCommandLine(winMap.get(Number(pid)));
    if (!cwdCache.has(pid)) cwdCache.set(pid, unixCwd(pid));
    return deriveProjectFromCwd(cwdCache.get(pid));
  };
}
