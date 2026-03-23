import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { AUTH_DIR, ROOT_DIR, isMainModule } from '../core/paths.js';
import { generateImage as generateImageWithFallback, downloadImage, IMAGE_MODELS } from '../shared/generate-image.js';

const XAI_API_KEY = process.env.XAI_API_KEY;
const BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_GROK_STORAGE_PATH = path.join(AUTH_DIR, 'grok-storage-state.json');
const DEFAULT_GROK_COOKIES_PATH = path.join(AUTH_DIR, 'grok-session-cookies.json');
const DEFAULT_GROK_USER_DATA_DIR = path.join(AUTH_DIR, 'grok-chrome-profile-web-fallback');

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
    DEFAULT_GROK_COOKIES_PATH
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildGrokWebSessionArgs(sessionPath) {
  try {
    const raw = fs.readFileSync(sessionPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) || Array.isArray(parsed?.cookies)) {
      return ['--cookies', sessionPath];
    }
    if (Array.isArray(parsed?.origins)) {
      return ['--state', sessionPath];
    }
  } catch {
    // Fall back to filename heuristics below.
  }

  if (/storage-state/i.test(path.basename(sessionPath))) {
    return ['--state', sessionPath];
  }

  return ['--cookies', sessionPath];
}

function buildBrowserClipPrompt(clip, clipDurationSeconds) {
  return [
    'Create a vertical 9:16 video clip.',
    `Target duration: ${clipDurationSeconds} seconds.`,
    'Treat the following image direction as the opening frame and visual identity to preserve.',
    'Continuity is more important than novelty or extra detail.',
    'If recurring characters are present, keep the exact same face/head design, silhouette, wardrobe logic, proportions, palette, environment, and cinematic style established by the image direction and continuity anchors.',
    'Do not redesign characters into generic humans, new costumes, or a different art style.',
    'If dialogue makes the acting feel weak, keep the acting simple and let the visual beat stay dominant.',
    '',
    'IMAGE DIRECTION:',
    clip.imagePrompt,
    '',
    'CONTINUITY ANCHORS:',
    clip.continuityAnchors || 'Preserve the same identity, wardrobe, set, and overall style established by the image prompt.',
    '',
    'Animate that exact scene using this motion and dialogue direction:',
    '',
    'VIDEO DIRECTION:',
    clip.videoPrompt,
    '',
    'Keep the framing, character, body-part context, and action clear and legible.',
    'Output a single finished video clip.'
  ].join('\n');
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

async function persistReferenceImageAsset(imageResult, outputPath) {
  if (typeof imageResult === 'string' && !/^https?:\/\//i.test(imageResult)) {
    if (path.resolve(imageResult) !== path.resolve(outputPath)) {
      fs.copyFileSync(imageResult, outputPath);
    }
    return outputPath;
  }

  const buffer = await downloadImage(imageResult);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function generateReferenceAsset(prompt, outputPath, options = {}) {
  const result = await generateImageWithFallback(
    { xaiApiKey: XAI_API_KEY },
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
    imageUrl: XAI_API_KEY ? result : null,
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
  const prompt = buildBrowserClipPrompt(clip, clipDurationSeconds);
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
    clip.name = firstLine.replace(/\s*--\s*(Wonder|Fear).*/, '').trim();
    clip.mood = firstLine.includes('Fear') ? 'fear' : 'wonder';

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
  if (!XAI_API_KEY) {
    throw new Error('Missing XAI_API_KEY in .env');
  }

  console.log(`  [image] Generating image for ${clipName}...`);

  const res = await withRetry(
    () => api.post('/images/generations', {
      model: options.imageModel || 'grok-imagine-image',
      prompt,
      n: 1,
      response_format: 'url',
      aspect_ratio: options.aspectRatio || '9:16',
    }),
    { label: `image:${clipName}` }
  );

  const imageUrl = res.data.data[0].url;
  console.log(`  [image] Got image URL for ${clipName}`);
  return imageUrl;
}

// Step 2: Generate video from image + prompt
export async function generateVideo(imageUrl, prompt, options = {}) {
  if (!XAI_API_KEY) {
    throw new Error('Missing XAI_API_KEY in .env');
  }

  const res = await withRetry(
    () => api.post('/videos/generations', {
      model: options.videoModel || 'grok-imagine-video',
      prompt,
      image: { url: imageUrl },
      duration: options.clipDurationSeconds || 6,
      aspect_ratio: options.aspectRatio || '9:16',
      resolution: options.resolution || '720p',
    }),
    { label: 'video:generate' }
  );

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

  if (!XAI_API_KEY) {
    const referenceStrategy = normalizeReferenceStrategy(options.referenceStrategy);
    let referenceImagePath = options.sharedReferenceImagePath || null;

    if (referenceStrategy === 'per_clip' || !referenceImagePath) {
      const referenceDir = path.join(path.dirname(outputDir), 'reference-images');
      ensureDir(referenceDir);
      const targetPath = path.join(referenceDir, `clip${clipNum}-${sanitizeFileName(clip.name)}.png`);
      const generated = await generateReferenceAsset(clip.imagePrompt, targetPath, options);
      referenceImagePath = generated.localPath;
    }

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
        videoPrompt: clip.fallbackVideoPrompt,
      }, videoPath, {
        ...options,
        referenceImagePath,
      });
    }
  }

  const referenceStrategy = normalizeReferenceStrategy(options.referenceStrategy);
  let imageUrl = options.sharedReferenceImageUrl || null;

  if (referenceStrategy === 'per_clip' || !imageUrl) {
    imageUrl = await generateImage(clip.imagePrompt, clip.name, options);
  }

  // Generate video from image
  console.log(`  [video] Starting video generation for ${clip.name}...`);
  let requestId;
  try {
    requestId = await generateVideo(imageUrl, clip.videoPrompt, options);
  } catch (error) {
    if (!clip.fallbackVideoPrompt || !shouldRetryWithFallback(error)) {
      throw error;
    }

    console.log(`  [video] Primary prompt rejected for ${clip.name}, retrying with fallback prompt...`);
    requestId = await generateVideo(imageUrl, clip.fallbackVideoPrompt, options);
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
    const fallbackRequestId = await generateVideo(imageUrl, clip.fallbackVideoPrompt, options);
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

// Main
export async function main() {
  const mdFile = process.argv[2];

  if (!mdFile) {
    console.error('Usage: node code/cli/video-compilation.js <path-to-compilation.md>');
    console.error('Example: node code/cli/video-compilation.js output/videos/skincare-benefits-hero-compilation.md');
    process.exit(1);
  }

  const mdPath = path.resolve(mdFile);
  if (!fs.existsSync(mdPath)) {
    console.error(`File not found: ${mdPath}`);
    process.exit(1);
  }

  // Parse the MD
  const meta = parseCompilationMeta(mdPath);
  const clips = parseCompilationMD(mdPath);
  const referenceStrategy = normalizeReferenceStrategy(meta.reference_strategy);
  console.log(`Parsed ${clips.length} clips from ${path.basename(mdPath)}\n`);

  for (const clip of clips) {
    console.log(`  - ${clip.name} (${clip.mood})`);
  }

  // Create output directory
  const baseName = path.basename(mdPath, '.md');
  const outputDir = path.join(path.dirname(mdPath), 'clips');
  fs.mkdirSync(outputDir, { recursive: true });

  let sharedReferenceImagePath = null;
  let sharedReferenceImageUrl = null;
  if (referenceStrategy === 'shared_reference' && clips[0]?.imagePrompt) {
    const referenceDir = path.join(path.dirname(mdPath), 'reference');
    ensureDir(referenceDir);
    const sharedReferencePath = path.join(referenceDir, 'shared-reference.png');
    console.log(`\n--- Generating shared reference image (${referenceStrategy}) ---`);
    const sharedReference = await generateReferenceAsset(clips[0].imagePrompt, sharedReferencePath, {
      aspectRatio: meta.aspect_ratio,
      resolution: meta.resolution,
    });
    sharedReferenceImagePath = sharedReference.localPath;
    sharedReferenceImageUrl = sharedReference.imageUrl;
    console.log(`Shared reference image: ${sharedReferenceImagePath}`);
  }

  // Generate each clip
  const clipPaths = [];
  for (let i = 0; i < clips.length; i++) {
    try {
      const clipPath = await generateClip(clips[i], i, outputDir, {
        referenceStrategy,
        sharedReferenceImagePath,
        sharedReferenceImageUrl,
        clipDurationSeconds: meta.clip_duration_seconds,
        aspectRatio: meta.aspect_ratio,
        resolution: meta.resolution,
        imageModel: meta.image_model,
        videoModel: meta.video_model,
      });
      clipPaths.push(clipPath);
    } catch (err) {
      console.error(`\nFailed on clip ${i + 1} (${clips[i].name}): ${err.message}`);
      console.error('Continuing with remaining clips...\n');
    }
  }

  if (clipPaths.length === 0) {
    console.error('No clips were generated.');
    process.exit(1);
  }

  // Stitch together
  const finalPath = path.join(path.dirname(mdPath), `${baseName}.mp4`);
  stitchClips(clipPaths, finalPath);

  console.log(`\nDone! ${clipPaths.length}/${clips.length} clips generated and stitched.`);
  console.log(`Output: ${finalPath}`);
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
