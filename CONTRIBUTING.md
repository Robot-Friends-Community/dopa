# Contributing to DoPA

Thanks for helping out! DoPA is a small, dependency-free Node CLI — easy to read, easy to extend.

## Development setup

```bash
git clone https://github.com/Robot-Friends-Community/dopa
cd dopa
npm link          # makes `dopa` available globally, pointing at your checkout
npm test          # runs the test suite (node --test)
```

There are **no runtime dependencies** — please keep it that way. The only thing we shell out to is the OS's own port tooling (`lsof` / `ss` / `netstat` / `tasklist`).

## Branch flow

```
main  ← dev  ← feature/*
```

- `main` — stable; what `npm install -g github:Robot-Friends-Community/dopa` installs. Released/tagged from here.
- `dev` — integration branch.
- `feature/*` — one concern per branch; open a PR into `dev`.

(GitHub Free doesn't enforce branch protection, so this is a convention — please follow it.)

## Code conventions

- **ESM**, Node ≥ 18, zero runtime deps.
- **Keep the port parsers pure and tested.** `parseNetstat` / `parseLsof` / `parseSs` / `parseTasklist` take a string and return rows — never spawn a process inside a parser, so they stay unit-testable with fixtures.
- **Never build a shell string.** Always `execFileSync(cmd, argsArray)` so there's no command-injection surface.
- **The `evict` guard is sacred.** It must refuse sealed / reserved / system ports unless `--force`. If you touch it, add a test.
- Cross-platform matters: if you add a code path, account for win32 / darwin / linux.

## Adding a service label or port hint

Edit `src/services.js`:
- add a well-known port to `PORT_HINTS`, or
- add a process-name pattern to `PROC_HINTS`.

Add a line to the `identifyService` test in `test/dopa.test.js`.

## Pull requests

1. Branch off `dev`.
2. `npm test` must pass.
3. Add a `CHANGELOG.md` entry under `## [Unreleased]`.
4. Open the PR into `dev` and fill out the template.

By contributing you agree your work is licensed under the project's [MIT License](LICENSE), and you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
