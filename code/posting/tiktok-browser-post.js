/**
 * TikTok Browser Poster — Playwright-based upload via Creator Studio
 *
 * Posts a video to TikTok using stored cookies and browser automation.
 * Follows the same pattern as instagram-browser-post.js.
 *
 * NOTE: TikTok carousels (photo posts) are NOT supported via browser upload.
 * The Creator Studio web UI does not expose a photo/carousel upload flow.
 * Carousel posting would require the TikTok API or mobile automation.
 *
 * Usage:
 *   import { postToTikTok } from './tiktok-browser-post.js';
 *   const result = await postToTikTok({ videoPath, caption, headless: true });
 *
 * CLI:
 *   node code/posting/tiktok-browser-post.js <video-path> [--headless] [--caption "text"]
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..', '..');
const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'tiktok_cookies.json');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

let resolvedUsername = (process.env.TIKTOK_ACCOUNT_NAME || '').replace(/^@/, '');
const CREATOR_UPLOAD_URL = 'https://www.tiktok.com/creator#/upload?scene=creator_center';
const STUDIO_CONTENT_URL = 'https://www.tiktok.com/tiktokstudio/content';

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function normalizeCookies(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .filter(c => c && c.name && String(c.domain || '').includes('tiktok.com'))
    .map(c => ({
      name: String(c.name),
      value: String(c.value || ''),
      domain: String(c.domain || '.tiktok.com'),
      path: c.path || '/',
      expires: typeof c.expires === 'number' ? c.expires : -1,
      httpOnly: Boolean(c.httpOnly ?? c.http_only ?? false),
      secure: c.secure === 1 || c.secure === true || c.secure === '1',
      sameSite: c.sameSite || c.same_site || 'Lax',
    }));
}

async function loadCookies(context) {
  if (!fs.existsSync(COOKIE_FILE)) return false;
  const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  const cookies = normalizeCookies(raw);
  if (cookies.length === 0) return false;
  await context.addCookies(cookies);
  return true;
}

async function saveCookies(context) {
  const cookies = await context.cookies();
  const filtered = cookies
    .filter(c => String(c.domain || '').includes('tiktok.com'))
    .map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
  fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(filtered, null, 2));
  return filtered;
}

// ---------------------------------------------------------------------------
// Debug helpers
// ---------------------------------------------------------------------------

async function saveDebugScreenshot(page, label) {
  try {
    const debugDir = path.join(REPO_ROOT, 'output', 'debug');
    fs.mkdirSync(debugDir, { recursive: true });
    const filename = `tiktok-${label}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(debugDir, filename), fullPage: false });
    console.log(`  [debug] Screenshot saved: output/debug/${filename}`);
    return filename;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Permalink extraction — click latest video on profile, verify caption match
// ---------------------------------------------------------------------------

function captionFingerprint(caption) {
  return String(caption || '')
    .toLowerCase()
    .replace(/[#@]\S+/g, '')   // strip hashtags/mentions
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

async function extractPermalink(page, caption, maxRetries = 3) {
  const fingerprint = captionFingerprint(caption);
  console.log(`  [tiktok] Looking for post matching: "${fingerprint.slice(0, 60)}..."`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Use TikTok Studio content page — renders reliably (no CAPTCHA)
      console.log(`  [tiktok] Navigating to TikTok Studio content (attempt ${attempt})...`);
      await page.goto(STUDIO_CONTENT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(6000);
      await saveDebugScreenshot(page, `06a-studio-content-${attempt}`);

      // Extract video URLs (with real username) from the content table HTML
      const posts = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const results = [];
        const seen = new Set();

        // Extract @username/video/ID patterns — gets real username from links
        const re = /@([a-zA-Z0-9_.]+)\/video\/(\d+)/g;
        let m;
        while ((m = re.exec(html)) !== null) {
          if (!seen.has(m[2])) {
            seen.add(m[2]);
            results.push({
              id: m[2],
              username: m[1],
              url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`,
            });
          }
        }

        return results.slice(0, 10);
      });

      console.log(`  [tiktok] Found ${posts.length} posts in Studio`);

      if (posts.length === 0) {
        console.log('  [tiktok] No posts found in Studio content page');
        if (attempt < maxRetries) {
          await page.waitForTimeout(10000);
          continue;
        }
        return null;
      }

      // The first post is the most recent — also capture the real username
      const latestPost = posts[0];
      if (latestPost.username) {
        resolvedUsername = latestPost.username;
        console.log(`  [tiktok] Resolved username from Studio: @${resolvedUsername}`);
      }
      console.log(`  [tiktok] Latest video: ${latestPost.url}`);
      if (latestPost.caption) {
        console.log(`  [tiktok] Studio caption: "${latestPost.caption.slice(0, 80)}"`);
      }

      // If no caption to verify, return the latest post
      if (!fingerprint) {
        console.log('  [tiktok] No caption to verify — returning latest post');
        return latestPost.url;
      }

      // Navigate to the latest video page to verify caption via meta tags
      console.log(`  [tiktok] Verifying caption on video page...`);
      await page.goto(latestPost.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      await saveDebugScreenshot(page, `06b-video-verify-${attempt}`);

      const pageCaption = await page.evaluate(() => {
        const meta = document.querySelector('meta[property="og:description"], meta[name="description"]');
        if (meta) return meta.getAttribute('content') || '';
        return (document.body?.innerText || '').slice(0, 500);
      }).catch(() => '');

      const pageFp = captionFingerprint(pageCaption);
      // Both sides must be non-empty for a valid match
      if (fingerprint.length >= 10 && pageFp.length >= 10 &&
          (pageFp.includes(fingerprint.slice(0, 40)) || fingerprint.includes(pageFp.slice(0, 40)))) {
        console.log(`  [tiktok] Caption match confirmed: ${latestPost.url}`);
        return latestPost.url;
      }

      console.log(`  [tiktok] Caption mismatch: "${pageFp.slice(0, 60)}"`);
      if (attempt < maxRetries) {
        console.log('  [tiktok] Video may not have propagated yet, retrying in 15s...');
        await page.waitForTimeout(15000);
      }
    } catch (e) {
      console.log(`  [tiktok] Permalink extraction error (attempt ${attempt}): ${e.message}`);
      if (attempt < maxRetries) {
        await page.waitForTimeout(10000);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Login verification
// ---------------------------------------------------------------------------

async function ensureTikTokLoggedIn(page) {
  const url = page.url();

  // Check for login redirect
  if (url.includes('/login') || url.includes('login_redirect')) {
    throw new Error('TikTok session is not logged in — redirected to login page');
  }

  // Check for presence of upload UI or creator center elements
  const hasUploadUI = await page.evaluate(() => {
    const body = (document.body?.innerText || '').toLowerCase();
    return body.includes('upload') || body.includes('post') || body.includes('creator');
  }).catch(() => false);

  if (!hasUploadUI) {
    // Could be a loading issue, give it a second check
    await page.waitForTimeout(3000);
    const url2 = page.url();
    if (url2.includes('/login')) {
      throw new Error('TikTok session is not logged in — redirected to login page');
    }
  }
}

// ---------------------------------------------------------------------------
// Main posting function
// ---------------------------------------------------------------------------

export async function postToTikTok({ videoPath, caption = '', headless = true }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const fileSizeMB = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(1);
  console.log(`  [tiktok] Video: ${videoPath} (${fileSizeMB} MB)`);
  console.log(`  [tiktok] Caption: ${caption.slice(0, 80)}${caption.length > 80 ? '...' : ''}`);

  let browser;
  let context;
  let page;

  try {
    // -----------------------------------------------------------------------
    // 1. Launch browser with anti-bot stealth
    // -----------------------------------------------------------------------
    browser = await chromium.launch({
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
      slowMo: headless ? 0 : 40,
    });

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });

    // Remove navigator.webdriver
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // -----------------------------------------------------------------------
    // 2. Load cookies
    // -----------------------------------------------------------------------
    const hadCookies = await loadCookies(context);
    if (!hadCookies) {
      throw new Error(`No valid TikTok cookies found at ${COOKIE_FILE}`);
    }
    console.log('  [tiktok] Cookies loaded');

    page = await context.newPage();

    // -----------------------------------------------------------------------
    // 3. Navigate to Creator Studio upload page
    // -----------------------------------------------------------------------
    await page.goto(CREATOR_UPLOAD_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(5000);
    await saveDebugScreenshot(page, '01-initial-load');

    // -----------------------------------------------------------------------
    // 4. Verify logged-in state
    // -----------------------------------------------------------------------
    await ensureTikTokLoggedIn(page);
    console.log('  [tiktok] Logged in, on Creator Studio');
    console.log('  [tiktok] URL:', page.url());

    // (No pre-snapshot needed — permalink extraction clicks the latest video)

    // -----------------------------------------------------------------------
    // 6. Upload video via file chooser
    // -----------------------------------------------------------------------
    console.log('  [tiktok] Uploading video...');

    // Strategy 1: Try to find a file input directly
    let uploaded = false;
    const fileInput = page.locator('input[type="file"]').first();
    const fileInputAttached = await fileInput.waitFor({ state: 'attached', timeout: 10000 }).then(() => true).catch(() => false);

    if (fileInputAttached) {
      await fileInput.setInputFiles(videoPath);
      uploaded = true;
      console.log('  [tiktok] Video set via file input');
    }

    // Strategy 2: Click upload area and use filechooser event
    if (!uploaded) {
      console.log('  [tiktok] No file input found, trying filechooser event...');
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        (async () => {
          // Try clicking various upload trigger elements
          for (const selector of [
            'button:has-text("Select file")',
            'button:has-text("select file")',
            'button:has-text("Select video")',
            'button:has-text("Upload")',
            '[class*="upload"] button',
            '[class*="upload-btn"]',
            '[data-testid="upload"]',
            '.upload-card',
          ]) {
            const el = page.locator(selector).first();
            if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
              console.log(`  [tiktok] Clicking upload trigger: ${selector}`);
              await el.click();
              return;
            }
          }
          // Last resort: click the center of the upload area
          const uploadArea = page.locator('[class*="upload"]').first();
          if (await uploadArea.isVisible({ timeout: 3000 }).catch(() => false)) {
            await uploadArea.click();
          }
        })(),
      ]);
      await fileChooser.setFiles(videoPath);
      uploaded = true;
      console.log('  [tiktok] Video set via filechooser');
    }

    await saveDebugScreenshot(page, '02-after-upload');

    // -----------------------------------------------------------------------
    // 7. Wait for video processing (up to 120s)
    // -----------------------------------------------------------------------
    console.log('  [tiktok] Waiting for video processing...');
    const processStart = Date.now();
    const processTimeout = 120000;

    while (Date.now() - processStart < processTimeout) {
      await page.waitForTimeout(5000);

      const state = await page.evaluate(() => {
        const body = (document.body?.innerText || '').toLowerCase();
        return {
          hasProgress: body.includes('uploading') || body.includes('processing') || body.includes('%'),
          isReady: body.includes('post') && !body.includes('uploading') && !body.includes('processing'),
          hasError: body.includes('failed') || body.includes('error') || body.includes('try again'),
          hasCaptionArea: !!document.querySelector('[contenteditable="true"], [data-text="true"], .DraftEditor-root, .public-DraftEditor-content, textarea'),
        };
      }).catch(() => ({}));

      if (state.hasError) {
        await saveDebugScreenshot(page, '02b-processing-error');
        throw new Error('TikTok video processing failed');
      }

      if (state.hasCaptionArea && state.isReady) {
        console.log('  [tiktok] Video processing complete');
        break;
      }

      const elapsed = Math.round((Date.now() - processStart) / 1000);
      if (elapsed % 15 === 0) {
        console.log(`  [tiktok] Still processing... (${elapsed}s)`);
      }
    }

    await saveDebugScreenshot(page, '03-video-processed');

    // -----------------------------------------------------------------------
    // 7b. Dismiss any modal overlays that appeared after upload
    //     (e.g. "Turn on automatic content checks?", "Got it" tooltips)
    // -----------------------------------------------------------------------
    for (let dismissRound = 0; dismissRound < 3; dismissRound++) {
      let dismissed = false;
      for (const label of ['Turn on', 'Cancel', 'Got it', 'OK', 'Not now', 'Not Now', 'Skip', 'Close', 'Dismiss']) {
        for (const getBtn of [
          () => page.getByRole('button', { name: label }).first(),
          () => page.locator(`button:has-text("${label}")`).first(),
          () => page.locator(`div[role="button"]:has-text("${label}")`).first(),
        ]) {
          try {
            const btn = getBtn();
            if (await btn.isVisible({ timeout: 1500 })) {
              await btn.click({ force: true });
              console.log(`  [tiktok] Dismissed overlay: "${label}"`);
              dismissed = true;
              await page.waitForTimeout(1500);
              break;
            }
          } catch { /* try next */ }
        }
        if (dismissed) break;
      }

      // Also try clicking the X/close button on any TUXModal
      if (!dismissed) {
        try {
          const closeBtn = page.locator('.TUXModal-overlay button[aria-label="Close"], .TUXModal-overlay svg[data-icon="close"]').first();
          if (await closeBtn.isVisible({ timeout: 1000 })) {
            await closeBtn.click({ force: true });
            console.log('  [tiktok] Dismissed overlay via close button');
            dismissed = true;
            await page.waitForTimeout(1500);
          }
        } catch { /* ignore */ }
      }

      if (!dismissed) break; // No more overlays to dismiss
    }

    await saveDebugScreenshot(page, '03b-after-dismiss');

    // -----------------------------------------------------------------------
    // 8. Fill in the caption (DraftJS contenteditable)
    // -----------------------------------------------------------------------
    if (caption) {
      console.log('  [tiktok] Filling caption...');

      // TikTok uses DraftJS which doesn't work with Playwright's fill().
      // We need to click the editor, select all existing text, then type.
      const captionSelectors = [
        '.public-DraftEditor-content[contenteditable="true"]',
        '.DraftEditor-root [contenteditable="true"]',
        '[data-contents="true"]',
        'div[contenteditable="true"][data-text="true"]',
        'div[contenteditable="true"]',
        '[class*="caption"] [contenteditable="true"]',
        '[class*="description"] [contenteditable="true"]',
      ];

      let captionFilled = false;
      for (const selector of captionSelectors) {
        const editor = page.locator(selector).first();
        if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
          await editor.click();
          await page.waitForTimeout(500);

          // Select all existing content and delete it
          const isMac = process.platform === 'darwin';
          await page.keyboard.press(isMac ? 'Meta+a' : 'Control+a');
          await page.waitForTimeout(200);
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(300);

          // Type caption character by character (DraftJS needs this)
          // Limit to TikTok's character limit (~2200 for descriptions)
          const trimmedCaption = caption.slice(0, 2200);
          await page.keyboard.type(trimmedCaption, { delay: 10 });
          captionFilled = true;
          console.log(`  [tiktok] Caption typed (${trimmedCaption.length} chars)`);
          break;
        }
      }

      if (!captionFilled) {
        // Fallback: try a regular textarea
        const textarea = page.locator('textarea').first();
        if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
          await textarea.fill(caption.slice(0, 2200));
          captionFilled = true;
          console.log('  [tiktok] Caption filled via textarea');
        }
      }

      if (!captionFilled) {
        console.warn('  [tiktok] WARNING: Could not find caption input');
        await saveDebugScreenshot(page, '03b-no-caption-input');
      }
    }

    await page.waitForTimeout(1000);
    await saveDebugScreenshot(page, '04-before-post');

    // -----------------------------------------------------------------------
    // 9. Click the Post button (Playwright native click only — TikTok
    //    ignores synthetic JS dispatchEvent)
    // -----------------------------------------------------------------------
    console.log('  [tiktok] Clicking Post button...');

    // Exact approach from the first successful run: getByRole .first() + plain .click()
    // Playwright auto-scrolls. No force, no manual scroll.
    const postBtn = page.getByRole('button', { name: /^post$/i }).first();
    const postVisible = await postBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!postVisible) {
      await saveDebugScreenshot(page, '04b-post-button-not-found');
      throw new Error('Could not find the Post button');
    }
    const isDisabled = await postBtn.isDisabled().catch(() => false);
    if (isDisabled) {
      console.log('  [tiktok] Post button disabled, waiting 5s...');
      await page.waitForTimeout(5000);
    }
    await postBtn.click();
    console.log('  [tiktok] Post button clicked');

    await page.waitForTimeout(3000);
    await saveDebugScreenshot(page, '04c-after-post-click');

    // -----------------------------------------------------------------------
    // 10. Handle "Continue to post?" / "Post now" dialog if it appears
    // -----------------------------------------------------------------------
    for (const label of ['Post now', 'Continue', 'Confirm']) {
      try {
        const dialogBtn = page.locator(
          `.TUXModal-overlay button:has-text("${label}"), [role="dialog"] button:has-text("${label}")`
        ).first();
        if (await dialogBtn.isVisible({ timeout: 3000 })) {
          await dialogBtn.click({ force: true });
          console.log(`  [tiktok] Clicked "${label}" in confirmation dialog`);
          await page.waitForTimeout(3000);
          break;
        }
      } catch { /* try next */ }
    }

    await saveDebugScreenshot(page, '05-after-post');

    // -----------------------------------------------------------------------
    // 11. Wait ~30s, then go to profile and click the latest video to get
    //     the permalink. Verify the caption matches.
    // -----------------------------------------------------------------------
    console.log('  [tiktok] Waiting 30s for video to propagate...');
    await page.waitForTimeout(30000);

    const permalink = await extractPermalink(page, caption);
    if (!permalink) {
      console.warn('  [tiktok] WARNING: Could not resolve video permalink');
    }

    await saveDebugScreenshot(page, '06-permalink');

    // -----------------------------------------------------------------------
    // 12. Save updated cookies
    // -----------------------------------------------------------------------
    await saveCookies(context);
    console.log('  [tiktok] Cookies saved');

    return {
      postUrl: permalink || (resolvedUsername ? `https://www.tiktok.com/@${resolvedUsername}` : 'https://www.tiktok.com'),
      verified: !!permalink && permalink.includes('/video/'),
      username: resolvedUsername || '',
      mediaType: 'video',
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

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const videoPath = args.find(a => !a.startsWith('--'));
  const headless = args.includes('--headless');
  const captionFlag = args.indexOf('--caption');
  const caption = captionFlag !== -1 ? args[captionFlag + 1] || '' : '';

  if (!videoPath) {
    console.error('Usage: node tiktok-browser-post.js <video-path> [--headless] [--caption "text"]');
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(videoPath) ? videoPath : path.resolve(videoPath);

  postToTikTok({ videoPath: resolvedPath, caption, headless })
    .then(result => {
      console.log('\nResult:');
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(err => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
}
