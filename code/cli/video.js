#!/usr/bin/env node

import { main as runVideoGeneration } from '../video/generate-video.js';

runVideoGeneration().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
