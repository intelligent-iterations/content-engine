/**
 * Image generation uses Grok first and falls back to Grok browser automation.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { AUTH_DIR, ROOT_DIR, TEMP_DIR } from '../core/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_RETRIES = 10;
const RATE_LIMIT_WAIT = 5000; // 5 seconds between requests
const DEFAULT_GROK_STORAGE_PATH = path.join(AUTH_DIR, 'grok-storage-state.json');
const DEFAULT_GROK_COOKIES_PATH = path.join(AUTH_DIR, 'grok-session-cookies.json');
const DEFAULT_GROK_USER_DATA_DIR = path.join(AUTH_DIR, 'grok-chrome-profile-web-fallback');
const DEFAULT_BROWSER_IMAGE_DOWNLOAD_DIR = path.join(TEMP_DIR, 'grok-images');

export const IMAGE_MODELS = {
  grok: 'grok'
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function generateImageWithGrok(apiKey, prompt, options = {}, retryCount = 0) {
  const { referenceImage, aspectRatio, resolution } = options;

  if (referenceImage) {
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

  if (aspectRatio) {
    body.aspect_ratio = aspectRatio;
  }

  if (resolution) {
    body.resolution = resolution;
  }

  if (referenceImage) {
    const base64 = referenceImage.toString('base64');
    const mimeType = 'image/jpeg';
    body.image = {
      type: 'image_url',
      url: `data:${mimeType};base64,${base64}`
    };
  }

  const response = await fetch('https://api.x.ai/v1/images/generations', {
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

  if (!data.data || !data.data[0] || !data.data[0].url) {
    throw new Error(`Unexpected Grok response format: ${JSON.stringify(data)}`);
  }

  console.log('Grok image generation complete!');
  return data.data[0].url;
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

  if (options.referenceImage) {
    throw new Error('Browser image fallback does not support reference-image edits yet.');
  }

  const outDir = options.outDir || process.env.GROK_IMAGE_OUT_DIR || DEFAULT_BROWSER_IMAGE_DOWNLOAD_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const beforeFiles = new Set(fs.readdirSync(outDir));
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
  const noTextSuffix = ', absolutely no text, no writing, no letters, no words, no labels, no fine print on any surface';
  if (!cleanPrompt.toLowerCase().includes('absolutely no text')) {
    cleanPrompt = cleanPrompt + noTextSuffix;
  }

  if (!tokens.xaiApiKey) {
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
