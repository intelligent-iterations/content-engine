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
import { COOKIES_DIR, II_ROOT, ROOT_DIR } from '../core/paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COOKIE_FILE = path.join(COOKIES_DIR, 'instagram_cookies.json');

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function chromiumLaunchOptions(headless) {
  const executablePath = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  return {
    headless,
    slowMo: headless ? 0 : 40,
    executablePath,
    args: executablePath ? ['--no-sandbox'] : undefined,
  };
}

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

async function saveDebugScreenshot(page, label) {
  try {
    const debugDir = path.join(II_ROOT, 'debug');
    fs.mkdirSync(debugDir, { recursive: true });
    const filename = `instagram-${label}-${Date.now()}.png`;
    await page.screenshot({ path: path.join(debugDir, filename), fullPage: false });
    console.log(`  [debug] Screenshot saved: ${path.join(debugDir, filename)}`);
    return filename;
  } catch {
    return null;
  }
}

async function getInstagramComposerRoot(page) {
  const candidateRoots = [
    page.locator('[role="dialog"]').filter({
      hasText: /create new post|create reel|drag photos and videos here|select from computer|crop|edit|write a caption|share/i,
    }).last(),
    page.locator('[role="presentation"]').filter({
      hasText: /create new post|create reel|drag photos and videos here|select from computer|crop|edit|write a caption|share/i,
    }).last(),
    page.locator('[role="dialog"]').last(),
    page.locator('[role="presentation"]').last(),
  ];

  for (const root of candidateRoots) {
    if (await root.isVisible({ timeout: 1200 }).catch(() => false)) {
      return root;
    }
  }

  return null;
}

async function readInstagramComposerState(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[role="dialog"], [role="presentation"]'));
    const visibleNodes = nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 260
        && rect.height > 160
        && style.display !== 'none'
        && style.visibility !== 'hidden';
    });

    const root = visibleNodes[visibleNodes.length - 1];
    if (!root) {
      return {
        hasRoot: false,
        text: '',
        hasUploadPrompt: false,
        hasCaptionBox: false,
        hasPreviewMedia: false,
        buttonLabels: [],
      };
    }

    const text = root.innerText || '';
    const buttonLabels = Array.from(root.querySelectorAll('button, [role="button"]'))
      .map(el => (el.innerText || el.getAttribute('aria-label') || '').trim())
      .filter(Boolean)
      .slice(0, 20);

    return {
      hasRoot: true,
      text,
      hasUploadPrompt: /drag photos and videos here|select from computer/i.test(text),
      hasCaptionBox: Boolean(root.querySelector(
        'textarea[aria-label*="caption" i], textarea[placeholder*="caption" i], div[aria-label*="Write a caption" i][contenteditable="true"], div[contenteditable="true"][role="textbox"], [role="textbox"][contenteditable="true"]'
      )),
      hasPreviewMedia: Boolean(root.querySelector('img, video, canvas')),
      buttonLabels,
    };
  }).catch(() => ({
    hasRoot: false,
    text: '',
    hasUploadPrompt: false,
    hasCaptionBox: false,
    hasPreviewMedia: false,
    buttonLabels: [],
  }));
}

async function waitForInstagramComposer(page, timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const root = await getInstagramComposerRoot(page);
    if (root) return root;
    await page.waitForTimeout(750);
  }

  return null;
}

async function waitForInstagramEditorScreen(page, timeoutMs = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const state = await readInstagramComposerState(page);
    const hasNext = state.buttonLabels.some(label => /^next$/i.test(label));
    const hasShare = state.buttonLabels.some(label => /share|post/i.test(label));

    if (state.hasCaptionBox || hasNext || hasShare || (state.hasPreviewMedia && !state.hasUploadPrompt)) {
      return state;
    }

    await page.waitForTimeout(1000);
  }

  return { hasCaptionBox: false, hasUploadPrompt: true, hasNext: false, hasPreviewMedia: false, buttonLabels: [] };
}

