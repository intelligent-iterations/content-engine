#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { TEMP_DIR } from '../core/paths.js';
import {
  applyCookiesFileToContext,
  applyStorageStateToContext,
  ensureGrokStorageState,
  isChromeProfileLockError,
  makeTempChromeProfileDir,
  parseCookieFile
} from '../shared/grok-browser-session.js';
import { ensureAuthenticatedGrokSession } from '../shared/grok-web-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_PATH = path.join(PROJECT_ROOT, 'auth', 'grok-storage-state.json');
const DEFAULT_DOWNLOAD_DIR = path.join(TEMP_DIR, 'grok-images');
const DEFAULT_USER_DATA_DIR = path.join(PROJECT_ROOT, 'auth', 'grok-chrome-profile');
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;
const MIN_IMAGE_DIMENSION = 768;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60000;
const DEFAULT_MAX_RATE_LIMIT_RETRIES = 3;
const GROK_URL = 'https://grok.com/imagine';
const DEFAULT_COOKIE_PATH_CANDIDATES = [];

const PROMPT_SELECTOR_CANDIDATES = [
  'textarea[aria-label="Make an image"]',
  'textarea[aria-label="Imagine"]',
  'textarea[name*="prompt"]',
  'textarea[placeholder*="customize" i]',
  'textarea[placeholder*="image" i]',
  'div[role="textbox"][contenteditable="true"]',
  'div[role="textbox"]',
  '[contenteditable="true"]',
  'textarea'
];

const IMAGE_SELECTOR_CANDIDATES = [
  'main img',
  'img[src*="imagine-public.x.ai"]',
  'img[src*="/media/"]',
  'img'
];

const ACTION_BUTTON_SELECTOR_CANDIDATES = [
  'button[aria-label="Submit"]',
  'button[aria-label="Make image"]',
  'button[aria-label="Redo"]',
  'button[type="submit"]'
];

const REFERENCE_IMAGE_BUTTON_LABELS = [
  /upload/i,
  /add image/i,
  /reference/i,
  /attach/i,
  /image/i,
  /^\+$/i
];

function printUsage() {
  console.log(`
Usage:
  node code/image/grok-image-automation.js --save-login
  node code/image/grok-image-automation.js --prompt "your prompt here"

Options:
  --prompt <text>            Prompt to submit to Grok
  --save-login               Open a headed browser and save login state
  --state <path>             Playwright storage state path
  --cookies <path>           Import cookies JSON before running
  --out-dir <path>           Directory for downloaded images
  --reference-image <path>   Local image file to attach before generating, repeatable
  --user-data-dir <path>     Persistent Chrome profile directory
  --timeout-ms <number>      Max wait time for image generation
  --headed                   Run with visible browser
  --debug                    Extra logging
  --help                     Show this help

Examples:
  node code/image/grok-image-automation.js --save-login --headed
  node code/image/grok-image-automation.js --prompt "A cinematic perfume bottle on mirrored black glass"
  node code/image/grok-image-automation.js --prompt "Retro claymation coffee ad key visual" --cookies ./grok-cookies.json
`.trim());
}

