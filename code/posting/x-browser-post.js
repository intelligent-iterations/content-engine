import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { II_ROOT } from '../core/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');
const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'x_cookies.json');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

function chromiumLaunchOptions(headless) {
  const executablePath = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  return {
    headless,
    slowMo: headless ? 0 : 40,
    executablePath,
    args: executablePath ? ['--no-sandbox'] : undefined,
  };
}

async function saveDebugScreenshot(page, label) {
  try {
    const debugDir = path.join(II_ROOT, 'debug');
    fs.mkdirSync(debugDir, { recursive: true });
    const filename = `x-${label}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(debugDir, filename), fullPage: false });
    console.log(`  [debug] Screenshot saved: ${path.join(debugDir, filename)}`);
    return filename;
  } catch {
    return null;
  }
}

async function loadCookies(context) {
  if (!fs.existsSync(COOKIE_FILE)) {
    return false;
  }

  const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    return false;
  }

  await context.addCookies(raw
    .filter((cookie) => cookie && cookie.name)
    .map((cookie) => ({
      name: String(cookie.name),
      value: String(cookie.value || ''),
      domain: cookie.domain || '.x.com',
      path: cookie.path || '/',
      expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
      httpOnly: Boolean(cookie.httpOnly ?? cookie.http_only),
      secure: Boolean(cookie.secure ?? true),
      sameSite: cookie.sameSite || cookie.same_site || 'Lax',
    })));

  return true;
}

async function ensureLoggedIn(page) {
  const href = page.url();
  const body = await page.locator('body').innerText().catch(() => '');
  const haystack = `${href} ${body}`.toLowerCase();

  if (href.includes('/i/flow/login')) {
    throw new Error('X browser session is not logged in');
  }

  if ((haystack.includes('sign in') && haystack.includes('create account'))
    || haystack.includes('join today')
    || haystack.includes('happening now')) {
    throw new Error('X browser session is not logged in');
  }
}

function normalizeXUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('/')) {
    return `https://x.com${value}`;
  }
  return value
    .replace('https://twitter.com/', 'https://x.com/')
    .replace('https://www.twitter.com/', 'https://x.com/')
    .replace('https://www.x.com/', 'https://x.com/');
}

function statusIdFromUrl(url) {
  return String(url || '').match(/\/status\/([^/?#]+)/)?.[1] || '';
}

function captionFingerprint(text, maxLength = 60) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function hasTransientComposerError(bodyText) {
  const normalized = String(bodyText || '').toLowerCase();
  return normalized.includes('something went wrong')
    || normalized.includes('let’s give it another shot')
    || normalized.includes("let's give it another shot");
}

async function extractUsername(page) {
  const href = await page.evaluate(() => {
    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    return profileLink ? (profileLink.getAttribute('href') || '') : '';
  }).catch(() => '');

  const match = String(href).match(/\/([A-Za-z0-9_]+)$/);
  if (match) {
    return match[1];
  }

  return String(process.env.X_USERNAME || '').trim().replace(/^@/, '') || 'videogens';
}

async function openCompose(page) {
  await page.goto('https://x.com/compose/post', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(4000);
  await ensureLoggedIn(page);
}

async function fillComposerText(page, text) {
  const editor = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"][contenteditable="true"]').first();
  await editor.waitFor({ timeout: 30000 });
  await editor.click();
  try {
    await editor.fill(text);
  } catch {
    await page.keyboard.type(text, { delay: 8 });
  }
}

async function attachMedia(page, mediaPaths) {
  if (!Array.isArray(mediaPaths) || mediaPaths.length === 0) {
    return;
  }

  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ timeout: 30000 });
  await input.setInputFiles(mediaPaths);
  await page.waitForFunction((expectedCount) => {
    const previews = document.querySelectorAll('img[src*="media"], video, [data-testid="attachments"] img');
    return previews.length >= expectedCount;
  }, mediaPaths.length, { timeout: 60000 }).catch(() => {});
  await waitForComposerToSettle(page);
}

async function waitForSubmitEnabled(page, timeoutMs = 180000) {
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
    if (!button) {
      return false;
    }

    const disabled = button.disabled || button.getAttribute('aria-disabled') === 'true';
    return !disabled;
  }, { timeout: timeoutMs });
}

