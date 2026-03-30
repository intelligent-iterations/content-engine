import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { AUTH_DIR, ROOT_DIR, isMainModule } from '../core/paths.js';
import {
  buildVideoExecutionPlan,
  loadVideoExecutionPlan,
  saveVideoExecutionPlan,
} from './execution-plan.js';
import {
  generateImage as generateImageWithFallback,
  downloadImage,
  IMAGE_MODELS,
  detectMimeTypeFromBuffer,
  isBrowserOverrideEnabled,
  normalizeImageBufferForOutputPath,
  padImageBufferToAspectRatio,
} from '../shared/generate-image.js';
import {
  assertSpendWithinLimit,
  estimateXaiImageCost,
  estimateXaiVideoCost,
  recordApiSpend,
} from '../shared/api-spend-tracker.js';

const XAI_API_KEY = process.env.XAI_API_KEY;
const BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_GROK_STORAGE_PATH = path.join(AUTH_DIR, 'grok-storage-state.json');
const DEFAULT_GROK_COOKIES_PATH = path.join(AUTH_DIR, 'grok-session-cookies.json');
const DEFAULT_GROK_USER_DATA_DIR = path.join(AUTH_DIR, 'grok-chrome-profile-web-fallback');
const DEFAULT_X_COOKIES_PATH = path.join(ROOT_DIR, 'cookies', 'x_cookies.json');

function effectiveXaiApiKey() {
  return isBrowserOverrideEnabled() ? null : XAI_API_KEY;
}

function normalizeImageModel(value) {
  const model = String(value || '').trim();
  if (!model) {
    return 'grok-imagine-image';
  }

  const legacyAliases = new Set([
    'grok',
    'grok-image',
    'grok-2-image'
  ]);

  return legacyAliases.has(model) ? 'grok-imagine-image' : model;
}

function normalizeVideoModel(value) {
  const model = String(value || '').trim();
  if (!model) {
    return 'grok-imagine-video';
  }

  return model;
}

