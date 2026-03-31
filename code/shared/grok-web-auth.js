import fs from 'fs';
import path from 'path';

const GROK_SIGN_IN_URL = 'https://accounts.x.ai/sign-in?redirect=grok-com&return_to=%2Fimagine';
const GROK_IMAGINE_URL = 'https://grok.com/imagine';

function logDebug(enabled, message) {
  if (enabled) {
    console.log(`[debug] ${message}`);
  }
}

async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

function pageLooksGuest(url, text) {
  const lowered = String(text || '').toLowerCase();

  if (/\/i\/flow\/login|\/oauth2\/authorize|accounts\.x\.ai\/sign-in/i.test(String(url || ''))) {
    return true;
  }

  if (lowered.includes('sign in to grok') || lowered.includes('log into your account')) {
    return true;
  }

  if (lowered.includes('or browse curated posts from creators')) {
    return true;
  }

  if (lowered.includes('grok imagine') && lowered.includes('sign in') && lowered.includes('sign up')) {
    return true;
  }

  if (lowered.includes('featured templates') && lowered.includes('discover') && lowered.includes('sign in')) {
    return true;
  }

  return lowered.includes('sign in') && lowered.includes('sign up') && !lowered.includes('toggle sidebar');
}

async function domLooksGuest(page) {
  const signInButton = page.getByRole('button', { name: /^sign in$/i }).first();
  const signUpButton = page.getByRole('button', { name: /^sign up$/i }).first();

  try {
    const signInVisible = await signInButton.isVisible({ timeout: 1000 }).catch(() => false);
    const signUpVisible = await signUpButton.isVisible({ timeout: 1000 }).catch(() => false);
    if (signInVisible && signUpVisible) {
      return true;
    }
  } catch {
    // Ignore transient DOM issues.
  }

  return false;
}

async function currentPageLooksGuest(page) {
  const text = await bodyText(page);
  if (pageLooksGuest(page.url(), text)) {
    return true;
  }

  return domLooksGuest(page);
}

async function clickIfVisible(locator, timeout = 4000) {
  try {
    if (await locator.isVisible({ timeout })) {
      await locator.click({ timeout: Math.max(timeout, 10000) });
      return true;
    }
  } catch {
    // Ignore transient visibility/click issues.
  }

  return false;
}

export async function ensureAuthenticatedGrokSession(page, context, options = {}) {
  const {
    debug = false,
    statePath = null,
  } = options;

  if (!await currentPageLooksGuest(page)) {
    await page.waitForTimeout(1500);
  }

  if (!await currentPageLooksGuest(page)) {
    return false;
  }

  logDebug(debug, 'Guest Grok session detected; starting xAI sign-in recovery');
  await page.goto(GROK_SIGN_IN_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);

  const signInBody = await bodyText(page);
  if (/cloudflare|you have been blocked/i.test(signInBody)) {
    throw new Error('xAI sign-in was blocked by Cloudflare during browser auth recovery.');
  }

  const xLoginButtonCandidates = [
    page.getByRole('button', { name: /login with/i }).filter({ hasText: '𝕏' }).first(),
    page.locator('button').filter({ hasText: /login with/i }).filter({ hasText: '𝕏' }).first(),
    page.locator('button').filter({ hasText: /login with/i }).first(),
  ];

  let clickedXLogin = false;
  for (const candidate of xLoginButtonCandidates) {
    if (await clickIfVisible(candidate)) {
      clickedXLogin = true;
      logDebug(debug, 'Clicked Login with X');
      break;
    }
  }

  if (!clickedXLogin) {
    throw new Error('Could not find the xAI "Login with X" button during browser auth recovery.');
  }

  const authorizeDeadline = Date.now() + 30000;
  while (Date.now() < authorizeDeadline) {
    const currentUrl = page.url();

    if (/x\.com\/i\/flow\/login/i.test(currentUrl)) {
      throw new Error('X OAuth redirected to the X login form. Existing X cookies are missing or expired.');
    }

    if (/x\.com\/i\/oauth2\/authorize/i.test(currentUrl)) {
      const authorizeButton = page.getByRole('button', { name: /authorize app/i }).first();
      if (await clickIfVisible(authorizeButton)) {
        logDebug(debug, 'Authorized xAI app access on X');
        break;
      }
    }

    if (currentUrl.includes(GROK_IMAGINE_URL) && !await currentPageLooksGuest(page)) {
      break;
    }

    await page.waitForTimeout(1000);
  }

  const completionDeadline = Date.now() + 120000;
  while (Date.now() < completionDeadline) {
    const currentUrl = page.url();

    if (currentUrl.includes(GROK_IMAGINE_URL) && !await currentPageLooksGuest(page)) {
      break;
    }

    await page.waitForTimeout(2000);
  }

  if (!page.url().includes(GROK_IMAGINE_URL)) {
    await page.goto(GROK_IMAGINE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1500);
  }

  if (await currentPageLooksGuest(page)) {
    throw new Error('Grok browser auth recovery completed, but the session still appears to be guest/upsell state.');
  }

  if (statePath) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await context.storageState({ path: statePath });
    logDebug(debug, `Saved refreshed Grok storage state to ${statePath}`);
  }

  return true;
}
