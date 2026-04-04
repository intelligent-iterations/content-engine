import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveIIRoot() {
  const env = process.env.II_ROOT;
  if (env) {
    const expanded = env.startsWith('~') ? path.join(os.homedir(), env.slice(1)) : env;
    return path.resolve(expanded);
  }
  return path.join(os.homedir(), 'ii', 'content-engine');
}

export const ROOT_DIR = path.join(__dirname, '..', '..');
export const DOCS_DIR = path.join(ROOT_DIR, 'docs');
export const II_ROOT = resolveIIRoot();
export const OUTPUT_DIR = II_ROOT;
export const AUTH_DIR = path.join(II_ROOT, 'auth');
export const COOKIES_DIR = path.join(II_ROOT, 'cookies');
export const PROMPTS_DIR = path.join(II_ROOT, 'prompts');
export const RESEARCH_DIR = path.join(II_ROOT, 'research');
export const DOWNLOADS_DIR = path.join(II_ROOT, 'downloads');
export const VIDEOS_DIR = path.join(OUTPUT_DIR, 'videos');
export const CAROUSELS_DIR = path.join(OUTPUT_DIR, 'carousels');
export const SCHEDULED_VIDEOS_DIR = path.join(OUTPUT_DIR, 'scheduled_videos');
export const SCHEDULED_CAROUSELS_DIR = path.join(OUTPUT_DIR, 'scheduled_carousels');
export const POSTED_VIDEOS_DIR = path.join(OUTPUT_DIR, 'posted_videos');
export const TEMP_DIR = path.join(OUTPUT_DIR, 'tmp');

// Ensure the shared root directories exist
fs.mkdirSync(II_ROOT, { recursive: true });

export const VIDEO_TEMPLATE_REGISTRY_PATH = path.join(PROMPTS_DIR, 'video-templates.json');
export const CAROUSEL_TEMPLATE_REGISTRY_PATH = path.join(PROMPTS_DIR, 'carousel-templates.json');

export function isMainModule(metaUrl) {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
}
