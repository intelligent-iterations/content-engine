#!/usr/bin/env node

import { main as runVideoCompilation } from '../video/generate-video-compilation.js';

runVideoCompilation().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