function parseArgs(argv) {
  ensureGrokStorageState();
  const args = {
    statePath: DEFAULT_STATE_PATH,
    outDir: DEFAULT_DOWNLOAD_DIR,
    userDataDir: DEFAULT_USER_DATA_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    rateLimitWaitMs: DEFAULT_RATE_LIMIT_WAIT_MS,
    maxRateLimitRetries: DEFAULT_MAX_RATE_LIMIT_RETRIES,
    referenceImagePaths: [],
    headed: false,
    debug: false,
    saveLogin: false,
    cookiesPath: null,
    prompt: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help') {
      args.help = true;
    } else if (arg === '--save-login') {
      args.saveLogin = true;
    } else if (arg === '--headed') {
      args.headed = true;
    } else if (arg === '--debug') {
      args.debug = true;
    } else if (arg === '--prompt') {
      args.prompt = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--prompt=')) {
      args.prompt = arg.slice('--prompt='.length);
    } else if (arg === '--state') {
      args.statePath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--state=')) {
      args.statePath = arg.slice('--state='.length);
    } else if (arg === '--cookies') {
      args.cookiesPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--cookies=')) {
      args.cookiesPath = arg.slice('--cookies='.length);
    } else if (arg === '--out-dir') {
      args.outDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--out-dir=')) {
      args.outDir = arg.slice('--out-dir='.length);
    } else if (arg === '--reference-image') {
      args.referenceImagePaths.push(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--reference-image=')) {
      args.referenceImagePaths.push(arg.slice('--reference-image='.length));
    } else if (arg === '--user-data-dir') {
      args.userDataDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--user-data-dir=')) {
      args.userDataDir = arg.slice('--user-data-dir='.length);
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else if (arg === '--rate-limit-wait-ms') {
      args.rateLimitWaitMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--rate-limit-wait-ms=')) {
      args.rateLimitWaitMs = Number(arg.slice('--rate-limit-wait-ms='.length));
    } else if (arg === '--max-rate-limit-retries') {
      args.maxRateLimitRetries = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--max-rate-limit-retries=')) {
      args.maxRateLimitRetries = Number(arg.slice('--max-rate-limit-retries='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  if (!Number.isFinite(args.rateLimitWaitMs) || args.rateLimitWaitMs <= 0) {
    throw new Error('--rate-limit-wait-ms must be a positive number');
  }

  if (!Number.isInteger(args.maxRateLimitRetries) || args.maxRateLimitRetries < 0) {
    throw new Error('--max-rate-limit-retries must be a non-negative integer');
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function logDebug(enabled, message) {
  if (enabled) {
    console.log(`[debug] ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeFileName(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'grok-image';
}

function normalizePromptText(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCookiePath(providedPath) {
  if (providedPath) {
    return providedPath;
  }

  return DEFAULT_COOKIE_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolvePlaywrightLaunchOptions(args) {
  const launchOptions = {
    headless: !args.headed,
    acceptDownloads: true,
    downloadsPath: args.outDir,
    viewport: { width: 1440, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  const executableCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);

  const executablePath = executableCandidates.find((candidate) => fs.existsSync(candidate));
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  } else {
    launchOptions.channel = 'chrome';
  }

  return launchOptions;
}

async function applyCookiesToContext(context, args) {
  await applyStorageStateToContext(context, args.statePath);
  await applyCookiesFileToContext(context, resolveCookiePath(args.cookiesPath));
}

async function launchPersistentChrome(args) {
  ensureDir(args.outDir);
  const userDataDir = args.preferFreshProfile
    ? makeTempChromeProfileDir('grok-image-run-')
    : args.userDataDir;

  ensureDir(userDataDir);
  const launchOptions = resolvePlaywrightLaunchOptions(args);

  try {
    return await chromium.launchPersistentContext(userDataDir, launchOptions);
  } catch (error) {
    if (!isChromeProfileLockError(error)) {
      throw error;
    }

    const fallbackDir = makeTempChromeProfileDir('grok-image-');
    console.warn(`Profile locked at ${userDataDir}. Retrying with temp profile ${fallbackDir}`);
    return chromium.launchPersistentContext(fallbackDir, launchOptions);
  }
}

async function saveLoginState(args) {
  ensureDir(path.dirname(args.statePath));
  const context = await launchPersistentChrome({ ...args, headed: true });
  await applyCookiesToContext(context, args);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(GROK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Log into Grok in the opened browser window.');
    console.log('After the Grok Imagine page is visibly logged in, press Enter here to save the session.');
    process.stdin.resume();
    await new Promise(resolve => process.stdin.once('data', resolve));
    await context.storageState({ path: args.statePath });
    console.log(`Saved login state to ${args.statePath}`);
  } finally {
    await context.close();
  }
}

async function dismissInterruptions(page, debug) {
  const labels = [
    /accept/i,
    /allow all/i,
    /continue/i,
    /not now/i,
    /close/i,
    /got it/i,
    /skip/i
  ];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    try {
      if (await button.isVisible({ timeout: 750 })) {
        logDebug(debug, `Clicked interruption button ${label}`);
        await button.click();
        await page.waitForTimeout(400);
      }
    } catch {
      // Ignore overlays that disappear mid-click.
    }
  }
}

async function waitForEditorToHydrate(page, debug) {
  const editorSelector = '[contenteditable="true"].ProseMirror';

  await page.waitForFunction((selector) => {
    const element = document.querySelector(selector);
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }, editorSelector, { timeout: 30000 });

  logDebug(debug, 'Editor hydrated');
}

async function ensureImageMode(page, debug) {
  const resolveModeButton = async (label) => {
    const candidates = [
      page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first(),
      page.locator('button').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first(),
      page.locator(`button:has-text("${label}")`).first()
    ];

    for (const candidate of candidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: 1500 });
        return candidate;
      } catch {
        // Try next candidate.
      }
    }

    return null;
  };

  const imageButton = await resolveModeButton('Image');
  const videoButton = await resolveModeButton('Video');

  if (!imageButton) {
    logDebug(debug, 'Image mode button not found; keeping current mode');
    return;
  }

  const imageClass = await imageButton.getAttribute('class').catch(() => '');
  if (imageClass && /text-primary/.test(imageClass) && !/text-secondary/.test(imageClass)) {
    logDebug(debug, 'Image mode already active');
    return;
  }

  if (videoButton) {
    const videoClass = await videoButton.getAttribute('class').catch(() => '');
    logDebug(debug, `Current mode button classes: image=${imageClass || 'n/a'} video=${videoClass || 'n/a'}`);
  }

  await imageButton.click({ force: true });
  await page.waitForTimeout(800);

  const nextClass = await imageButton.getAttribute('class').catch(() => '');
  logDebug(debug, `Switched to Image mode; class=${nextClass || 'n/a'}`);
}

async function findVisiblePromptLocator(page) {
  const hydratedEditor = page.locator('[contenteditable="true"].ProseMirror').filter({ visible: true }).first();
  try {
    await hydratedEditor.waitFor({ state: 'visible', timeout: 1500 });
    return hydratedEditor;
  } catch {
    // Fall through to legacy selectors.
  }

  for (const selector of PROMPT_SELECTOR_CANDIDATES) {
    const locator = page.locator(selector).filter({ visible: true }).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 1500 });
      return locator;
    } catch {
      // Try next selector.
    }
  }

  throw new Error('Could not find the Grok image prompt input');
}

async function fillPrompt(locator, prompt, debug) {
  const tagName = await locator.evaluate((el) => el.tagName.toLowerCase());
  const isContentEditable = await locator.evaluate((el) => el.isContentEditable);

  await locator.click({ force: true });

  if (tagName === 'textarea' || tagName === 'input') {
    await locator.fill('');
    await locator.fill(prompt);
    logDebug(debug, 'Filled textarea/input prompt');
    return;
  }

  if (isContentEditable) {
    await locator.evaluate((el, value) => {
      el.focus();

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);

      document.execCommand('insertText', false, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, prompt);
    logDebug(debug, 'Filled contenteditable prompt');
    return;
  }

  throw new Error('Unsupported prompt input type');
}

async function attachReferenceImages(page, imagePaths, debug) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    return;
  }

  const resolvedPaths = imagePaths.map((imagePath) => path.resolve(imagePath));
  const fileInputs = page.locator('input[type="file"]');
  const fileInputCount = await fileInputs.count().catch(() => 0);
  let attachedPaths = [];

  for (let i = 0; i < fileInputCount; i += 1) {
    const input = fileInputs.nth(i);
    try {
      const supportsMultiple = await input.evaluate((node) => node.hasAttribute('multiple')).catch(() => false);
      attachedPaths = supportsMultiple ? [...resolvedPaths] : [resolvedPaths[0]];
      await input.setInputFiles(attachedPaths);
      await page.waitForTimeout(1500);
      logDebug(debug, `Attached ${attachedPaths.length} reference image(s) via file input`);

      if (supportsMultiple || resolvedPaths.length === 1) {
        return;
      }

      break;
    } catch {
      // Try next input or button-driven chooser.
    }
  }

  for (const resolvedPath of resolvedPaths.slice(attachedPaths.length)) {
    let attached = false;

    for (const label of REFERENCE_IMAGE_BUTTON_LABELS) {
      const button = page.getByRole('button', { name: label }).first();

      try {
        await button.waitFor({ state: 'visible', timeout: 1000 });
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 2000 });
        await button.click({ force: true });
        const chooser = await chooserPromise;
        await chooser.setFiles(resolvedPath);
        await page.waitForTimeout(1500);
        logDebug(debug, `Attached reference image via file chooser: ${resolvedPath}`);
        attached = true;
        attachedPaths.push(resolvedPath);
        break;
      } catch {
        // Try next label.
      }
    }

    if (!attached) {
      throw new Error(`Could not attach reference image: ${resolvedPath}`);
    }
  }

  if (attachedPaths.length < resolvedPaths.length) {
    throw new Error('Could not find a file input or upload control for image reference input');
  }
}

async function findActionButton(page) {
  for (const selector of ACTION_BUTTON_SELECTOR_CANDIDATES) {
    const button = page.locator(selector).filter({ visible: true }).first();
    try {
      if (await button.isVisible({ timeout: 500 })) {
        return button;
      }
    } catch {
      // Ignore.
    }
  }

  const handle = await page.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const labels = ['make image', 'generate', 'create image', 'send', 'redo'];
    return buttons.find((button) => {
      if (button.closest('nav, aside, [role="navigation"]')) {
        return false;
      }
      const label = (button.getAttribute('aria-label') || button.textContent || button.title || '').trim().toLowerCase();
      const visible = button.offsetParent !== null;
      return visible && labels.some((value) => label === value || label.includes(value));
    }) || null;
  });

  const element = handle.asElement();
  if (element) {
    return element;
  }

  return null;
}

async function submitPrompt(page, promptLocator, debug) {
  const button = await findActionButton(page);

  if (button) {
    try {
      await button.waitForElementState?.('stable').catch(() => {});
      const disabled = await button.isDisabled?.().catch(() => false);
      if (disabled) {
        throw new Error('Submit button is disabled');
      }
      await button.click({ force: true });
      logDebug(debug, 'Submitted via action button');
      return;
    } catch {
      // Fall through to Enter.
    }
  }

  await promptLocator.press('Enter');
  logDebug(debug, 'Submitted via Enter key');
}

async function detectErrorState(page) {
  const visibleDialogText = await page.evaluate(() => {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[data-radix-dialog-content]',
      '[data-state="open"][role="dialog"]'
    ];

    const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const texts = [];

    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (!text) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      texts.push(text);
    }

    return texts.join('\n');
  }).catch(() => '');

  const loweredDialog = visibleDialogText.toLowerCase();
  if (
    page.url().includes('#subscribe')
    || (
      loweredDialog.includes('supergrok')
      && (
        loweredDialog.includes('claim free offer')
        || loweredDialog.includes('try free for 3 days')
        || loweredDialog.includes('upgrade to lite')
      )
    )
  ) {
    return 'Grok browser submit opened the SuperGrok subscribe modal instead of starting image generation.';
  }

  const visibleErrorText = await page.evaluate(() => {
    const selectors = [
      '[role="alert"]',
      '[role="status"]',
      '[role="dialog"]',
      '[data-sonner-toast]',
      '[data-radix-toast-viewport]',
      '[aria-live="assertive"]',
      '[aria-live="polite"]'
    ];

    const nodes = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const texts = [];

    for (const node of nodes) {
      const text = (node.textContent || '').trim();
      if (!text) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      texts.push(text);
    }

    return texts.join('\n');
  }).catch(() => '');

  const fallbackBodyText = visibleErrorText
    ? visibleErrorText
    : await page.locator('body').innerText().catch(() => '');
  const lowered = fallbackBodyText.toLowerCase();

  if (lowered.includes('content moderated') || lowered.includes('try a different idea')) {
    return 'Grok rejected the prompt due to moderation';
  }

  if (lowered.includes('rate limit reached') || lowered.includes('too many requests')) {
    return 'Grok rate limit reached';
  }

  if (lowered.includes('something went wrong') || lowered.includes('generation failed')) {
    return 'Grok reported a generation failure';
  }

  const hardLimitPatterns = [
    'generation limit reached',
    'you\'ve reached your limit',
    'you have reached your limit',
    'get more generations',
    'daily limit reached',
    'monthly limit reached'
  ];

  if (hardLimitPatterns.some((pattern) => lowered.includes(pattern))) {
    return 'Grok free-tier limit reached (upgrade/subscription upsell detected). Use XAI_API_KEY or wait for the limit to reset.';
  }

  return null;
}

async function extractImageMetadata(page) {
  return page.evaluate(() => {
    const normalizeUrl = (value) => {
      if (!value) return '';
      if (value.startsWith('//')) return `${location.protocol}${value}`;
      if (value.startsWith('/')) return `${location.origin}${value}`;
      return value;
    };

    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[property="twitter:image"]'
    ];

    const metaUrls = metaSelectors
      .map((selector) => document.querySelector(selector)?.getAttribute('content') || '')
      .map(normalizeUrl)
      .filter(Boolean);

    const imageUrls = Array.from(document.querySelectorAll('img'))
      .map((img) => ({
        src: normalizeUrl(img.currentSrc || img.src || ''),
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0
      }))
      .filter((img) => img.src)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height));

    const downloadLinks = Array.from(document.querySelectorAll('a[href], a[download]'))
      .map((link) => ({
        href: normalizeUrl(link.getAttribute('href') || ''),
        text: (link.textContent || link.getAttribute('aria-label') || '').trim()
      }))
      .filter((link) => link.href);

    return {
      currentUrl: location.href,
      metaUrls,
      imageUrls,
      downloadLinks
    };
  });
}

function chooseDirectImageUrl(metadata) {
  const preferred = [
    ...metadata.downloadLinks
      .filter((link) => /download|save/i.test(link.text) || /\.(png|jpe?g|webp)(\?|$)/i.test(link.href))
      .map((link) => link.href),
    ...metadata.imageUrls.map((img) => img.src),
    ...metadata.metaUrls
  ];

  return preferred.find((url) => (
    /^data:image\//i.test(url)
    || (/^https?:/i.test(url) && (
      url.includes('imagine-public.x.ai')
      || url.includes('/media/')
      || /\.(png|jpe?g|webp)(\?|$)/i.test(url)
    ))
  )) || null;
}

function collectKnownMediaUrls(metadata) {
  return new Set([
    ...(metadata?.metaUrls || []),
    ...((metadata?.imageUrls || []).map((img) => img.src)),
    ...((metadata?.downloadLinks || []).map((link) => link.href))
  ].filter(Boolean));
}

async function collectKnownPublicAssetUrls(page) {
  return page.evaluate(() => {
    const urls = new Set();
    const normalize = (value) => {
      if (!value) return '';
      if (value.startsWith('//')) return `${location.protocol}${value}`;
      if (value.startsWith('/')) return `${location.origin}${value}`;
      return value;
    };

    for (const img of document.querySelectorAll('img')) {
      const src = normalize(img.currentSrc || img.src || '');
      if (/imagine-public\.x\.ai\/imagine-public\/(images|share-images)\//i.test(src)) {
        urls.add(src);
      }
    }

    for (const entry of performance.getEntriesByType('resource')) {
      const name = normalize(entry.name || '');
      if (/imagine-public\.x\.ai\/imagine-public\/(images|share-images)\//i.test(name)) {
        urls.add(name);
      }
    }

    return Array.from(urls);
  });
}

async function collectKnownSectionIds(page) {
  return page.evaluate(() => (
    Array.from(document.querySelectorAll('[id^="imagine-masonry-section-"]'))
      .map((node) => node.id)
      .filter(Boolean)
  ));
}

async function resolvePromptSection(page, prompt, debug, options = {}) {
  const allowFallback = options.allowFallback !== false;
  const target = normalizePromptText(prompt);
  const locator = page.locator('[id^="imagine-masonry-section-"]').filter({
    has: page.locator('span')
  });
  const count = await locator.count().catch(() => 0);

  for (let i = 0; i < count; i += 1) {
    const section = locator.nth(i);
    const text = normalizePromptText(await section.textContent().catch(() => ''));
    if (text.includes(target)) {
      logDebug(debug, `Matched prompt section ${i} for prompt "${prompt}"`);
      return section;
    }
  }

  if (!allowFallback) {
    logDebug(debug, `No prompt section match for "${prompt}" yet`);
    return null;
  }

  logDebug(debug, `No exact prompt section match for "${prompt}", using latest section`);
  return locator.first();
}

async function extractSectionImageMetadata(section) {
  return section.evaluate((node) => {
    const normalizeUrl = (value) => {
      if (!value) return '';
      if (value.startsWith('//')) return `${location.protocol}${value}`;
      if (value.startsWith('/')) return `${location.origin}${value}`;
      return value;
    };

    const imageUrls = Array.from(node.querySelectorAll('img'))
      .map((img) => ({
        src: normalizeUrl(img.currentSrc || img.src || ''),
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0
      }))
      .filter((img) => img.src)
      .sort((a, b) => (b.width * b.height) - (a.width * a.height));

    const downloadLinks = Array.from(node.querySelectorAll('a[href], a[download]'))
      .map((link) => ({
        href: normalizeUrl(link.getAttribute('href') || ''),
        text: (link.textContent || link.getAttribute('aria-label') || '').trim()
      }))
      .filter((link) => link.href);

    return {
      currentUrl: location.href,
      sectionId: node.id || '',
      metaUrls: [],
      imageUrls,
      downloadLinks
    };
  });
}


async function waitForGeneration(page, timeoutMs, debug, initialMetadata, knownSectionIds = [], interceptedJobIds = [], completedJobIds = [], prompt = '') {
  const deadline = Date.now() + timeoutMs;
  let sawProgress = false;
  const knownUrls = collectKnownMediaUrls(initialMetadata);

  // Grok shows a compressed data URL preview (~31KB) on the main page.
  // The full-quality image is only on the /imagine/post/{jobId} page,
  // where it loads as an HTTP CDN URL (share-images).
  //
  // Strategy:
  //   1. Wait for any generated image to appear (even as preview)
  //   2. Once preview + job ID available, navigate directly to /imagine/post/{jobId}
  //   3. Wait for the full-res CDN image on the post page
  //   4. Fall back to best data URL if no CDN image appears

  let previewDetected = false;

  while (Date.now() < deadline) {
    await dismissInterruptions(page, debug);

    const error = await detectErrorState(page);
    if (error) {
      throw new Error(error);
    }

    const currentSectionIds = await collectKnownSectionIds(page).catch(() => []);
    const newestSectionId = currentSectionIds.find((id) => !knownSectionIds.includes(id)) || null;
    const promptSection = newestSectionId
      ? page.locator(`#${newestSectionId}`).first()
      : (prompt
        ? await resolvePromptSection(page, prompt, debug, { allowFallback: false }).catch(() => null)
        : null);
    const promptSectionMetadata = promptSection
      ? await extractSectionImageMetadata(promptSection).catch(() => null)
      : null;
    const pageMetadata = await extractImageMetadata(page);

    // PATH 2: Check for new direct image URLs in the prompt-matched section only.
    const directUrl = promptSectionMetadata
      ? chooseDirectImageUrl({
        ...promptSectionMetadata,
        metaUrls: promptSectionMetadata.metaUrls.filter((url) => !knownUrls.has(url)),
        imageUrls: promptSectionMetadata.imageUrls.filter((img) => !knownUrls.has(img.src)),
        downloadLinks: promptSectionMetadata.downloadLinks.filter((link) => !knownUrls.has(link.href))
      })
      : null;

    if (directUrl) {
      if (/^data:image\//i.test(directUrl)) {
        const matchingImg = promptSectionMetadata?.imageUrls.find((img) => img.src === directUrl);
        const imgMaxDim = matchingImg ? Math.max(matchingImg.width, matchingImg.height) : 0;

        if (imgMaxDim >= MIN_IMAGE_DIMENSION && !previewDetected) {
          previewDetected = true;
          logDebug(debug, `Preview detected (${matchingImg?.width}x${matchingImg?.height}, ${Math.round(directUrl.length / 1024)}KB)`);

          // Once we have a preview and a job ID, navigate directly to the
          // post page to get the full-res CDN image (clicking doesn't work
          // in headless mode).
          if (interceptedJobIds.length > 0) {
            logDebug(debug, `Have ${interceptedJobIds.length} job IDs — navigating to post page for full-res image`);
            return { directUrl, metadata: pageMetadata };
          }
        }
      } else {
        logDebug(debug, `Direct HTTP image URL detected: ${directUrl}`);
        return { directUrl, metadata: pageMetadata };
      }
    }

    // If preview detected but no job IDs yet, wait for WS to deliver them
    if (previewDetected && interceptedJobIds.length > 0) {
      logDebug(debug, 'Preview + job IDs ready — returning for post-page navigation');
      const lastMetadata = await extractImageMetadata(page).catch(() => initialMetadata);
      const lastDirectUrl = promptSectionMetadata
        ? chooseDirectImageUrl(promptSectionMetadata)
        : null;
      if (lastDirectUrl) {
        return { directUrl: lastDirectUrl, metadata: lastMetadata, jobIds: [...interceptedJobIds] };
      }
    }

    if (completedJobIds.length > 0) {
      logDebug(debug, `Completed image job detected via websocket: ${completedJobIds[0]}`);
      return {
        directUrl: null,
        metadata: pageMetadata,
        jobIds: [...completedJobIds],
      };
    }

    const progressButton = page.locator('button[aria-label*="Options"]').first();
    try {
      if (await progressButton.isVisible({ timeout: 300 })) {
        sawProgress = true;
      }
    } catch {
      // Ignore missing progress button.
    }

    await page.waitForTimeout(previewDetected ? 2000 : (sawProgress ? 2500 : 1500));
  }

  throw new Error(`Timed out waiting for image generation after ${Math.round(timeoutMs / 1000)}s`);
}

async function downloadViaButton(page, outputPath, debug, options = {}) {
  const section = await resolvePromptSection(page, options.prompt, debug, { allowFallback: false }).catch(() => null);
  if (!section) {
    return null;
  }

  const saveButtons = section.locator('button[aria-label="Save"]');
  const saveButtonCount = await saveButtons.count().catch(() => 0);
  if (saveButtonCount < 1) {
    logDebug(debug, 'No section-local Save buttons found');
    return null;
  }

  const cardIndex = Math.min(options.cardIndex ?? 0, saveButtonCount - 1);
  const knownPublicAssetUrls = new Set(await collectKnownPublicAssetUrls(page).catch(() => []));
  logDebug(debug, `Trying section-local Save for card ${cardIndex}; known public assets=${knownPublicAssetUrls.size}`);

  const downloadPromise = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
  const publicAssetResponses = [];
  const publicAssetHandler = (response) => {
    const url = response.url();
    if (
      response.status() === 200
      && /imagine-public\.x\.ai\/imagine-public\/(images|share-images)\/.+\.(png|jpe?g|webp)(\?|$)/i.test(url)
      && !knownPublicAssetUrls.has(url)
    ) {
      publicAssetResponses.push(url);
    }
  };
  page.on('response', publicAssetHandler);

  const targetButton = saveButtons.nth(cardIndex);
  try {
    await targetButton.click({ force: true, timeout: 2000 });
  } catch {
    await page.evaluate((idx) => {
      const sectionNode = document.querySelector('[id^="imagine-masonry-section-"]');
      const sections = Array.from(document.querySelectorAll('[id^="imagine-masonry-section-"]'));
      const sectionMatch = sections.find((node) => (node.textContent || '').toLowerCase().includes(window.__codexPromptTarget || '')) || sectionNode;
      const button = sectionMatch?.querySelectorAll('button[aria-label="Save"]')?.[idx];
      const card = button?.closest('.group\\/media-post-masonry-card');
      if (card) {
        card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
        card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
      }
      if (button) {
        button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
    }, cardIndex).catch(() => {});
  }

  await page.waitForTimeout(12000);
  page.off('response', publicAssetHandler);

  const download = await downloadPromise;
  if (download) {
    await download.saveAs(outputPath);
    return { outputPath };
  }

  const directUrl = publicAssetResponses.at(-1) || null;
  if (directUrl) {
    logDebug(debug, `Captured post-save asset URL ${directUrl}`);
    return { directUrl };
  }

  logDebug(debug, 'Section-local Save did not produce a new public asset response');

  return null;
}

async function downloadViaBrowserNavigation(context, url, outputPath, debug) {
  logDebug(debug, `Trying browser navigation download for ${url}`);
  const page = await context.newPage();

  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null)
    ]);
    await download.saveAs(outputPath);
    return outputPath;
  } finally {
    await page.close().catch(() => {});
  }
}

async function downloadFromUrl(context, page, url, outputPath, debug) {
  if (/^data:image\//i.test(url)) {
    logDebug(debug, 'Saving image from in-page data URL');
    const match = url.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Unsupported data URL format for image result');
    }

    fs.writeFileSync(outputPath, Buffer.from(match[2], 'base64'));
    return outputPath;
  }

  logDebug(debug, `Downloading direct asset ${url}`);
  const response = await context.request.get(url, {
    timeout: 120000,
    headers: {
      referer: 'https://grok.com/',
      origin: 'https://grok.com'
    }
  });

  if (response.ok()) {
    fs.writeFileSync(outputPath, Buffer.from(await response.body()));
    return outputPath;
  }

  logDebug(debug, `Direct request returned ${response.status()}, falling back to page fetch`);

  const fetched = await page.evaluate(async (assetUrl) => {
    try {
      const res = await fetch(assetUrl, {
        credentials: 'include'
      });

      if (!res.ok) {
        return { ok: false, status: res.status };
      }

      const blob = await res.blob();
      const buffer = await blob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      return { ok: true, bytes };
    } catch (error) {
      return {
        ok: false,
        status: -1,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }, url);

  if (!fetched.ok) {
    logDebug(debug, `Page fetch failed with status ${fetched.status}${fetched.error ? `: ${fetched.error}` : ''}`);
    const browserDownload = await downloadViaBrowserNavigation(context, url, outputPath, debug).catch(() => null);
    if (browserDownload) {
      return browserDownload;
    }
    throw new Error(`Image download failed with status ${fetched.status}`);
  }

  fs.writeFileSync(outputPath, Buffer.from(fetched.bytes));
  return outputPath;
}

function inferImageExtension(url) {
  const normalized = String(url || '').toLowerCase();
  if (normalized.startsWith('data:image/jpeg')) return 'jpg';
  if (normalized.startsWith('data:image/jpg')) return 'jpg';
  if (normalized.startsWith('data:image/png')) return 'png';
  if (normalized.startsWith('data:image/webp')) return 'webp';
  if (normalized.includes('.png')) return 'png';
  if (normalized.includes('.webp')) return 'webp';
  if (normalized.includes('.jpg') || normalized.includes('.jpeg')) return 'jpg';
  return 'png';
}

async function runPrompt(args) {
  const context = await launchPersistentChrome(args);
  await applyCookiesToContext(context, args);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.addInitScript((promptTarget) => {
      window.__codexPromptTarget = promptTarget;
    }, normalizePromptText(args.prompt));

    let result = null;
    let attempt = 0;
    while (attempt <= args.maxRateLimitRetries) {
      await page.goto(GROK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await dismissInterruptions(page, args.debug);
      await ensureAuthenticatedGrokSession(page, context, {
        debug: args.debug,
        statePath: args.statePath,
      });
      await waitForEditorToHydrate(page, args.debug);
      await dismissInterruptions(page, args.debug);
      await ensureImageMode(page, args.debug);
      await attachReferenceImages(page, args.referenceImagePaths, args.debug);

      const promptInput = await findVisiblePromptLocator(page);
      await fillPrompt(promptInput, args.prompt, args.debug);
      await page.waitForFunction(() => {
        const submit = document.querySelector('button[aria-label="Submit"]');
        return !submit || !submit.disabled;
      }, { timeout: 15000 }).catch(() => {});
      const initialMetadata = await extractImageMetadata(page);

      // Intercept WebSocket frames to capture full-resolution CDN URLs.
      // Grok Imagine uses WebSocket (wss://grok.com/ws/imagine/listen) for
      // generation. Completion frames contain CDN image URLs.
      const baselinePublicUrls = new Set(await collectKnownPublicAssetUrls(page).catch(() => []));
      const baselineSectionIds = await collectKnownSectionIds(page).catch(() => []);
      const interceptedCdnUrls = [];
      const interceptedJobIds = [];
      const completedJobIds = [];

      const cdpSession = await page.context().newCDPSession(page);
      await cdpSession.send('Network.enable');

      const wsFrameHandler = (params) => {
        try {
          const data = params.response?.payloadData || '';
          if (!data || data.length < 10) return;

          // Parse JSON frames
          let frame;
          try { frame = JSON.parse(data); } catch { return; }

          // Track job IDs
          if (frame.job_id && !interceptedJobIds.includes(frame.job_id)) {
            interceptedJobIds.push(frame.job_id);
            logDebug(args.debug, `WS job: ${frame.job_id} status=${frame.current_status}`);
          }

          const status = String(frame.current_status || frame.status || '').toLowerCase();
          if (frame.job_id && /(complete|completed|done|success|succeeded|finished|ready)/i.test(status) && !completedJobIds.includes(frame.job_id)) {
            completedJobIds.push(frame.job_id);
            logDebug(args.debug, `WS completed image job: ${frame.job_id} status=${status}`);
          }

          // Look for CDN URLs in any field
          const frameStr = data;
          const cdnMatches = frameStr.match(/https?:\/\/imagine-public\.x\.ai[^\s"')\]}>]+\.(png|jpe?g|webp)(\?[^\s"')\]}>]*)?/gi);
          if (cdnMatches) {
            for (const match of cdnMatches) {
              if (!baselinePublicUrls.has(match) && !interceptedCdnUrls.includes(match)) {
                interceptedCdnUrls.push(match);
                logDebug(args.debug, `WS CDN URL: ${match}`);
              }
            }
          }

          // Check for image_url, url, or similar fields
          if (frame.image_url || frame.url || frame.imageUrl) {
            const url = frame.image_url || frame.url || frame.imageUrl;
            if (/^https?:/.test(url) && !interceptedCdnUrls.includes(url)) {
              interceptedCdnUrls.push(url);
              logDebug(args.debug, `WS image URL field: ${url}`);
            }
          }
        } catch {
          // Ignore parse errors
        }
      };
      cdpSession.on('Network.webSocketFrameReceived', wsFrameHandler);

      // Also watch HTTP responses for CDN URLs
      const cdnResponseHandler = async (response) => {
        try {
          const url = response.url();
          if (
            response.status() === 200
            && /imagine-public\.x\.ai\/imagine-public\/(images|share-images)\/.+\.(png|jpe?g|webp)(\?|$)/i.test(url)
            && !baselinePublicUrls.has(url)
          ) {
            interceptedCdnUrls.push(url);
            logDebug(args.debug, `HTTP CDN response: ${url}`);
          }
        } catch {}
      };
      page.on('response', cdnResponseHandler);

      await submitPrompt(page, promptInput, args.debug);

      try {
        result = await waitForGeneration(page, args.timeoutMs, args.debug, initialMetadata, baselineSectionIds, interceptedJobIds, completedJobIds, args.prompt);

        // Try to upgrade from data URL preview to full-res CDN image.
        // The WS-intercepted /images/{jobId} CDN URLs are the exact generated
        // images. In-page fetch fails (CORS), but context.request bypasses CORS.
        if ((!result.directUrl || /^data:/.test(result.directUrl || '')) && interceptedJobIds.length > 0) {
          // Wait a moment for remaining WS CDN URLs to arrive
          await page.waitForTimeout(5000);

          // Strategy 1: Download /images/{jobId} URLs via context.request (bypasses CORS)
          const wsImageUrls = interceptedCdnUrls.filter((u) => /\/images\//.test(u));
          logDebug(args.debug, `Trying ${wsImageUrls.length} WS /images/ URLs via context.request`);
          for (const wsUrl of wsImageUrls) {
            try {
              const resp = await context.request.get(wsUrl, {
                timeout: 10000,
                headers: { referer: 'https://grok.com/', origin: 'https://grok.com' }
              });
              if (resp.ok()) {
                const body = await resp.body();
                if (body.length > 50000) {
                  logDebug(args.debug, `Full-res image downloaded: ${wsUrl} (${body.length} bytes)`);
                  result.directUrl = wsUrl;
                  break;
                }
                logDebug(args.debug, `${wsUrl} returned ${body.length} bytes (too small)`);
              } else {
                logDebug(args.debug, `${wsUrl} returned status ${resp.status()}`);
              }
            } catch (e) {
              logDebug(args.debug, `${wsUrl} context.request failed: ${e.message}`);
            }
          }

          // Strategy 2: Navigate to post page, wait for the generated image to load
          if (/^data:/.test(result.directUrl || '')) {
            for (const jobId of interceptedJobIds.slice(0, 2)) {
              const postUrl = `https://grok.com/imagine/post/${jobId}`;
              logDebug(args.debug, `Navigating to post page: ${postUrl}`);
              await page.goto(postUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
              await page.waitForTimeout(5000);

              // Look for CDN images on the post page — only match actual CDN paths
              const mainImage = await page.evaluate(() => {
                const imgs = Array.from(document.querySelectorAll('img'));
                const cdnImgs = imgs
                  .map((img) => ({
                    src: img.currentSrc || img.src || '',
                    w: img.naturalWidth || img.width || 0,
                    h: img.naturalHeight || img.height || 0
                  }))
                  .filter((img) =>
                    /^https:\/\/imagine-public\.x\.ai\/imagine-public\/(images|share-images)\//.test(img.src)
                    && Math.max(img.w, img.h) >= 800
                  )
                  .sort((a, b) => (b.w * b.h) - (a.w * a.h));
                return cdnImgs[0] || null;
              }).catch(() => null);

              if (mainImage) {
                logDebug(args.debug, `Post page image: ${mainImage.src} (${mainImage.w}x${mainImage.h})`);
                result.directUrl = mainImage.src;
                break;
              }

              // Strategy 3: Try context.request on /images/{jobId} URLs
              for (const ext of ['png', 'jpg']) {
                const cdnUrl = `https://imagine-public.x.ai/imagine-public/images/${jobId}.${ext}`;
                try {
                  const resp = await context.request.get(cdnUrl, {
                    timeout: 8000,
                    headers: { referer: 'https://grok.com/', origin: 'https://grok.com' }
                  });
                  if (resp.ok()) {
                    const body = await resp.body();
                    if (body.length > 50000) {
                      logDebug(args.debug, `CDN /images/ accessible: ${cdnUrl} (${body.length} bytes)`);
                      result.directUrl = cdnUrl;
                      break;
                    }
                  }
                } catch {}
              }
              if (!/^data:/.test(result.directUrl || '')) break;
            }
          }
        }
        break;
      } catch (error) {
        const isRateLimit = /rate limit/i.test(error.message || '');
        if (!isRateLimit || attempt >= args.maxRateLimitRetries) {
          throw error;
        }

        const waitMs = args.rateLimitWaitMs * (attempt + 1);
        console.warn(`Grok rate limited image generation. Waiting ${Math.round(waitMs / 1000)}s before retry ${attempt + 1}/${args.maxRateLimitRetries}...`);
        await sleep(waitMs);
        attempt += 1;
      } finally {
        page.off('response', cdnResponseHandler);
        cdpSession.off('Network.webSocketFrameReceived', wsFrameHandler);
        await cdpSession.detach().catch(() => {});
      }
    }

    if (!result) {
      throw new Error('Image generation did not produce a result');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(
      args.outDir,
      `${sanitizeFileName(args.prompt)}-${timestamp}.${inferImageExtension(result.directUrl)}`
    );

    const buttonResult = await downloadViaButton(page, outputPath, args.debug, {
      prompt: args.prompt,
      cardIndex: 0
    });
    if (buttonResult?.outputPath) {
      console.log(`Downloaded image to ${buttonResult.outputPath}`);
      return;
    }

    await downloadFromUrl(context, page, buttonResult?.directUrl || result.directUrl, outputPath, args.debug);
    console.log(`Downloaded image to ${outputPath}`);
  } finally {
    await context.close();
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || (!args.saveLogin && !args.prompt)) {
      printUsage();
      return;
    }

    if (args.saveLogin) {
      await saveLoginState(args);
      return;
    }

    for (const referenceImagePath of args.referenceImagePaths) {
      if (!fs.existsSync(referenceImagePath)) {
        throw new Error(`Reference image not found: ${referenceImagePath}`);
      }
    }

    await runPrompt(args);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
