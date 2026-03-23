/**
 * Crop 9:16 TikTok slideshows to 4:5 Instagram format
 * Aligns text to rule of thirds lines based on original text_position
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CAROUSELS_DIR, SCHEDULED_CAROUSELS_DIR } from './core/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dimensions
const TIKTOK_WIDTH = 1080;
const TIKTOK_HEIGHT = 1920;
const INSTAGRAM_WIDTH = 1080;
const INSTAGRAM_HEIGHT = 1350;

// Height to crop
const CROP_AMOUNT = TIKTOK_HEIGHT - INSTAGRAM_HEIGHT; // 570px

// Original text Y positions (from add-text-overlay.js SAFE_ZONES)
const TEXT_POSITIONS = {
  top: 650,
  center: 900,
  'bottom-safe': 1150
};

// Rule of thirds lines in 4:5 format
const RULE_OF_THIRDS = {
  upper: INSTAGRAM_HEIGHT / 3,      // 450
  lower: (INSTAGRAM_HEIGHT / 3) * 2  // 900
};

/**
 * Calculate crop coordinates to align text to rule of thirds
 * @param {string} textPosition - 'top', 'center', or 'bottom-safe'
 * @returns {object} - { top, left, width, height } for sharp extract
 */
function calculateCrop(textPosition) {
  const originalY = TEXT_POSITIONS[textPosition] || TEXT_POSITIONS.top;

  // Determine which rule of thirds line to target
  let targetY;
  let topCrop;

  // For top/center text, aim for upper third line
  // For bottom-safe text, aim for lower third line
  if (textPosition === 'bottom-safe') {
    targetY = RULE_OF_THIRDS.lower; // 900
    topCrop = originalY - targetY;   // 1150 - 900 = 250
  } else if (textPosition === 'center') {
    // Center could go either way - let's put it on upper third for more breathing room below
    targetY = RULE_OF_THIRDS.upper; // 450
    topCrop = originalY - targetY;   // 900 - 450 = 450
  } else {
    // top position
    targetY = RULE_OF_THIRDS.upper; // 450
    topCrop = originalY - targetY;   // 650 - 450 = 200
  }

  // Clamp topCrop to valid range [0, CROP_AMOUNT]
  topCrop = Math.max(0, Math.min(CROP_AMOUNT, topCrop));

  return {
    left: 0,
    top: topCrop,
    width: INSTAGRAM_WIDTH,
    height: INSTAGRAM_HEIGHT
  };
}

/**
 * Crop a single image for Instagram
 * @param {string} inputPath - Path to original image
 * @param {string} outputPath - Path for cropped output
 * @param {string} textPosition - Text position from metadata
 */
async function cropImage(inputPath, outputPath, textPosition) {
  const crop = calculateCrop(textPosition);

  await sharp(inputPath)
    .extract(crop)
    .toFile(outputPath);

  return crop;
}

/**
 * Process a slideshow folder
 * @param {string} folderPath - Path to slideshow output folder
 */
