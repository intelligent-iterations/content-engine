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
import {
  listScheduledPlatformItems,
  prepareScheduledVideoForPlatform,
  recordScheduledPlatformFailure,
  updateScheduledPlatformPost,
} from '../shared/scheduled-queue.js';
import { normalizeCaptionForPosting } from '../shared/post-promo.js';
import { II_ROOT } from '../core/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const PLATFORM = 'instagram';

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const POSTS_PER_RUN = 1;

/**
 * Post a single video to Instagram
 */
async function postOneVideo(item) {
  const video = item.manifest;
  const prepared = prepareScheduledVideoForPlatform(item, PLATFORM);
  const videoFilePath = prepared.preparedVideoPath;
  if (!fs.existsSync(videoFilePath)) {
    console.error(`  File not found: ${path.relative(II_ROOT, videoFilePath)}`);
    return null;
  }

  const fileSizeMB = (fs.statSync(videoFilePath).size / (1024 * 1024)).toFixed(1);
  console.log(`  File: ${path.relative(II_ROOT, videoFilePath)} (${fileSizeMB} MB)`);

  // Load caption
  let caption = normalizeCaptionForPosting(`${video.id} #content #video`);
  if (video.assets.caption_path) {
    const captionFilePath = path.join(II_ROOT, video.assets.caption_path);
    if (fs.existsSync(captionFilePath)) {
      caption = normalizeCaptionForPosting(fs.readFileSync(captionFilePath, 'utf-8'));
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

  if (!result?.verified) {
    throw new Error(`Instagram post was not verified: ${result?.postUrl || 'no permalink returned'}`);
  }

  const postId = result.postUrl.split('/').filter(Boolean).pop() || `instagram-reel-${Date.now()}`;
  updateScheduledPlatformPost('video', item.dir, 'instagram', {
    post_id: postId,
    permalink: result.postUrl,
    source_file: prepared.manifest.queue?.platforms?.[PLATFORM]?.prepared_video_path || video.assets.video_path,
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

  const allVideos = listScheduledPlatformItems('video', PLATFORM);
  console.log(`Total scheduled videos: ${allVideos.length}`);
  console.log(`Ready for Instagram: ${allVideos.length}`);

  if (allVideos.length === 0) {
    console.log('\nNo unposted scheduled videos available!');
    return { success: false, reason: 'no_unposted_content' };
  }

  const batch = allVideos.slice(0, POSTS_PER_RUN);
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
      recordScheduledPlatformFailure('video', video.dir, PLATFORM, err);
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
