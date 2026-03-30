#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import {
  buildCompilationScaffold,
  listTemplates,
  resolveGenerationSettings,
  resolveTemplate,
} from '../video/template-registry.js';
import { VIDEOS_DIR, isMainModule } from '../core/paths.js';
import { writeAssetManifestIfMissing } from '../video/asset-manifest.js';

function parseArgs(args) {
  const opts = {
    topic: null,
    template: null,
    outputName: null,
    clips: null,
    clipDuration: null,
    targetLength: null,
    out: null,
    force: false,
    listTemplates: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template' && args[i + 1]) {
      opts.template = args[++i];
    } else if (args[i] === '--output-name' && args[i + 1]) {
      opts.outputName = args[++i];
    } else if (args[i] === '--clips' && args[i + 1]) {
      opts.clips = parseInt(args[++i], 10);
    } else if (args[i] === '--clip-duration' && args[i + 1]) {
      opts.clipDuration = parseInt(args[++i], 10);
    } else if (args[i] === '--target-length' && args[i + 1]) {
      opts.targetLength = parseInt(args[++i], 10);
    } else if (args[i] === '--out' && args[i + 1]) {
      opts.out = args[++i];
    } else if (args[i] === '--force') {
      opts.force = true;
    } else if (args[i] === '--list-templates') {
      opts.listTemplates = true;
    } else if (!args[i].startsWith('--')) {
      opts.topic = args[i];
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

function resolveOutputPath({ topic, outputName, out }) {
  if (out) {
    return path.resolve(out);
  }

  const slug = safeOutputName(outputName || topic, 'video');
  return path.join(VIDEOS_DIR, slug, `${slug}.md`);
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.listTemplates) {
    console.log('\nAvailable video templates:\n');
    for (const template of listTemplates()) {
      console.log(`- ${template.id}: ${template.description}`);
    }
    return;
  }

  if (!opts.topic) {
    console.error('Usage: node code/cli/video-template-scaffold.js "topic" --template id [--output-name slug] [--out path] [--force]');
    process.exit(1);
  }

  const resolvedTemplate = resolveTemplate(opts.template);
  const settings = resolveGenerationSettings(opts, resolvedTemplate);
  const outputPath = resolveOutputPath({
    topic: opts.topic,
    outputName: opts.outputName,
    out: opts.out,
  });

  if (fs.existsSync(outputPath) && !opts.force) {
    console.error(`Refusing to overwrite existing scaffold: ${outputPath}`);
    console.error('Pass --force to replace it.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const scaffold = buildCompilationScaffold({
    topic: opts.topic,
    resolvedTemplate,
    settings,
  });

  fs.writeFileSync(outputPath, scaffold);
  const manifestPath = writeAssetManifestIfMissing({
    topic: opts.topic,
    resolvedTemplate,
    settings,
    videosDir: path.dirname(outputPath),
    mdPath: outputPath,
  });
  console.log(`Scaffolded compilation markdown: ${outputPath}`);
  console.log(`Initialized asset manifest: ${manifestPath}`);
}

if (isMainModule(import.meta.url)) {
  main();
}
