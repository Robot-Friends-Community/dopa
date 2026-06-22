#!/usr/bin/env node
import { run } from "../src/cli.js";

try {
  run(process.argv.slice(2));
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
