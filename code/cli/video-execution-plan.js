#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  materializeExecutionPlanFromMd,
} from '../video/generate-video-compilation.js';

function parseArgs(argv) {
  const args = {
    md: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--md' && argv[i + 1]) {
      args.md = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      args.json = true;
    } else if (!arg.startsWith('--') && !args.md) {
      args.md = arg;
    }
  }

  return args;
}

function printPlan(plan, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`Template: ${plan.templateLabel} (${plan.templateId})`);
  console.log(`Reference strategy: ${plan.referenceStrategy}`);
  console.log(`Clip duration: ${plan.clipDurationSeconds}s`);
  console.log('');

  for (const job of plan.jobs) {
    console.log(`[clip ${job.clipIndex}] ${job.name}`);
    if (job.sceneReferenceImagePath) {
      console.log(`  scene ref: ${job.sceneReferenceImagePath}`);
    }
    console.log(`  primary prompt chars: ${job.primaryVideoPrompt.length}`);
    if (job.fallbackVideoPrompt) {
      console.log(`  fallback prompt chars: ${job.fallbackVideoPrompt.length}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.md) {
    console.log('Usage: node code/cli/video-execution-plan.js <path-to-compilation.md> [--json]');
    return;
  }

  const mdPath = path.resolve(args.md);
  if (!fs.existsSync(mdPath)) {
    throw new Error(`File not found: ${mdPath}`);
  }

  const { plan, planPath } = materializeExecutionPlanFromMd(mdPath);
  printPlan(plan, args.json);
  if (!args.json) {
    console.log(`\nSaved: ${planPath}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
