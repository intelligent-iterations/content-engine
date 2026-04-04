/**
 * Auto-post AI video variants to X (Twitter) as video tweets
 *
 * Posts 1 scheduled video per run from output/scheduled_videos/.
 * Source assets are expected under output/videos/.
 * Common default schedule: 8:20am, 12:20pm, 8:20pm.
 *
 * Usage:
 *   node code/posting/auto-post-x-ai-video.js
 *   node code/posting/auto-post-x-ai-video.js --dry-run
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { postToXViaBrowser } from './x-browser-post.js';
import {
  listScheduledPlatformItems,
  prepareScheduledVideoForPlatform,
  recordScheduledPlatformFailure,
  updateScheduledPlatformPost,
} from '../shared/scheduled-queue.js';
import { buildShortPostWithPromo } from '../shared/post-promo.js';
import {
  assertSpendWithinLimit,
  estimateXaiChatCompletionCost,
  estimateXaiChatCompletionMaxCost,
  extractXaiChatUsageMetadata,
  recordApiSpend,
} from '../shared/api-spend-tracker.js';
import { II_ROOT, ROOT_DIR } from '../core/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });
const PLATFORM = 'x';
const CHAT_MODEL = 'grok-4-1-fast-non-reasoning';

const BROAD_HASHTAGS = ['#creators', '#marketing', '#video', '#content', '#automation'];
const NICHE_HASHTAGS = ['#AIVideo', '#CarouselDesign', '#CreativeOps', '#ContentWorkflow', '#SocialContent'];

async function generateTweetCaption(video) {
  const day = Math.floor(Date.now() / 86400000);
  const broad = BROAD_HASHTAGS[day % BROAD_HASHTAGS.length];
  const niche = NICHE_HASHTAGS[day % NICHE_HASHTAGS.length];

  // Load caption file for context
  let captionContext = '';
  if (video.assets.caption_path) {
    const captionFilePath = path.join(II_ROOT, video.assets.caption_path);
    if (fs.existsSync(captionFilePath)) {
      captionContext = fs.readFileSync(captionFilePath, 'utf-8').trim();
    }
  }

  try {
    const prompt = `You write tweets for a general AI content tool that helps people generate videos and carousels fast.

CONTENT:
Video topic: "${video.id}"
Hook: "${video.id}"
Context: "${captionContext.substring(0, 400)}"

WRITE A TWEET for a video post. Follow these rules EXACTLY:

FORMAT (use line breaks between sections):
Line 1: Bold, scroll-stopping statement about the video idea or payoff (max 80 chars)
Line 2: One surprising fact — weave ONE of these hashtags inline: ${broad} or ${niche}
Line 3: End with a short punchy question that provokes replies

RULES:
- TOTAL tweet must be under 220 characters (hard limit)
- Exactly 1 hashtag, placed INLINE mid-sentence (NEVER at start, NEVER grouped at end)
- No emojis, no links
- Be direct, punchy, and highly shareable

Return ONLY the tweet text. Nothing else.`;
    const messages = [{ role: 'user', content: prompt }];
    const estimatedCostUsd = estimateXaiChatCompletionMaxCost({
      model: CHAT_MODEL,
      messages,
      maxTokens: 200,
    });

    assertSpendWithinLimit({
      provider: 'xai',
      operation: 'chat.completions',
      model: CHAT_MODEL,
      projectedCostUsd: estimatedCostUsd || 0,
    });

    const res = await axios.post('https://api.x.ai/v1/chat/completions', {
      model: CHAT_MODEL,
      messages,
      max_tokens: 200,
      temperature: 0.9,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    let tweet = res.data.choices?.[0]?.message?.content?.trim();
    if (tweet) {
      recordApiSpend({
        provider: 'xai',
        operation: 'chat.completions',
        model: CHAT_MODEL,
        costUsd: estimateXaiChatCompletionCost({
          model: CHAT_MODEL,
          usage: res.data?.usage,
        }) || 0,
        estimatedCostUsd,
        metadata: {
          ...extractXaiChatUsageMetadata(res.data),
          purpose: 'x-video-caption',
        },
      });

      tweet = tweet.replace(/^["']|["']$/g, '');
      if (tweet.length > 280) tweet = tweet.substring(0, 277) + '...';
      return tweet;
    }
  } catch (e) {
    console.log(`  Grok caption failed: ${e.message}`);
  }

  return buildShortPostWithPromo(`${video.id} is ready to post. What should this tool generate next?`);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(50));
  console.log('  X AI Video Auto-Poster (1/run, 3x/day)');
  console.log('  ' + new Date().toISOString());
  if (dryRun) console.log('  ** DRY RUN **');
  console.log('='.repeat(50));
  console.log();

  const allVideos = listScheduledPlatformItems('video', PLATFORM);
  console.log(`Total scheduled ready for X: ${allVideos.length}`);

  if (allVideos.length === 0) {
    console.log('\nNo unposted variants!');
    return;
  }

  const item = allVideos[0];
  const video = item.manifest;
  console.log(`\nSelected: ${video.id}`);

  if (dryRun) {
    console.log(`[dry-run] Would post: ${video.assets.video_path}`);
    return;
  }

  const prepared = prepareScheduledVideoForPlatform(item, PLATFORM);
  const videoFilePath = prepared.preparedVideoPath;
  if (!fs.existsSync(videoFilePath)) {
    console.error(`File not found: ${path.relative(II_ROOT, videoFilePath)}`);
    process.exit(1);
  }

  try {
    console.log('Generating caption...');
    const tweetText = buildShortPostWithPromo(await generateTweetCaption(video));
    console.log(`  "${tweetText}" (${tweetText.length}/280)`);

    console.log('\nPosting via X browser session...');
    const result = await postToXViaBrowser({
      text: tweetText,
      mediaPaths: [videoFilePath],
    });
    const tweetId = result.tweetId;
    const tweetUrl = result.tweetUrl;

    console.log(`\nSUCCESS! ${tweetUrl}`);
    updateScheduledPlatformPost('video', item.dir, 'x', {
      post_id: tweetId,
      permalink: tweetUrl,
      source_file: prepared.manifest.queue?.platforms?.[PLATFORM]?.prepared_video_path || video.assets.video_path,
    });
  } catch (error) {
    recordScheduledPlatformFailure('video', item.dir, PLATFORM, error);
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { main as autoPostXAIVideo };
