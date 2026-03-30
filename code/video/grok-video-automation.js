#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { AUTH_DIR, ROOT_DIR, TEMP_DIR, isMainModule } from '../core/paths.js';
import {
  applyCookiesFileToContext,
  applyStorageStateToContext,
  isChromeProfileLockError,
  makeTempChromeProfileDir
} from '../shared/grok-browser-session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATE_PATH = path.join(AUTH_DIR, 'grok-storage-state.json');
const DEFAULT_DOWNLOAD_DIR = path.join(TEMP_DIR, 'grok');
const DEFAULT_USER_DATA_DIR = path.join(AUTH_DIR, 'grok-chrome-profile');
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const GROK_URL = 'https://grok.com/imagine';
const DEFAULT_COOKIE_PATH_CANDIDATES = [
  path.join(ROOT_DIR, 'cookies', 'x_cookies.json')
];

const PROMPT_SELECTOR_CANDIDATES = [
  'textarea[aria-label="Make a video"]',
  'textarea[name*="prompt"]',
  'textarea[placeholder*="customize" i]',
  'textarea[placeholder*="video" i]',
  'div[role="textbox"][contenteditable="true"]',
  'div[role="textbox"]',
  '[contenteditable="true"]',
  'textarea'
];

const VIDEO_SELECTOR_CANDIDATES = [
  'video#sd-video',
  'main video',
  'video'
];

