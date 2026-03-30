#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import {
  generateImage,
  downloadImage,
  IMAGE_MODELS,
  normalizeImageBufferForOutputPath,
  padImageBufferToAspectRatio,
  parseAspectRatio,
} from '../shared/generate-image.js';
import {
  assetManifestPathForRun,
  loadAssetManifest,
  saveAssetManifest,
  writeAssetManifestIfMissing,
} from '../video/asset-manifest.js';
import {
  resolveGenerationSettings,
  resolveTemplate,
} from '../video/template-registry.js';
import {
  buildVideoToolPlan,
  filterJobsByStage,
  loadVideoToolPlan,
  saveVideoToolPlan,
} from '../video/tool-plan.js';
import { parseCompilationMD } from '../video/generate-video-compilation.js';
import { VIDEOS_DIR, isMainModule } from '../core/paths.js';

function parseArgs(args) {
  const opts = {
    command: null,
    topic: null,
    template: null,
    outputName: null,
    manifest: null,
    plan: null,
    stage: null,
    json: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!opts.command && !arg.startsWith('--')) {
      opts.command = arg;
    } else if (arg === '--topic' && args[i + 1]) {
      opts.topic = args[++i];
    } else if (arg === '--template' && args[i + 1]) {
      opts.template = args[++i];
    } else if (arg === '--output-name' && args[i + 1]) {
      opts.outputName = args[++i];
    } else if (arg === '--manifest' && args[i + 1]) {
      opts.manifest = args[++i];
    } else if (arg === '--plan' && args[i + 1]) {
      opts.plan = args[++i];
    } else if (arg === '--stage' && args[i + 1]) {
      opts.stage = args[++i];
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--force') {
      opts.force = true;
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

function inferRunDir({ outputName, topic }) {
  const slug = safeOutputName(outputName || topic, 'video');
  return path.join(VIDEOS_DIR, slug);
}

function resolveManifestPath(opts) {
  if (opts.manifest) {
    return path.resolve(opts.manifest);
  }
  return assetManifestPathForRun(inferRunDir(opts));
}

function outputFormatForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'jpeg';
  }
  if (ext === '.webp') {
    return 'webp';
  }
  return 'png';
}

async function writeImageToPath(imageResult, destinationPath, options = {}) {
  let buffer = await downloadImage(imageResult);

  if (options.normalizeAspectRatio) {
    buffer = await padImageBufferToAspectRatio(buffer, {
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      outputFormat: outputFormatForPath(destinationPath),
    });
  }

  const normalizedBuffer = await normalizeImageBufferForOutputPath(buffer, destinationPath);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, normalizedBuffer);
}

async function loadReferenceImages(referenceImagePaths = [], manifestDir, options = {}) {
  const referenceImages = [];

  for (const referenceImagePath of referenceImagePaths) {
    const resolvedPath = path.resolve(manifestDir, referenceImagePath);
    if (fs.existsSync(resolvedPath)) {
      let buffer = fs.readFileSync(resolvedPath);
      if (options.normalizeAspectRatio && options.aspectRatio) {
        buffer = await padImageBufferToAspectRatio(buffer, {
          aspectRatio: options.aspectRatio,
          resolution: options.resolution,
          outputFormat: 'png',
        });
      }
      referenceImages.push({
        buffer,
        filePath: resolvedPath,
      });
    }
  }

  return referenceImages;
}

function addAspectHintToPrompt(prompt, aspectRatio) {
  const text = String(prompt || '').trim();
  if (!text || !aspectRatio) {
    return text;
  }

  const lower = text.toLowerCase();
  if (
    lower.includes(String(aspectRatio).toLowerCase())
    || lower.includes('vertical')
    || lower.includes('portrait')
    || lower.includes('landscape')
    || lower.includes('horizontal')
  ) {
    return text;
  }

  const ratio = parseAspectRatio(aspectRatio);
  const orientation = ratio.width <= ratio.height ? 'vertical portrait' : 'horizontal landscape';
  return `Create this as a ${orientation} ${aspectRatio} composition. ${text}`;
}

async function generateFromPrompt(prompt, destinationPath, force = false, options = {}) {
  if (!force && fs.existsSync(destinationPath)) {
    return false;
  }

  const referenceImages = await loadReferenceImages(
    options.referenceImagePaths || [],
    options.manifestDir || path.dirname(destinationPath),
    {
      normalizeAspectRatio: options.normalizeReferenceAspectRatio,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
    }
  );
  const promptWithAspectHint = addAspectHintToPrompt(prompt, options.aspectRatio);
  const imageResult = await generateImage(
    { xaiApiKey: process.env.XAI_API_KEY },
    promptWithAspectHint,
    {
      model: IMAGE_MODELS.grok,
      outDir: path.dirname(destinationPath),
      referenceImages,
      allowLetterCharacters: options.allowLetterCharacters,
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
    }
  );
  await writeImageToPath(imageResult, destinationPath, options);
  return true;
}

function createToolPlan(opts) {
  const manifestPath = resolveManifestPath(opts);
  const manifest = loadAssetManifest(manifestPath);
  return buildVideoToolPlan({ manifest, manifestPath });
}

function materializeToolPlan(opts) {
  const manifestPath = resolveManifestPath(opts);
  const toolPlan = createToolPlan(opts);
  const planPath = saveVideoToolPlan(toolPlan, manifestPath);
  return {
    toolPlan: loadVideoToolPlan(planPath),
    planPath,
  };
}

