#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { autoPostTikTokVideo } from './auto-post-tiktok-ai-video.js';

const VALID_SLOTS = new Set(['morning', 'evening']);

function parseSlot(argv) {
  const slotArg = argv.find(arg => !arg.startsWith('--'));
  const slot = String(slotArg || '').toLowerCase();
  if (!VALID_SLOTS.has(slot)) {
    throw new Error('Usage: node code/posting/run-tiktok-slot.js <morning|evening> [--dry-run]');
  }
  return slot;
}

async function main() {
  const slot = parseSlot(process.argv.slice(2));
  const dryRun = process.argv.includes('--dry-run');
  console.log(`TikTok slot: ${slot}`);
  if (dryRun) {
    process.argv.push('--dry-run');
  }
  return autoPostTikTokVideo();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`TikTok slot runner failed: ${error.message}`);
    process.exit(1);
  });
}

export { main as runTikTokSlot };
