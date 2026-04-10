/**
 * Integration test — post a carousel (images) to X.
 *
 * Generates a minimal test image with sharp, posts it as a tweet with
 * an image attachment, and verifies the result contains a tweet URL.
 *
 * Requires: cookies/x_cookies.json
 *
 * Usage:
 *   npm run test:post:carousel:x
 *   npm run test:post:carousel:x -- --headed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'x_cookies.json');

async function main() {
  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('ERROR: X cookies not found at', COOKIE_FILE);
    console.error('Posting cookies not found. Set up auth in ii-social-media-poster-internal.');
    process.exit(1);
  }

  const headless = !process.argv.includes('--headed');

  // ----- generate a test image (1080x1350) -----
  const tmpDir = path.join(REPO_ROOT, 'output', 'test-post-carousel-x');
  fs.mkdirSync(tmpDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const svgOverlay = Buffer.from(`
    <svg width="1080" height="1350">
      <rect width="1080" height="1350" fill="#1DA1F2"/>
      <text x="540" y="600" text-anchor="middle" font-size="48" fill="white" font-family="sans-serif">Content Gen</text>
      <text x="540" y="700" text-anchor="middle" font-size="32" fill="#DDD" font-family="sans-serif">X Post Test</text>
      <text x="540" y="780" text-anchor="middle" font-size="24" fill="#AAA" font-family="sans-serif">${timestamp}</text>
    </svg>`);

  const imagePath = path.join(tmpDir, 'slide_1.jpg');
  await sharp(svgOverlay).jpeg({ quality: 80 }).toFile(imagePath);
  console.log('Test image created:', imagePath);

  // ----- post -----
  const { postToXViaBrowser } = await import('./posting/x-browser-post.js');

  const text = `[Test] Content Gen integration test — ${timestamp}`;

  console.log('Posting to X...');
  const result = await postToXViaBrowser({
    text,
    mediaPaths: [imagePath],
    headless,
  });

  console.log('\n========================================');
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('========================================');

  if (!result.tweetUrl) {
    console.error('FAIL: No tweet URL returned');
    process.exit(1);
  }

  console.log('\nX carousel post test PASSED');
  console.log('Tweet URL:', result.tweetUrl);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
