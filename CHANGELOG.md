# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-06-22

Initial release — the Department of Port Authorities opens its doors.

### Added
- **Inspect:** `patrol` / `scan` (all listening ports with PID, process, service label, status) and `inspect <port>`.
- **Registry:** `permit` / `revoke`, `registry` / `ls`, and `claim` (find + reserve a free port in a band; defaults to `40400-40499`).
- **Protect:** `seal` / `unseal` (the do-not-kill list) and a guarded `evict` that refuses sealed, reserved, and system-critical ports without `--force`.
- Cross-platform port discovery (macOS `lsof`, Linux `ss`→`lsof`, Windows `netstat`+`tasklist`), zero runtime dependencies.
- Persistent JSON registry at `~/.dopa/registry.json` (override with `DOPA_HOME`).
- `--json` output for `patrol` and `registry`; `--quiet` bare-port output for `claim`.
- Test suite (`node --test`) covering the port parsers, service identification, and registry semantics.

### Credits
- Cross-platform port-discovery approach adapted from [portcop](https://github.com/Hawila/portcop) (MIT).
- Service-identification + safety-tier concept from [portrm](https://github.com/abhishekayu/portrm) (MIT).