async function waitForComposerToSettle(page, timeoutMs = 120000) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[aria-label="Drafts"]')?.closest('[role="dialog"]');
    const root = dialog || document.body;
    const bodyText = String(root?.innerText || '').toLowerCase();
    const hasBusyUi = Boolean(root?.querySelector('[role="progressbar"], [aria-busy="true"]'));
    const hasUploadText = /uploading|processing|finalizing/i.test(bodyText);
    return !hasBusyUi && !hasUploadText;
  }, { timeout: timeoutMs }).catch(() => {});

  await page.waitForTimeout(3000);
}

async function findPostedStatusUrl(page, username, expectedText) {
  const expected = captionFingerprint(expectedText, 40);
  if (!username) {
    return '';
  }

  const lookupPage = await page.context().newPage();

  try {
    await lookupPage.goto(`https://x.com/${username}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await lookupPage.waitForTimeout(5000);

    return await lookupPage.evaluate((needle) => {
      const articles = Array.from(document.querySelectorAll('article'));
      for (const article of articles) {
        const text = String(article.innerText || '').toLowerCase();
        if (!text.includes(needle)) {
          continue;
        }
        const link = article.querySelector('a[href*="/status/"]');
        if (link) {
          return link.href || link.getAttribute('href') || '';
        }
      }
      return '';
    }, expected).then(normalizeXUrl).catch(() => '');
  } finally {
    await lookupPage.close().catch(() => {});
  }
}

async function submitPost(page, expectedText, username) {
  let lastError = '';

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const submitButton = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
    await submitButton.waitFor({ timeout: 30000 });
    await submitButton.click();
    console.log(`  [debug] Submit attempt ${attempt}`);
    await page.waitForTimeout(10000);
    await saveDebugScreenshot(page, `05-after-submit-${attempt}`);

    const currentUrl = page.url();
    if (/\/status\//.test(currentUrl)) {
      return normalizeXUrl(currentUrl);
    }

    const body = await page.locator('body').innerText().catch(() => '');
    if (hasTransientComposerError(body)) {
      lastError = 'X composer returned a transient submit error';
      console.log(`  [debug] Submit error after attempt ${attempt}`);
      await page.waitForTimeout(12000);
      const delayedProfileStatusUrl = await findPostedStatusUrl(page, username, expectedText);
      if (delayedProfileStatusUrl) {
        return delayedProfileStatusUrl;
      }
      await waitForComposerToSettle(page, 30000);
      continue;
    }

    const profileStatusUrl = await findPostedStatusUrl(page, username, expectedText);
    if (profileStatusUrl) {
      return profileStatusUrl;
    }
  }

  throw new Error(lastError || 'X submit retried 3 times but no verified post URL was found');
}

export async function postToXViaBrowser({ text, mediaPaths = [], headless = true }) {
  if (!String(text || '').trim()) {
    throw new Error('Tweet text is required');
  }

  for (const mediaPath of mediaPaths) {
    if (!fs.existsSync(mediaPath)) {
      throw new Error(`Media file not found: ${mediaPath}`);
    }
  }

  const browser = await chromium.launch(chromiumLaunchOptions(headless));
  const context = await browser.newContext();

  try {
    const loadedCookies = await loadCookies(context);
    if (!loadedCookies) {
      throw new Error(`X cookies not found or empty at ${COOKIE_FILE}`);
    }

    const page = await context.newPage();
    await openCompose(page);
    await saveDebugScreenshot(page, '01-compose-page');

    await fillComposerText(page, text);
    await saveDebugScreenshot(page, '02-after-text');

    await attachMedia(page, mediaPaths);
    await saveDebugScreenshot(page, '03-after-media');

    await waitForSubmitEnabled(page);
    await saveDebugScreenshot(page, '04-submit-ready');

    const username = await extractUsername(page);
    const permalink = await submitPost(page, text, username);
    const tweetId = statusIdFromUrl(permalink);

    if (!permalink || !tweetId) {
      throw new Error('X post could not be verified after submit');
    }

    return {
      tweetId,
      tweetUrl: permalink,
      username,
      method: 'playwright_cookies',
      verified: true,
    };
  } finally {
    await browser.close();
  }
}

export { hasTransientComposerError };
export { findPostedStatusUrl };
