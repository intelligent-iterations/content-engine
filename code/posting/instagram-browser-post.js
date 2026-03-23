import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  authenticateInstagram,
  dismissInstagramPrompts,
  ensureInstagramLoggedIn,
  saveCookies,
} from './instagram-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');
const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'instagram_cookies.json');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

async function loadCookies(context) {
  if (!fs.existsSync(COOKIE_FILE)) return false;
  const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  if (!Array.isArray(raw) || raw.length === 0) return false;
  await context.addCookies(raw.map(cookie => ({
    name: String(cookie.name),
    value: String(cookie.value || ''),
    domain: cookie.domain || '.instagram.com',
    path: cookie.path || '/',
    expires: typeof cookie.expires === 'number' ? cookie.expires : -1,
    httpOnly: Boolean(cookie.httpOnly ?? cookie.http_only),
    secure: Boolean(cookie.secure ?? true),
    sameSite: cookie.sameSite || cookie.same_site || 'Lax',
  })));
  return true;
}

function normalizeInstagramUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('/')) return `https://www.instagram.com${value}`;
  return value;
}

function captionFingerprint(caption) {
  return String(caption || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function descriptionMatchesCaption(description, caption) {
  const fingerprint = captionFingerprint(caption);
  if (!fingerprint) return false;
  return String(description || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .includes(fingerprint);
}

async function collectRecentProfileLinks(page, username) {
  const cleanUsername = String(username || '').replace(/^@/, '');
  await page.goto(`https://www.instagram.com/${cleanUsername}/`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(1000);
  }
  const hrefs = await page.evaluate(() => Array.from(new Set(
    Array.from(document.querySelectorAll('a'))
      .map(a => a.getAttribute('href') || '')
      .filter(href => href.startsWith('/p/') || href.startsWith('/reel/') || href.includes('/p/') || href.includes('/reel/')),
  ))).catch(() => []);
  return hrefs
    .map(normalizeInstagramUrl)
    .filter(Boolean)
    .slice(0, 18);
}

async function extractPermalink(page, username, caption) {
  const currentUrl = page.url();
  if (currentUrl.includes('/p/') || currentUrl.includes('/reel/')) {
    const description = await page.evaluate(() => (
      document.querySelector('meta[property="og:description"]')?.getAttribute('content')
      || document.querySelector('meta[name="description"]')?.getAttribute('content')
      || ''
    )).catch(() => '');
    if (descriptionMatchesCaption(description, caption)) {
      return currentUrl;
    }
  }

  const recentLinks = await collectRecentProfileLinks(page, username);
  for (const url of recentLinks) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const description = await page.evaluate(() => (
      document.querySelector('meta[property="og:description"]')?.getAttribute('content')
      || document.querySelector('meta[name="description"]')?.getAttribute('content')
      || ''
    )).catch(() => '');
    if (descriptionMatchesCaption(description, caption)) {
      return url;
    }
  }

  throw new Error('Instagram post completed but a verified permalink could not be recovered from the profile');
}

export async function postToInstagramViaBrowser({ caption = '', mediaType = 'image', mediaPaths = [], headless = true }) {
  const username = String(process.env.INSTAGRAM_USERNAME || 'contentgen').replace(/^@/, '');
  let browser;
  let context;
  let page;
  try {
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : 40,
    });
    context = await browser.newContext();
    const hadCookies = await loadCookies(context);
    page = await context.newPage();
    await page.goto('https://www.instagram.com/create/select/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    try {
      await ensureInstagramLoggedIn(page);
    } catch {
      await browser.close();
      const auth = await authenticateInstagram({ headless: false, manualFallback: true });
      browser = await chromium.launch({ headless, slowMo: headless ? 0 : 40 });
      context = await browser.newContext();
      await loadCookies(context);
      page = await context.newPage();
      await page.goto('https://www.instagram.com/create/select/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      await ensureInstagramLoggedIn(page);
      if (!auth.cookieFile) {
        throw new Error('Instagram authentication did not produce a cookie file');
      }
    }

    const input = page.locator('input[type="file"]').first();
    await input.waitFor({ state: 'attached', timeout: 15000 });
    await input.setInputFiles(mediaPaths);
    await page.waitForTimeout(mediaType === 'reel' || mediaType === 'video' ? 10000 : 6000);

    for (let i = 0; i < 2; i += 1) {
      const nextButton = page.getByRole('button', { name: 'Next' }).first();
      if (await nextButton.isVisible().catch(() => false)) {
        await nextButton.click();
        await page.waitForTimeout(3000);
      }
    }

    const captionBox = page.locator('textarea[aria-label*="caption"], textarea[placeholder*="caption"], div[aria-label*="Write a caption"][contenteditable="true"], div[contenteditable="true"]').first();
    await captionBox.waitFor({ state: 'visible', timeout: 15000 });
    await captionBox.click();
    await captionBox.fill(String(caption || '').slice(0, 2200));
    await page.waitForTimeout(1000);

    const shareButton = page.getByRole('button', { name: /share|post/i }).first();
    await shareButton.click();
    await page.waitForTimeout(12000);
    await dismissInstagramPrompts(page);
    await saveCookies(context);

    const permalink = await extractPermalink(page, username, caption);
    return {
      postUrl: permalink,
      username,
      mediaType: mediaType === 'video' ? 'reel' : mediaType,
      method: hadCookies ? 'browser_cookies' : 'browser_login',
      cookieFile: COOKIE_FILE,
    };
  } finally {
    try {
      await browser?.close();
    } catch {
      // ignore cleanup errors
    }
  }
}
