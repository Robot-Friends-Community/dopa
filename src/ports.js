// Cross-platform discovery of listening TCP ports.
//
// Strategy (adapted from portcop, MIT — see LICENSE):
//   win32  → `netstat -ano -p TCP` + `tasklist` (PID → process name)
//   darwin → `lsof -nP -iTCP -sTCP:LISTEN`
//   linux  → `ss -tlnpH` (fallback: lsof)
//
// The parsers are exported as pure functions so they can be unit-tested with
// fixtures without spawning processes.

import { execFileSync } from "node:child_process";

// NOTE: always execFileSync with an argument array — never a shell string — so
// nothing is interpolated through a shell (no command-injection surface).
const runTool = (cmd, args) =>
  execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });

export function parseNetstat(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (!m) continue;
    const addr = m[1];
    const pid = Number(m[2]);
    const port = Number(addr.slice(addr.lastIndexOf(":") + 1));
    if (!Number.isInteger(port) || port <= 0) continue;
    rows.push({ port, pid, proto: "tcp", address: addr });
  }
  return rows;
}

export function parseTasklist(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const cols = line.match(/"([^"]*)"/g);
    if (!cols || cols.length < 2) continue;
    const name = cols[0].slice(1, -1);
    const pid = Number(cols[1].slice(1, -1));
    if (Number.isInteger(pid)) map.set(pid, name.replace(/\.exe$/i, ""));
  }
  return map;
}

export function parseLsof(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || /^COMMAND\s/.test(line)) continue;
    const p = line.split(/\s+/);
    if (p.length < 9) continue;
    const cmd = p[0];
    const pid = Number(p[1]);
    const name = p[8]; // host:port
    const colon = name.lastIndexOf(":");
    if (colon < 0) continue;
    const port = Number(name.slice(colon + 1).replace(/\D.*$/, ""));
    if (!Number.isInteger(port) || !port) continue;
    rows.push({ port, pid, proto: "tcp", address: name, process: cmd });
  }
  return rows;
}

export function parseSs(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (!/^LISTEN/i.test(line.trim())) continue;
    const cols = line.trim().split(/\s+/);
    const local = cols[3] || ""; // LISTEN recvq sendq LOCAL peer users
    const colon = local.lastIndexOf(":");
    if (colon < 0) continue;
    const port = Number(local.slice(colon + 1));
    if (!Number.isInteger(port) || !port) continue;
    let pid = null;
    let proc = "?";
    const um = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (um) {
      proc = um[1];
      pid = Number(um[2]);
    }
    rows.push({ port, pid, proto: "tcp", address: local, process: proc });
  }
  return rows;
}

// One row per port. Prefer a row that carries a pid/process.
export function dedupeByPort(rows) {
  const m = new Map();
  for (const r of rows) {
    const ex = m.get(r.port);
    if (!ex || (!ex.pid && r.pid)) m.set(r.port, r);
  }
  return [...m.values()].sort((a, b) => a.port - b.port);
}

export function listListening() {
  try {
    if (process.platform === "win32") {
      const rows = parseNetstat(runTool("netstat", ["-ano", "-p", "TCP"]));
      let names = new Map();
      try {
        names = parseTasklist(runTool("tasklist", ["/FO", "CSV", "/NH"]));
      } catch {
        /* tasklist optional; ports still listed without names */
      }
      for (const r of rows) r.process = names.get(r.pid) || "?";
      return dedupeByPort(rows);
    }
    if (process.platform === "darwin") {
      return dedupeByPort(parseLsof(runTool("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"])));
    }
    // linux
    try {
      return dedupeByPort(parseSs(runTool("ss", ["-tlnpH"])));
    } catch {
      return dedupeByPort(parseLsof(runTool("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"])));
    }
  } catch {
    // No listeners, or the underlying tool exited non-zero (e.g. lsof with no
    // matches). Treat as "nothing listening".
    return [];
  }
}

export function onPort(port) {
  return listListening().filter((r) => r.port === Number(port));
}

export function killPid(pid) {
  if (process.platform === "win32") {
    runTool("taskkill", ["/PID", String(pid), "/F", "/T"]);
  } else {
    process.kill(Number(pid), "SIGKILL");
  }
}
