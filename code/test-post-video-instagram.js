/**
 * Integration test — post a video (reel) to Instagram.
 *
 * Generates a minimal 5-second test video with ffmpeg, posts it as a
 * reel via browser automation, and verifies the result contains a permalink.
 *
 * Requires: cookies/instagram_cookies.json, ffmpeg on PATH
 *
 * Usage:
 *   npm run test:post:video:instagram
 *   npm run test:post:video:instagram -- --headed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'instagram_cookies.json');

function generateTestVideo(outputPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=#C13584:s=1080x1920:d=5:r=30`,
    '-vf', `drawtext=text='Content Gen - IG Reel Test':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40,drawtext=text='${timestamp}':fontsize=28:fontcolor=#CCCCCC:x=(w-text_w)/2:y=(h-text_h)/2+40`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    outputPath,
  ], { stdio: 'pipe' });
}

async function main() {
  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('ERROR: Instagram cookies not found at', COOKIE_FILE);
    console.error('Posting cookies not found. Set up auth in ii-social-media-poster-internal.');
    process.exit(1);
  }

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    console.error('ERROR: ffmpeg not found on PATH. Install it with `brew install ffmpeg`.');
    process.exit(1);
  }

  const headless = !process.argv.includes('--headed');

  const tmpDir = path.join(REPO_ROOT, 'output', 'test-post-video-ig');
  fs.mkdirSync(tmpDir, { recursive: true });

  const videoPath = path.join(tmpDir, 'test-reel.mp4');
  console.log('Generating test video...');
  generateTestVideo(videoPath);
  console.log('Test video created:', videoPath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const { postToInstagramViaBrowser } = await import('./posting/instagram-browser-post.js');

  const caption = `[Test] Content Gen reel integration test — ${timestamp}\n\nThis is an automated test post. Please ignore.\n\n#contentgen #test`;

  console.log('Posting reel to Instagram...');
  const result = await postToInstagramViaBrowser({
    caption,
    mediaType: 'reel',
    mediaPaths: [videoPath],
    headless,
  });

  console.log('\n========================================');
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('========================================');

  if (!result.postUrl) {
    console.error('FAIL: No post URL returned');
    process.exit(1);
  }

  console.log('\nInstagram reel post test PASSED');
  console.log('Post URL:', result.postUrl);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
