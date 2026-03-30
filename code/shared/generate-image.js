/**
 * Image generation uses Grok first and falls back to Grok browser automation.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { AUTH_DIR, ROOT_DIR, TEMP_DIR } from '../core/paths.js';
import {
  assertSpendWithinLimit,
  estimateXaiImageCost,
  recordApiSpend,
} from './api-spend-tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_RETRIES = 10;
const RATE_LIMIT_WAIT = 5000; // 5 seconds between requests
const DEFAULT_GROK_STORAGE_PATH = path.join(AUTH_DIR, 'grok-storage-state.json');
const DEFAULT_GROK_COOKIES_PATH = path.join(AUTH_DIR, 'grok-session-cookies.json');
const DEFAULT_GROK_USER_DATA_DIR = path.join(AUTH_DIR, 'grok-chrome-profile-web-fallback');
const DEFAULT_X_COOKIES_PATH = path.join(ROOT_DIR, 'cookies', 'x_cookies.json');
const DEFAULT_BROWSER_IMAGE_DOWNLOAD_DIR = path.join(TEMP_DIR, 'grok-images');

export const IMAGE_MODELS = {
  grok: 'grok'
};

function envFlagEnabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

export function isBrowserOverrideEnabled() {
  return envFlagEnabled(process.env.BROWSER_OVERRIDE);
}

function shouldAllowLetterCharacters(prompt, options = {}) {
  if (options.allowLetterCharacters) {
    return true;
  }

  const text = String(prompt || '').toLowerCase();
  return /anthropomorphic\s+(capital\s+)?[a-z]\b/.test(text)
    || text.includes('anthropomorphic alphabet')
    || text.includes('alphabet drama')
    || text.includes('letterform');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function detectMimeTypeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) {
    return 'image/jpeg';
  }

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return 'image/jpeg';
}

export function parseAspectRatio(aspectRatio = '9:16') {
  const match = String(aspectRatio || '').trim().match(/^(\d+)\s*:\s*(\d+)$/);
  if (!match) {
    return { width: 9, height: 16 };
  }

  return {
    width: Number(match[1]) || 9,
    height: Number(match[2]) || 16,
  };
}

export function resolveTargetImageSize(aspectRatio = '9:16', resolution = '720p') {
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

function normalizeImageResolution(resolution = '') {
  const value = String(resolution || '').trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value === '1k' || value === '2k') {
    return value;
  }

  if (value.includes('1080') || value.includes('2k')) {
    return '2k';
  }

  return '1k';
}

function aspectDelta(width, height, targetWidth, targetHeight) {
  const sourceRatio = width / height;
  const targetRatio = targetWidth / targetHeight;
  return Math.abs(sourceRatio - targetRatio);
}

async function averageBackgroundColor(buffer) {
  const { data } = await sharp(buffer)
    .resize(1, 1, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    r: data[0] ?? 16,
    g: data[1] ?? 16,
    b: data[2] ?? 16,
    alpha: 1,
  };
}

export async function padImageBufferToAspectRatio(buffer, options = {}) {
  const {
    aspectRatio = '9:16',
    resolution = '720p',
    outputFormat = 'png',
  } = options;

  const metadata = await sharp(buffer).metadata();
  const sourceWidth = Number(metadata.width) || 0;
  const sourceHeight = Number(metadata.height) || 0;
  if (!sourceWidth || !sourceHeight) {
    return buffer;
  }

  const { width: targetWidth, height: targetHeight } = resolveTargetImageSize(aspectRatio, resolution);
  if (aspectDelta(sourceWidth, sourceHeight, targetWidth, targetHeight) < 0.01) {
    if (outputFormat === 'jpeg') {
      return sharp(buffer).jpeg({ quality: 95 }).toBuffer();
    }
    if (outputFormat === 'webp') {
      return sharp(buffer).webp().toBuffer();
    }
    return sharp(buffer).png().toBuffer();
  }

  const background = await averageBackgroundColor(buffer);
  const foreground = await sharp(buffer)
    .resize(targetWidth, targetHeight, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  let pipeline = sharp({
    create: {
      width: targetWidth,
      height: targetHeight,
      channels: 4,
      background,
    },
  }).composite([{ input: foreground }]);

  if (outputFormat === 'jpeg') {
    pipeline = pipeline.jpeg({ quality: 95 });
  } else if (outputFormat === 'webp') {
    pipeline = pipeline.webp();
  } else {
    pipeline = pipeline.png();
  }

  return pipeline.toBuffer();
}

export async function normalizeImageBufferForOutputPath(buffer, outputPath) {
  const ext = path.extname(String(outputPath || '')).toLowerCase();
  const sourceMimeType = detectMimeTypeFromBuffer(buffer);

  if (ext === '.png') {
    if (sourceMimeType === 'image/png') {
      return buffer;
    }
    return sharp(buffer).png().toBuffer();
  }

  if (ext === '.webp') {
    if (sourceMimeType === 'image/webp') {
      return buffer;
    }
    return sharp(buffer).webp().toBuffer();
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    if (sourceMimeType === 'image/jpeg') {
      return buffer;
    }
    return sharp(buffer).jpeg({ quality: 95 }).toBuffer();
  }

  return buffer;
}

function normalizeReferenceImages(referenceImages) {
  const inputs = Array.isArray(referenceImages)
    ? referenceImages
    : (referenceImages ? [referenceImages] : []);

  const normalized = [];
  for (const referenceImage of inputs) {
    if (!referenceImage) {
      continue;
    }

    if (Buffer.isBuffer(referenceImage)) {
      normalized.push({
        buffer: referenceImage,
        mimeType: detectMimeTypeFromBuffer(referenceImage),
        filePath: null,
      });
      continue;
    }

    const buffer = referenceImage.buffer || null;
    if (!buffer) {
      continue;
    }

    normalized.push({
      buffer,
      mimeType: referenceImage.mimeType || detectMimeTypeFromBuffer(buffer),
      filePath: referenceImage.filePath || null,
    });
  }

  return normalized;
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') {
    return 'png';
  }
  if (mimeType === 'image/webp') {
    return 'webp';
  }
  return 'jpg';
}

function materializeReferenceImageFiles(referenceImages, outDir) {
  return normalizeReferenceImages(referenceImages).map((referenceImage, index) => {
    if (referenceImage.filePath && fs.existsSync(referenceImage.filePath)) {
      return referenceImage.filePath;
    }

    const filePath = path.join(
      outDir || DEFAULT_BROWSER_IMAGE_DOWNLOAD_DIR,
      `reference-${Date.now()}-${index}.${extensionForMimeType(referenceImage.mimeType)}`
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, referenceImage.buffer);
    return filePath;
  });
}

async function generateImageWithGrok(apiKey, prompt, options = {}, retryCount = 0) {
  const { aspectRatio, resolution } = options;
  const referenceImages = normalizeReferenceImages(options.referenceImages || options.referenceImage);
  const hasReferenceImages = referenceImages.length > 0;
  const model = 'grok-imagine-image';

  if (hasReferenceImages) {
    console.log('Starting Grok IMAGE EDIT generation...');
  } else {
    console.log('Starting Grok text-to-image generation...');
  }

  const body = {
    model: 'grok-imagine-image',
    prompt,
    n: 1,
    response_format: 'url'
  };

  if (aspectRatio && (referenceImages.length === 0 || referenceImages.length > 1)) {
    body.aspect_ratio = aspectRatio;
  }

  const imageResolution = normalizeImageResolution(resolution);
  if (imageResolution) {
    body.resolution = imageResolution;
  }

  if (referenceImages.length === 1) {
    const [referenceImage] = referenceImages;
    const base64 = referenceImage.buffer.toString('base64');
    body.image = {
      type: 'image_url',
      url: `data:${referenceImage.mimeType};base64,${base64}`
    };
  } else if (referenceImages.length > 1) {
    body.images = referenceImages.map((referenceImage) => ({
      type: 'image_url',
      url: `data:${referenceImage.mimeType};base64,${referenceImage.buffer.toString('base64')}`
    }));
  }

  const endpoint = hasReferenceImages
    ? 'https://api.x.ai/v1/images/edits'
    : 'https://api.x.ai/v1/images/generations';
  const estimatedCostUsd = estimateXaiImageCost({
    model,
    imageCount: 1,
    inputImageCount: referenceImages.length,
  });

  assertSpendWithinLimit({
    provider: 'xai',
    operation: hasReferenceImages ? 'images.edit' : 'images.generate',
    model,
    projectedCostUsd: estimatedCostUsd || 0,
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (response.status === 429) {
    if (retryCount >= MAX_RETRIES) {
      throw new Error('Max retries exceeded for rate limiting (Grok)');
    }

    const retryData = await response.json().catch(() => ({}));
    const retryAfter = retryData.retry_after || 10;

    console.log(`  Rate limited (Grok). Waiting ${retryAfter}s before retry ${retryCount + 1}/${MAX_RETRIES}...`);
    await sleep(retryAfter * 1000);

    return generateImageWithGrok(apiKey, prompt, options, retryCount + 1);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const actualCostUsd = estimateXaiImageCost({
    model,
    imageCount: Number(data?.data?.length) || 1,
    inputImageCount: referenceImages.length,
  });

  if (!data.data || !data.data[0] || !data.data[0].url) {
    throw new Error(`Unexpected Grok response format: ${JSON.stringify(data)}`);
  }

  recordApiSpend({
    provider: 'xai',
    operation: hasReferenceImages ? 'images.edit' : 'images.generate',
    model,
    costUsd: actualCostUsd || 0,
    estimatedCostUsd,
    metadata: {
      aspect_ratio: aspectRatio || null,
      resolution: resolution || null,
      input_image_count: referenceImages.length,
      output_image_count: Number(data?.data?.length) || 1,
      endpoint,
    },
  });

  console.log('Grok image generation complete!');
  return data.data[0].url;
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

function inferPromptSlug(prompt) {
  return String(prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'grok-image';
}

function generateImageViaBrowser(prompt, options = {}) {
  const sessionPath = resolveGrokWebSessionPath();
  if (!sessionPath) {
    throw new Error(
      'Grok API unavailable and no Grok web session file was found. Run `npm run grok:image -- --save-login --headed` first.'
    );
  }

  const outDir = options.outDir || process.env.GROK_IMAGE_OUT_DIR || DEFAULT_BROWSER_IMAGE_DOWNLOAD_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const beforeFiles = new Set(fs.readdirSync(outDir));
  const referenceImagePaths = materializeReferenceImageFiles(options.referenceImages || options.referenceImage, outDir);
  const scriptPath = path.join(ROOT_DIR, 'code', 'image', 'grok-image-automation.js');
  const args = [
    scriptPath,
    '--prompt',
    prompt,
    ...buildGrokWebSessionArgs(sessionPath),
    '--out-dir',
    outDir,
    '--user-data-dir',
    process.env.GROK_WEB_USER_DATA_DIR || DEFAULT_GROK_USER_DATA_DIR,
    '--timeout-ms',
    process.env.GROK_WEB_TIMEOUT_MS || '240000'
  ];

  for (const referenceImagePath of referenceImagePaths) {
    args.push('--reference-image', referenceImagePath);
  }

  if (process.env.GROK_WEB_HEADED === '1') {
    args.push('--headed');
  }

  if (process.env.GROK_WEB_DEBUG === '1') {
    args.push('--debug');
  }

  console.log('Grok API unavailable, falling back to Grok browser image generation...');
  execFileSync(process.execPath, args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: 'inherit'
  });

  const promptSlug = inferPromptSlug(prompt);
  const downloadedPath = fs.readdirSync(outDir)
    .filter((file) => !beforeFiles.has(file))
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .map((file) => path.join(outDir, file))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .find((filePath) => path.basename(filePath).toLowerCase().includes(promptSlug));

  if (!downloadedPath) {
    const latest = fs.readdirSync(outDir)
      .filter((file) => !beforeFiles.has(file))
      .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
      .map((file) => path.join(outDir, file))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

    if (!latest) {
      throw new Error('Grok browser image automation completed but no image file was found.');
    }

    return latest;
  }

  return downloadedPath;
}

export async function generateImage(tokens, prompt, options = {}) {
  const { model = IMAGE_MODELS.grok } = options;

  if (model !== IMAGE_MODELS.grok) {
    throw new Error(`Unsupported image model "${model}". Only "grok" is supported.`);
  }

  let cleanPrompt = prompt;
  const noTextSuffix = shouldAllowLetterCharacters(prompt, options)
    ? ', absolutely no written signage, no words, no labels, no captions, no fine print on any surface outside the character design'
    : ', absolutely no text, no writing, no letters, no words, no labels, no fine print on any surface';
  if (!cleanPrompt.toLowerCase().includes('absolutely no text') && !cleanPrompt.toLowerCase().includes('absolutely no written signage')) {
    cleanPrompt = cleanPrompt + noTextSuffix;
  }

  const forceBrowser = isBrowserOverrideEnabled();
  if (!tokens.xaiApiKey || forceBrowser) {
    if (forceBrowser) {
      console.log('BROWSER_OVERRIDE=true detected, forcing Grok browser image generation...');
    }
    return generateImageViaBrowser(cleanPrompt, options);
  }

  try {
    return await generateImageWithGrok(tokens.xaiApiKey, cleanPrompt, options);
  } catch (error) {
    console.warn(`Grok API image generation failed: ${error.message}`);
    return generateImageViaBrowser(cleanPrompt, options);
  }
}

export async function downloadImage(imageUrl) {
  console.log('Downloading image...');

  if (typeof imageUrl === 'string' && !/^https?:\/\//i.test(imageUrl)) {
    return fs.readFileSync(imageUrl);
  }

  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateAllImages(tokens, slides, options = {}) {
  const { model = IMAGE_MODELS.grok } = options;
  const results = [];

  console.log(`Using image model: ${model.toUpperCase()}`);

  for (const slide of slides) {
    console.log(`\nGenerating image for slide ${slide.slide_number}...`);

    const imageUrl = await generateImage(tokens, slide.image_prompt, { model });
    const imageBuffer = await downloadImage(imageUrl);

    results.push({
      ...slide,
      imageUrl,
      imageBuffer
    });

    console.log('  Waiting 5s before next image...');
    await sleep(RATE_LIMIT_WAIT);
  }

  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  import('dotenv').then(async (dotenv) => {
    dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

    const tokens = {
      xaiApiKey: process.env.XAI_API_KEY
    };

    const testPrompt = '9:16 vertical aspect ratio, aesthetic skincare products on a marble bathroom counter, soft morning light, pink and white tones, clean minimal composition, no text';

    console.log('Testing image generation with model: grok');

    try {
      const imageUrl = await generateImage(tokens, testPrompt, { model: IMAGE_MODELS.grok });
      console.log('\nGenerated image URL:', imageUrl);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });
}
