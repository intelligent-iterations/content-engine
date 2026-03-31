import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import {
  CAROUSELS_DIR,
  POSTED_VIDEOS_DIR,
  ROOT_DIR,
  SCHEDULED_CAROUSELS_DIR,
  SCHEDULED_VIDEOS_DIR,
  VIDEOS_DIR,
} from '../core/paths.js';
import {
  DEFAULT_POST_PROMO_LINE,
  normalizeCaptionForPosting,
} from './post-promo.js';

const SCHEDULE_FILE = 'schedule.json';
const DEFAULT_POST_OUTRO_PATH = '/Users/admin/Documents/plug.mov';
const DEFAULT_RETRY_DELAY_MS = 15 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

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

function isoNow() {
  return new Date().toISOString();
}

function rewriteRelativePathPrefix(value, fromPrefix, toPrefix) {
  const normalized = String(value || '');
  if (!normalized || !normalized.startsWith(fromPrefix)) {
    return value;
  }
  return `${toPrefix}${normalized.slice(fromPrefix.length)}`;
}

function manifestPlatformsForType(type, manifest) {
  const fallback = defaultPlatforms(type);
  const posts = manifest?.posts || fallback;
  return Object.keys(posts);
}

function defaultQueueState(type, manifest = {}) {
  const queuedAt = manifest.scheduled_at || isoNow();
  const platformStates = {};

  for (const platform of manifestPlatformsForType(type, manifest)) {
    platformStates[platform] = {
      status: manifest?.posts?.[platform]?.permalink ? 'posted' : 'queued',
      queued_at: queuedAt,
      last_attempt_at: null,
      next_attempt_at: queuedAt,
      retry_count: 0,
      last_error: null,
      prepared_video_path: null,
    };
  }

  return {
    overall: {
      status: isManifestFullyPosted(type, manifest) ? 'posted' : 'queued',
      queued_at: queuedAt,
      last_prepared_at: null,
    },
    platforms: platformStates,
  };
}

function ensureQueueState(type, manifest) {
  const fallback = defaultQueueState(type, manifest);
  let changed = false;

  manifest.queue = manifest.queue && typeof manifest.queue === 'object'
    ? manifest.queue
    : {};

  if (!manifest.queue.overall || typeof manifest.queue.overall !== 'object') {
    manifest.queue.overall = fallback.overall;
    changed = true;
  } else {
    for (const [key, value] of Object.entries(fallback.overall)) {
      if (manifest.queue.overall[key] == null) {
        manifest.queue.overall[key] = value;
        changed = true;
      }
    }
  }

  manifest.queue.platforms = manifest.queue.platforms && typeof manifest.queue.platforms === 'object'
    ? manifest.queue.platforms
    : {};

  for (const [platform, state] of Object.entries(fallback.platforms)) {
    if (!manifest.queue.platforms[platform] || typeof manifest.queue.platforms[platform] !== 'object') {
      manifest.queue.platforms[platform] = state;
      changed = true;
      continue;
    }

    for (const [key, value] of Object.entries(state)) {
      if (manifest.queue.platforms[platform][key] == null) {
        manifest.queue.platforms[platform][key] = value;
        changed = true;
      }
    }
  }

  return changed;
}

function ensureScheduledManifestDefaults(type, manifest) {
  let changed = ensureQueueState(type, manifest);

  manifest.post_defaults = manifest.post_defaults && typeof manifest.post_defaults === 'object'
    ? manifest.post_defaults
    : {};

  const expectedPostDefaults = {
    promo_line: DEFAULT_POST_PROMO_LINE,
    outro_path: DEFAULT_POST_OUTRO_PATH,
    append_outro_before_post: true,
  };

  for (const [key, value] of Object.entries(expectedPostDefaults)) {
    if (manifest.post_defaults[key] == null) {
      manifest.post_defaults[key] = value;
      changed = true;
    }
  }

  if (type === 'video') {
    manifest.assets = manifest.assets && typeof manifest.assets === 'object' ? manifest.assets : {};
    if (!manifest.assets.raw_video_path && manifest.assets.video_path) {
      manifest.assets.raw_video_path = manifest.assets.video_path;
      changed = true;
    }
  }

  return changed;
}

function retryDelayMs(retryCount) {
  return Math.min(MAX_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS * Math.max(1, 2 ** Math.max(0, retryCount - 1)));
}

function platformQueueState(manifest, platform) {
  return manifest?.queue?.platforms?.[platform] || null;
}

function isPlatformReady(type, manifest, platform) {
  if (manifest?.posts?.[platform]?.permalink) {
    return false;
  }

  const state = platformQueueState(manifest, platform) || defaultQueueState(type, manifest).platforms[platform];
  const nextAttempt = state?.next_attempt_at ? Date.parse(state.next_attempt_at) : 0;
  if (Number.isFinite(nextAttempt) && nextAttempt > Date.now()) {
    return false;
  }

  return true;
}

