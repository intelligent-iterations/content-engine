#!/usr/bin/env node

import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { AUTH_DIR, isMainModule } from '../core/paths.js';

const DEFAULT_OUTPUT = path.join(AUTH_DIR, 'grok-storage-state.json');
const CHROME_USER_DATA = path.join(homedir(), 'Library/Application Support/Google/Chrome');
const DEFAULT_PROFILE = 'Default';
const TARGETS = ['https://grok.com', 'https://x.ai', 'https://x.com'];
const AUTH_NAMES = ['auth_token', 'ct0', 'kdt', 'twid', 'sso', 'sso-rw', 'cf_clearance'];

function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    profile: DEFAULT_PROFILE
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--output') {
      args.output = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
    } else if (arg === '--profile') {
      args.profile = argv[i + 1];
      i += 1;
    } else if (arg.startsWith('--profile=')) {
      args.profile = arg.slice('--profile='.length);
    } else if (arg === '--help') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Usage:
  node code/cli/export-grok-browser-session.js

Options:
  --profile <name>   Chrome profile directory name (default: Default)
  --output <path>    Storage-state output path
  --help             Show this help
`.trim());
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const profileDir = path.join(CHROME_USER_DATA, args.profile);

  console.log('Launching Chrome with your real profile...');
  console.log(`Profile: ${profileDir}`);
  console.log('Close all normal Chrome windows first or the profile lock will fail.');
  console.log('When Grok is open and looks logged in, close the browser window.\n');

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation']
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://grok.com', { waitUntil: 'domcontentloaded' });

  async function saveSession() {
    const cookies = await context.cookies(TARGETS);
    const storageState = await context.storageState();

    const seen = new Set(storageState.cookies.map((cookie) => `${cookie.name}|${cookie.domain}`));
    for (const cookie of cookies) {
      const key = `${cookie.name}|${cookie.domain}`;
      if (!seen.has(key)) {
        storageState.cookies.push(cookie);
        seen.add(key);
      }
    }

    writeFileSync(args.output, JSON.stringify(storageState, null, 2));

    const found = storageState.cookies.filter((cookie) => AUTH_NAMES.includes(cookie.name));
    console.log(`Saved ${storageState.cookies.length} cookies to ${args.output}`);
    if (found.length > 0) {
      console.log('Auth cookies found:');
      for (const cookie of found) {
        console.log(`  ${cookie.name} (${cookie.domain}) ${cookie.httpOnly ? '[HttpOnly]' : ''}`);
      }
    } else {
      console.log('  No auth cookies yet; waiting...');
    }
  }

  const interval = setInterval(() => {
    saveSession().catch(() => {});
  }, 5000);

  async function cleanup() {
    clearInterval(interval);
    try {
      await saveSession();
    } catch {
      // Ignore final-save failures during teardown.
    }
    try {
      await context.close();
    } catch {
      // Ignore close failures.
    }
  }

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  context.on('close', async () => {
    clearInterval(interval);
    try {
      const cookies = await context.cookies(TARGETS).catch(() => []);
      if (cookies.length > 0) {
        await saveSession();
      }
    } catch {
      // Ignore shutdown races.
    }
    console.log('\nDone.');
    process.exit(0);
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
