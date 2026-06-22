# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Email **richard@404notfound.red** with details and steps to reproduce. We aim to acknowledge within a few days and will coordinate a fix before any public disclosure. We ask for up to a **90-day** window before details are made public.

## Scope notes

DoPA runs locally and shells out to the OS's own port tooling (`lsof` / `ss` / `netstat` / `tasklist`) using `execFileSync` with argument arrays (no shell string interpolation). The registry is a plain JSON file under `~/.dopa/` (or `$DOPA_HOME`). DoPA can terminate processes via `evict` — by design it refuses sealed, reserved, and system-critical ports unless `--force` is given. Reports about ways to bypass that guard, or any command-injection / privilege issue, are especially welcome.
