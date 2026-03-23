#!/usr/bin/env node

import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'export-grok-cookies.py');
const venvPython = path.join(__dirname, '..', '..', '.venv', 'bin', 'python');

// Forward CLI args to the Python script
const args = process.argv.slice(2);

try {
  execFileSync(venvPython, [scriptPath, ...args], { stdio: 'inherit' });
} catch (error) {
  process.exit(error.status || 1);
}
