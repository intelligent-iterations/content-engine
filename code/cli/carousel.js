#!/usr/bin/env node

import { generateSlideshowV2 } from '../carousel/generate-slideshow.js';

generateSlideshowV2().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