async function processSlideshow(folderPath) {
  const metadataPath = path.join(folderPath, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    console.error(`No metadata.json found in ${folderPath}`);
    return;
  }

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

  // Create instagram subfolder
  const instagramFolder = path.join(folderPath, 'instagram');
  if (!fs.existsSync(instagramFolder)) {
    fs.mkdirSync(instagramFolder, { recursive: true });
  }

  console.log(`\nProcessing: ${metadata.topic}`);
  console.log(`Output: ${instagramFolder}`);

  // Process each slide
  for (const slide of metadata.slides) {
    const slideNum = slide.slide_number;

    // Determine file extension (screenshots are png, others are jpg)
    const isScreenshot = slide.has_screenshot === true &&
                         fs.existsSync(path.join(folderPath, `slide_${slideNum}.png`));

    // Actually, let's check what files exist
    let inputFile;
    let outputFile;

    if (fs.existsSync(path.join(folderPath, `slide_${slideNum}.png`))) {
      inputFile = path.join(folderPath, `slide_${slideNum}.png`);
      outputFile = path.join(instagramFolder, `slide_${slideNum}.png`);
    } else if (fs.existsSync(path.join(folderPath, `slide_${slideNum}.jpg`))) {
      inputFile = path.join(folderPath, `slide_${slideNum}.jpg`);
      outputFile = path.join(instagramFolder, `slide_${slideNum}.jpg`);
    } else {
      console.log(`  Slide ${slideNum}: file not found, skipping`);
      continue;
    }

    // Get text position (screenshots don't have text overlay, use center crop)
    const textPosition = slide.text_position || 'top';
    const isScreenshotSlide = inputFile.endsWith('.png') && !slide.text_overlay;

    // For screenshots (no text), do a centered crop
    let crop;
    if (isScreenshotSlide) {
      // Center crop for screenshots
      const topCrop = Math.floor(CROP_AMOUNT / 2); // 285px from top and bottom
      crop = {
        left: 0,
        top: topCrop,
        width: INSTAGRAM_WIDTH,
        height: INSTAGRAM_HEIGHT
      };

      await sharp(inputFile)
        .extract(crop)
        .toFile(outputFile);
    } else {
      crop = await cropImage(inputFile, outputFile, textPosition);
    }

    console.log(`  Slide ${slideNum}: ${textPosition || 'screenshot'} → crop top ${crop.top}px`);
  }

  // Also copy metadata with crop info
  const instagramMetadata = {
    ...metadata,
    format: 'instagram_4x5',
    original_format: 'tiktok_9x16',
    slides: metadata.slides.map(slide => {
      const textPosition = slide.text_position || 'top';
      const isScreenshot = !slide.text_overlay;
      const crop = isScreenshot
        ? { top: Math.floor(CROP_AMOUNT / 2) }
        : calculateCrop(textPosition);

      return {
        ...slide,
        instagram_crop: {
          top: crop.top,
          bottom: CROP_AMOUNT - crop.top,
          text_aligned_to: isScreenshot ? 'center' : (textPosition === 'bottom-safe' ? 'lower_third' : 'upper_third')
        }
      };
    })
  };

  fs.writeFileSync(
    path.join(instagramFolder, 'metadata.json'),
    JSON.stringify(instagramMetadata, null, 2)
  );
  console.log(`  Saved: metadata.json`);

  return instagramFolder;
}

/**
 * Process multiple slideshow folders
 * @param {string[]} folderPaths - Array of folder paths
 */
async function processMultiple(folderPaths) {
  console.log('='.repeat(50));
  console.log('  Instagram 4:5 Crop Tool');
  console.log('  Rule of Thirds Text Alignment');
  console.log('='.repeat(50));

  for (const folderPath of folderPaths) {
    await processSlideshow(folderPath);
  }

  console.log('\n' + '='.repeat(50));
  console.log('  Done!');
  console.log('='.repeat(50));
}

// CLI usage
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // If no args, process most recent folders
    const folders = fs.readdirSync(CAROUSELS_DIR)
      .filter(f => fs.statSync(path.join(CAROUSELS_DIR, f)).isDirectory())
      .filter(f => !f.startsWith('.'))
      .sort()
      .reverse()
      .slice(0, 3); // Last 3 folders

    console.log('No folders specified, processing 3 most recent:');
    folders.forEach(f => console.log(`  - ${f}`));

    const folderPaths = folders.map(f => path.join(CAROUSELS_DIR, f));
    processMultiple(folderPaths);
  } else if (args[0] === '--all') {
    // Process all folders
    const folders = fs.readdirSync(CAROUSELS_DIR)
      .filter(f => fs.statSync(path.join(CAROUSELS_DIR, f)).isDirectory())
      .filter(f => !f.startsWith('.'))
      .filter(f => {
        // Only process folders that have metadata.json but no instagram/ subfolder yet
        const hasMetadata = fs.existsSync(path.join(CAROUSELS_DIR, f, 'metadata.json'));
        const hasInstagram = fs.existsSync(path.join(CAROUSELS_DIR, f, 'instagram'));
        return hasMetadata && !hasInstagram;
      });

    console.log(`Processing ${folders.length} folders without instagram/ subfolder`);

    const folderPaths = folders.map(f => path.join(CAROUSELS_DIR, f));
    processMultiple(folderPaths);
  } else {
    // Process specified folders
    const folderPaths = args.map(arg => {
      if (path.isAbsolute(arg)) return arg;
      const scheduledPath = path.join(SCHEDULED_CAROUSELS_DIR, arg);
      if (fs.existsSync(scheduledPath)) return scheduledPath;
      return path.join(CAROUSELS_DIR, arg);
    });

    processMultiple(folderPaths);
  }
}

export { processSlideshow, processMultiple, calculateCrop };
