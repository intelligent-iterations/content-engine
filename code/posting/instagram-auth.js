import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { COOKIES_DIR, ROOT_DIR } from '../core/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIE_FILE = path.join(COOKIES_DIR, 'instagram_cookies.json');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function chromiumLaunchOptions(headless) {
  const executablePath = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  return {
    headless,
    slowMo: headless ? 0 : 60,
    executablePath,
    args: executablePath ? ['--no-sandbox'] : undefined,
  };
}

function getInstagramUsername() {
  return (process.env.INSTAGRAM_USERNAME || '').trim().replace(/^@/, '');
}

function getInstagramPassword() {
  return String(process.env.INSTAGRAM_PASSWORD || '');
}

function profileUrl() {
  return `https://www.instagram.com/${getInstagramUsername()}/`;
}

async function loadCookies(context) {
  if (!fs.existsSync(COOKIE_FILE)) return false;
  const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const cookies = raw
    .filter(item => item && item.name)
    .map(item => ({
      name: String(item.name),
      value: String(item.value || ''),
      domain: item.domain || '.instagram.com',
      path: item.path || '/',
      expires: typeof item.expires === 'number' ? item.expires : -1,
      httpOnly: Boolean(item.httpOnly ?? item.http_only),
      secure: Boolean(item.secure ?? true),
      sameSite: item.sameSite || item.same_site || 'Lax',
    }));
  if (cookies.length === 0) return false;
  await context.addCookies(cookies);
  return true;
}

export async function saveCookies(context) {
  const cookies = await context.cookies();
  const filtered = cookies
    .filter(cookie => String(cookie.domain || '').includes('instagram.com'))
    .map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(filtered, null, 2));
  return filtered;
}

export async function dismissInstagramPrompts(page) {
  const labels = ['Not now', 'Not Now', 'Cancel', 'Close', 'Skip', 'OK', 'Ok'];
  for (const label of labels) {
    const locator = page.getByRole('button', { name: label }).first();
    try {
      if (await locator.isVisible({ timeout: 1000 })) {
        await locator.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // ignore
    }
  }
}

export async function ensureInstagramLoggedIn(page) {
  const href = page.url();
  const body = await page.locator('body').innerText().catch(() => '');
  const haystack = `${href} ${body}`.toLowerCase();
  if (href.includes('/accounts/onetap/')) {
    return;
  }
  if (href.includes('/accounts/login') || (haystack.includes('log in') && haystack.includes('sign up'))) {
    throw new Error('Instagram browser session is not logged in');
  }
  // Detect the "Continue as [user]" re-login screen (session expired but account remembered)
  if (haystack.includes('use another profile') || haystack.includes('create new account')) {
    throw new Error('Instagram session expired — Continue/re-login page detected');
  }
  // Detect redirect away from creation flow to homepage (not logged in)
  // Only flag as not-logged-in if there are no signs of an active session
  if (href === 'https://www.instagram.com/' && !haystack.includes('create') && !haystack.includes('switch') && !haystack.includes('suggested for you') && !haystack.includes('messages')) {
    throw new Error('Instagram redirected to homepage — not logged in');
  }
}

async function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(promptText, () => {
    rl.close();
    resolve();
  }));
}

export async function launchInstagramBrowser({ headless = true } = {}) {
  return chromium.launch(chromiumLaunchOptions(headless));
}

export async function authenticateInstagram({ headless = false, manualFallback = true } = {}) {
  const browser = await launchInstagramBrowser({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const username = getInstagramUsername();
  const password = getInstagramPassword();

  try {
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    if (username && password) {
      await page.locator('input[name="email"], input[name="username"]').first().fill(username);
      await page.locator('input[name="pass"], input[name="password"]').first().fill(password);
      const submit = page.getByRole('button', { name: /log in/i }).first();
      if (await submit.count()) {
        await submit.click();
      } else {
        await page.locator('input[type="submit"]').click({ force: true });
      }
      await page.waitForTimeout(8000);
    } else if (manualFallback) {
      console.log('Instagram credentials missing. Complete login in the opened browser, then press Enter.');
      await waitForEnter('');
    } else {
      throw new Error('INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD are required');
    }

    if (manualFallback && page.url().includes('/accounts/login')) {
      console.log('Instagram may need manual verification. Complete it in the opened browser, then press Enter.');
      await waitForEnter('');
    }

    await dismissInstagramPrompts(page);
    await ensureInstagramLoggedIn(page);
    const cookies = await saveCookies(context);
    return { cookieFile: COOKIE_FILE, cookieCount: cookies.length, username };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === __filename) {
  const headless = process.argv.includes('--headless');
  authenticateInstagram({ headless, manualFallback: !headless })
    .then(result => {
      console.log(JSON.stringify({ ok: true, ...result }));
    })
    .catch(error => {
      console.log(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    });
}
