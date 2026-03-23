#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import {
  applyCookiesFileToContext,
  applyStorageStateToContext,
  isChromeProfileLockError,
  makeTempChromeProfileDir
} from '../shared/grok-browser-session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STATE_PATH = path.join(PROJECT_ROOT, 'auth', 'grok-storage-state.json');
const DEFAULT_USER_DATA_DIR = path.join(PROJECT_ROOT, 'auth', 'grok-chrome-profile-web-fallback');
const DEFAULT_TIMEOUT_MS = 6 * 60 * 1000;
const GROK_URL = 'https://grok.com/';
const DEFAULT_COOKIE_PATH_CANDIDATES = [
  path.join(PROJECT_ROOT, 'cookies', 'x_cookies.json')
];

const PROMPT_SELECTOR_CANDIDATES = [
  '[contenteditable="true"].ProseMirror',
  'textarea[placeholder*="ask" i]',
  'textarea[placeholder*="message" i]',
  'textarea[aria-label*="message" i]',
  'textarea[name*="prompt" i]',
  'div[role="textbox"][contenteditable="true"]',
  '[contenteditable="true"]',
  'textarea'
];

const SEND_BUTTON_SELECTOR_CANDIDATES = [
  'button[aria-label="Send message"]',
  'button[aria-label="Send"]',
  'button[type="submit"]'
];

function printUsage() {
  console.log(`
Usage:
  node code/video/grok-text-automation.js --prompt "your prompt here"

Options:
  --prompt <text>            Prompt to submit to Grok chat
  --state <path>             Playwright storage state path
  --cookies <path>           Import cookies JSON before running
  --user-data-dir <path>     Persistent Chrome profile directory
  --timeout-ms <number>      Max wait time for Grok response
  --headed                   Run with visible browser
  --debug                    Extra logging
  --help                     Show this help
`.trim());
}

function parseArgs(argv) {
  const args = {
    statePath: DEFAULT_STATE_PATH,
    userDataDir: DEFAULT_USER_DATA_DIR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headed: false,
    debug: false,
    cookiesPath: null,
    prompt: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help') {
      args.help = true;
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
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function logDebug(enabled, message) {
  if (enabled) {
    console.error(`[debug] ${message}`);
  }
}

function resolveCookiePath(providedPath) {
  if (providedPath) {
    return providedPath;
  }

  return DEFAULT_COOKIE_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

async function applyCookiesToContext(context, args) {
  await applyStorageStateToContext(context, args.statePath);
  await applyCookiesFileToContext(context, resolveCookiePath(args.cookiesPath));
}

async function launchPersistentChrome(args) {
  ensureDir(args.userDataDir);
  const launchOptions = {
    headless: !args.headed,
    channel: 'chrome',
    viewport: { width: 1440, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  };

  try {
    return await chromium.launchPersistentContext(args.userDataDir, launchOptions);
  } catch (error) {
    if (!isChromeProfileLockError(error)) {
      throw error;
    }

    const fallbackDir = makeTempChromeProfileDir('grok-text-');
    console.error(`Profile locked at ${args.userDataDir}. Retrying with temp profile ${fallbackDir}`);
    return chromium.launchPersistentContext(fallbackDir, launchOptions);
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

async function assertLoggedIn(page) {
  const href = page.url();
  if (/\/i\/flow\/login|\/login\b/i.test(href)) {
    throw new Error('Not logged in to Grok. Save a storage state first with `npm run grok:export-session` or provide valid cookies.');
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const lowered = bodyText.toLowerCase();
  const hasLoginWall = lowered.includes('sign in to grok') || lowered.includes('log in to grok') || lowered.includes('continue with google');

  if (hasLoginWall) {
    throw new Error('Not logged in to Grok. Save a storage state first with `npm run grok:export-session` or provide valid cookies.');
  }
}

async function findVisiblePromptLocator(page) {
  for (const selector of PROMPT_SELECTOR_CANDIDATES) {
    const locator = page.locator(selector).filter({ visible: true }).first();
    try {
      await locator.waitFor({ state: 'visible', timeout: 1500 });
      return locator;
    } catch {
      // Try next selector.
    }
  }

  throw new Error('Could not find the Grok chat prompt input');
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
      document.execCommand('delete');
      document.execCommand('insertText', false, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, prompt);
    logDebug(debug, 'Filled contenteditable prompt');
    return;
  }

  throw new Error('Unsupported prompt input type');
}

async function submitPrompt(page, locator, debug) {
  for (const selector of SEND_BUTTON_SELECTOR_CANDIDATES) {
    const button = page.locator(selector).filter({ visible: true }).first();
    try {
      if (await button.isVisible({ timeout: 600 })) {
        await button.click({ force: true });
        logDebug(debug, `Submitted prompt via ${selector}`);
        return;
      }
    } catch {
      // Ignore and try next button.
    }
  }

  await locator.press('Enter');
  logDebug(debug, 'Submitted prompt via Enter');
}

function wrapPromptForExtraction(prompt) {
  const token = `__CODEX_RESPONSE_${crypto.randomUUID().replace(/-/g, '_').toUpperCase()}__`;
  const wrappedPrompt = [
    'Return ONLY the final answer between the two markers below.',
    'Do not echo the instructions.',
    'Do not add any text before the first marker or after the second marker.',
    '',
    `${token}_START`,
    `${token}_END`,
    '',
    prompt,
  ].join('\n');

  return {
    token,
    wrappedPrompt,
  };
}

function extractResponse(bodyText, token) {
  const startMarker = `${token}_START`;
  const endMarker = `${token}_END`;
  const lastStart = bodyText.lastIndexOf(startMarker);

  if (lastStart === -1) {
    return null;
  }

  const startIndex = lastStart + startMarker.length;
  const lastEnd = bodyText.indexOf(endMarker, startIndex);
  if (lastEnd === -1) {
    return null;
  }

  const content = bodyText.slice(startIndex, lastEnd).trim();
  return content || null;
}

async function waitForResponse(page, token, timeoutMs, debug) {
  const startedAt = Date.now();
  let stableCount = 0;
  let lastExtracted = null;

  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const extracted = extractResponse(bodyText, token);

    if (extracted) {
      if (extracted === lastExtracted) {
        stableCount += 1;
      } else {
        stableCount = 1;
        lastExtracted = extracted;
      }

      if (stableCount >= 3) {
        logDebug(debug, 'Response markers found and stabilized');
        return extracted;
      }
    }

    await page.waitForTimeout(1500);
  }

  throw new Error('Timed out waiting for Grok text response');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.prompt) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const { token, wrappedPrompt } = wrapPromptForExtraction(args.prompt);
  const context = await launchPersistentChrome(args);
  await applyCookiesToContext(context, args);
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto(GROK_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissInterruptions(page, args.debug);
    await assertLoggedIn(page);

    const promptLocator = await findVisiblePromptLocator(page);
    await fillPrompt(promptLocator, wrappedPrompt, args.debug);
    await submitPrompt(page, promptLocator, args.debug);

    const response = await waitForResponse(page, token, args.timeoutMs, args.debug);
    process.stdout.write(response);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
