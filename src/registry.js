// The persistent port registry — DoPA's "records office".
//
// Stored as JSON at  $DOPA_HOME/registry.json  (default ~/.dopa/registry.json).
// Each entry tracks whether a port is reserved (permitted) and/or sealed
// (on the do-not-kill list), plus the owning project and a note.
//
// The mutators are pure (they take and return a `reg` object) so they're trivial
// to unit-test; the CLI does load() → mutate → save().

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function dopaHome() {
  return process.env.DOPA_HOME || path.join(os.homedir(), ".dopa");
}

export function registryPath() {
  return path.join(dopaHome(), "registry.json");
}

const blank = () => ({ version: 1, ports: {} });
const now = () => new Date().toISOString();

export function load() {
  try {
    const data = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    if (!data || typeof data !== "object") return blank();
    data.version ??= 1;
    data.ports ??= {};
    return data;
  } catch {
    return blank();
  }
}

export function save(reg) {
  fs.mkdirSync(dopaHome(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2) + "\n");
  return reg;
}

export function getEntry(reg, port) {
  return reg.ports[String(port)] || null;
}

export function permit(reg, port, { project, note } = {}) {
  const key = String(port);
  const e = reg.ports[key] || { sealed: false };
  if (project !== undefined) e.project = project;
  if (note !== undefined) e.note = note;
  e.reserved = true;
  e.updatedAt = now();
  reg.ports[key] = e;
  return reg;
}

export function revoke(reg, port) {
  const key = String(port);
  const e = reg.ports[key];
  if (!e) return reg;
  e.reserved = false;
  delete e.project;
  e.updatedAt = now();
  // An entry only exists while it is reserved or sealed.
  if (!e.reserved && !e.sealed) delete reg.ports[key];
  return reg;
}

export function seal(reg, port, { note } = {}) {
  const key = String(port);
  const e = reg.ports[key] || { reserved: false };
  e.sealed = true;
  if (note !== undefined) e.note = note;
  e.updatedAt = now();
  reg.ports[key] = e;
  return reg;
}

export function unseal(reg, port) {
  const key = String(port);
  const e = reg.ports[key];
  if (!e) return reg;
  e.sealed = false;
  e.updatedAt = now();
  if (!e.reserved && !e.sealed) delete reg.ports[key];
  return reg;
}

export function entries(reg) {
  return Object.entries(reg.ports)
    .map(([port, e]) => ({ port: Number(port), ...e }))
    .sort((a, b) => a.port - b.port);
}

// Registry-derived status for a port (live state is layered on top by the CLI).
export function statusOf(entry) {
  if (entry?.sealed) return "SEALED";
  if (entry?.reserved || entry?.project) return "RESERVED";
  return null;
}
