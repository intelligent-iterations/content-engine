/**
 * Post carousel to X (Twitter)
 *
 * Usage:
 *   node code/posting/post-to-x.js <folder-path>
 *   node code/posting/post-to-x.js scheduled-carousel-slug
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { postToXViaBrowser } from './x-browser-post.js';
import { SCHEDULED_CAROUSELS_DIR } from '../core/paths.js';
import { resolveScheduledItem, updateScheduledPlatformPost } from '../shared/scheduled-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

// --- HASHTAG POOLS (rotate to avoid repetition penalty) ---
const BROAD_HASHTAGS = ['#creators', '#marketing', '#content', '#video', '#automation', '#socialmedia', '#creative'];
const NICHE_HASHTAGS = ['#AICreator', '#ContentWorkflow', '#CarouselDesign', '#AIVideo', '#CreativeOps', '#Storytelling', '#ContentSystem'];

/**
 * Pick 1-2 hashtags: 1 broad + 1 niche, rotated based on day
 * Twitter algo penalizes >2 hashtags by 40%, so strict max of 2
 */
function pickHashtags() {
  const day = Math.floor(Date.now() / 86400000); // rotate daily
  const broad = BROAD_HASHTAGS[day % BROAD_HASHTAGS.length];
  const niche = NICHE_HASHTAGS[day % NICHE_HASHTAGS.length];
  return { broad, niche };
}

/**
 * Generate an algorithm-optimized tweet using Grok API
 *
 * Research-backed strategy:
 * - 71-100 chars ideal (17% higher engagement), max ~200 before hashtags
 * - 1-2 hashtags INLINE (not at end, never at start) — 55% more engagement
 * - End with a question — replies are 13.5x value of a like, reply chains 150x
 * - Use line breaks for readability
 * - No external links (zero median engagement for non-Premium)
 * - Bold/provocative tone that stops the scroll
 */
async function generateTweetCaption(metadata) {
  const { topic, hook, caption } = metadata;
  const { broad, niche } = pickHashtags();

  const prompt = `You write tweets for a general AI content tool that helps people generate videos and carousels from plain-English ideas.

CONTENT:
Topic: "${topic}"
Hook: "${hook}"
Context: "${caption?.substring(0, 400)}"

WRITE A TWEET. Follow these rules EXACTLY:

FORMAT (use line breaks between sections):
Line 1: Bold, scroll-stopping statement about the idea or payoff (max 80 chars)
Line 2: One surprising fact or stat woven naturally into the sentence — weave ONE of these hashtags into this line naturally as part of the sentence: ${broad} or ${niche}
Line 3: End with a short punchy question that provokes replies

RULES:
- TOTAL tweet must be under 220 characters (hard limit — count carefully)
- Exactly 1 hashtag, placed INLINE mid-sentence (NEVER at start of line, NEVER grouped at end)
- No emojis
- No links
- No "did you know" or "here's why"
- Be direct, punchy, and highly shareable
- The question at the end should make people WANT to reply

Return ONLY the tweet text with line breaks. Nothing else.`;

  try {
    const res = await axios.post('https://api.x.ai/v1/chat/completions', {
      model: 'grok-4-1-fast-non-reasoning',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.9,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      }
    });

    let tweet = res.data.choices?.[0]?.message?.content?.trim();
    if (!tweet) throw new Error('Empty response');

    // Strip any quotes Grok might wrap it in
    tweet = tweet.replace(/^["']|["']$/g, '');

    // Ensure we're under 280
    if (tweet.length > 280) {
      // Try to cut at last sentence before 280
      const cut = tweet.substring(0, 277);
      const lastBreak = Math.max(cut.lastIndexOf('?'), cut.lastIndexOf('.'), cut.lastIndexOf('!'));
      tweet = lastBreak > 150 ? tweet.substring(0, lastBreak + 1) : cut + '...';
    }

    return tweet;
  } catch (e) {
    console.log(`  Grok caption failed: ${e.message}`);
  }

  // Fallback: hook + hashtag + question
  return `${hook}\n\nWhat should this tool generate next?`;
}

/**
 * Select images for tweet (max 4)
 *
 * Priority order:
 * 1. Hook slide
 * 2. The strongest content slides
 * 3. Skip low-value CTA slides when possible
 * Prefer instagram/ cropped (4:5) when available, fall back to original 9:16
 */
function selectImages(folderPath) {
  const instagramFolder = path.join(folderPath, 'instagram');
  const useInstagram = fs.existsSync(instagramFolder);
  const imageFolder = useInstagram ? instagramFolder : folderPath;

  // Load metadata for slide info
  let slides = [];
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(folderPath, 'metadata.json'), 'utf-8'));
    slides = meta.slides || [];
  } catch (e) {}

  const allSlides = fs.readdirSync(imageFolder)
    .filter(f => f.startsWith('slide_') && (f.endsWith('.jpg') || f.endsWith('.png')))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide_(\d+)/)[1]);
      const numB = parseInt(b.match(/slide_(\d+)/)[1]);
      return numA - numB;
    });

  if (allSlides.length === 0) return [];
  if (allSlides.length <= 4) {
    return allSlides.map(f => path.join(imageFolder, f));
  }

  const selected = [];
  const hookSlide = allSlides[0];
  const nonCtaSlides = allSlides.filter((file) => {
    const num = parseInt(file.match(/slide_(\d+)/)[1], 10);
    const slideMeta = slides.find(s => s.slide_number === num);
    return slideMeta?.slide_type !== 'cta';
  });

  if (hookSlide) {
    selected.push(hookSlide);
  }

  const remaining = nonCtaSlides.filter(f => !selected.includes(f));
  for (const f of remaining) {
    if (selected.length < 4) selected.push(f);
  }

  if (selected.length < 4) {
    for (const f of allSlides) {
      if (selected.length < 4 && !selected.includes(f)) selected.push(f);
    }
  }

  // Sort by original slide order
  selected.sort((a, b) => {
    const numA = parseInt(a.match(/slide_(\d+)/)?.[1] || '0');
    const numB = parseInt(b.match(/slide_(\d+)/)?.[1] || '0');
    return numA - numB;
  });

  return selected.map(f => path.join(imageFolder, f));
}

