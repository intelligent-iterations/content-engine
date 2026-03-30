#!/usr/bin/env node

import path from 'path';
import { fileURLToPath } from 'url';
import { main as scaffoldVideoTemplate } from './video-template-scaffold.js';
import { main as manageVideoAssets } from './video-assets.js';
import { main as renderVideo } from '../video/generate-video.js';
import { loadAssetManifest } from '../video/asset-manifest.js';
import { buildVideoToolPlan, saveVideoToolPlan } from '../video/tool-plan.js';
import { materializeExecutionPlanFromMd } from '../video/generate-video-compilation.js';
import { resolveGeneratedVideoDir, scheduleVideo } from '../shared/scheduled-queue.js';

function parseArgs(args) {
  const opts = {
    command: null,
    topic: null,
    template: null,
    outputName: null,
    md: null,
    slug: null,
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!opts.command && !arg.startsWith('--')) {
      opts.command = arg;
    } else if (arg === '--template' && args[i + 1]) {
      opts.template = args[++i];
    } else if (arg === '--output-name' && args[i + 1]) {
      opts.outputName = args[++i];
    } else if (arg === '--md' && args[i + 1]) {
      opts.md = args[++i];
    } else if (arg === '--slug' && args[i + 1]) {
      opts.slug = args[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (!arg.startsWith('--') && !opts.topic) {
      opts.topic = arg;
    }
  }

  return opts;
}

function safeOutputName(value, fallback = 'video') {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  return normalized || fallback;
}

function inferRunDir({ outputName, topic, md }) {
  if (md) {
    return path.dirname(path.resolve(md));
  }

  return resolveGeneratedVideoDir(safeOutputName(outputName || topic, 'video'));
}

function inferMdPath({ outputName, topic, md }) {
  if (md) {
    return path.resolve(md);
  }

  const runDir = inferRunDir({ outputName, topic, md });
  const slug = safeOutputName(outputName || topic, 'video');
  return path.join(runDir, `${slug}.md`);
}

async function runPrepare(opts) {
  if (!opts.topic || !opts.template) {
    throw new Error('prepare requires a topic and --template.');
  }

  const args = [opts.topic, '--template', opts.template];
  if (opts.outputName) {
    args.push('--output-name', opts.outputName);
  }
  if (opts.md) {
    args.push('--out', opts.md);
  }
  if (opts.force) {
    args.push('--force');
  }

  await scaffoldVideoTemplate(args);

  const assetArgs = ['init', '--topic', opts.topic, '--template', opts.template];
  if (opts.outputName) {
    assetArgs.push('--output-name', opts.outputName);
  }
  await manageVideoAssets(assetArgs);

  const runDir = inferRunDir(opts);
  const manifestPath = path.join(runDir, 'asset-manifest.json');
  const mdPath = inferMdPath(opts);
  const manifest = loadAssetManifest(manifestPath);
  saveVideoToolPlan(buildVideoToolPlan({ manifest, manifestPath }), manifestPath);
  materializeExecutionPlanFromMd(mdPath);
}

async function runRender(opts) {
  if (!opts.topic) {
    throw new Error('render requires a topic.');
  }

  const args = [opts.topic];
  if (opts.template) {
    args.push('--template', opts.template);
  }
  if (opts.outputName) {
    args.push('--output-name', opts.outputName);
  }
  if (opts.md) {
    args.push('--md', opts.md);
  }
  if (opts.dryRun) {
    args.push('--dry-run');
  }

  await renderVideo(args);
}

async function runQueue(opts) {
  const runDir = inferRunDir(opts);
  const result = scheduleVideo(runDir, { slug: opts.slug });
  console.log(`Queued video: ${result.targetDir}`);
}

async function runShip(opts) {
  await runRender(opts);
  if (opts.dryRun) {
    return;
  }
  await runQueue(opts);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const command = opts.command || 'help';

  if (command === 'help') {
    console.log('Usage: node code/cli/video-workflow.js <prepare|render|queue|ship> "topic" [options]');
    console.log('  prepare "topic" --template template-id [--output-name slug] [--md path] [--force]');
    console.log('  render "topic" --template template-id [--output-name slug] [--md path] [--dry-run]');
    console.log('  queue "topic" [--output-name slug] [--md path] [--slug queue-slug]');
    console.log('  ship "topic" --template template-id [--output-name slug] [--md path]');
    return;
  }

  if (command === 'prepare') {
    await runPrepare(opts);
    return;
  }

  if (command === 'render') {
    await runRender(opts);
    return;
  }

  if (command === 'queue') {
    await runQueue(opts);
    return;
  }

  if (command === 'ship') {
    await runShip(opts);
    return;
  }

  throw new Error(`Unknown command "${command}"`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