export async function postToInstagramViaBrowser({ caption = '', mediaType = 'image', mediaPaths = [], headless = true }) {
  let username = String(process.env.INSTAGRAM_USERNAME || '').replace(/^@/, '');
  let browser;
  let context;
  let page;
  try {
    browser = await chromium.launch(chromiumLaunchOptions(headless));
    context = await browser.newContext();
    const hadCookies = await loadCookies(context);
    page = await context.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    await dismissInstagramPrompts(page);

    await saveDebugScreenshot(page, '01-initial-load');

    // Extract username from the logged-in page if not set via env
    if (!username) {
      username = await page.evaluate(() => {
        // Known Instagram nav/system paths to exclude
        const EXCLUDED_PATHS = new Set([
          'reels', 'explore', 'create', 'direct', 'accounts', 'stories',
          'p', 'reel', 'tv', 'live', 'tags', 'locations', 'nametag',
          'directory', 'topics', 'about', 'legal', 'privacy', 'safety',
        ]);

        // Strategy 1: Look for the Profile nav link (has specific text/span)
        const navLinks = Array.from(document.querySelectorAll('a[role="link"]'));
        for (const link of navLinks) {
          const text = (link.textContent || '').trim().toLowerCase();
          const href = link.getAttribute('href') || '';
          // The "Profile" nav link text matches and href is /<username>/
          if (text === 'profile' && href.match(/^\/[a-zA-Z0-9_.]+\/$/)) {
            return href.replace(/\//g, '');
          }
        }

        // Strategy 2: Find nav links that aren't known system paths
        for (const link of navLinks) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/^\/([a-zA-Z0-9_.]+)\/$/);
          if (match && !EXCLUDED_PATHS.has(match[1].toLowerCase())) {
            return match[1];
          }
        }

        // Strategy 3: Check meta tags
        const metaUrl = document.querySelector('meta[property="al:ios:url"]')?.getAttribute('content');
        if (metaUrl) {
          const userMatch = metaUrl.match(/user\?username=([^&]+)/);
          if (userMatch) return userMatch[1];
        }

        return '';
      }).catch(() => '');
      if (!username) console.warn('  [debug] WARNING: Could not detect Instagram username from page');
    }
    console.log('  [debug] Extracted username:', username);

    try {
      await ensureInstagramLoggedIn(page);
    } catch {
      await saveDebugScreenshot(page, '01b-not-logged-in');
      await browser.close();
      const auth = await authenticateInstagram({ headless: false, manualFallback: true });
      browser = await chromium.launch(chromiumLaunchOptions(headless));
      context = await browser.newContext();
      await loadCookies(context);
      page = await context.newPage();
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      await dismissInstagramPrompts(page);
      await ensureInstagramLoggedIn(page);
      if (!auth.cookieFile) {
        throw new Error('Instagram authentication did not produce a cookie file');
      }
    }

    console.log('  [debug] Logged in as:', username);
    console.log('  [debug] Current URL:', page.url());

    // Click the "+" (Create) button in the sidebar nav to open the upload dialog
    // DO NOT use href-based selectors (a[href="/create/..."]) — they cause page
    // navigation instead of opening Instagram's client-side modal overlay.
    let clickedCreate = false;

    // Strategy 1: Find SVGs with aria-label "New post"/"Create" scoped to the sidebar (left side)
    clickedCreate = await page.evaluate(() => {
      for (const label of ['New post', 'Create']) {
        const svgs = document.querySelectorAll(`svg[aria-label="${label}"]`);
        for (const svg of svgs) {
          const link = svg.closest('a, [role="button"], [role="link"]');
          if (link) {
            const rect = link.getBoundingClientRect();
            // Only click if it's in the left sidebar (x < 150px)
            if (rect.left < 150 && rect.width < 150) {
              for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                link.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
              }
              return label;
            }
          }
        }
      }
      return null;
    });
    if (clickedCreate) {
      console.log(`  [debug] Clicked sidebar Create via SVG label: ${clickedCreate}`);
      clickedCreate = true;
    }

    // Strategy 2: Playwright accessible role matching
    if (!clickedCreate) {
      for (const role of ['link', 'button', 'menuitem']) {
        try {
          const el = page.getByRole(role, { name: /^create$/i }).first();
          if (await el.isVisible({ timeout: 2000 })) {
            await el.click();
            clickedCreate = true;
            console.log(`  [debug] Clicked Create via role=${role}`);
            break;
          }
        } catch { /* try next */ }
      }
    }

    // Strategy 3: JS — find the sidebar item with "Create" text and simulate full pointer events
    if (!clickedCreate) {
      clickedCreate = await page.evaluate(() => {
        // Look for spans/divs whose own text content is exactly "Create"
        const allEls = document.querySelectorAll('span, div');
        for (const el of allEls) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim())
            .join('');
          if (ownText === 'Create') {
            const target = el.closest('a, [role="button"], [role="link"]') || el;
            // Dispatch full pointer event sequence so React handlers fire
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
              target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
            }
            return true;
          }
        }
        return false;
      });
      if (clickedCreate) console.log('  [debug] Clicked Create via JS pointer events');
    }

    if (!clickedCreate) {
      throw new Error('Could not find the Create/+ button in Instagram navigation');
    }

    // Wait for the upload modal/dialog to appear
    let dialogOpened = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForTimeout(2000);
      dialogOpened = Boolean(await waitForInstagramComposer(page, 3000));
      if (dialogOpened) {
        console.log('  [debug] Upload dialog detected');
        break;
      }
      // Also check if a file input appeared (some flows inject it without a dialog role)
      const hasFileInput = await page.locator('input[type="file"]').first()
        .isVisible({ timeout: 1000 }).catch(() => false);
      if (hasFileInput) {
        console.log('  [debug] File input detected (no dialog role)');
        dialogOpened = true;
        break;
      }
      console.log(`  [debug] Dialog not open yet (attempt ${attempt + 1}/3), retrying click...`);
      // Retry with JS dispatchEvent
      await page.evaluate(() => {
        const allEls = document.querySelectorAll('span, div');
        for (const el of allEls) {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim())
            .join('');
          if (ownText === 'Create') {
            const target = el.closest('a, [role="button"], [role="link"]') || el;
            for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
              target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
            }
            return;
          }
        }
      });
    }

    if (!dialogOpened) {
      await saveDebugScreenshot(page, '01d-dialog-not-opened');
      // Last resort: try navigating directly and see if the dialog loads
      console.log('  [debug] Dialog still not open — trying direct URL as last resort');
      await page.goto('https://www.instagram.com/create/select/', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(4000);
    }

    // NOTE: Do NOT call dismissInstagramPrompts here — it would click "Cancel"/"Close"
    // buttons inside the upload dialog, closing it before we can upload files.
    await saveDebugScreenshot(page, '01c-after-create-click');
    let composerRoot = await waitForInstagramComposer(page, 15000);
    if (!composerRoot) {
      throw new Error('Instagram upload dialog opened but the active composer root could not be identified');
    }

    if (mediaPaths.length > 1) {
      console.log(`  [debug] Uploading ${mediaPaths.length} files for carousel via filechooser...`);

      // Force multiple attribute on ALL file inputs BEFORE triggering the dialog
      await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach(el => {
          el.setAttribute('multiple', '');
          el.multiple = true;
        });
      });
      console.log('  [debug] Forced multiple attribute on file inputs');

      // Use Playwright's filechooser event to properly inject multiple files
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        (async () => {
          const selectBtn = page.locator('button:has-text("Select"), button:has-text("select from"), button:has-text("Select from")').first();
          if (await selectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await selectBtn.click();
          } else {
            const input = page.locator('input[type="file"]').first();
            await input.waitFor({ state: 'attached', timeout: 10000 });
            await input.dispatchEvent('click');
          }
        })(),
      ]);

      console.log(`  [debug] filechooser.isMultiple(): ${fileChooser.isMultiple()}`);
      await fileChooser.setFiles(mediaPaths);
      console.log(`  [debug] Set ${mediaPaths.length} files via filechooser`);
      await page.waitForTimeout(6000);

      await saveDebugScreenshot(page, '02a-after-filechooser');
      const pageTextSnippet = await page.evaluate(() => (document.body.innerText || '').slice(0, 300)).catch(() => '');
      console.log(`  [debug] Page text after upload: "${pageTextSnippet.slice(0, 120)}"`);

      await page.waitForTimeout(2000);
    } else {
      let uploaded = false;

      const composerInput = composerRoot.locator('input[type="file"]').last();
      if (await composerInput.count().catch(() => 0)) {
        await composerInput.setInputFiles(mediaPaths);
        uploaded = true;
        console.log('  [debug] Uploaded via composer-scoped file input');
      }

      // Prefer the filechooser route inside the active composer because page-level
      // buttons and inputs can belong to the background feed rather than the post modal.
      try {
        if (!uploaded) {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 12000 }),
            (async () => {
              for (const locator of [
                composerRoot.getByRole('button', { name: /select from computer|select from your computer/i }).first(),
                composerRoot.locator('button').filter({ hasText: /select from computer|select from your computer/i }).first(),
                composerRoot.getByText(/select from computer|select from your computer/i).first(),
              ]) {
                if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
                  await locator.click();
                  return;
                }
              }
            })(),
          ]);
          await fileChooser.setFiles(mediaPaths);
          uploaded = true;
          console.log('  [debug] Uploaded via composer-scoped filechooser');
        }
      } catch {
        console.log('  [debug] Composer filechooser path unavailable, trying direct input...');
      }

      if (!uploaded) {
        composerRoot = await waitForInstagramComposer(page, 3000) || composerRoot;
        const input = composerRoot.locator('input[type="file"]').last();
        const inputAttached = await input.waitFor({ state: 'attached', timeout: 8000 }).then(() => true).catch(() => false);
        if (!inputAttached) {
          throw new Error('Instagram upload failed: no usable file chooser or file input found');
        }
        await input.setInputFiles(mediaPaths);
        console.log('  [debug] Uploaded via fallback composer file input');
      }

      await page.waitForTimeout(mediaType === 'reel' || mediaType === 'video' ? 10000 : 6000);

      const editorState = await waitForInstagramEditorScreen(page, 12000);
      console.log(`  [debug] Composer buttons after upload: ${editorState.buttonLabels?.join(' | ') || '(none)'}`);
      const editorHasNext = editorState.buttonLabels?.some(label => /^next$/i.test(label));
      const editorHasShare = editorState.buttonLabels?.some(label => /share|post/i.test(label));
      if (editorState.hasUploadPrompt && !editorHasNext && !editorHasShare && !editorState.hasCaptionBox) {
        const uploadDiagnostics = await page.evaluate(() => {
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="presentation"]'));
          const root = dialogs[dialogs.length - 1] || document;
          const fileInput = root.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
          return {
            hasSelectedFile: Boolean(fileInput?.files?.length),
            selectedFileName: fileInput?.files?.[0]?.name || null,
            loading: !!root.querySelector('[data-visualcompletion="loading-state"]'),
          };
        }).catch(() => ({ hasSelectedFile: false, selectedFileName: null, loading: false }));

        if (uploadDiagnostics.hasSelectedFile && uploadDiagnostics.loading) {
          throw new Error(`Instagram upload stalled after file selection: ${uploadDiagnostics.selectedFileName || 'attached video'} never progressed past the initial modal`);
        }

        throw new Error('Instagram upload failed: modal stayed on the initial "Select from computer" screen');
      }
    }

    await saveDebugScreenshot(page, '02-after-upload');

    // Dismiss informational overlays that appear after video upload
    // (e.g. "Video posts are now shared as reels" with OK button)
    // Try multiple selector strategies since Instagram uses non-standard button elements
    for (const label of ['OK', 'Ok', 'Got it', 'Continue', 'Not now', 'Not Now']) {
      for (const locator of [
        page.getByRole('button', { name: label }).first(),
        page.locator(`button:has-text("${label}")`).first(),
        page.locator(`div[role="button"]:has-text("${label}")`).first(),
        page.getByText(label, { exact: true }).first(),
      ]) {
        try {
          if (await locator.isVisible({ timeout: 1500 })) {
            await locator.click({ force: true });
            console.log(`  [debug] Dismissed overlay: ${label}`);
            await page.waitForTimeout(2000);
            break;
          }
        } catch { /* try next */ }
      }
    }

    // Click Next/arrow buttons to advance through Crop → Edit → Caption screens
    for (let i = 0; i < 3; i += 1) {
      // Check for "Next" — could be a button, a link, or a styled div/span
      composerRoot = await waitForInstagramComposer(page, 5000) || composerRoot;
      const nextButton = composerRoot.getByRole('button', { name: /^next$/i }).first();
      const nextText = composerRoot.getByText('Next', { exact: true }).first();
      const nextLink = composerRoot.locator('div[role="button"]').filter({ hasText: /^Next$/i }).last();
      let clicked = false;
      for (const btn of [nextButton, nextText, nextLink]) {
        try {
          if (await btn.isVisible({ timeout: 3000 })) {
            await btn.click();
            clicked = true;
            console.log(`  [debug] Clicked Next (step ${i + 1})`);
            await page.waitForTimeout(3000);
            break;
          }
        } catch { /* try next */ }
      }
      if (!clicked) break;

      // After each Next, dismiss any new informational overlays
      for (const label of ['OK', 'Got it', 'Continue']) {
        try {
          const btn = page.getByRole('button', { name: label }).first();
          if (await btn.isVisible({ timeout: 1500 })) {
            await btn.click();
            console.log(`  [debug] Dismissed overlay after Next: ${label}`);
            await page.waitForTimeout(1500);
          }
        } catch { /* ignore */ }
      }
    }

    await saveDebugScreenshot(page, '03-after-next');

    const captionSelectors = [
      'textarea[aria-label*="caption" i]',
      'textarea[placeholder*="caption" i]',
      'div[aria-label*="Write a caption" i][contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      '[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]',
    ];

    let captionFilled = false;
    for (const selector of captionSelectors) {
      composerRoot = await waitForInstagramComposer(page, 5000) || composerRoot;
      const captionBox = composerRoot.locator(selector).first();
      if (!(await captionBox.isVisible({ timeout: 2500 }).catch(() => false))) {
        continue;
      }

      await captionBox.click().catch(() => {});
      await page.waitForTimeout(300);

      // contenteditable surfaces do not support fill reliably
      const isMac = process.platform === 'darwin';
      await page.keyboard.press(isMac ? 'Meta+a' : 'Control+a').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await page.waitForTimeout(200);
      await page.keyboard.type(String(caption || '').slice(0, 2200), { delay: 5 });
      captionFilled = true;
      console.log(`  [debug] Caption filled via selector: ${selector}`);
      break;
    }

    if (!captionFilled) {
      throw new Error('Instagram caption entry failed: no visible caption input matched current UI');
    }
    await page.waitForTimeout(1000);

    await saveDebugScreenshot(page, '04-before-share');

    // Validate share button is visible and enabled before clicking
    composerRoot = await waitForInstagramComposer(page, 5000) || composerRoot;
    const shareButton = composerRoot.getByRole('button', { name: /share|post/i }).first();
    const shareVisible = await shareButton.isVisible({ timeout: 5000 }).catch(() => false);
    if (!shareVisible) {
      await saveDebugScreenshot(page, '04b-share-not-found');
      throw new Error('Share/Post button not found or not visible — Instagram creation flow may not have completed');
    }
    const shareDisabled = await shareButton.isDisabled().catch(() => false);
    if (shareDisabled) {
      await saveDebugScreenshot(page, '04c-share-disabled');
      throw new Error('Share/Post button is disabled — upload may still be processing');
    }

    await shareButton.click();
    console.log('  [debug] Share button clicked, waiting for upload to complete...');

    // Wait for the sharing/upload to complete.
    // Instagram shows a "Sharing" spinner while uploading. We need to wait for:
    // - The spinner to disappear, OR
    // - A "Your reel has been shared" / success message, OR
    // - The dialog to close and return to the feed
    // DO NOT navigate away while sharing is in progress — it will discard the post.
    const maxShareWaitMs = 120000; // 2 min for video upload
    const shareStart = Date.now();
    let shareCompleted = false;

    while (Date.now() - shareStart < maxShareWaitMs) {
      await page.waitForTimeout(3000);

      // Check if sharing completed — look for success indicators
      const pageState = await page.evaluate(() => {
        const body = document.body?.innerText?.toLowerCase() || '';
        const hasDialog = !!document.querySelector('[role="dialog"], [role="presentation"]');
        const hasSpinner = body.includes('sharing');
        const hasSuccess = body.includes('your reel has been shared') ||
                           body.includes('your post has been shared') ||
                           body.includes('reel shared');
        const hasError = body.includes('something went wrong') ||
                         body.includes('couldn\'t share') ||
                         body.includes('try again');
        return { hasDialog, hasSpinner, hasSuccess, hasError };
      }).catch(() => ({}));

      if (pageState.hasSuccess) {
        console.log('  [debug] Share confirmed: success message detected');
        shareCompleted = true;
        break;
      }
      if (pageState.hasError) {
        await saveDebugScreenshot(page, '05-share-error');
        throw new Error('Instagram sharing failed — error message detected on page');
      }
      // If no dialog is visible anymore, sharing is done (dialog closed)
      if (!pageState.hasDialog) {
        console.log('  [debug] Share dialog closed — upload likely complete');
        shareCompleted = true;
        break;
      }
      // If dialog is still showing but no longer says "Sharing", it may have completed
      if (pageState.hasDialog && !pageState.hasSpinner) {
        console.log('  [debug] Dialog present but no longer sharing — checking for completion');
        await page.waitForTimeout(3000);
        shareCompleted = true;
        break;
      }

      const elapsed = Math.round((Date.now() - shareStart) / 1000);
      if (elapsed % 15 === 0) {
        console.log(`  [debug] Still sharing... (${elapsed}s elapsed)`);
      }
    }

    if (!shareCompleted) {
      console.warn('  [debug] WARNING: Share wait timed out after 120s');
    }

    // Handle "Discard post?" dialog if it appeared — always click Cancel to keep the post
    const discardDialog = page.getByText('Discard post?', { exact: false }).first();
    if (await discardDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('  [debug] "Discard post?" dialog detected — clicking Cancel to keep post');
      const cancelBtn = page.getByRole('button', { name: 'Cancel' }).first();
      await cancelBtn.click().catch(() => {});
      await page.waitForTimeout(5000);
    }

    // Dismiss only safe post-share prompts (NOT Cancel/Close which could discard the post)
    for (const label of ['Not now', 'Not Now', 'Skip', 'OK', 'Ok']) {
      try {
        const btn = page.getByRole('button', { name: label }).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          await page.waitForTimeout(1000);
        }
      } catch { /* ignore */ }
    }
    await page.waitForTimeout(2000);

    const urlAfterShare = page.url();
    console.log('  [debug] URL after share:', urlAfterShare);

    await saveDebugScreenshot(page, '05-after-share');
    await saveCookies(context);

    // Check if we're still on the creation page (likely means post failed)
    const stillOnCreate = urlAfterShare.includes('/create/');
    if (stillOnCreate) {
      const errorText = await page.evaluate(() => {
        const errorEl = document.querySelector('[role="alert"], [data-testid="error"], .error-message');
        return errorEl ? errorEl.innerText : '';
      }).catch(() => '');
      if (errorText) {
        throw new Error(`Instagram post failed with error: ${errorText}`);
      }
      console.warn('  [debug] WARNING: Still on /create/ page after sharing — post may not have gone through');
    }

    let permalink;
    try {
      permalink = await extractPermalink(page, username, caption);
    } catch (e) {
      await saveDebugScreenshot(page, '06-permalink-failed');
      if (stillOnCreate) {
        throw new Error('Instagram post failed: still on creation page and could not find post on profile');
      }
      console.warn(`Warning: ${e.message}`);
      console.warn('The post may have succeeded — check your Instagram profile manually.');
      console.warn('Check debug screenshots in output/debug/ for more details.');
      permalink = `https://www.instagram.com/${username}/`;
    }
    return {
      postUrl: permalink,
      verified: permalink.includes('/p/') || permalink.includes('/reel/'),
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
