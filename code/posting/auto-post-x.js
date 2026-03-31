/**
 * Auto-post to X (Twitter)
 *
 * Picks an Instagram-posted carousel that hasn't been posted to X yet
 * and posts it with a Grok-generated caption.
 *
 * Usage:
 *   node code/posting/auto-post-x.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { postToX } from './post-to-x.js';
import { listScheduledItems } from '../shared/scheduled-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getUnpostedFolders() {
  const items = listScheduledItems('carousel');
  const unposted = items.filter(item => !item.manifest.posts?.x?.permalink);
  console.log(`Scheduled carousels: ${items.length}`);
  console.log(`Unposted to X: ${unposted.length}`);
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

  if (!fs.existsSync(path.join(folderPath, 'metadata.json'))) {
    return false;
  }

  const files = fs.readdirSync(folderPath);
  const hasSlides = files.some(f => f.startsWith('slide_'));

  return hasSlides;
}

/**
 * Main auto-post function
 */
async function autoPostToX() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(50));
  console.log('  X (Twitter) Auto-Poster');
  console.log('  ' + new Date().toISOString());
  if (dryRun) console.log('  ** DRY RUN **');
  console.log('='.repeat(50));
  console.log();

  const unposted = getUnpostedFolders();

  if (unposted.length === 0) {
    console.log('No unposted Instagram carousels available!');
    console.log('Post more content to Instagram first.');
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

  // Post to X
  console.log('Posting to X...');
  const result = await postToX(selectedFolder.dir);

  return {
    success: true,
    folder: selectedFolder.manifest.id,
    tweetId: result.tweetId,
    tweetUrl: result.tweetUrl
  };
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  autoPostToX()
    .then(result => {
      if (result.success) {
        console.log('\nAuto-post complete!');
        console.log(`URL: ${result.tweetUrl}`);
      } else {
        console.log(`\nNo post made: ${result.reason}`);
      }
    })
    .catch(err => {
      console.error('\nError:', err.message);
      process.exit(1);
    });
}

export { autoPostToX, getUnpostedFolders };