function isManifestFullyPosted(type, manifest) {
  return manifestPlatformsForType(type, manifest)
    .every((platform) => Boolean(manifest?.posts?.[platform]?.permalink));
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
  const changed = ensureScheduledManifestDefaults(manifest.type, manifest);
  if (changed) {
    writeJson(manifestPath, manifest);
  }
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

export function listScheduledPlatformItems(type, platform) {
  return listScheduledItems(type)
    .filter((item) => isPlatformReady(type, item.manifest, platform))
    .sort((a, b) => {
      const aState = platformQueueState(a.manifest, platform) || {};
      const bState = platformQueueState(b.manifest, platform) || {};
      const aRetry = Number(aState.retry_count) || 0;
      const bRetry = Number(bState.retry_count) || 0;
      if (aRetry !== bRetry) {
        return aRetry - bRetry;
      }

      const aNext = aState.next_attempt_at || a.manifest.scheduled_at || '';
      const bNext = bState.next_attempt_at || b.manifest.scheduled_at || '';
      return aNext.localeCompare(bNext);
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
  ensureQueueState(type, item.manifest);
  item.manifest.posts[platform] = {
    ...details,
    platform,
    posted_at: details.posted_at || isoNow(),
  };
  item.manifest.queue.platforms[platform] = {
    ...item.manifest.queue.platforms[platform],
    status: 'posted',
    posted_at: item.manifest.posts[platform].posted_at,
    last_attempt_at: item.manifest.posts[platform].posted_at,
    next_attempt_at: null,
    last_error: null,
  };
  item.manifest.queue.overall.status = isManifestFullyPosted(type, item.manifest) ? 'posted' : 'queued';

  writeJson(item.manifestPath, item.manifest);

  if (type === 'video' && isManifestFullyPosted(type, item.manifest)) {
    return archiveScheduledVideoItem(item.dir);
  }

  return item.manifest;
}

export function archiveScheduledVideoItem(itemDir) {
  const item = loadManifestFromDir(itemDir);
  if (!item) {
    throw new Error(`Missing scheduled manifest in ${itemDir}`);
  }

  ensureDir(POSTED_VIDEOS_DIR);

  const slug = path.basename(item.dir);
  const targetDir = path.join(POSTED_VIDEOS_DIR, slug);
  const oldRelativeDir = relativeToRepo(item.dir);
  const newRelativeDir = relativeToRepo(targetDir);

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.renameSync(item.dir, targetDir);

  const movedItem = loadManifestFromDir(targetDir);
  if (!movedItem) {
    throw new Error(`Archived scheduled video is missing its manifest: ${targetDir}`);
  }

  const manifest = movedItem.manifest;
  manifest.archived_from_queue_at = isoNow();
  manifest.queue_status = 'posted';
  manifest.archived_from = oldRelativeDir;
  ensureQueueState('video', manifest);
  manifest.queue.overall.status = 'posted';

  if (manifest.assets) {
    for (const [key, value] of Object.entries(manifest.assets)) {
      if (typeof value === 'string') {
        manifest.assets[key] = rewriteRelativePathPrefix(value, oldRelativeDir, newRelativeDir);
      }
    }
  }

  if (manifest.posts && typeof manifest.posts === 'object') {
    for (const post of Object.values(manifest.posts)) {
      if (post && typeof post === 'object' && typeof post.source_file === 'string') {
        post.source_file = rewriteRelativePathPrefix(post.source_file, oldRelativeDir, newRelativeDir);
      }
    }
  }

  if (manifest.queue?.platforms && typeof manifest.queue.platforms === 'object') {
    for (const state of Object.values(manifest.queue.platforms)) {
      if (state && typeof state === 'object' && typeof state.prepared_video_path === 'string') {
        state.prepared_video_path = rewriteRelativePathPrefix(state.prepared_video_path, oldRelativeDir, newRelativeDir);
      }
    }
  }

  writeJson(movedItem.manifestPath, manifest);
  return manifest;
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

function appendPostOutro(sourceVideoPath, targetVideoPath) {
  if (!fs.existsSync(DEFAULT_POST_OUTRO_PATH)) {
    throw new Error(`Required post outro clip not found: ${DEFAULT_POST_OUTRO_PATH}`);
  }

  execFileSync('ffmpeg', [
    '-y',
    '-i', sourceVideoPath,
    '-i', DEFAULT_POST_OUTRO_PATH,
    '-filter_complex', '[0:v:0][0:a:0][1:v:0][1:a:0]concat=n=2:v=1:a=1[v][a]',
    '-map', '[v]',
    '-map', '[a]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    targetVideoPath,
  ], { stdio: 'pipe' });
}

function resolveQueuedVideoSource(item) {
  const candidates = [];
  const sourceFolder = item?.manifest?.source?.folder;
  if (sourceFolder) {
    const sourceDir = path.join(ROOT_DIR, sourceFolder);
    const baseName = path.basename(sourceDir);
    candidates.push(path.join(sourceDir, `${baseName}.mp4`));
  }

  const rawVideoPath = item?.manifest?.assets?.raw_video_path;
  if (rawVideoPath) {
    candidates.push(path.join(ROOT_DIR, rawVideoPath));
  }

  const queuedVideoPath = item?.manifest?.assets?.video_path;
  if (queuedVideoPath) {
    candidates.push(path.join(ROOT_DIR, queuedVideoPath));
  }

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

export function prepareScheduledVideoForPlatform(item, platform) {
  if (!item?.manifest || item.manifest.type !== 'video') {
    throw new Error('prepareScheduledVideoForPlatform requires a scheduled video item.');
  }

  ensureQueueState('video', item.manifest);

  const sourceVideoPath = resolveQueuedVideoSource(item);
  if (!sourceVideoPath) {
    throw new Error(`Missing source video for scheduled item ${item.manifest.id}`);
  }

  const preparedDir = path.join(item.dir, 'platform-renders', platform);
  ensureDir(preparedDir);
  const preparedPath = path.join(preparedDir, `${item.manifest.id}-${platform}.mp4`);
  appendPostOutro(sourceVideoPath, preparedPath);

  const preparedAt = isoNow();
  item.manifest.queue.platforms[platform] = {
    ...item.manifest.queue.platforms[platform],
    status: 'prepared',
    prepared_video_path: relativeToRepo(preparedPath),
    last_attempt_at: preparedAt,
    next_attempt_at: preparedAt,
    last_error: null,
  };
  item.manifest.queue.overall.last_prepared_at = preparedAt;
  writeJson(item.manifestPath, item.manifest);

  return {
    ...item,
    manifest: item.manifest,
    preparedVideoPath: preparedPath,
  };
}

export function recordScheduledPlatformFailure(type, itemDir, platform, error) {
  const item = loadManifestFromDir(itemDir);
  if (!item) {
    throw new Error(`Missing scheduled manifest in ${itemDir}`);
  }

  ensureQueueState(type, item.manifest);
  const now = Date.now();
  const state = item.manifest.queue.platforms[platform] || defaultQueueState(type, item.manifest).platforms[platform];
  const retryCount = (Number(state.retry_count) || 0) + 1;
  const nextAttemptAt = new Date(now + retryDelayMs(retryCount)).toISOString();

  item.manifest.queue.platforms[platform] = {
    ...state,
    status: 'failed',
    retry_count: retryCount,
    last_attempt_at: new Date(now).toISOString(),
    next_attempt_at: nextAttemptAt,
    last_error: String(error?.message || error || 'Unknown posting error'),
  };

  writeJson(item.manifestPath, item.manifest);
  return item.manifest;
}

export function scheduleVideo(sourceDir, options = {}) {
  const resolvedSource = path.resolve(sourceDir);
  const assets = detectVideoAssets(resolvedSource);
  const slug = safeSlug(options.slug || assets.baseName, assets.baseName);
  const scheduledAt = isoNow();
  const targetDir = path.join(SCHEDULED_VIDEOS_DIR, slug);
  fs.rmSync(targetDir, { recursive: true, force: true });
  ensureDir(targetDir);

  const targetVideoPath = path.join(targetDir, `${slug}.mp4`);
  const targetCaptionPath = path.join(targetDir, `${slug}_caption.txt`);
  const targetMdPath = path.join(targetDir, `${slug}.md`);

  fs.copyFileSync(assets.videoPath, targetVideoPath);

  if (assets.captionPath && fs.existsSync(assets.captionPath)) {
    const caption = fs.readFileSync(assets.captionPath, 'utf8');
    fs.writeFileSync(targetCaptionPath, normalizeCaptionForPosting(caption));
  }

  copyFileIfPresent(assets.mdPath, targetMdPath);

  const manifest = {
    id: slug,
    type: 'video',
    scheduled_at: scheduledAt,
    source: {
      folder: relativeToRepo(resolvedSource),
    },
    assets: {
      video_path: relativeToRepo(targetVideoPath),
      raw_video_path: relativeToRepo(targetVideoPath),
      caption_path: fs.existsSync(targetCaptionPath) ? relativeToRepo(targetCaptionPath) : null,
      compilation_path: fs.existsSync(targetMdPath) ? relativeToRepo(targetMdPath) : null,
    },
    posts: defaultPlatforms('video'),
    queue: defaultQueueState('video', {
      type: 'video',
      scheduled_at: scheduledAt,
      posts: defaultPlatforms('video'),
    }),
    post_defaults: {
      promo_line: DEFAULT_POST_PROMO_LINE,
      outro_path: DEFAULT_POST_OUTRO_PATH,
      append_outro_before_post: true,
    },
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
    scheduled_at: isoNow(),
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
