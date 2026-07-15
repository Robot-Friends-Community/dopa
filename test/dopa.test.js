import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

import { parseNetstat, parseTasklist, parseLsof, parseSs, dedupeByPort } from "../src/ports.js";
import { identifyService, isSystemProcess } from "../src/services.js";
import { permit, revoke, seal, unseal, getEntry, statusOf, entries } from "../src/registry.js";
import {
  deriveProjectFromCommandLine,
  deriveProjectFromCwd,
  buildProjectResolver,
} from "../src/project.js";

test("parseNetstat extracts LISTENING ports + pids", () => {
  const sample = [
    "  Proto  Local Address          Foreign Address        State           PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       968",
    "  TCP    127.0.0.1:40404        0.0.0.0:0              LISTENING       12345",
    "  TCP    [::]:445               [::]:0                 LISTENING       4",
    "  TCP    10.0.0.5:50012         52.1.2.3:443           ESTABLISHED     900",
  ].join("\r\n");
  const rows = parseNetstat(sample);
  const ports = rows.map((r) => r.port).sort((a, b) => a - b);
  assert.deepEqual(ports, [135, 445, 40404]);
  assert.equal(rows.find((r) => r.port === 40404).pid, 12345);
});

test("parseTasklist maps pid → process name (strips .exe)", () => {
  const sample = ['"node.exe","12345","Console","1","120,000 K"', '"postgres.exe","999","Services","0","50,000 K"'].join("\r\n");
  const map = parseTasklist(sample);
  assert.equal(map.get(12345), "node");
  assert.equal(map.get(999), "postgres");
});

test("parseLsof extracts command/pid/port", () => {
  const sample = [
    "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
    "node    12345 user   23u  IPv4 0xabc      0t0  TCP 127.0.0.1:40404 (LISTEN)",
    "postgres  999 user    5u  IPv6 0xdef      0t0  TCP [::1]:5432 (LISTEN)",
  ].join("\n");
  const rows = parseLsof(sample);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].port, 40404);
  assert.equal(rows[0].process, "node");
  assert.equal(rows[1].port, 5432);
});

test("parseSs extracts port + process from users:(())", () => {
  const sample = [
    'LISTEN 0 511    0.0.0.0:40404  0.0.0.0:*  users:(("node",pid=123,fd=23))',
    'LISTEN 0 4096     [::1]:5432     [::]:*    users:(("postgres",pid=999,fd=5))',
  ].join("\n");
  const rows = parseSs(sample);
  assert.equal(rows[0].port, 40404);
  assert.equal(rows[0].process, "node");
  assert.equal(rows[0].pid, 123);
  assert.equal(rows[1].port, 5432);
});

test("dedupeByPort keeps one row per port, preferring one with a pid", () => {
  const rows = dedupeByPort([
    { port: 80, pid: null, process: "?" },
    { port: 80, pid: 5, process: "nginx" },
    { port: 22, pid: 9, process: "sshd" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.port === 80).pid, 5);
});

test("identifyService prefers port hint, falls back to process", () => {
  assert.equal(identifyService(5432, "node"), "PostgreSQL");
  assert.equal(identifyService(54999, "postgres"), "PostgreSQL");
  assert.equal(identifyService(54999, "mysteryd"), "mysteryd");
  assert.equal(identifyService(54999, "?"), "—");
});

test("isSystemProcess flags critical processes", () => {
  assert.equal(isSystemProcess("svchost"), true);
  assert.equal(isSystemProcess("System"), true);
  assert.equal(isSystemProcess("node"), false);
});

test("registry: permit then revoke removes a non-sealed entry", () => {
  const reg = { version: 1, ports: {} };
  permit(reg, 40404, { project: "workbench", note: "GP dev" });
  assert.equal(getEntry(reg, 40404).project, "workbench");
  assert.equal(statusOf(getEntry(reg, 40404)), "RESERVED");
  revoke(reg, 40404);
  assert.equal(getEntry(reg, 40404), null);
});

test("registry: sealed survives revoke (keeps the do-not-kill flag)", () => {
  const reg = { version: 1, ports: {} };
  permit(reg, 5432, { project: "db" });
  seal(reg, 5432, { note: "prod-like" });
  revoke(reg, 5432);
  const e = getEntry(reg, 5432);
  assert.ok(e, "entry should remain because it's sealed");
  assert.equal(e.sealed, true);
  assert.equal(statusOf(e), "SEALED");
  unseal(reg, 5432);
  // No reservation and no seal left → the entry is fully cleared.
  assert.equal(getEntry(reg, 5432), null);
});

test("deriveProjectFromCommandLine reads the dir before node_modules (windows next dev)", () => {
  const cmd =
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\Dev\\robobffs\\rf-business-os-onboarding\\node_modules\\.bin\\next" dev -p 40422';
  assert.equal(deriveProjectFromCommandLine(cmd), "rf-business-os-onboarding");
});

test("deriveProjectFromCommandLine handles unix paths + other dev servers", () => {
  assert.equal(
    deriveProjectFromCommandLine("/usr/bin/node /home/u/dev/discovery-copilot/node_modules/next/dist/bin/next dev"),
    "discovery-copilot",
  );
  assert.equal(
    deriveProjectFromCommandLine("node /projects/my-site/node_modules/vite/bin/vite.js"),
    "my-site",
  );
});

test("deriveProjectFromCommandLine returns null with no node_modules / bad input", () => {
  assert.equal(deriveProjectFromCommandLine("postgres -D /var/lib/pgsql/data"), null);
  assert.equal(deriveProjectFromCommandLine(""), null);
  assert.equal(deriveProjectFromCommandLine(null), null);
});

test("deriveProjectFromCwd uses basename, or the dir before node_modules", () => {
  assert.equal(deriveProjectFromCwd("/home/u/dev/discovery-copilot"), "discovery-copilot");
  assert.equal(deriveProjectFromCwd("C:\\Dev\\_PROJECTS\\_WIP\\gp-workbench"), "gp-workbench");
  assert.equal(deriveProjectFromCwd("/home/u/dev/foo/node_modules/.bin"), "foo");
  assert.equal(deriveProjectFromCwd("/home/u/dev/bar/"), "bar"); // trailing slash tolerated
  assert.equal(deriveProjectFromCwd(""), null);
});

test("buildProjectResolver: registry project wins and short-circuits PID inference", () => {
  const resolve = buildProjectResolver([]);
  assert.equal(resolve({ pid: 123 }, { project: "workbench" }), "workbench");
  assert.equal(resolve({ pid: null }, null), null); // no pid → unknown, never guesses
});

test("registry: sealedness takes precedence over reserved in statusOf", () => {
  const reg = { version: 1, ports: {} };
  permit(reg, 3000, { project: "x" });
  seal(reg, 3000);
  assert.equal(statusOf(getEntry(reg, 3000)), "SEALED");
});

test("registry: load/save round-trip via DOPA_HOME", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dopa-test-"));
  process.env.DOPA_HOME = tmp;
  // re-import to pick up env? registryPath reads env at call time, so direct use is fine.
  const { load, save } = await import("../src/registry.js");
  const reg = load();
  permit(reg, 40410, { project: "roundtrip" });
  save(reg);
  const reloaded = load();
  assert.equal(getEntry(reloaded, 40410).project, "roundtrip");
  assert.equal(entries(reloaded).length, 1);
  fs.rmSync(tmp, { recursive: true, force: true });
  delete process.env.DOPA_HOME;
});
