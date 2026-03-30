#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { autoPostXAIVideo } from './auto-post-x-ai-video.js';
import { autoPostToX } from './auto-post-x.js';

const VALID_SLOTS = new Set(['morning', 'midday', 'evening']);

function parseSlot(argv) {
  const slotArg = argv.find(arg => !arg.startsWith('--'));
  const slot = String(slotArg || '').toLowerCase();
  if (!VALID_SLOTS.has(slot)) {
    throw new Error('Usage: node code/posting/run-x-slot.js <morning|midday|evening> [--dry-run]');
  }
  return slot;
}

async function main() {
  const slot = parseSlot(process.argv.slice(2));
  const dryRun = process.argv.includes('--dry-run');
  console.log(`X slot: ${slot}`);

  if (slot === 'midday') {
    if (dryRun) {
      process.argv.push('--dry-run');
    }
    return autoPostToX();
  }

  if (dryRun) {
    process.argv.push('--dry-run');
  }
  return autoPostXAIVideo();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`X slot runner failed: ${error.message}`);
    process.exit(1);
  });
}

export { main as runXSlot };
