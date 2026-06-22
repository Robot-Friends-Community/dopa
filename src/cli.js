// DoPA command-line interface.
//
// Commands (with friendly aliases):
//   patrol | scan          list every listening port + who's on it
//   inspect <port>         detail for one port
//   permit  <port>         reserve a port in the registry  (--project --note)
//   revoke  <port>         release a reservation
//   seal    <port>         add to the do-not-kill list      (--note)
//   unseal  <port>         remove from the do-not-kill list
//   evict   <port>         guarded kill (refuses sealed/reserved/system w/o --force)
//   claim                  find + reserve a free port in a band (--range --project --note)
//   registry | ls          show the registry (reserved + sealed) and live state
//   help · version

import { readFileSync } from "node:fs";
import {
  listListening,
  onPort,
  killPid,
} from "./ports.js";
import {
  identifyService,
  isSystemProcess,
} from "./services.js";
import {
  load,
  save,
  getEntry,
  permit,
  revoke,
  seal,
  unseal,
  entries,
  statusOf,
  registryPath,
} from "./registry.js";
import { table, statusBadge, bold, dim, gray, green, red, yellow, cyan } from "./format.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const DEFAULT_BAND = "40400-40499"; // DoPA's recommended uncommon dev band

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (a.startsWith("-") && a.length > 1) {
      flags[a.slice(1)] = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function fail(msg) {
  console.error(red("✗ ") + msg);
  process.exitCode = 1;
}

function validPort(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : null;
}

// status for a live row, layering registry over system detection
function rowStatus(entry, row) {
  const reg = statusOf(entry);
  if (reg) return reg;
  if (row && isSystemProcess(row.process)) return "SYSTEM";
  return "LIVE";
}

function cmdPatrol(flags) {
  const live = listListening();
  const reg = load();
  if (flags.json) {
    const out = live.map((r) => ({
      ...r,
      service: identifyService(r.port, r.process),
      status: rowStatus(getEntry(reg, r.port), r),
      registry: getEntry(reg, r.port) || null,
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (!live.length) {
    console.log(dim("No listening TCP ports found."));
    return;
  }
  const rows = live.map((r) => {
    const e = getEntry(reg, r.port);
    return [
      bold(r.port),
      r.pid ?? "—",
      r.process || "?",
      identifyService(r.port, r.process),
      statusBadge(rowStatus(e, r)),
      e?.note ? dim(e.note) : "",
    ];
  });
  console.log(table(["PORT", "PID", "PROCESS", "SERVICE", "STATUS", "NOTE"], rows));
  console.log(dim(`\n${live.length} listening · registry: ${registryPath()}`));
}

function cmdInspect(positionals) {
  const port = validPort(positionals[0]);
  if (!port) return fail("inspect needs a valid port, e.g. `dopa inspect 3000`");
  const reg = load();
  const e = getEntry(reg, port);
  const live = onPort(port);
  console.log(bold(`Port ${port}`) + "  " + statusBadge(rowStatus(e, live[0])));
  console.log(dim("service: ") + identifyService(port, live[0]?.process));
  if (live.length) {
    for (const r of live) {
      console.log(dim("live:    ") + `pid ${r.pid ?? "?"} · ${r.process || "?"} · ${r.address}`);
    }
  } else {
    console.log(dim("live:    ") + gray("nothing listening"));
  }
  if (e) {
    if (e.reserved || e.project) console.log(dim("reserved:") + ` ${e.project || "(no project)"}`);
    if (e.sealed) console.log(dim("sealed:  ") + red("do-not-kill"));
    if (e.note) console.log(dim("note:    ") + e.note);
    if (e.updatedAt) console.log(dim("updated: ") + e.updatedAt);
  } else {
    console.log(dim("registry:") + gray(" no entry"));
  }
}

function cmdPermit(positionals, flags) {
  const port = validPort(positionals[0]);
  if (!port) return fail("permit needs a valid port, e.g. `dopa permit 40404 --project workbench`");
  const reg = load();
  permit(reg, port, { project: typeof flags.project === "string" ? flags.project : undefined, note: typeof flags.note === "string" ? flags.note : undefined });
  save(reg);
  const e = getEntry(reg, port);
  console.log(green("✓ permit issued ") + bold(`:${port}`) + dim(`  ${e.project ? `for ${e.project}` : ""}${e.note ? ` — ${e.note}` : ""}`));
}

function cmdRevoke(positionals) {
  const port = validPort(positionals[0]);
  if (!port) return fail("revoke needs a valid port");
  const reg = load();
  if (!getEntry(reg, port)) return console.log(dim(`:${port} had no permit.`));
  revoke(reg, port);
  save(reg);
  console.log(green("✓ permit revoked ") + bold(`:${port}`));
}

function cmdSeal(positionals, flags) {
  const port = validPort(positionals[0]);
  if (!port) return fail("seal needs a valid port, e.g. `dopa seal 5432 --note 'prod-like db'`");
  const reg = load();
  seal(reg, port, { note: typeof flags.note === "string" ? flags.note : undefined });
  save(reg);
  console.log(red("🔒 sealed ") + bold(`:${port}`) + dim("  (do-not-kill — evict will refuse without --force)"));
}

function cmdUnseal(positionals) {
  const port = validPort(positionals[0]);
  if (!port) return fail("unseal needs a valid port");
  const reg = load();
  unseal(reg, port);
  save(reg);
  console.log(green("✓ unsealed ") + bold(`:${port}`));
}

function cmdRegistry(flags) {
  const reg = load();
  const list = entries(reg);
  if (flags.json) return console.log(JSON.stringify(list, null, 2));
  if (!list.length) {
    console.log(dim("Registry empty. Reserve a port with `dopa permit <port>` or `dopa seal <port>`."));
    return;
  }
  const liveMap = new Map(listListening().map((r) => [r.port, r]));
  const rows = list.map((e) => {
    const r = liveMap.get(e.port);
    return [
      bold(e.port),
      statusBadge(e.sealed ? "SEALED" : "RESERVED"),
      e.project || dim("—"),
      e.note || dim("—"),
      r ? green(`● ${r.process || "live"}`) : gray("· not running"),
    ];
  });
  console.log(table(["PORT", "STATUS", "PROJECT", "NOTE", "LIVE"], rows));
  console.log(dim(`\n${list.length} registered · ${registryPath()}`));
}

function cmdEvict(positionals, flags) {
  const port = validPort(positionals[0]);
  if (!port) return fail("evict needs a valid port, e.g. `dopa evict 3000`");
  const force = Boolean(flags.force || flags.f);
  const reg = load();
  const e = getEntry(reg, port);
  const live = onPort(port);

  if (!live.length) {
    console.log(dim(`Nothing is listening on :${port}.`));
    if (e) console.log(dim(`(It's still in the registry — `) + `dopa revoke ${port}` + dim(` / `) + `dopa unseal ${port}` + dim(` to clear.)`));
    return;
  }

  // Guards — refuse without --force.
  if (e?.sealed && !force) {
    return fail(`:${port} is ${red("SEALED")} (do-not-kill)${e.note ? ` — ${e.note}` : ""}. Use ${bold("--force")} to override.`);
  }
  if ((e?.reserved || e?.project) && !force) {
    return fail(`:${port} is ${cyan("RESERVED")}${e.project ? ` for ${e.project}` : ""}. Use ${bold("--force")} to override.`);
  }
  const sysProc = live.find((r) => isSystemProcess(r.process));
  if (sysProc && !force) {
    return fail(`:${port} is held by a ${yellow("SYSTEM")} process (${sysProc.process}). Use ${bold("--force")} if you really mean it.`);
  }

  let killed = 0;
  for (const r of live) {
    if (!r.pid) continue;
    try {
      killPid(r.pid);
      killed++;
      console.log(green("✓ evicted ") + `pid ${r.pid} (${r.process || "?"}) from :${port}`);
    } catch (err) {
      fail(`could not evict pid ${r.pid}: ${err?.message || err}`);
    }
  }
  if (killed && force && (e?.sealed || e?.reserved)) {
    console.log(dim("(registry entry kept — `dopa revoke`/`unseal` to remove it.)"));
  }
}

function cmdClaim(flags) {
  const band = typeof flags.range === "string" ? flags.range : DEFAULT_BAND;
  const m = band.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return fail(`--range must look like 40400-40499 (got "${band}")`);
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  if (lo > hi) return fail("--range start must be <= end");

  const reg = load();
  const liveSet = new Set(listListening().map((r) => r.port));
  let chosen = null;
  for (let p = lo; p <= hi; p++) {
    if (liveSet.has(p)) continue;
    if (getEntry(reg, p)) continue;
    chosen = p;
    break;
  }
  if (!chosen) return fail(`no free + unreserved port in ${band}.`);

  permit(reg, chosen, {
    project: typeof flags.project === "string" ? flags.project : undefined,
    note: typeof flags.note === "string" ? flags.note : undefined,
  });
  save(reg);
  if (flags.quiet || flags.q) {
    console.log(chosen); // bare number, for scripting:  PORT=$(dopa claim -q)
  } else {
    console.log(green("✓ claimed ") + bold(`:${chosen}`) + dim(`  reserved in ${band}${typeof flags.project === "string" ? ` for ${flags.project}` : ""}`));
    console.log(dim(`  start your server on ${chosen} (e.g. \`next dev -p ${chosen}\`).`));
  }
}

function help() {
  console.log(`${bold("dopa")} ${dim("·")} Department of Port Authorities ${dim(`(v${pkg.version})`)}
${dim("Track, protect, and clear local-dev ports. Stop killing each other's dev servers.")}

${bold("USAGE")}
  dopa <command> [port] [flags]

${bold("INSPECT")}
  patrol, scan            List every listening port + PID, process, service, status
  inspect <port>          Show detail for one port

${bold("REGISTRY")}
  permit <port>           Reserve a port            ${dim("--project <name> --note <text>")}
  revoke <port>           Release a reservation
  registry, ls            Show the registry + live state
  claim                   Find + reserve a free port ${dim("--range 40400-40499 --project --note [-q]")}

${bold("PROTECT")}
  seal <port>             Add to the do-not-kill list ${dim("--note <text>")}
  unseal <port>           Remove from the do-not-kill list
  evict <port>            Guarded kill ${dim("(refuses sealed/reserved/system without --force)")}

${bold("FLAGS")}
  --force, -f             Override evict guards
  --json                  Machine-readable output (patrol, registry)
  --quiet, -q             Bare port number only (claim)
  --help, -h · --version, -v

${bold("EXAMPLES")}
  dopa patrol
  dopa claim --range 40400-40499 --project workbench
  dopa seal 5432 --note "prod-like db — don't touch"
  dopa evict 3000
  PORT=$(dopa claim -q) && next dev -p $PORT

${dim(`registry: ${registryPath()}`)}`);
}

export function run(argv) {
  const { positionals, flags } = parseArgs(argv);
  const cmd = (positionals.shift() || "").toLowerCase();

  if (flags.version || flags.v || cmd === "version") return console.log(pkg.version);
  if (!cmd || flags.help || flags.h || cmd === "help") return help();

  switch (cmd) {
    case "patrol":
    case "scan":
      return cmdPatrol(flags);
    case "inspect":
    case "check":
      return cmdInspect(positionals);
    case "permit":
    case "reserve":
      return cmdPermit(positionals, flags);
    case "revoke":
    case "release":
    case "free":
      return cmdRevoke(positionals);
    case "seal":
    case "protect":
      return cmdSeal(positionals, flags);
    case "unseal":
    case "unprotect":
      return cmdUnseal(positionals);
    case "registry":
    case "ls":
    case "list":
      return cmdRegistry(flags);
    case "evict":
    case "kill":
      return cmdEvict(positionals, flags);
    case "claim":
      return cmdClaim(flags);
    default:
      fail(`unknown command "${cmd}". Run \`dopa help\`.`);
  }
}
