// Best-effort identification of what's likely running on a port, and whether a
// process looks like a system/critical process (so DoPA can warn before evicting).
//
// Two signals, cheapest first:
//   1. Well-known port number  → a label.
//   2. Process name            → a label.
// The port hint wins when both are present (it's more specific to dev intent).

export const PORT_HINTS = {
  80: "HTTP",
  443: "HTTPS",
  3000: "Next.js / React / Node dev",
  3001: "Node dev (alt)",
  3306: "MySQL / MariaDB",
  4000: "Phoenix / dev server",
  5000: "Flask / dev server",
  5173: "Vite dev",
  5432: "PostgreSQL",
  5433: "PostgreSQL (alt)",
  6379: "Redis",
  8000: "Python / Django dev",
  8080: "HTTP alt / dev proxy",
  8443: "HTTPS alt",
  8888: "Jupyter / dev",
  9000: "PHP-FPM / dev",
  9229: "Node debugger (inspect)",
  11434: "Ollama",
  27017: "MongoDB",
  // DoPA's recommended uncommon dev band (see README).
  40404: "reserved dev band (DoPA 404xx)",
};

const PROC_HINTS = [
  [/^node(\.exe)?$/i, "Node app"],
  [/next/i, "Next.js"],
  [/vite/i, "Vite"],
  [/python|uvicorn|gunicorn/i, "Python app"],
  [/postgres/i, "PostgreSQL"],
  [/redis/i, "Redis"],
  [/mongod/i, "MongoDB"],
  [/mysqld|mariadb/i, "MySQL/MariaDB"],
  [/docker|com\.docker/i, "Docker"],
  [/ollama/i, "Ollama"],
  [/nginx/i, "nginx"],
  [/caddy/i, "Caddy"],
];

export function identifyService(port, processName) {
  if (PORT_HINTS[port]) return PORT_HINTS[port];
  if (processName && processName !== "?") {
    for (const [re, label] of PROC_HINTS) if (re.test(processName)) return label;
    return processName;
  }
  return "—";
}

// Processes that should never be casually killed. Used to flag SYSTEM status and
// to make `evict` refuse without --force even when there's no registry entry.
const SYSTEM_PROCS = [
  /^system$/i,
  /^idle$/i,
  /svchost/i,
  /lsass/i,
  /services\.exe/i,
  /winlogon/i,
  /csrss/i,
  /wininit/i,
  /launchd/i,
  /^systemd/i,
  /^kernel/i,
  /sshd/i,
];

export function isSystemProcess(processName) {
  if (!processName || processName === "?") return false;
  return SYSTEM_PROCS.some((re) => re.test(processName));
}
