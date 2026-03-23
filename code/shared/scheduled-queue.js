import fs from 'fs';
import path from 'path';
import {
  CAROUSELS_DIR,
  ROOT_DIR,
  SCHEDULED_CAROUSELS_DIR,
  SCHEDULED_VIDEOS_DIR,
  VIDEOS_DIR,
} from '../core/paths.js';

const SCHEDULE_FILE = 'schedule.json';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeSlug(value, fallback) {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

  return normalized || fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function relativeToRepo(filePath) {
  return path.relative(ROOT_DIR, filePath);
}

function scheduleRoot(type) {
  return type === 'video' ? SCHEDULED_VIDEOS_DIR : SCHEDULED_CAROUSELS_DIR;
}

function defaultPlatforms(type) {
  return type === 'video'
    ? { tiktok: null, instagram: null, x: null }
    : { instagram: null, x: null };
}

function loadManifestFromDir(itemDir) {
  const manifestPath = path.join(itemDir, SCHEDULE_FILE);
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  const manifest = readJson(manifestPath);
  return {
    dir: itemDir,
    manifestPath,
    manifest,
  };
}

export function listScheduledItems(type) {
  const rootDir = scheduleRoot(type);
  ensureDir(rootDir);

  return fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => loadManifestFromDir(path.join(rootDir, entry.name)))
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = a.manifest.scheduled_at || '';
      const bTime = b.manifest.scheduled_at || '';
      return aTime.localeCompare(bTime);
    });
}

export function resolveScheduledItem(type, idOrPath) {
  if (path.isAbsolute(idOrPath)) {
    return loadManifestFromDir(idOrPath);
  }

  const direct = path.join(scheduleRoot(type), idOrPath);
  if (fs.existsSync(direct)) {
    return loadManifestFromDir(direct);
  }

  return null;
}

export function updateScheduledPlatformPost(type, itemDir, platform, details) {
  const item = loadManifestFromDir(itemDir);
  if (!item) {
    throw new Error(`Missing scheduled manifest in ${itemDir}`);
  }

  item.manifest.posts = item.manifest.posts || defaultPlatforms(type);
  item.manifest.posts[platform] = {
    ...details,
    platform,
    posted_at: details.posted_at || new Date().toISOString(),
  };

  writeJson(item.manifestPath, item.manifest);
  return item.manifest;
}

function detectVideoAssets(sourceDir) {
  const baseName = path.basename(sourceDir);
  const videoPath = path.join(sourceDir, `${baseName}.mp4`);
  const captionPath = path.join(sourceDir, `${baseName}_caption.txt`);
  const mdPath = path.join(sourceDir, `${baseName}.md`);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  return {
    baseName,
    videoPath,
    captionPath: fs.existsSync(captionPath) ? captionPath : null,
    mdPath: fs.existsSync(mdPath) ? mdPath : null,
  };
}

function copyFileIfPresent(fromPath, toPath) {
  if (fromPath && fs.existsSync(fromPath)) {
    fs.copyFileSync(fromPath, toPath);
  }
}

export function scheduleVideo(sourceDir, options = {}) {
  const resolvedSource = path.resolve(sourceDir);
  const assets = detectVideoAssets(resolvedSource);
  const slug = safeSlug(options.slug || assets.baseName, assets.baseName);
  const targetDir = path.join(SCHEDULED_VIDEOS_DIR, slug);
  ensureDir(targetDir);

  const targetVideoPath = path.join(targetDir, `${slug}.mp4`);
  const targetCaptionPath = path.join(targetDir, `${slug}_caption.txt`);
  const targetMdPath = path.join(targetDir, `${slug}.md`);

  fs.copyFileSync(assets.videoPath, targetVideoPath);
  copyFileIfPresent(assets.captionPath, targetCaptionPath);
  copyFileIfPresent(assets.mdPath, targetMdPath);

  const manifest = {
    id: slug,
    type: 'video',
    scheduled_at: new Date().toISOString(),
    source: {
      folder: relativeToRepo(resolvedSource),
    },
    assets: {
      video_path: relativeToRepo(targetVideoPath),
      caption_path: fs.existsSync(targetCaptionPath) ? relativeToRepo(targetCaptionPath) : null,
      compilation_path: fs.existsSync(targetMdPath) ? relativeToRepo(targetMdPath) : null,
    },
    posts: defaultPlatforms('video'),
  };

  writeJson(path.join(targetDir, SCHEDULE_FILE), manifest);
  return { targetDir, manifest };
}

export function scheduleCarousel(sourceDir, options = {}) {
  const resolvedSource = path.resolve(sourceDir);
  const slug = safeSlug(options.slug || path.basename(resolvedSource), path.basename(resolvedSource));
  const targetDir = path.join(SCHEDULED_CAROUSELS_DIR, slug);

  ensureDir(SCHEDULED_CAROUSELS_DIR);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(resolvedSource, targetDir, { recursive: true });

  const metadataPath = path.join(targetDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Carousel metadata not found after copy: ${metadataPath}`);
  }

  const slideFiles = fs.readdirSync(targetDir)
    .filter(name => /^slide_\d+\.(jpg|png)$/i.test(name))
    .sort();

  const manifest = {
    id: slug,
    type: 'carousel',
    scheduled_at: new Date().toISOString(),
    source: {
      folder: relativeToRepo(resolvedSource),
    },
    assets: {
      folder_path: relativeToRepo(targetDir),
      metadata_path: relativeToRepo(metadataPath),
      slide_files: slideFiles,
    },
    posts: defaultPlatforms('carousel'),
  };

  writeJson(path.join(targetDir, SCHEDULE_FILE), manifest);
  return { targetDir, manifest };
}

export function resolveGeneratedVideoDir(input) {
  if (path.isAbsolute(input)) {
    return input;
  }
  const candidates = [
    path.join(VIDEOS_DIR, input),
    path.join(process.cwd(), input),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

export function resolveGeneratedCarouselDir(input) {
  if (path.isAbsolute(input)) {
    return input;
  }
  const candidates = [
    path.join(CAROUSELS_DIR, input),
    path.join(process.cwd(), input),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}
