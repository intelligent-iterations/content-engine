/**
 * Integration test — post a video to TikTok.
 *
 * Generates a minimal 5-second test video with ffmpeg, posts it via
 * browser automation, and verifies the result contains a permalink.
 *
 * Requires: cookies/tiktok_cookies.json, ffmpeg on PATH
 *
 * Usage:
 *   npm run test:post:video:tiktok
 *   npm run test:post:video:tiktok -- --headed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const COOKIE_FILE = path.join(REPO_ROOT, 'cookies', 'tiktok_cookies.json');

function generateTestVideo(outputPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // Generate a 5-second 1080x1920 video with a colored background and text
  execFileSync('ffmpeg', [
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=#FF6B35:s=1080x1920:d=5:r=30`,
    '-vf', `drawtext=text='Content Gen - TikTok Test':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40,drawtext=text='${timestamp}':fontsize=28:fontcolor=#CCCCCC:x=(w-text_w)/2:y=(h-text_h)/2+40`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    outputPath,
  ], { stdio: 'pipe' });
}

async function main() {
  if (!fs.existsSync(COOKIE_FILE)) {
    console.error('ERROR: TikTok cookies not found at', COOKIE_FILE);
    console.error('Run `npm run auth:posting:tiktok` first.');
    process.exit(1);
  }

  // Check ffmpeg is available
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  } catch {
    console.error('ERROR: ffmpeg not found on PATH. Install it with `brew install ffmpeg`.');
    process.exit(1);
  }

  const headless = !process.argv.includes('--headed');

  // ----- generate a test video -----
  const tmpDir = path.join(REPO_ROOT, 'output', 'test-post-video-tiktok');
  fs.mkdirSync(tmpDir, { recursive: true });

  const videoPath = path.join(tmpDir, 'test-video.mp4');
  console.log('Generating test video...');
  generateTestVideo(videoPath);
  console.log('Test video created:', videoPath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // ----- post -----
  const { postToTikTok } = await import('./posting/tiktok-browser-post.js');

  const caption = `[Test] Content Gen video integration test ${timestamp} #contentgen #test`;

  console.log('Posting video to TikTok...');
  const result = await postToTikTok({
    videoPath,
    caption,
    headless,
  });

  console.log('\n========================================');
  console.log('Result:', JSON.stringify(result, null, 2));
  console.log('========================================');

  if (!result.postUrl) {
    console.error('FAIL: No post URL returned');
    process.exit(1);
  }

  console.log('\nTikTok video post test PASSED');
  console.log('Post URL:', result.postUrl);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
