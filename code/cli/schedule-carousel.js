#!/usr/bin/env node

import { resolveGeneratedCarouselDir, scheduleCarousel } from '../shared/scheduled-queue.js';

const args = process.argv.slice(2);
const source = args[0];
const slugIdx = args.indexOf('--slug');
const slug = slugIdx !== -1 ? args[slugIdx + 1] : null;

if (!source) {
  console.error('Usage: node code/cli/schedule-carousel.js <carousels-folder> [--slug output-slug]');
  process.exit(1);
}

const result = scheduleCarousel(resolveGeneratedCarouselDir(source), { slug });
console.log(`Scheduled carousel: ${result.targetDir}`);
