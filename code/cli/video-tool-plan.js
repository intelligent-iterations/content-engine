#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { main as manageVideoAssets } from './video-assets.js';

export async function main(argv = process.argv.slice(2)) {
  await manageVideoAssets(['plan', ...argv]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