export const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${XAI_API_KEY}`,
    'Content-Type': 'application/json',
  },
  validateStatus: (status) => status === 200 || status === 202,
});

// Track whether we've hit a 429 recently — used for adaptive cooldown
export let lastHit429 = false;

function parseFrontmatterValue(raw) {
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  return value;
}

export function parseCompilationMeta(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);

  if (!match) {
    return {};
  }

  const meta = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    meta[key] = parseFrontmatterValue(value);
  }

  return meta;
}

function resolveGrokWebSessionPath() {
  const candidates = [
    process.env.GROK_WEB_COOKIES_PATH,
    process.env.GROK_WEB_STATE_PATH,
    DEFAULT_GROK_STORAGE_PATH,
    DEFAULT_GROK_COOKIES_PATH,
    DEFAULT_X_COOKIES_PATH
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildGrokWebSessionArgs(sessionPath) {
  try {
    const raw = fs.readFileSync(sessionPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return ['--cookies', sessionPath];
    }
    if (Array.isArray(parsed?.origins)) {
      return ['--state', sessionPath];
    }
    if (Array.isArray(parsed?.cookies)) {
      return ['--cookies', sessionPath];
    }
  } catch {
    // Fall back to filename heuristics below.
  }

  if (/storage-state/i.test(path.basename(sessionPath))) {
    return ['--state', sessionPath];
  }

  return ['--cookies', sessionPath];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeFileName(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'reference';
}

function normalizeReferenceStrategy(value) {
  const strategy = String(value || 'per_clip').trim().toLowerCase();
  return strategy === 'shared_reference' ? 'shared_reference' : 'per_clip';
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {
    input: null,
    md: null,
    plan: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--md' && argv[index + 1]) {
      args.md = argv[index + 1];
      index += 1;
    } else if (arg === '--plan' && argv[index + 1]) {
      args.plan = argv[index + 1];
      index += 1;
    } else if (!arg.startsWith('--') && !args.input) {
      args.input = arg;
    }
  }

  return args;
}

function mimeTypeForPath(filePath) {
  const buffer = fs.readFileSync(filePath);
  return detectMimeTypeFromBuffer(buffer);
}

function localImagePathToDataUrl(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mimeType = detectMimeTypeFromBuffer(buffer);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function parseAspectRatio(aspectRatio = '9:16') {
  const match = String(aspectRatio || '').trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) {
    return { width: 9, height: 16 };
  }
  return {
    width: Number(match[1]) || 9,
    height: Number(match[2]) || 16,
  };
}

function resolveTargetImageSize(aspectRatio = '9:16', resolution = '720p') {
  const ratio = parseAspectRatio(aspectRatio);
  const shortSide = String(resolution || '').includes('1080') ? 1080 : 720;

  if (ratio.width <= ratio.height) {
    return {
      width: shortSide,
      height: Math.round(shortSide * (ratio.height / ratio.width)),
    };
  }

  return {
    width: Math.round(shortSide * (ratio.width / ratio.height)),
    height: shortSide,
  };
}

function aspectDelta(width, height, targetWidth, targetHeight) {
  const sourceRatio = width / height;
  const targetRatio = targetWidth / targetHeight;
  return Math.abs(sourceRatio - targetRatio);
}

async function prepareReferenceImageForVideo(referenceImagePath, options = {}) {
  if (!referenceImagePath || !fs.existsSync(referenceImagePath)) {
    return referenceImagePath;
  }

  const preparedDir = path.join(path.dirname(options.outputDir || path.dirname(referenceImagePath)), 'prepared-video-refs');
  ensureDir(preparedDir);
  const preparedPath = path.join(
    preparedDir,
    `clip${String(options.clipNum || 0).padStart(2, '0')}-${sanitizeFileName(options.clipName || path.basename(referenceImagePath, path.extname(referenceImagePath)))}.png`
  );

  const sourceBuffer = fs.readFileSync(referenceImagePath);
  const paddedBuffer = await padImageBufferToAspectRatio(sourceBuffer, {
    aspectRatio: options.aspectRatio,
    resolution: options.resolution,
    outputFormat: 'png',
  });
  const normalizedBuffer = await normalizeImageBufferForOutputPath(paddedBuffer, preparedPath);

  // If the scene frame is already the right portrait asset, reuse it directly
  // instead of creating a redundant copy in prepared-video-refs.
  if (Buffer.compare(sourceBuffer, normalizedBuffer) === 0) {
    return referenceImagePath;
  }

  fs.writeFileSync(preparedPath, normalizedBuffer);

  return preparedPath;
}

export function loadSiblingAssetManifest(mdPath) {
  const manifestPath = path.join(path.dirname(mdPath), 'asset-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    console.warn(`Warning: failed to parse asset manifest at ${manifestPath}: ${error.message}`);
    return null;
  }
}

export function enrichClipsWithManifest(clips, assetManifest, mdPath) {
  if (!assetManifest) {
    return clips;
  }

  const baseDir = path.dirname(mdPath);
  const sceneFrames = Array.isArray(assetManifest.scene_start_frames)
    ? assetManifest.scene_start_frames
    : [];

  return clips.map((clip, index) => {
    const frame = sceneFrames.find((entry) => {
      if (entry.clip_index === index + 1) {
        return true;
      }

      const clipName = String(clip.name || '').trim().toLowerCase();
      const frameName = String(entry.clip_name || '').trim().toLowerCase();
      return clipName && frameName && clipName === frameName;
    });

    if (!frame?.output_path) {
      return clip;
    }

    const resolvedPath = path.resolve(baseDir, frame.output_path);
    if (!fs.existsSync(resolvedPath)) {
      return clip;
    }

    return {
      ...clip,
      sceneReferenceImagePath: resolvedPath,
    };
  });
}

export function createExecutionPlanFromMd(mdPath) {
  const resolvedMdPath = path.resolve(mdPath);
  const meta = parseCompilationMeta(resolvedMdPath);
  const rawClips = parseCompilationMD(resolvedMdPath);
  const assetManifest = loadSiblingAssetManifest(resolvedMdPath);
  const clips = enrichClipsWithManifest(rawClips, assetManifest, resolvedMdPath);

  return buildVideoExecutionPlan({
    clips,
    meta: {
      ...meta,
      compilation_md_path: resolvedMdPath,
    },
    assetManifest,
  });
}

export function materializeExecutionPlanFromMd(mdPath, outputPath = null) {
  const resolvedMdPath = path.resolve(mdPath);
  const plan = createExecutionPlanFromMd(resolvedMdPath);
  const planPath = saveVideoExecutionPlan(plan, resolvedMdPath, outputPath || undefined);
  return {
    plan: loadVideoExecutionPlan(planPath),
    planPath,
  };
}

async function persistReferenceImageAsset(imageResult, outputPath) {
  if (typeof imageResult === 'string' && !/^https?:\/\//i.test(imageResult)) {
    if (path.resolve(imageResult) !== path.resolve(outputPath)) {
      const buffer = fs.readFileSync(imageResult);
      const normalizedBuffer = await normalizeImageBufferForOutputPath(buffer, outputPath);
      fs.writeFileSync(outputPath, normalizedBuffer);
    }
    return outputPath;
  }

  const buffer = await downloadImage(imageResult);
  const normalizedBuffer = await normalizeImageBufferForOutputPath(buffer, outputPath);
  fs.writeFileSync(outputPath, normalizedBuffer);
  return outputPath;
}

async function generateReferenceAsset(prompt, outputPath, options = {}) {
  const apiKey = effectiveXaiApiKey();
  const result = await generateImageWithFallback(
    { xaiApiKey: apiKey },
    prompt,
    {
      model: IMAGE_MODELS.grok,
      aspectRatio: options.aspectRatio || '9:16',
      resolution: options.resolution || '720p',
      outDir: path.dirname(outputPath),
    }
  );

  const localPath = await persistReferenceImageAsset(result, outputPath);
  return {
    localPath,
    imageUrl: apiKey ? result : null,
  };
}

function coerceBrowserClipDuration(requestedDurationSeconds) {
  const supportedDurations = [6, 10];
  const normalized = Number(requestedDurationSeconds) || 6;

  return supportedDurations.reduce((closest, candidate) => {
    const candidateDelta = Math.abs(candidate - normalized);
    const closestDelta = Math.abs(closest - normalized);

    if (candidateDelta < closestDelta) {
      return candidate;
    }

    return closest;
  }, supportedDurations[0]);
}

function generateClipViaBrowser(clip, videoPath, options = {}) {
  const sessionPath = resolveGrokWebSessionPath();
  if (!sessionPath) {
    throw new Error(
      'Missing XAI_API_KEY and no Grok web session file was found. Run `npm run grok:export-session` first.'
    );
  }

  const requestedDurationSeconds = options.clipDurationSeconds || 6;
  const clipDurationSeconds = coerceBrowserClipDuration(requestedDurationSeconds);
  const prompt = clip.primaryVideoPrompt;
  const scriptPath = path.join(ROOT_DIR, 'code', 'video', 'grok-video-automation.js');
  const outDir = path.dirname(videoPath);
  const beforeFiles = new Set(fs.readdirSync(outDir));
  const args = [
    scriptPath,
    '--prompt',
    prompt,
    ...buildGrokWebSessionArgs(sessionPath),
    '--out-dir',
    outDir,
    '--output-path',
    videoPath,
    '--user-data-dir',
    process.env.GROK_WEB_USER_DATA_DIR || DEFAULT_GROK_USER_DATA_DIR,
    '--duration-seconds',
    String(clipDurationSeconds),
    '--timeout-ms',
    process.env.GROK_WEB_TIMEOUT_MS || '240000'
  ];

  if (options.referenceImagePath) {
    args.push('--reference-image', options.referenceImagePath);
  }

  if (process.env.GROK_WEB_HEADED === '1') {
    args.push('--headed');
  }

  if (process.env.GROK_WEB_DEBUG === '1') {
    args.push('--debug');
  }

  if (clipDurationSeconds !== requestedDurationSeconds) {
    console.log(
      `  [browser] Requested ${requestedDurationSeconds}s for ${clip.name}; using nearest supported Grok duration ${clipDurationSeconds}s.`
    );
  }

  console.log(`  [browser] Generating clip for ${clip.name} via Grok web automation...`);
  execFileSync(process.execPath, args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: 'inherit'
  });

  const downloadedPath = fs.existsSync(videoPath)
    ? videoPath
    : fs.readdirSync(outDir)
      .filter((file) => file.toLowerCase().endsWith('.mp4') && !beforeFiles.has(file))
      .map((file) => path.join(outDir, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!downloadedPath) {
    throw new Error(`Grok web automation completed but no clip file was found for ${clip.name}`);
  }

  if (downloadedPath !== videoPath) {
    fs.renameSync(downloadedPath, videoPath);
  }

  return videoPath;
}

// Retry wrapper for 429 (rate limit) and 5xx (server error) with exponential backoff
async function withRetry(fn, { maxRetries = 3, baseDelay = 10000, label = 'API call' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);

      if (!isRetryable || attempt === maxRetries) throw err;

      if (status === 429) lastHit429 = true;

      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`  [retry] ${label} got ${status}, retrying in ${delay / 1000}s (${attempt + 1}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function shouldRetryWithFallback(error) {
  const status = error?.response?.status;
  const message = [
    error?.response?.data?.error,
    error?.response?.data?.code,
    error?.message,
  ].filter(Boolean).join(' ').toLowerCase();

  return status === 400 && (
    message.includes('moderation')
    || message.includes('invalid argument')
    || message.includes('rejected')
  );
}

function parseClipHeader(firstLine) {
  const header = String(firstLine || '').trim();
  const match = header.match(/^(.*?)\s*--\s*(.+)$/);

  if (!match) {
    return {
      name: header,
      mood: null,
    };
  }

  return {
    name: match[1].trim(),
    mood: match[2].trim(),
  };
}

// Parse the compilation MD file into structured clips
export function parseCompilationMD(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const clips = [];

  // Split by clip headers (## Clip N:)
  const clipSections = content.split(/^## Clip \d+:/m).slice(1);

  for (const section of clipSections) {
    const clip = {};

    // Get clip name from first line
    const firstLine = section.split('\n')[0].trim();
    const parsedHeader = parseClipHeader(firstLine);
    clip.name = parsedHeader.name;
    clip.mood = parsedHeader.mood ? parsedHeader.mood.toLowerCase() : null;

    // Extract image prompt
    const imageMatch = section.match(/### Image Prompt\s*```\s*([\s\S]*?)```/);
    clip.imagePrompt = imageMatch ? imageMatch[1].trim() : null;

    const continuityMatch = section.match(/### Continuity Anchors\s*```\s*([\s\S]*?)```/);
    clip.continuityAnchors = continuityMatch ? continuityMatch[1].trim() : null;

    // Extract video prompt
    const videoMatch = section.match(/### Video Prompt\s*```\s*([\s\S]*?)```/);
    clip.videoPrompt = videoMatch ? videoMatch[1].trim() : null;

    const fallbackMatch = section.match(/### Fallback Video Prompt\s*```\s*([\s\S]*?)```/);
    clip.fallbackVideoPrompt = fallbackMatch ? fallbackMatch[1].trim() : null;

    if (clip.imagePrompt && clip.videoPrompt) {
      clips.push(clip);
    }
  }

  return clips;
}

// Step 1: Generate image from prompt
export async function generateImage(prompt, clipName, options = {}) {
  const apiKey = effectiveXaiApiKey();
  if (!apiKey) {
    throw new Error('Missing XAI_API_KEY in .env');
  }

  console.log(`  [image] Generating image for ${clipName}...`);
  const model = normalizeImageModel(options.imageModel);
  const estimatedCostUsd = estimateXaiImageCost({
    model,
    imageCount: 1,
    inputImageCount: 0,
  });

  assertSpendWithinLimit({
    provider: 'xai',
    operation: 'images.generate',
    model,
    projectedCostUsd: estimatedCostUsd || 0,
  });

  const res = await withRetry(
    () => api.post('/images/generations', {
      model,
      prompt,
      n: 1,
      response_format: 'url',
      aspect_ratio: options.aspectRatio || '9:16',
    }),
    { label: `image:${clipName}` }
  );

  const imageUrl = res.data.data[0].url;
  recordApiSpend({
    provider: 'xai',
    operation: 'images.generate',
    model,
    costUsd: estimateXaiImageCost({
      model,
      imageCount: Number(res.data?.data?.length) || 1,
      inputImageCount: 0,
    }) || 0,
    estimatedCostUsd,
    metadata: {
      clip_name: clipName,
      aspect_ratio: options.aspectRatio || '9:16',
      output_image_count: Number(res.data?.data?.length) || 1,
    },
  });
  console.log(`  [image] Got image URL for ${clipName}`);
  return imageUrl;
}

// Step 2: Generate video from image + prompt
export async function generateVideo(imageUrl, prompt, options = {}) {
  const apiKey = effectiveXaiApiKey();
  if (!apiKey) {
    throw new Error('Missing XAI_API_KEY in .env');
  }
  const model = normalizeVideoModel(options.videoModel);
  const estimatedCostUsd = estimateXaiVideoCost({
    model,
    durationSeconds: options.clipDurationSeconds || 6,
    resolution: options.resolution || '720p',
    inputImageCount: imageUrl ? 1 : 0,
  });

  assertSpendWithinLimit({
    provider: 'xai',
    operation: 'videos.generate',
    model,
    projectedCostUsd: estimatedCostUsd || 0,
  });

  const res = await withRetry(
    () => api.post('/videos/generations', {
      model,
      prompt,
      image: { url: imageUrl },
      duration: options.clipDurationSeconds || 6,
      aspect_ratio: options.aspectRatio || '9:16',
      resolution: options.resolution || '720p',
    }),
    { label: 'video:generate' }
  );

  recordApiSpend({
    provider: 'xai',
    operation: 'videos.generate',
    model,
    costUsd: estimateXaiVideoCost({
      model,
      durationSeconds: options.clipDurationSeconds || 6,
      resolution: options.resolution || '720p',
      inputImageCount: imageUrl ? 1 : 0,
    }) || 0,
    estimatedCostUsd,
    metadata: {
      aspect_ratio: options.aspectRatio || '9:16',
      duration_seconds: options.clipDurationSeconds || 6,
      resolution: options.resolution || '720p',
      request_id: res.data?.request_id || null,
      used_input_image: Boolean(imageUrl),
    },
  });

  return res.data.request_id;
}

// Step 3: Poll for video completion
export async function pollForVideo(requestId, clipName, maxWaitMs = 600000) {
  const startTime = Date.now();
  let delay = 5000;

  while (Date.now() - startTime < maxWaitMs) {
    const res = await withRetry(
      () => api.get(`/videos/${requestId}`),
      { label: `poll:${clipName}` }
    );

    // Completed: status 200, URL at res.data.video.url
    const videoUrl = res.data?.video?.url;
    if (res.status === 200 && videoUrl) {
      return videoUrl;
    }

    // Check for failed status
    if (res.data?.status === 'failed' || res.data?.error) {
      throw new Error(`Video generation failed for ${clipName}: ${JSON.stringify(res.data?.error || res.data)}`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`  [video] ${clipName} still processing... (${elapsed}s)`);

    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 15000);
  }

  throw new Error(`Timeout waiting for video: ${clipName}`);
}

// Download a file from URL
export async function downloadFile(url, outputPath) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(outputPath, Buffer.from(res.data));
}

// Generate a single clip (image → video → download)
export async function generateClip(clip, index, outputDir, options = {}) {
  const clipNum = index + 1;
  const safeName = clip.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const videoPath = path.join(outputDir, `clip${clipNum}-${safeName}.mp4`);
  const clipDurationSeconds = options.clipDurationSeconds || 6;

  // Skip if already generated
  if (fs.existsSync(videoPath)) {
    console.log(`  [skip] Clip ${clipNum} (${clip.name}) already exists`);
    return videoPath;
  }

  console.log(`\n--- Clip ${clipNum}: ${clip.name} ---`);

  if (!effectiveXaiApiKey()) {
    const referenceStrategy = normalizeReferenceStrategy(options.referenceStrategy);
    let referenceImagePath = clip.sceneReferenceImagePath || options.sharedReferenceImagePath || null;

    if (referenceStrategy === 'per_clip' || !referenceImagePath) {
      const referenceDir = path.join(path.dirname(outputDir), 'reference-images');
      ensureDir(referenceDir);
      const targetPath = path.join(referenceDir, `clip${clipNum}-${sanitizeFileName(clip.name)}.png`);
      const generated = await generateReferenceAsset(clip.imagePrompt, targetPath, options);
      referenceImagePath = generated.localPath;
    }

    referenceImagePath = await prepareReferenceImageForVideo(referenceImagePath, {
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      outputDir,
      clipNum,
      clipName: clip.name,
    });

    try {
      return generateClipViaBrowser(clip, videoPath, {
        ...options,
        referenceImagePath,
      });
    } catch (error) {
      if (!clip.fallbackVideoPrompt) {
        throw error;
      }

      console.log(`  [browser] Primary prompt failed for ${clip.name}, retrying with fallback prompt...`);
      return generateClipViaBrowser({
        ...clip,
        primaryVideoPrompt: clip.fallbackVideoPrompt,
      }, videoPath, {
        ...options,
        referenceImagePath,
      });
    }
  }

  const referenceStrategy = normalizeReferenceStrategy(options.referenceStrategy);
  const sceneReferenceImagePath = clip.sceneReferenceImagePath
    ? await prepareReferenceImageForVideo(clip.sceneReferenceImagePath, {
      aspectRatio: options.aspectRatio,
      resolution: options.resolution,
      outputDir,
      clipNum,
      clipName: clip.name,
    })
    : null;
  let imageUrl = clip.sceneReferenceImagePath
    ? localImagePathToDataUrl(sceneReferenceImagePath)
    : (options.sharedReferenceImageUrl || null);

  if ((referenceStrategy === 'per_clip' || !imageUrl) && !clip.sceneReferenceImagePath) {
    imageUrl = await generateImage(clip.imagePrompt, clip.name, options);
  }

  // Generate video from image
  console.log(`  [video] Starting video generation for ${clip.name}...`);
  let requestId;
  try {
    requestId = await generateVideo(
      imageUrl,
      clip.primaryVideoPrompt,
      options
    );
  } catch (error) {
    if (!clip.fallbackVideoPrompt || !shouldRetryWithFallback(error)) {
      throw error;
    }

    console.log(`  [video] Primary prompt rejected for ${clip.name}, retrying with fallback prompt...`);
    requestId = await generateVideo(
      imageUrl,
      clip.fallbackVideoPrompt,
      options
    );
  }
  console.log(`  [video] Request ID: ${requestId}`);

  // Poll for completion
  let videoUrl;
  try {
    videoUrl = await pollForVideo(requestId, clip.name);
  } catch (error) {
    if (!clip.fallbackVideoPrompt || !shouldRetryWithFallback(error)) {
      throw error;
    }

    console.log(`  [video] Generated video failed moderation for ${clip.name}, retrying with fallback prompt...`);
    const fallbackRequestId = await generateVideo(
      imageUrl,
      clip.fallbackVideoPrompt,
      options
    );
    console.log(`  [video] Fallback request ID: ${fallbackRequestId}`);
    videoUrl = await pollForVideo(fallbackRequestId, clip.name);
  }
  console.log(`  [video] ${clip.name} complete!`);

  // Download to temp file, then trim to the configured clip length
  const tmpPath = videoPath + '.tmp.mp4';
  console.log(`  [download] Saving to ${videoPath}`);
  await downloadFile(videoUrl, tmpPath);

  // Trim to target duration and strip thumbnail stream
  execFileSync('ffmpeg', [
    '-i', tmpPath,
    '-t', String(clipDurationSeconds),
    '-map', '0:v:0',
    '-map', '0:a:0',
    '-c', 'copy',
    videoPath,
    '-y',
  ], { stdio: 'pipe' });
  fs.unlinkSync(tmpPath);

  return videoPath;
}

// Stitch clips together with ffmpeg
export function stitchClips(clipPaths, outputPath) {
  console.log('\n--- Stitching clips together ---');

  const listFile = path.join(path.dirname(outputPath), 'concat-list.txt');
  const listContent = clipPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listFile, listContent);

  execFileSync('ffmpeg', [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    outputPath,
    '-y',
  ], { stdio: 'inherit' });

  fs.unlinkSync(listFile);
  console.log(`\nFinal video: ${outputPath}`);
}

export async function executeExecutionPlan(executionPlan) {
  const referenceStrategy = normalizeReferenceStrategy(executionPlan.referenceStrategy);
  const runDir = executionPlan.runDir || (executionPlan.compilationMdPath ? path.dirname(executionPlan.compilationMdPath) : process.cwd());
  const baseName = executionPlan.baseName || (executionPlan.compilationMdPath ? path.basename(executionPlan.compilationMdPath, '.md') : 'video');
  console.log(`Parsed ${executionPlan.jobs.length} clips from ${executionPlan.compilationMdPath ? path.basename(executionPlan.compilationMdPath) : baseName}\n`);

  for (const clip of executionPlan.jobs) {
    console.log(`  - ${clip.name} (${clip.mood})`);
  }

  const outputDir = executionPlan.clipsOutputDir || path.join(runDir, 'clips');
  fs.mkdirSync(outputDir, { recursive: true });

  let sharedReferenceImagePath = null;
  let sharedReferenceImageUrl = null;
  const everyClipHasSceneFrame = executionPlan.jobs.length > 0 && executionPlan.jobs.every((clip) => clip.sceneReferenceImagePath);
  if (referenceStrategy === 'shared_reference' && executionPlan.jobs[0]?.imagePrompt && !everyClipHasSceneFrame) {
    const referenceDir = path.join(runDir, 'reference');
    ensureDir(referenceDir);
    const sharedReferencePath = path.join(referenceDir, 'shared-reference.png');
    console.log(`\n--- Generating shared reference image (${referenceStrategy}) ---`);
    const sharedReference = await generateReferenceAsset(executionPlan.jobs[0].imagePrompt, sharedReferencePath, {
      aspectRatio: executionPlan.aspectRatio,
      resolution: executionPlan.resolution,
    });
    sharedReferenceImagePath = sharedReference.localPath;
    sharedReferenceImageUrl = sharedReference.imageUrl;
    console.log(`Shared reference image: ${sharedReferenceImagePath}`);
  } else if (everyClipHasSceneFrame) {
    console.log('\n--- Using saved scene start frames from asset-manifest.json for per-clip continuity ---');
  }

  // Generate each clip
  const clipPaths = [];
  for (let i = 0; i < executionPlan.jobs.length; i++) {
    try {
      const clipPath = await generateClip(executionPlan.jobs[i], i, outputDir, {
        referenceStrategy,
        sharedReferenceImagePath,
        sharedReferenceImageUrl,
        clipDurationSeconds: executionPlan.clipDurationSeconds,
        aspectRatio: executionPlan.aspectRatio,
        resolution: executionPlan.resolution,
        imageModel: executionPlan.imageModel,
        videoModel: executionPlan.videoModel,
      });
      clipPaths.push(clipPath);
    } catch (err) {
      console.error(`\nFailed on clip ${i + 1} (${executionPlan.jobs[i].name}): ${err.message}`);
      console.error('Continuing with remaining clips...\n');
    }
  }

  if (clipPaths.length === 0) {
    console.error('No clips were generated.');
    process.exit(1);
  }

  const finalPath = executionPlan.finalVideoPath || path.join(runDir, `${baseName}.mp4`);
  const stitchedPath = executionPlan.stitchedVideoPath || finalPath;
  stitchClips(clipPaths, stitchedPath);

  console.log(`\nDone! ${clipPaths.length}/${executionPlan.jobs.length} clips generated and stitched.`);
  console.log(`Output: ${stitchedPath}`);
  return {
    clipPaths,
    stitchedPath,
    finalPath,
  };
}

// Main
export async function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const input = args.plan || args.md || args.input;

  if (!input) {
    console.error('Usage: node code/cli/video-compilation.js <path-to-compilation.md | path-to-execution-plan.json>');
    console.error('Example: node code/cli/video-compilation.js output/videos/story/story.md');
    process.exit(1);
  }

  const resolvedInput = path.resolve(input);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`File not found: ${resolvedInput}`);
    process.exit(1);
  }

  let executionPlan;
  if (args.plan || path.extname(resolvedInput).toLowerCase() === '.json') {
    executionPlan = loadVideoExecutionPlan(resolvedInput);
  } else {
    const materialized = materializeExecutionPlanFromMd(resolvedInput);
    executionPlan = materialized.plan;
    console.log(`Saved execution plan: ${materialized.planPath}\n`);
  }

  const result = await executeExecutionPlan(executionPlan);
  if (result.stitchedPath !== result.finalPath) {
    fs.renameSync(result.stitchedPath, result.finalPath);
    console.log(`Final video: ${result.finalPath}`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
