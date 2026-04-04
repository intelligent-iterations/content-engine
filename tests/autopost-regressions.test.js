import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

import { processSlideshow } from '../code/crop-for-instagram.js';
import { ROOT_DIR, SCHEDULED_CAROUSELS_DIR } from '../code/core/paths.js';
import { postToX, selectImages } from '../code/posting/post-to-x.js';
import { findPostedStatusUrl, hasTransientComposerError } from '../code/posting/x-browser-post.js';
import { listScheduledItems, resolvePostOutroPath } from '../code/shared/scheduled-queue.js';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeJpeg(filePath, width, height, color = '#7744aa') {
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="${color}" />
      <text x="${Math.floor(width / 2)}" y="${Math.floor(height / 2)}" text-anchor="middle" font-size="48" fill="#ffffff">test</text>
    </svg>
  `);

  await sharp(svg).jpeg({ quality: 80 }).toFile(filePath);
}

test('processSlideshow handles slides that are already 4:5', async () => {
  const tempDir = makeTempDir('content-engine-crop-');

  try {
    await writeJpeg(path.join(tempDir, 'slide_1.jpg'), 1080, 1350);
    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify({
      topic: 'Already 4:5',
      slides: [
        {
          slide_number: 1,
          text_position: 'top',
          text_overlay: 'Hook',
        },
      ],
    }, null, 2));

    await processSlideshow(tempDir);

    const outputPath = path.join(tempDir, 'instagram', 'slide_1.jpg');
    assert.equal(fs.existsSync(outputPath), true);

    const meta = await sharp(outputPath).metadata();
    assert.equal(meta.width, 1080);
    assert.equal(meta.height, 1350);

    const instagramMeta = JSON.parse(fs.readFileSync(path.join(tempDir, 'instagram', 'metadata.json'), 'utf8'));
    assert.equal(instagramMeta.slides[0].instagram_crop.top, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('selectImages falls back to original slides when instagram render exists but is empty', async () => {
  const tempDir = makeTempDir('content-engine-x-images-');

  try {
    fs.mkdirSync(path.join(tempDir, 'instagram'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'metadata.json'), JSON.stringify({
      slides: [
        { slide_number: 1, slide_type: 'hook' },
        { slide_number: 2, slide_type: 'tutorial_step' },
        { slide_number: 3, slide_type: 'tutorial_step' },
        { slide_number: 4, slide_type: 'tutorial_step' },
        { slide_number: 5, slide_type: 'cta' },
      ],
    }, null, 2));

    for (let index = 1; index <= 5; index += 1) {
      await writeJpeg(path.join(tempDir, `slide_${index}.jpg`), 1080, 1920, '#335577');
    }

    const selected = selectImages(tempDir);
    assert.equal(selected.length, 4);
    assert.equal(selected.every(filePath => !filePath.includes('/instagram/')), true);
    assert.equal(selected[0].endsWith('slide_1.jpg'), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('listScheduledItems skips malformed schedule manifests instead of aborting the run', () => {
  const validId = `test-valid-${Date.now()}`;
  const invalidId = `test-invalid-${Date.now()}`;
  const validDir = path.join(SCHEDULED_CAROUSELS_DIR, validId);
  const invalidDir = path.join(SCHEDULED_CAROUSELS_DIR, invalidId);

  fs.mkdirSync(validDir, { recursive: true });
  fs.mkdirSync(invalidDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(validDir, 'schedule.json'), JSON.stringify({
      id: validId,
      type: 'carousel',
      scheduled_at: new Date().toISOString(),
      source: { folder: 'output/carousels/test' },
      assets: {
        folder_path: 'output/scheduled_carousels/test',
        metadata_path: 'output/scheduled_carousels/test/metadata.json',
        slide_files: ['slide_1.jpg'],
      },
      posts: { instagram: null, x: null },
    }, null, 2));
    fs.writeFileSync(path.join(invalidDir, 'schedule.json'), '{');

    const items = listScheduledItems('carousel');
    const ids = new Set(items.map(item => item.manifest.id));

    assert.equal(ids.has(validId), true);
    assert.equal(ids.has(invalidId), false);
  } finally {
    fs.rmSync(validDir, { recursive: true, force: true });
    fs.rmSync(invalidDir, { recursive: true, force: true });
  }
});

test('resolvePostOutroPath keeps relative overrides rooted inside the repo', () => {
  const resolved = resolvePostOutroPath({
    post_defaults: {
      outro_path: 'assets/post/plug.mov',
    },
  });

  assert.equal(resolved, path.join(ROOT_DIR, 'assets/post/plug.mov'));
});

test('hasTransientComposerError detects the X composer retry banner', () => {
  assert.equal(
    hasTransientComposerError('Something went wrong, but don’t fret — let’s give it another shot.'),
    true,
  );
  assert.equal(hasTransientComposerError('All clear.'), false);
});

test('findPostedStatusUrl uses a fresh lookup page instead of navigating the composer page', async () => {
  let composerUrl = 'https://x.com/compose/post';
  let lookupClosed = false;
  let gotoUrl = '';

  const lookupPage = {
    async goto(url) {
      gotoUrl = url;
    },
    async waitForTimeout() {},
    async evaluate() {
      return 'https://x.com/videogens/status/123';
    },
    async close() {
      lookupClosed = true;
    },
  };

  const page = {
    url() {
      return composerUrl;
    },
    context() {
      return {
        async newPage() {
          return lookupPage;
        },
      };
    },
  };

  const result = await findPostedStatusUrl(page, 'videogens', 'hello world');
  assert.equal(result, 'https://x.com/videogens/status/123');
  assert.equal(gotoUrl, 'https://x.com/videogens');
  assert.equal(page.url(), composerUrl);
  assert.equal(lookupClosed, true);
});

test('postToX is exported for runtime use', () => {
  assert.equal(typeof postToX, 'function');
});