function resolveToolPlan(opts) {
  if (opts.plan) {
    const planPath = path.resolve(opts.plan);
    return {
      toolPlan: loadVideoToolPlan(planPath),
      planPath,
    };
  }

  return materializeToolPlan(opts);
}

function printToolPlan(toolPlan, asJson = false) {
  if (asJson) {
    console.log(JSON.stringify(toolPlan, null, 2));
    return;
  }

  console.log(`Template: ${toolPlan.template_label} (${toolPlan.template_id})`);
  if (toolPlan.plan_path) {
    console.log(`Plan: ${toolPlan.plan_path}`);
  }
  console.log(`Manifest: ${toolPlan.manifest_path}`);
  console.log('');

  for (const job of toolPlan.jobs) {
    console.log(`[${job.stage}] ${job.kind} :: ${job.entity_label}`);
    if (job.output_path) {
      console.log(`  output: ${job.output_path}`);
    }
    if (job.subject_image_path) {
      console.log(`  subject: ${job.subject_image_path}`);
    }
    if (job.reference_image_paths?.length) {
      console.log(`  refs: ${job.reference_image_paths.join(', ')}`);
    }
    if (job.verification_rules?.length) {
      console.log(`  rules: ${job.verification_rules.join(' | ')}`);
    }
  }
}

function printVerificationSummary(toolPlan, stage) {
  const verificationJobs = filterJobsByStage(toolPlan, stage, ['verify_reference_consistency']);
  if (verificationJobs.length === 0) {
    return;
  }

  console.log('\nVerification jobs declared by template:');
  for (const job of verificationJobs) {
    console.log(`- ${job.entity_label}: ${job.subject_image_path}`);
    for (const rule of job.verification_rules || []) {
      console.log(`  rule: ${rule}`);
    }
  }
}

async function runStage(opts, stage) {
  const { toolPlan } = resolveToolPlan(opts);
  const manifest = loadAssetManifest(toolPlan.manifest_path);
  const renderSettings = manifest.render_settings || {};
  const jobs = filterJobsByStage(toolPlan, stage, ['generate_image']);
  let generated = 0;

  for (const job of jobs) {
    const changed = await generateFromPrompt(job.prompt, job.output_absolute_path, opts.force, {
      manifestDir: path.dirname(toolPlan.manifest_path),
      referenceImagePaths: job.reference_image_paths || [],
      allowLetterCharacters: job.allow_letter_characters,
      aspectRatio: renderSettings.aspect_ratio,
      resolution: renderSettings.resolution,
      normalizeAspectRatio: Boolean(renderSettings.aspect_ratio),
      normalizeReferenceAspectRatio: Boolean(renderSettings.aspect_ratio),
    });
    if (changed) {
      generated += 1;
    }
  }

  console.log(`Generated ${stage}: ${generated}`);
  printVerificationSummary(toolPlan, stage);
}

async function initManifest(opts) {
  if (!opts.topic || !opts.template) {
    throw new Error('`init` requires --topic and --template.');
  }

  const resolvedTemplate = resolveTemplate(opts.template);
  const settings = resolveGenerationSettings({}, resolvedTemplate);
  const videosDir = inferRunDir(opts);
  const manifestPath = writeAssetManifestIfMissing({
    topic: opts.topic,
    resolvedTemplate,
    settings,
    videosDir,
  });

  const mdPath = path.join(videosDir, `${safeOutputName(opts.outputName || opts.topic, 'video')}.md`);
  if (fs.existsSync(mdPath)) {
    const manifest = loadAssetManifest(manifestPath);
    const clips = parseCompilationMD(mdPath);
    manifest.scene_start_frames = clips.map((clip, index) => ({
      clip_index: index + 1,
      clip_name: clip.name,
      source: 'compilation_markdown',
      image_prompt: clip.imagePrompt || '',
      output_path: `assets/scene-start-frames/clip${String(index + 1).padStart(2, '0')}-${safeOutputName(clip.name, `clip-${index + 1}`)}.png`
    }));
    saveAssetManifest(manifestPath, manifest);
  }

  console.log(`Asset manifest ready: ${manifestPath}`);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const command = opts.command || 'help';

  if (command === 'help') {
    console.log('Usage: node code/cli/video-assets.js <init|plan|cast|scene-frames> [options]');
    console.log('  init --topic "..." --template template-id [--output-name slug]');
    console.log('  plan --manifest output/videos/<slug>/asset-manifest.json [--stage cast|scene-frames] [--json]');
    console.log('  cast --plan output/videos/<slug>/plans/tool-plan.json [--force]');
    console.log('  scene-frames --plan output/videos/<slug>/plans/tool-plan.json [--force]');
    return;
  }

  if (command === 'init') {
    await initManifest(opts);
    return;
  }

  if (command === 'plan') {
    const { toolPlan, planPath } = materializeToolPlan(opts);
    const scopedPlan = opts.stage
      ? { ...toolPlan, jobs: filterJobsByStage(toolPlan, opts.stage) }
      : toolPlan;
    printToolPlan(scopedPlan, opts.json);
    if (!opts.json) {
      console.log(`Saved: ${planPath}`);
    }
    return;
  }

  if (command === 'cast') {
    await runStage(opts, 'cast');
    return;
  }

  if (command === 'scene-frames') {
    await runStage(opts, 'scene-frames');
    return;
  }

  throw new Error(`Unknown command "${command}"`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}