const ACTION_BUTTON_SELECTOR_CANDIDATES = [
  'button[aria-label="Submit"]',
  'button[aria-label="Make video"]',
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
  node code/cli/grok-video.js --save-login
  node code/cli/grok-video.js --prompt "your prompt here"

Options:
  --prompt <text>            Prompt to submit to Grok
  --save-login               Open a headed browser and save login state
  --state <path>             Playwright storage state path
  --cookies <path>           Import cookies JSON before running
  --out-dir <path>           Directory for downloaded videos
  --output-path <path>       Exact file path for the downloaded video
  --reference-image <path>   Local image file to attach before generating video
  --user-data-dir <path>     Persistent Chrome profile directory
  --duration-seconds <n>     Video duration to select in the UI (6 or 10)
  --timeout-ms <number>      Max wait time for video generation
  --headed                   Run with visible browser
  --debug                    Extra logging
  --help                     Show this help

Examples:
  node code/cli/grok-video.js --save-login --headed
  node code/cli/grok-video.js --prompt "A cinematic drone shot over snowy mountains"
  node code/cli/grok-video.js --prompt "Retro claymation coffee ad" --cookies ./grok-cookies.json
`.trim());
}

function parseArgs(argv) {
  const args = {
    statePath: DEFAULT_STATE_PATH,
    outDir: DEFAULT_DOWNLOAD_DIR,
    outputPath: null,
    referenceImagePath: null,
    userDataDir: DEFAULT_USER_DATA_DIR,
    durationSeconds: 6,
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    } else if (arg === '--output-path') {
      args.outputPath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--output-path=')) {
      args.outputPath = arg.slice('--output-path='.length);
    } else if (arg === '--reference-image') {
      args.referenceImagePath = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--reference-image=')) {
      args.referenceImagePath = arg.slice('--reference-image='.length);
    } else if (arg === '--user-data-dir') {
      args.userDataDir = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--user-data-dir=')) {
      args.userDataDir = arg.slice('--user-data-dir='.length);
    } else if (arg === '--duration-seconds') {
      args.durationSeconds = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--duration-seconds=')) {
      args.durationSeconds = Number(arg.slice('--duration-seconds='.length));
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  if (![6, 10].includes(args.durationSeconds)) {
    throw new Error('--duration-seconds must be 6 or 10');
  }

  if (args.referenceImagePath && !fs.existsSync(args.referenceImagePath)) {
    throw new Error(`Reference image not found: ${args.referenceImagePath}`);
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

function sanitizeFileName(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'grok-video';
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

async function buildContext(browser, args) {
  const contextOptions = {
    acceptDownloads: true,
    viewport: { width: 1440, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  if (fs.existsSync(args.statePath)) {
    contextOptions.storageState = args.statePath;
  }

  const context = await browser.newContext(contextOptions);
  await applyStorageStateToContext(context, args.statePath);
  await applyCookiesFileToContext(context, resolveCookiePath(args.cookiesPath));

  return context;
}

async function applyCookiesToContext(context, args) {
  await applyStorageStateToContext(context, args.statePath);
  await applyCookiesFileToContext(context, resolveCookiePath(args.cookiesPath));
}

async function launchPersistentChrome(args) {
  ensureDir(args.userDataDir);
  ensureDir(args.outDir);
  const launchOptions = resolvePlaywrightLaunchOptions(args);

  try {
    return await chromium.launchPersistentContext(args.userDataDir, launchOptions);
  } catch (error) {
    if (!isChromeProfileLockError(error)) {
      throw error;
    }

    const fallbackDir = makeTempChromeProfileDir('grok-video-');
    console.warn(`Profile locked at ${args.userDataDir}. Retrying with temp profile ${fallbackDir}`);
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

async function ensureVideoMode(page, debug) {
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

  const videoButton = await resolveModeButton('Video');
  const imageButton = await resolveModeButton('Image');

  if (!videoButton) {
    logDebug(debug, 'Video mode button not found; keeping current mode');
    return;
  }

  const videoClass = await videoButton.getAttribute('class').catch(() => '');
  if (videoClass && /text-primary/.test(videoClass) && !/text-secondary/.test(videoClass)) {
    logDebug(debug, 'Video mode already active');
    return;
  }

  if (imageButton) {
    const imageClass = await imageButton.getAttribute('class').catch(() => '');
    logDebug(debug, `Current mode button classes: image=${imageClass || 'n/a'} video=${videoClass || 'n/a'}`);
  }

  await videoButton.click({ force: true });
  await page.waitForTimeout(800);

  const nextClass = await videoButton.getAttribute('class').catch(() => '');
  logDebug(debug, `Switched to Video mode; class=${nextClass || 'n/a'}`);
}

async function ensureVideoDuration(page, durationSeconds, debug) {
  const label = `${durationSeconds}s`;
  const durationOption = page.getByRole('radio', { name: label, exact: true });

  await durationOption.waitFor({ state: 'visible', timeout: 5000 });

  const currentState = await durationOption.getAttribute('aria-checked').catch(() => null);
  if (currentState === 'true') {
    logDebug(debug, `Video duration already set to ${label}`);
    return;
  }

  await durationOption.click({ force: true });

  await page.waitForFunction((targetLabel) => {
    const options = Array.from(document.querySelectorAll('button[role="radio"]'));
    const match = options.find((node) => node.textContent?.trim() === targetLabel);
    return match?.getAttribute('aria-checked') === 'true';
  }, label, { timeout: 5000 });

  logDebug(debug, `Switched video duration to ${label}`);
}

async function assertLoggedIn(page) {
  const href = page.url();
  if (/\/i\/flow\/login|\/login\b/i.test(href)) {
    throw new Error('Not logged in to Grok. Save a storage state first with --save-login or provide valid cookies.');
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const lowered = bodyText.toLowerCase();
  const hasLoginWall = lowered.includes('sign in to grok') || lowered.includes('log in to grok') || lowered.includes('continue with google');

  if (hasLoginWall) {
    throw new Error('Not logged in to Grok. Save a storage state first with --save-login or provide valid cookies.');
  }
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

  const fallback = await page.evaluateHandle((selectors) => {
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    return candidates.find((el) => {
      const style = window.getComputedStyle(el);
      const text = (el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') || el.textContent || '').toLowerCase();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
      return visible && !text.includes('search');
    }) || null;
  }, PROMPT_SELECTOR_CANDIDATES);

  const asElement = fallback.asElement();
  if (asElement) {
    return asElement;
  }

  throw new Error('Could not find the Grok video prompt input');
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

async function attachReferenceImage(page, imagePath, debug) {
  if (!imagePath) {
    return;
  }

  const resolvedPath = path.resolve(imagePath);
  const fileInputs = page.locator('input[type="file"]');
  const fileInputCount = await fileInputs.count().catch(() => 0);

  for (let i = 0; i < fileInputCount; i += 1) {
    const input = fileInputs.nth(i);
    try {
      await input.setInputFiles(resolvedPath);
      await page.waitForTimeout(1500);
      logDebug(debug, `Attached reference image via file input: ${resolvedPath}`);
      return;
    } catch {
      // Try next input or button-driven chooser.
    }
  }

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
      return;
    } catch {
      // Try next label.
    }
  }

  throw new Error('Could not find a file input or upload control for video reference image');
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
    const labels = ['make video', 'generate', 'create video', 'send', 'redo'];
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
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const lowered = bodyText.toLowerCase();

  if (lowered.includes('content moderated') || lowered.includes('try a different idea')) {
    return 'Grok rejected the prompt due to moderation';
  }

  if (lowered.includes('rate limit reached') || lowered.includes('too many requests')) {
    return 'Grok rate limit reached';
  }

  if (lowered.includes('something went wrong') || lowered.includes('generation failed')) {
    return 'Grok reported a generation failure';
  }

  const upsellPatterns = [
    'upgrade to supergrok',
    'upgrade to grok plus',
    'subscribe to grok',
    'supergrok plan',
    'grok plus plan',
    'unlock more',
    'get more generations',
    'generation limit reached',
    'limit reached',
    'you\'ve reached your limit',
    'upgrade your plan',
    'upgrade now',
    'go premium',
  ];

  if (upsellPatterns.some((pattern) => lowered.includes(pattern))) {
    return 'Grok free-tier limit reached (upgrade/subscription upsell detected). Use XAI_API_KEY or wait for the limit to reset.';
  }

  return null;
}

async function extractVideoMetadata(page) {
  return page.evaluate(() => {
    const normalizeUrl = (value) => {
      if (!value) return '';
      if (value.startsWith('//')) return `${location.protocol}${value}`;
      if (value.startsWith('/')) return `${location.origin}${value}`;
      return value;
    };

    const metaSelectors = [
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[name="twitter:player:stream"]',
      'meta[name="twitter:player"]'
    ];

    const metaUrls = metaSelectors
      .map((selector) => document.querySelector(selector)?.getAttribute('content') || '')
      .map(normalizeUrl)
      .filter(Boolean);

    const videos = Array.from(document.querySelectorAll('video'));
    const videoUrls = videos
      .flatMap((video) => [video.currentSrc || '', video.src || '', ...(Array.from(video.querySelectorAll('source')).map((source) => source.src || ''))])
      .map(normalizeUrl)
      .filter(Boolean);

    const downloadLinks = Array.from(document.querySelectorAll('a[href], a[download]'))
      .map((link) => ({
        href: normalizeUrl(link.getAttribute('href') || ''),
        text: (link.textContent || link.getAttribute('aria-label') || '').trim()
      }))
      .filter((link) => link.href);

    return {
      currentUrl: location.href,
      metaUrls,
      videoUrls,
      downloadLinks
    };
  });
}

function chooseDirectVideoUrl(metadata) {
  const preferred = [
    ...metadata.downloadLinks
      .filter((link) => /download/i.test(link.text) || /\.mp4(\?|$)/i.test(link.href))
      .map((link) => link.href),
    ...metadata.videoUrls,
    ...metadata.metaUrls
  ];

  return preferred.find((url) => /^https?:/i.test(url) && (url.includes('.mp4') || url.includes('imagine-public.x.ai') || url.includes('/media/'))) || null;
}

function collectKnownMediaUrls(metadata) {
  return new Set([
    ...(metadata?.metaUrls || []),
    ...(metadata?.videoUrls || []),
    ...((metadata?.downloadLinks || []).map((link) => link.href))
  ].filter(Boolean));
}

async function waitForGeneration(page, timeoutMs, debug, initialMetadata) {
  const deadline = Date.now() + timeoutMs;
  let sawProgress = false;
  const knownUrls = collectKnownMediaUrls(initialMetadata);

  while (Date.now() < deadline) {
    await dismissInterruptions(page, debug);

    const error = await detectErrorState(page);
    if (error) {
      throw new Error(error);
    }

    const metadata = await extractVideoMetadata(page);
    const directUrl = chooseDirectVideoUrl({
      ...metadata,
      metaUrls: metadata.metaUrls.filter((url) => !knownUrls.has(url)),
      videoUrls: metadata.videoUrls.filter((url) => !knownUrls.has(url)),
      downloadLinks: metadata.downloadLinks.filter((link) => !knownUrls.has(link.href))
    });

    if (directUrl) {
      logDebug(debug, `Direct video URL detected: ${directUrl}`);
      return { directUrl, metadata };
    }

    for (const selector of VIDEO_SELECTOR_CANDIDATES) {
      const video = page.locator(selector).filter({ visible: true }).first();
      try {
        if (await video.isVisible({ timeout: 500 })) {
          const currentSrc = await video.evaluate((node) => node.currentSrc || node.src || '');
          if (currentSrc && !knownUrls.has(currentSrc)) {
            logDebug(debug, `Video element source detected: ${currentSrc}`);
            return { directUrl: currentSrc, metadata };
          }
        }
      } catch {
        // Ignore and continue polling.
      }
    }

    const progressButton = page.locator('button[aria-label="Video Options"]').first();
    try {
      if (await progressButton.isVisible({ timeout: 300 })) {
        sawProgress = true;
        const progressText = await progressButton.innerText().catch(() => '');
        logDebug(debug, `Generation progress visible: ${progressText || 'Video Options'}`);
      }
    } catch {
      // Ignore missing progress button.
    }

    if (metadata.currentUrl.includes('/imagine/post/')) {
      logDebug(debug, `On imagine post route: ${metadata.currentUrl}`);
    }

    await page.waitForTimeout(sawProgress ? 2500 : 1500);
  }

  throw new Error(`Timed out waiting for video generation after ${Math.round(timeoutMs / 1000)}s`);
}

async function downloadViaButton(page, outputPath, debug) {
  const buttonCandidates = [
    page.getByRole('button', { name: /download/i }).first(),
    page.getByRole('link', { name: /download/i }).first(),
    page.locator('a[download]').first(),
    page.locator('[data-testid*="download"]').first()
  ];

  for (const candidate of buttonCandidates) {
    try {
      if (await candidate.isVisible({ timeout: 750 })) {
        logDebug(debug, 'Trying in-page download flow');
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 10000 }),
          candidate.click({ force: true })
        ]);
        await download.saveAs(outputPath);
        return outputPath;
      }
    } catch {
      // Ignore and try next strategy.
    }
  }

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
    throw new Error(`Video download failed with status ${fetched.status}`);
  }

  fs.writeFileSync(outputPath, Buffer.from(fetched.bytes));
  return outputPath;
}

async function runPrompt(args) {
  const context = await launchPersistentChrome(args);
  await applyCookiesToContext(context, args);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(GROK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForEditorToHydrate(page, args.debug);
    await dismissInterruptions(page, args.debug);
    await assertLoggedIn(page);
    await ensureVideoMode(page, args.debug);
    await ensureVideoDuration(page, args.durationSeconds, args.debug);
    await attachReferenceImage(page, args.referenceImagePath, args.debug);

    const promptInput = await findVisiblePromptLocator(page);
    await fillPrompt(promptInput, args.prompt, args.debug);
    await page.waitForFunction(() => {
      const submit = document.querySelector('button[aria-label="Submit"]');
      return submit && !submit.disabled;
    }, { timeout: 15000 }).catch(() => {});
    const initialMetadata = await extractVideoMetadata(page);
    await submitPrompt(page, promptInput, args.debug);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = args.outputPath
      ? path.resolve(args.outputPath)
      : path.join(args.outDir, `${sanitizeFileName(args.prompt)}-${timestamp}.mp4`);
    ensureDir(path.dirname(outputPath));

    const result = await waitForGeneration(page, args.timeoutMs, args.debug, initialMetadata);
    const downloadPath = await downloadViaButton(page, outputPath, args.debug);
    if (downloadPath) {
      console.log(`Downloaded video to ${downloadPath}`);
      return;
    }

    await downloadFromUrl(context, page, result.directUrl, outputPath, args.debug);
    console.log(`Downloaded video to ${outputPath}`);
  } finally {
    await context.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);

    if (args.help || (!args.saveLogin && !args.prompt)) {
      printUsage();
      return;
    }

    if (args.saveLogin) {
      await saveLoginState(args);
      return;
    }

    await runPrompt(args);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
