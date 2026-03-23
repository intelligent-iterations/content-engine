#!/usr/bin/env node

import { main as runGrokVideoAutomation } from '../video/grok-video-automation.js';

runGrokVideoAutomation().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
