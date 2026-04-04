#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { applyCookiesFileToContext, applyStorageStateToContext } from '../shared/grok-browser-session.js';
import { ensureAuthenticatedGrokSession } from '../shared/grok-web-auth.js';
import { AUTH_DIR, COOKIES_DIR, TEMP_DIR } from '../core/paths.js';

const OUTPUT_DIR = path.join(TEMP_DIR, 'browser-submit-probe');
const STATE_PATH = path.join(AUTH_DIR, 'grok-storage-state.json');
const COOKIES_PATH = path.join(COOKIES_DIR, 'x_cookies.json');
const USER_DATA_DIR = path.join(AUTH_DIR, 'grok-chrome-profile-web-fallback');

function parseArgs(argv) {
  const args = {
    outputDir: OUTPUT_DIR,
    statePath: STATE_PATH,
    cookiesPath: COOKIES_PATH,
    userDataDir: USER_DATA_DIR,
    usePersistent: false,
    useEnterSubmit: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--persistent') {
      args.usePersistent = true;
    } else if (arg === '--enter-submit') {
      args.useEnterSubmit = true;
    } else if (arg === '--state') {
      args.statePath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--state=')) {
      args.statePath = path.resolve(arg.slice('--state='.length));
    } else if (arg === '--cookies') {
      args.cookiesPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--cookies=')) {
      args.cookiesPath = path.resolve(arg.slice('--cookies='.length));
    } else if (arg === '--out-dir') {
      args.outputDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--out-dir=')) {
      args.outputDir = path.resolve(arg.slice('--out-dir='.length));
    } else if (arg === '--user-data-dir') {
      args.userDataDir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg.startsWith('--user-data-dir=')) {
      args.userDataDir = path.resolve(arg.slice('--user-data-dir='.length));
    } else if (arg === '--no-state') {
      args.statePath = null;
    } else if (arg === '--no-cookies') {
      args.cookiesPath = null;
    }
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function stringifyError(error) {
  if (!error) return '';
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function screenshot(page, fileName) {
  const fullPath = path.join(currentRun.outputDir, fileName);
  await page.screenshot({ path: fullPath, fullPage: true });
  return fullPath;
}

let currentRun = {
  outputDir: OUTPUT_DIR
};

async function fillPrompt(editor, prompt) {
  await editor.click({ force: true });
  await editor.evaluate((el, value) => {
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
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  currentRun = { outputDir: args.outputDir };
  ensureDir(args.outputDir);

  const prompt = `codex browser submit probe fruit cafeteria ${Date.now()}`;
  const events = [];
  const startedAt = Date.now();
  const context = args.usePersistent
    ? await chromium.launchPersistentContext(args.userDataDir, {
      headless: true,
      channel: 'chrome',
      acceptDownloads: true,
      viewport: { width: 1440, height: 1080 }
    })
    : await (async () => {
      const browser = await chromium.launch({ headless: true, channel: 'chrome' });
      const ephemeralContext = await browser.newContext({
        acceptDownloads: true,
        viewport: { width: 1440, height: 1080 }
      });
      ephemeralContext.__browser = browser;
      return ephemeralContext;
    })();
  const page = context.pages()[0] || await context.newPage();

  const push = (kind, data = {}) => {
    events.push({
      t_ms: Date.now() - startedAt,
      kind,
      ...data
    });
  };

  await applyStorageStateToContext(context, args.statePath);
  await applyCookiesFileToContext(context, args.cookiesPath);

  page.on('request', (request) => {
    const url = request.url();
    if (/grok\.com|x\.ai|imagine-public/i.test(url)) {
      push('request', {
        method: request.method(),
        url
      });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!/grok\.com|x\.ai|imagine-public/i.test(url)) {
      return;
    }

    const contentType = response.headers()['content-type'] || '';
    let snippet = '';
    if (/json|text/i.test(contentType)) {
      try {
        snippet = (await response.text()).slice(0, 800).replace(/\s+/g, ' ');
      } catch (error) {
        snippet = `<<${stringifyError(error)}>>`;
      }
    }

    push('response', {
      status: response.status(),
      url,
      contentType,
      snippet
    });
  });

  const cdpSession = await context.newCDPSession(page);
  await cdpSession.send('Network.enable');
  cdpSession.on('Network.webSocketFrameReceived', ({ response }) => {
    const data = response?.payloadData || '';
    if (!data) {
      return;
    }
    if (/job_id|current_status|share-images|imagine-public|image_url|\"url\"|browser submit probe fruit cafeteria/i.test(data)) {
      push('ws', {
        data: data.slice(0, 1600).replace(/\s+/g, ' ')
      });
    }
  });

  try {
    await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await ensureAuthenticatedGrokSession(page, context, {
      statePath: args.statePath,
      debug: true
    });
    await page.waitForTimeout(3000);
    await screenshot(page, '01-loaded.png');

    const editor = page.locator('[contenteditable="true"].ProseMirror').first();
    await fillPrompt(editor, prompt);
    await page.waitForTimeout(1000);
    await screenshot(page, '02-filled.png');

    const submit = page.locator('button[aria-label="Submit"]').first();
    const submitState = await submit.evaluate((el) => ({
      disabled: Boolean(el.disabled),
      text: (el.textContent || '').trim(),
      ariaLabel: el.getAttribute('aria-label') || ''
    })).catch((error) => ({
      error: String(error)
    }));
    push('submit_before', submitState);

    if (args.useEnterSubmit) {
      await editor.press('Enter');
      push('submit_enter');
    } else {
      await submit.click({ force: true });
      push('submit_click');
    }

    await page.waitForTimeout(3000);
    await screenshot(page, '03-after-submit.png');

    await page.waitForTimeout(12000);
    await screenshot(page, '04-plus-15s.png');

    await page.waitForTimeout(15000);
    await screenshot(page, '05-plus-30s.png');

    const sections = await page.evaluate(() => (
      Array.from(document.querySelectorAll('[id^="imagine-masonry-section-"]')).map((node) => ({
        id: node.id,
        text: (node.textContent || '').slice(0, 1200)
      }))
    ));

    const images = await page.evaluate(() => (
      Array.from(document.querySelectorAll('img'))
        .map((img) => ({
          src: img.currentSrc || img.src || '',
          width: img.naturalWidth || img.width || 0,
          height: img.naturalHeight || img.height || 0,
          alt: img.alt || ''
        }))
        .filter((img) => img.src)
    ));

    const bodyText = await page.locator('body').innerText().catch(() => '');

    fs.writeFileSync(path.join(args.outputDir, 'events.json'), JSON.stringify(events, null, 2));
    fs.writeFileSync(path.join(args.outputDir, 'sections.json'), JSON.stringify(sections, null, 2));
    fs.writeFileSync(path.join(args.outputDir, 'images.json'), JSON.stringify(images, null, 2));
    fs.writeFileSync(path.join(args.outputDir, 'body.txt'), bodyText);
    fs.writeFileSync(path.join(args.outputDir, 'summary.json'), JSON.stringify({
      prompt,
      usePersistent: args.usePersistent,
      useEnterSubmit: args.useEnterSubmit,
      statePath: args.statePath,
      cookiesPath: args.cookiesPath,
      screenshotFiles: fs.readdirSync(args.outputDir).filter((file) => file.endsWith('.png')).sort(),
      eventCount: events.length,
      sectionCount: sections.length,
      imageCount: images.length
    }, null, 2));

    console.log(path.join(args.outputDir, 'summary.json'));
  } finally {
    await cdpSession.detach().catch(() => {});
    await context.close().catch(() => {});
    await context.__browser?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
