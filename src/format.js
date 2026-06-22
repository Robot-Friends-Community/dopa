// Tiny zero-dependency formatting helpers (ANSI + tables).
// Respects NO_COLOR and non-TTY output.

const noColor = Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;

const wrap = (code) => (s) => (noColor ? String(s) : `\x1b[${code}m${s}\x1b[0m`);

export const bold = wrap(1);
export const dim = wrap(2);
export const red = wrap(31);
export const green = wrap(32);
export const yellow = wrap(33);
export const blue = wrap(34);
export const magenta = wrap(35);
export const cyan = wrap(36);
export const gray = wrap(90);

// Visible (ANSI-stripped) length, for column alignment.
const visLen = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "").length;

export function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(visLen(h), ...rows.map((r) => visLen(r[i] ?? "")))
  );
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - visLen(s)));
  const line = (cells) => cells.map((c, i) => pad(String(c ?? ""), widths[i])).join("  ");
  const out = [bold(line(headers))];
  out.push(gray(widths.map((w) => "─".repeat(w)).join("  ")));
  for (const r of rows) out.push(line(r));
  return out.join("\n");
}

// Status badge for a port row.
export function statusBadge(status) {
  switch (status) {
    case "SEALED":
      return red("🔒 SEALED");
    case "RESERVED":
      return cyan("◆ RESERVED");
    case "SYSTEM":
      return yellow("⚙ SYSTEM");
    case "LIVE":
      return green("● live");
    case "FREE":
      return gray("· free");
    default:
      return status || "";
  }
}