/**
 * Post to X (Twitter)
 */
async function postToX(folderPath) {
  if (!path.isAbsolute(folderPath)) {
    folderPath = path.join(SCHEDULED_CAROUSELS_DIR, folderPath);
  }

  console.log('='.repeat(50));
  console.log('  X (Twitter) Post');
  console.log('='.repeat(50));
  console.log();

  // Load metadata
  const metadataPath = path.join(folderPath, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    console.error(`No metadata.json found in ${folderPath}`);
    process.exit(1);
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const folderName = path.basename(folderPath);
  const scheduledItem = resolveScheduledItem('carousel', folderPath);

  console.log(`Topic: ${metadata.topic}`);
  console.log(`Folder: ${folderName}`);
  console.log();

  if (!scheduledItem) {
    throw new Error(`Missing scheduled carousel manifest in ${folderPath}`);
  }

  if (scheduledItem.manifest.posts?.x?.permalink) {
    console.error('This folder has already been posted to X!');
    process.exit(1);
  }

  // Generate tweet caption (use x_post_text from metadata when available)
  console.log('Generating tweet caption...');
  let tweetText = metadata.x_post_text || await generateTweetCaption(metadata);
  console.log(`  Caption: ${tweetText}`);
  console.log(`  Length: ${tweetText.length}/280`);
  console.log();

  // Select images (max 4)
  const imagePaths = selectImages(folderPath);
  console.log(`Selected ${imagePaths.length} images`);

  if (imagePaths.length === 0) {
    console.error('No images found!');
    process.exit(1);
  }

  console.log('\nPosting via X browser session...\n');
  const result = await postToXViaBrowser({
    text: tweetText,
    mediaPaths: imagePaths,
  });
  const tweetId = result.tweetId;
  const tweetUrl = result.tweetUrl;

  console.log('='.repeat(50));
  console.log('  SUCCESS!');
  console.log('='.repeat(50));
  console.log();
  console.log(`Tweet ID: ${tweetId}`);
  console.log(`URL: ${tweetUrl}`);
  console.log();

  updateScheduledPlatformPost('carousel', folderPath, 'x', {
    post_id: tweetId,
    permalink: tweetUrl,
    source_file: path.relative(REPO_ROOT, folderPath),
  });

  return { tweetId, tweetUrl };
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    fs.mkdirSync(SCHEDULED_CAROUSELS_DIR, { recursive: true });
    const folders = fs.readdirSync(SCHEDULED_CAROUSELS_DIR)
      .filter(f => fs.statSync(path.join(SCHEDULED_CAROUSELS_DIR, f)).isDirectory())
      .filter(f => !f.startsWith('.'))
      .sort()
      .reverse();

    if (folders.length === 0) {
      console.error('No output folders found.');
      process.exit(1);
    }

    const nextFolder = folders.find(f => {
      const item = resolveScheduledItem('carousel', path.join(SCHEDULED_CAROUSELS_DIR, f));
      return item && !item.manifest.posts?.x?.permalink;
    });
    if (!nextFolder) {
      console.log('All folders have already been posted to X.');
      process.exit(0);
    }

    console.log('No folder specified, using next unposted (most recent first):');
    console.log(`  ${nextFolder}`);
    console.log();

    postToX(nextFolder);
  } else {
    postToX(args[0]);
  }
}

export { postToX };
