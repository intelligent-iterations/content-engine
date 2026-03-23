import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { VIDEOS_DIR } from '../core/paths.js';

// --- Find clip files in a video directory ---

function findClips(videoDir) {
  const files = fs.readdirSync(videoDir)
    .filter(f => /^clip\d+-.*\.mp4$/.test(f) && !f.includes('.tmp'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/^clip(\d+)/)[1]);
      const numB = parseInt(b.match(/^clip(\d+)/)[1]);
      return numA - numB;
    });

  return files.map(f => ({
    filename: f,
    path: path.join(videoDir, f),
    index: parseInt(f.match(/^clip(\d+)/)[1]),
    name: f.match(/^clip\d+-(.*?)\.mp4$/)[1],
  }));
}

// --- Stitch clips in given order ---

function stitchClips(clipPaths, outputPath) {
  const listFile = outputPath + '.concat.txt';
  const listContent = clipPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(listFile, listContent);

  execFileSync('ffmpeg', [
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    outputPath,
    '-y',
  ], { stdio: 'pipe' });

  fs.unlinkSync(listFile);
}

// --- Generate hook variants (each clip rotated to position 1) ---

function generateHookVariants(clips) {
  const variants = [];
  for (let i = 0; i < clips.length; i++) {
    const hookClip = clips[i];
    const rest = clips.filter((_, idx) => idx !== i);
    const order = [hookClip, ...rest];
    variants.push({
      label: `hook-${hookClip.name}`,
      hookName: hookClip.name,
      description: `Hook: ${hookClip.name} → ${rest.map(c => c.name).join(' → ')}`,
      order,
    });
  }
  return variants;
}

// --- Build variants for a single video directory, output to variants/ ---

function buildVariants(videoDir) {
  const clips = findClips(videoDir);
  if (clips.length === 0) return { dir: videoDir, variants: [], error: 'no clips' };

  const variantsDir = path.join(videoDir, 'variants');
  fs.mkdirSync(variantsDir, { recursive: true });

  const variants = generateHookVariants(clips);
  const results = [];

  for (const variant of variants) {
    const outputPath = path.join(variantsDir, `${variant.label}.mp4`);

    if (fs.existsSync(outputPath)) {
      results.push({ ...variant, path: outputPath, skipped: true });
      continue;
    }

    try {
      stitchClips(variant.order.map(c => c.path), outputPath);
      results.push({ ...variant, path: outputPath, skipped: false });
    } catch (err) {
      console.error(`  [error] ${variant.label}: ${err.message}`);
    }
  }

  return { dir: videoDir, variants: results };
}

// --- Find all video directories with clips ---

function findAllVideoDirs() {
  return fs.readdirSync(VIDEOS_DIR)
    .filter(d => {
      const fullPath = path.join(VIDEOS_DIR, d);
      if (!fs.statSync(fullPath).isDirectory()) return false;
      if (d === 'variants') return false;
      // Must contain clip files
      return fs.readdirSync(fullPath).some(f => /^clip\d+-.*\.mp4$/.test(f));
    })
    .sort()
    .map(d => path.join(VIDEOS_DIR, d));
}

// --- Parse CLI args ---

function parseArgs(args) {
  const opts = { videoDir: null, mode: null, order: null, listOnly: false, all: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--hooks') {
      opts.mode = 'hooks';
    } else if (args[i] === '--all') {
      opts.all = true;
      opts.mode = 'hooks';
    } else if (args[i] === '--order' && args[i + 1]) {
      opts.mode = 'custom';
      opts.order = args[++i];
    } else if (args[i] === '--list') {
      opts.listOnly = true;
    } else if (!args[i].startsWith('--')) {
      opts.videoDir = args[i];
    }
  }

  return opts;
}

// --- Main ---

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.all) {
    // Batch mode: generate hook variants for ALL video directories
    const dirs = findAllVideoDirs();
    console.log(`\n=== Generating hook variants for ${dirs.length} videos ===\n`);

    let totalGenerated = 0;
    let totalSkipped = 0;

    for (const dir of dirs) {
      const dirName = path.basename(dir);
      const clips = findClips(dir);
      console.log(`[${dirName}] ${clips.length} clips`);

      const result = buildVariants(dir);
      const generated = result.variants.filter(v => !v.skipped).length;
      const skipped = result.variants.filter(v => v.skipped).length;
      totalGenerated += generated;
      totalSkipped += skipped;

      for (const v of result.variants) {
        const status = v.skipped ? 'skip' : 'ok';
        console.log(`  [${status}] ${v.label}.mp4`);
      }
    }

    console.log(`\n=== Done ===`);
    console.log(`Generated: ${totalGenerated}`);
    console.log(`Skipped:   ${totalSkipped}`);
    console.log(`Total:     ${totalGenerated + totalSkipped} variants across ${dirs.length} videos`);
    return;
  }

  if (!opts.videoDir) {
    console.error(`Usage: node code/video/reorder-clips.js <video-dir> [--hooks] [--list]
       node code/video/reorder-clips.js --all

Modes:
  --hooks     Create hook variants (each clip as first) into variants/ subfolder
  --all       Generate hook variants for ALL video directories
  --order     Custom reorder by clip numbers (e.g. "3,1,5,2,4,6")
  --list      Just list the clips without generating anything

Examples:
  node code/video/reorder-clips.js --all
  node code/video/reorder-clips.js output/videos/cosmetics-villains-the-most-common-preservatives-h-2026-02-09 --hooks
  node code/video/reorder-clips.js output/videos/cosmetics-villains-the-most-common-preservatives-h-2026-02-09 --list
`);
    process.exit(1);
  }

  // Single directory mode
  let videoDir = opts.videoDir;
  if (!path.isAbsolute(videoDir)) {
    videoDir = path.resolve(videoDir);
  }

  if (!fs.existsSync(videoDir) || !fs.statSync(videoDir).isDirectory()) {
    console.error(`Not a directory: ${videoDir}`);
    process.exit(1);
  }

  const clips = findClips(videoDir);
  if (clips.length === 0) {
    console.error(`No clips found in ${videoDir}`);
    process.exit(1);
  }

  console.log(`\nFound ${clips.length} clips in ${path.basename(videoDir)}:\n`);
  for (const clip of clips) {
    console.log(`  ${clip.index}. ${clip.name} (${clip.filename})`);
  }

  if (opts.listOnly) return;

  if (!opts.mode) {
    console.log('\nUse --hooks or --order to generate variants.');
    return;
  }

  if (opts.mode === 'hooks') {
    const result = buildVariants(videoDir);
    console.log(`\nGenerated ${result.variants.length} hook variants in variants/\n`);
    for (const v of result.variants) {
      console.log(`  [${v.skipped ? 'skip' : 'ok'}] ${v.label}.mp4 — ${v.description}`);
    }
  } else if (opts.mode === 'custom') {
    const indices = opts.order.split(',').map(s => parseInt(s.trim()));
    const order = indices.map(i => {
      const clip = clips.find(c => c.index === i);
      if (!clip) throw new Error(`No clip with index ${i}`);
      return clip;
    });
    const label = `custom-${indices.join('-')}`;
    const variantsDir = path.join(videoDir, 'variants');
    fs.mkdirSync(variantsDir, { recursive: true });
    const outputPath = path.join(variantsDir, `${label}.mp4`);
    stitchClips(order.map(c => c.path), outputPath);
    console.log(`\nGenerated: ${outputPath}`);
  }
}

main();
