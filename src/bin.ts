#!/usr/bin/env node
import { run } from './cli.js';
run({ argv: process.argv.slice(2), stdout: (s) => process.stdout.write(s), stderr: (s) => process.stderr.write(s) }).then((c) => process.exit(c));
