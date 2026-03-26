/**
 * Auto-post to Instagram
 *
 * Picks a TikTok carousel that hasn't been posted to Instagram yet,
 * crops it, and posts it.
 *
 * Usage:
 *   node code/posting/auto-post-instagram.js
 *
 * Intended for local scheduling via launchd or another scheduler, or manual invocation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { processSlideshow } from '../crop-for-instagram.js';
import { postToInstagram } from './post-to-instagram.js';
import { listScheduledItems } from '../shared/scheduled-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getUnpostedFolders() {
  const items = listScheduledItems('carousel');
  const unposted = items.filter(item => !item.manifest.posts?.instagram?.permalink);
  console.log(`Scheduled carousels: ${items.length}`);
  console.log(`Unposted to Instagram: ${unposted.length}`);
  return unposted;
}

/**
 * Check if a folder exists and has slides
 */
function isValidFolder(folderName) {
  const folderPath = typeof folderName === 'string' ? folderName : folderName.dir;

  if (!fs.existsSync(folderPath)) {
    return false;
  }

  // Check for metadata.json
  if (!fs.existsSync(path.join(folderPath, 'metadata.json'))) {
    return false;
  }

  // Check for at least one slide
  const files = fs.readdirSync(folderPath);
  const hasSlides = files.some(f => f.startsWith('slide_'));

  return hasSlides;
}

/**
 * Main auto-post function
 */
async function autoPostToInstagram() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(50));
  console.log('  Instagram Auto-Poster');
  console.log('  ' + new Date().toISOString());
  if (dryRun) console.log('  ** DRY RUN **');
  console.log('='.repeat(50));
  console.log();

  // Get unposted folders
  const unposted = getUnpostedFolders();

  if (unposted.length === 0) {
    console.log('No unposted TikTok carousels available!');
    console.log('Generate more content or wait for new TikTok posts.');
    return { success: false, reason: 'no_unposted_content' };
  }

  // Find first valid folder
  let selectedFolder = null;
  for (const folder of unposted) {
    if (isValidFolder(folder)) {
      selectedFolder = folder;
      break;
    } else {
      console.log(`Skipping invalid folder: ${folder}`);
    }
  }

  if (!selectedFolder) {
    console.log('No valid folders found!');
    return { success: false, reason: 'no_valid_folders' };
  }

  console.log(`Selected: ${selectedFolder.manifest.id}`);
  console.log();

  if (dryRun) {
    console.log(`[dry-run] Would post carousel folder: ${selectedFolder.dir}`);
    return { success: true, dryRun: true, folder: selectedFolder.manifest.id };
  }

  const folderPath = selectedFolder.dir;

  // Check if already cropped for Instagram
  const instagramFolder = path.join(folderPath, 'instagram');
  if (!fs.existsSync(instagramFolder)) {
    console.log('Cropping for Instagram...');
    await processSlideshow(folderPath);
    console.log();
  } else {
    console.log('Already cropped for Instagram');
  }

  // Post to Instagram
  console.log('Posting to Instagram...');
  const result = await postToInstagram(folderPath);

  return {
    success: true,
    folder: selectedFolder.manifest.id,
    postId: result.postId,
    postUrl: result.postUrl
  };
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  autoPostToInstagram()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Auto-post complete!');
        console.log(`URL: ${result.postUrl}`);
      } else {
        console.log(`\n⚠️ No post made: ${result.reason}`);
      }
    })
    .catch(err => {
      console.error('\n❌ Error:', err.message);
      process.exit(1);
    });
}

export { autoPostToInstagram, getUnpostedFolders };
