/**
 * Post carousel or single media to Instagram.
 * Uses Playwright browser automation (same as reel posting).
 *
 * Usage:
 *   node code/posting/post-to-instagram.js <folder-path>
 *   node code/posting/post-to-instagram.js scheduled-carousel-slug
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { II_ROOT, SCHEDULED_CAROUSELS_DIR } from '../core/paths.js';
import { resolveScheduledItem, updateScheduledPlatformPost } from '../shared/scheduled-queue.js';
import { postToInstagramViaBrowser } from './instagram-browser-post.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
dotenv.config({ path: path.join(REPO_ROOT, '.env') });

function resolveFolderPath(folderPath) {
  if (path.isAbsolute(folderPath)) return folderPath;
  return path.join(SCHEDULED_CAROUSELS_DIR, folderPath);
}

function collectSlideFiles(imageFolder) {
  return fs.readdirSync(imageFolder)
    .filter(f => f.startsWith('slide_') && (f.endsWith('.jpg') || f.endsWith('.png')))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide_(\d+)/)[1], 10);
      const numB = parseInt(b.match(/slide_(\d+)/)[1], 10);
      return numA - numB;
    });
}

function buildCaption(metadata) {
  const hashtags = '\n\n' + (metadata.hashtags || []).map(h => `#${h}`).join(' ');
  const maxCaptionLength = 2200 - hashtags.length;
  let captionText = metadata.caption || '';

  if (captionText.length > maxCaptionLength) {
    captionText = captionText.substring(0, maxCaptionLength - 3);
    const lastPeriod = captionText.lastIndexOf('.');
    const lastQuestion = captionText.lastIndexOf('?');
    const lastExclaim = captionText.lastIndexOf('!');
    const lastSentence = Math.max(lastPeriod, lastQuestion, lastExclaim);
    if (lastSentence > maxCaptionLength * 0.7) {
      captionText = captionText.substring(0, lastSentence + 1);
    } else {
      captionText += '...';
    }
  }

  return (captionText + hashtags).trim();
}

async function postViaBrowser({ caption, mediaPaths, mediaType }) {
  const result = await postToInstagramViaBrowser({
    caption,
    mediaType,
    mediaPaths,
    headless: true,
  });

  const postId = (result.postUrl || '').split('/').filter(Boolean).pop() || `instagram-${Date.now()}`;
  return {
    postId,
    postUrl: result.postUrl,
    method: result.method || 'browser_cookies',
  };
}

async function postToInstagram(folderPath) {
  const resolvedFolder = resolveFolderPath(folderPath);
  const scheduledItem = resolveScheduledItem('carousel', resolvedFolder);
  const instagramFolder = path.join(resolvedFolder, 'instagram');
  const imageFolder = fs.existsSync(instagramFolder) ? instagramFolder : resolvedFolder;
  const metadataPath = path.join(resolvedFolder, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`No metadata.json found in ${resolvedFolder}`);
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
  const folderName = path.basename(resolvedFolder);

  if (!scheduledItem) {
    throw new Error(`Missing scheduled carousel manifest in ${resolvedFolder}`);
  }

  if (scheduledItem.manifest.posts?.instagram?.permalink) {
    throw new Error(`This folder has already been posted to Instagram: ${folderName}`);
  }

  const slideFiles = collectSlideFiles(imageFolder);
  if (slideFiles.length === 0) {
    throw new Error(`No slide images found in ${imageFolder}`);
  }

  const mediaPaths = slideFiles.map(file => path.join(imageFolder, file));
  const caption = buildCaption(metadata);

  console.log('='.repeat(50));
  console.log('  Instagram Poster');
  console.log('='.repeat(50));
  console.log(`Topic: ${metadata.topic}`);
  console.log(`Folder: ${folderName}`);
  console.log(`Slides: ${mediaPaths.length}`);
  console.log();

  let result;
  const isCarousel = mediaPaths.length > 1;

  console.log(`Using Playwright browser automation for ${isCarousel ? 'carousel' : 'single image'}...\n`);
  result = await postViaBrowser({ caption, mediaPaths, mediaType: isCarousel ? 'carousel' : 'image' });

  updateScheduledPlatformPost('carousel', resolvedFolder, 'instagram', {
    post_id: result.postId,
    permalink: result.postUrl,
    source_file: path.relative(II_ROOT, resolvedFolder),
  });

  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  const run = async () => {
    if (args.length === 0) {
      fs.mkdirSync(SCHEDULED_CAROUSELS_DIR, { recursive: true });
      const folders = fs.readdirSync(SCHEDULED_CAROUSELS_DIR)
        .filter(f => fs.statSync(path.join(SCHEDULED_CAROUSELS_DIR, f)).isDirectory())
        .filter(f => !f.startsWith('.'))
        .sort()
        .reverse();

      const nextFolder = folders.find(f => {
        const item = resolveScheduledItem('carousel', path.join(SCHEDULED_CAROUSELS_DIR, f));
        return item && !item.manifest.posts?.instagram?.permalink;
      });
      if (!nextFolder) {
        console.log('All folders have already been posted to Instagram.');
        return;
      }
      const result = await postToInstagram(nextFolder);
      console.log(`Posted: ${result.postUrl}`);
      return;
    }

    const result = await postToInstagram(args[0]);
    console.log(`Posted: ${result.postUrl}`);
  };

  run().catch(error => {
    console.error(`Instagram post failed: ${error.message}`);
    process.exit(1);
  });
}

export { postToInstagram };
