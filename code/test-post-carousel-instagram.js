/**
 * Integration test — post a carousel to Instagram.
 *
 * Generates a minimal test image with sharp, posts it as a single-slide
 * carousel, and verifies the result contains a permalink.
 *
 * Requires: cookies/instagram_cookies.json
 *
 * Usage:
 *   npm run test:post:carousel:instagram
 *   npm run test:post:carousel:instagram -- --headless   (default)
 *   npm run test:post:carousel:instagram -- --headed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'instagram_cookies.json');

async function main() {
  // ----- guard: cookies required -----
  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('ERROR: Instagram cookies not found at', COOKIE_FILE);
    console.error('Run `npm run auth:posting:instagram` first.');
    process.exit(1);
  }

  const headless = !process.argv.includes('--headed');

  // ----- generate a test slide (1080x1350 4:5) -----
  const tmpDir = path.join(REPO_ROOT, 'output', 'test-post-carousel-ig');
  fs.mkdirSync(tmpDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = `Integration test ${timestamp}`;

  const svgOverlay = Buffer.from(`
    <svg width="1080" height="1350">
      <rect width="1080" height="1350" fill="#6C3EC1"/>
      <text x="540" y="600" text-anchor="middle" font-size="48" fill="white" font-family="sans-serif">Content Gen</text>
      <text x="540" y="700" text-anchor="middle" font-size="32" fill="#DDD" font-family="sans-serif">Carousel Post Test</text>
      <text x="540" y="780" text-anchor="middle" font-size="24" fill="#AAA" font-family="sans-serif">${timestamp}</text>
    </svg>`);

  const slidePath = path.join(tmpDir, 'slide_1.jpg');
  await sharp(svgOverlay).jpeg({ quality: 80 }).toFile(slidePath);
  console.log('Test slide created:', slidePath);

  // ----- post -----
  const { postToInstagramViaBrowser } = await import('./posting/instagram-browser-post.js');

  const caption = `[Test] Content Gen carousel integration test — ${timestamp}\n\nThis is an automated test post. Please ignore.\n\n#contentgen #test`;

  console.log('Posting carousel to Instagram...');
  const result = await postToInstagramViaBrowser({
    caption,
    mediaType: 'carousel',
    mediaPaths: [slidePath],
    headless,
  });

  console.log('\n========================================');
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('========================================');

  if (!result.postUrl) {
    console.error('FAIL: No post URL returned');
    process.exit(1);
  }

  console.log('\nInstagram carousel post test PASSED');
  console.log('Post URL:', result.postUrl);

  // cleanup temp slide
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
