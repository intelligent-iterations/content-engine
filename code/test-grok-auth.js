/**
 * Integration test for Grok auth via GitHub Secrets.
 *
 * Decodes GROK_STORAGE_STATE from env (set from GitHub Secrets in CI)
 * and verifies the cookies produce a valid authenticated Grok session.
 *
 * Run:   GROK_STORAGE_STATE=... node code/test-grok-auth.js
 * CI:    GROK_STORAGE_STATE is injected as an env var by the workflow.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { ROOT_DIR } from './core/paths.js';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

function loadStorageState() {
  const b64 = process.env.GROK_STORAGE_STATE;
  if (!b64) {
    throw new Error('GROK_STORAGE_STATE env var not set. Run this test in CI or set the env var.');
  }
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function normalizeCookie(c) {
  return {
    name: c.name,
    value: String(c.value ?? ''),
    domain: c.domain || '.grok.com',
    path: c.path || '/',
    expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure ?? true),
    sameSite: c.sameSite || 'Lax',
  };
}

async function run() {
  console.log('Loading Grok storage state...');
  const state = loadStorageState();
  const cookies = state.cookies || [];

  // --- Decode validation ---
  console.log(`  Found ${cookies.length} cookies`);
  if (cookies.length === 0) {
    throw new Error('Storage state has no cookies');
  }

  const AUTH_COOKIE_NAMES = ['auth_token', 'ct0', 'kdt', 'twid', 'sso', 'sso-rw'];
  const authCookies = cookies.filter(c => AUTH_COOKIE_NAMES.includes(c.name));
  console.log(`  Auth cookies found: ${authCookies.map(c => c.name).join(', ') || 'NONE'}`);

  if (authCookies.length === 0) {
    throw new Error('No auth cookies (auth_token, ct0, etc.) found in storage state');
  }

  // --- Browser session validation ---
  console.log('  Launching browser to verify Grok session...');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    await context.addCookies(cookies.map(c => normalizeCookie(c)));

    const page = await context.newPage();
    await page.goto('https://grok.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const haystack = `${url} ${bodyText}`.toLowerCase();

    // Check we're not on a login/upsell page
    const isGuest = haystack.includes('sign up') && haystack.includes('log in');
    const isLoginPage = url.includes('accounts.x.ai') || url.includes('/sign-in');

    if (isGuest || isLoginPage) {
      throw new Error(`Grok session is not authenticated. URL: ${url}`);
    }

    console.log(`  Grok session looks authenticated. URL: ${url}`);
    await context.close();
  } finally {
    await browser.close();
  }

  console.log('PASS: Grok auth test passed');
}

run().catch(err => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
