#!/usr/bin/env node

import { resolveGeneratedVideoDir, scheduleVideo } from '../shared/scheduled-queue.js';

const args = process.argv.slice(2);
const source = args[0];
const slugIdx = args.indexOf('--slug');
const slug = slugIdx !== -1 ? args[slugIdx + 1] : null;

if (!source) {
  console.error('Usage: node code/cli/schedule-video.js <videos-folder> [--slug output-slug]');
  process.exit(1);
}

const result = scheduleVideo(resolveGeneratedVideoDir(source), { slug });
console.log(`Scheduled video: ${result.targetDir}`);
