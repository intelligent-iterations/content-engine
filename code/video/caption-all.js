import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { extractDialogues, generateASS } from './add-captions.js';
import { VIDEOS_DIR } from '../core/paths.js';

function getClipDuration(clipPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    clipPath,
  ], { encoding: 'utf-8' });
  return parseFloat(out.trim());
}

function getVideoDimensions(videoPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath,
  ], { encoding: 'utf-8' });
  const [width, height] = out.trim().split('\n')[0].split(',').map(Number);
  return { width, height };
}

function burnASS(assContent, inputVideo, outputVideo) {
  const assPath = outputVideo.replace(/\.mp4$/, '.ass');
  fs.writeFileSync(assPath, assContent);
  const escaped = assPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\''");
  execFileSync('ffmpeg', [
    '-y',
    '-i', inputVideo,
    '-vf', `ass='${escaped}'`,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-c:a', 'copy',
    outputVideo,
  ], { stdio: 'pipe' });
  fs.unlinkSync(assPath);
}

function findClipFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => /^clip\d+-.*\.mp4$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/^clip(\d+)/)[1]);
      const numB = parseInt(b.match(/^clip(\d+)/)[1]);
      return numA - numB;
    });
}

// For a variant like "hook-dmdm-hydantoin.mp4", figure out which clip is first
// then the rest follow in original order
function getVariantClipOrder(hookName, clipFiles) {
  // Find which clip index matches the hook name
  const hookIdx = clipFiles.findIndex(f => {
    const name = f.match(/^clip\d+-(.*?)\.mp4$/)[1];
    return name === hookName;
  });
  if (hookIdx === -1) return null;

  // Hook clip first, then rest in original order
  const order = [hookIdx];
  for (let i = 0; i < clipFiles.length; i++) {
    if (i !== hookIdx) order.push(i);
  }
  return order;
}

// --- Process a single video directory ---

function processVideo(baseName, clipsDir, mdPath, finalVideoPath) {
  if (!fs.existsSync(mdPath) || !fs.existsSync(finalVideoPath)) {
    console.log(`  SKIP (missing md or final): ${baseName}`);
    return { captioned: 0, variants: 0 };
  }

  const clipFiles = findClipFiles(clipsDir);
  if (clipFiles.length === 0) {
    console.log(`  SKIP (no clips): ${baseName}`);
    return { captioned: 0, variants: 0 };
  }

  // Extract dialogues and clip durations
  const dialogues = extractDialogues(mdPath);
  const clipDurations = clipFiles.map(f => getClipDuration(path.join(clipsDir, f)));
  const { width, height } = getVideoDimensions(finalVideoPath);

  let captionedCount = 0;
  let variantCount = 0;

  // 1. Caption the original final video
  const captionedPath = finalVideoPath.replace(/\.mp4$/, '_captioned.mp4');
  if (fs.existsSync(captionedPath)) {
    console.log(`  [skip] Original already captioned`);
  } else {
    console.log(`  [caption] Original...`);
    const assContent = generateASS(dialogues, clipDurations, width, height);
    burnASS(assContent, finalVideoPath, captionedPath);
    captionedCount++;
  }

  // 2. Caption each variant
  const variantsDir = path.join(clipsDir, 'variants');
  if (!fs.existsSync(variantsDir)) {
    return { captioned: captionedCount, variants: 0 };
  }

  const variantFiles = fs.readdirSync(variantsDir)
    .filter(f => f.startsWith('hook-') && f.endsWith('.mp4') && !f.includes('-captioned'));

  for (const variantFile of variantFiles) {
    const captionedVariant = variantFile.replace(/\.mp4$/, '-captioned.mp4');
    const captionedVariantPath = path.join(variantsDir, captionedVariant);

    if (fs.existsSync(captionedVariantPath)) {
      console.log(`  [skip] ${variantFile}`);
      continue;
    }

    // Parse hook name from filename: "hook-dmdm-hydantoin.mp4" → "dmdm-hydantoin"
    const hookName = variantFile.match(/^hook-(.*?)\.mp4$/)[1];
    const clipOrder = getVariantClipOrder(hookName, clipFiles);

    if (!clipOrder) {
      console.log(`  [error] Can't determine clip order for ${variantFile}`);
      continue;
    }

    // Reorder dialogues and durations to match variant
    const reorderedDialogues = clipOrder.map(i => dialogues[i]);
    const reorderedDurations = clipOrder.map(i => clipDurations[i]);

    const assContent = generateASS(reorderedDialogues, reorderedDurations, width, height);
    const variantPath = path.join(variantsDir, variantFile);

    console.log(`  [caption] ${variantFile}...`);
    burnASS(assContent, variantPath, captionedVariantPath);
    variantCount++;
  }

  return { captioned: captionedCount, variants: variantCount };
}

// --- Main ---

function main() {
  console.log('\n=== Captioning All AI Videos ===\n');

  let totalCaptioned = 0;
  let totalVariants = 0;

  const videoDirs = fs.existsSync(VIDEOS_DIR)
    ? fs.readdirSync(VIDEOS_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : [];

  for (const entry of videoDirs) {
    const dir = path.join(VIDEOS_DIR, entry.name);
    const mdPath = path.join(dir, `${entry.name}.md`);
    const finalVideoPath = path.join(dir, `${entry.name}.mp4`);
    const clipsDir = path.join(dir, 'clips');

    console.log(`[${entry.name}]`);
    const result = processVideo(entry.name, clipsDir, mdPath, finalVideoPath);
    totalCaptioned += result.captioned;
    totalVariants += result.variants;
  }

  console.log(`\n=== Done ===`);
  console.log(`Originals captioned: ${totalCaptioned}`);
  console.log(`Variants captioned: ${totalVariants}`);
  console.log(`Total: ${totalCaptioned + totalVariants}`);
}

main();
