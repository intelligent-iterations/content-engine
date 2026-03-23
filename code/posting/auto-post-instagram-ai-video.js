/**
 * Auto-post AI video variants as Instagram Reels
 *
 * Posts 1 scheduled video per run from output/scheduled_videos/.
 * Source assets are expected under output/videos/.
 *
 * Usage:
 *   node code/posting/auto-post-instagram-ai-video.js
 *   node code/posting/auto-post-instagram-ai-video.js --dry-run
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { postToInstagramViaBrowser } from './instagram-browser-post.js';
import { listScheduledItems, updateScheduledPlatformPost } from '../shared/scheduled-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

// Load environment variables from repo root
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

if (!process.env.INSTAGRAM_USERNAME || !process.env.INSTAGRAM_PASSWORD) {
  console.error('ERROR: INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in content-gen/.env');
  process.exit(1);
}

const POSTS_PER_RUN = 1;

/**
 * Post a single video to Instagram
 */
async function postOneVideo(item) {
  const video = item.manifest;
  const videoFilePath = path.join(REPO_ROOT, video.assets.video_path);
  if (!fs.existsSync(videoFilePath)) {
    console.error(`  File not found: ${video.assets.video_path}`);
    return null;
  }

  const fileSizeMB = (fs.statSync(videoFilePath).size / (1024 * 1024)).toFixed(1);
  console.log(`  File: ${video.assets.video_path} (${fileSizeMB} MB)`);

  // Load caption
  let caption = `${video.id} #content #video`;
  if (video.assets.caption_path) {
    const captionFilePath = path.join(REPO_ROOT, video.assets.caption_path);
    if (fs.existsSync(captionFilePath)) {
      caption = fs.readFileSync(captionFilePath, 'utf-8').trim();
      console.log(`  Caption loaded (${caption.length} chars)`);
    }
  } else {
    console.log(`  No caption file, using default`);
  }

  console.log('  Posting reel through browser automation...');
  const result = await postToInstagramViaBrowser({
    caption,
    mediaType: 'reel',
    mediaPaths: [videoFilePath],
    headless: true,
  });
  const postId = result.postUrl.split('/').filter(Boolean).pop() || `instagram-reel-${Date.now()}`;
  updateScheduledPlatformPost('video', item.dir, 'instagram', {
    post_id: postId,
    permalink: result.postUrl,
    source_file: video.assets.video_path,
  });
  return { postId, postUrl: result.postUrl };
}

/**
 * Main auto-post function
 */
async function autoPostAIVideo() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(50));
  console.log('  Instagram AI Video Auto-Poster (1/run, 3x/day)');
  console.log('  ' + new Date().toISOString());
  if (dryRun) console.log('  ** DRY RUN **');
  console.log('='.repeat(50));
  console.log();

  const allVideos = listScheduledItems('video');
  console.log(`Total scheduled videos: ${allVideos.length}`);

  const unposted = allVideos.filter(item => !item.manifest.posts?.instagram?.permalink);
  console.log(`Unposted to Instagram: ${unposted.length}`);

  if (unposted.length === 0) {
    console.log('\nNo unposted scheduled videos available!');
    return { success: false, reason: 'no_unposted_content' };
  }

  const batch = unposted.slice(0, POSTS_PER_RUN);
  console.log(`\nPosting ${batch.length} video(s) this run:\n`);

  const results = [];

  for (let i = 0; i < batch.length; i++) {
    const video = batch[i];
    console.log(`--- [${i + 1}/${batch.length}] ${video.manifest.id} ---`);

    if (dryRun) {
      console.log(`  [dry-run] Would post: ${video.manifest.assets.video_path}\n`);
      results.push({ id: video.manifest.id, dryRun: true });
      continue;
    }

    try {
      const result = await postOneVideo(video);
      if (result) {
        console.log(`  Posted! ${result.postUrl}\n`);
        results.push({ id: video.manifest.id, ...result });
      }

      // 30s cooldown between posts to avoid IG rate limits
      if (i < batch.length - 1) {
        console.log('  [cooldown] 30s before next post...\n');
        await new Promise(r => setTimeout(r, 30000));
      }
    } catch (err) {
      console.error(`  FAILED: ${err.response?.data?.error?.message || err.message}`);
      if (err.response?.data?.error) {
        console.error(`  Details: ${JSON.stringify(err.response.data.error)}`);
      }
      console.log();
    }
  }

  console.log('='.repeat(50));
  console.log(`  Done! Posted ${results.length}/${batch.length}`);
  console.log('='.repeat(50));

  return { success: true, posted: results };
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  autoPostAIVideo()
    .then(result => {
      if (result.success) {
        console.log(`\nAuto-post complete! ${result.posted.length} video(s) posted.`);
      } else {
        console.log(`\nNo post made: ${result.reason}`);
      }
    })
    .catch(err => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
}

export { autoPostAIVideo };
