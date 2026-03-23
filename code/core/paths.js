import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.join(__dirname, '..', '..');
export const DOCS_DIR = path.join(ROOT_DIR, 'docs');
export const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');
export const AUTH_DIR = path.join(ROOT_DIR, 'auth');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
export const VIDEOS_DIR = path.join(OUTPUT_DIR, 'videos');
export const CAROUSELS_DIR = path.join(OUTPUT_DIR, 'carousels');
export const SCHEDULED_VIDEOS_DIR = path.join(OUTPUT_DIR, 'scheduled_videos');
export const SCHEDULED_CAROUSELS_DIR = path.join(OUTPUT_DIR, 'scheduled_carousels');
export const TEMP_DIR = path.join(OUTPUT_DIR, 'tmp');

export const VIDEO_TEMPLATE_REGISTRY_PATH = path.join(PROMPTS_DIR, 'video-templates.json');
export const CAROUSEL_TEMPLATE_REGISTRY_PATH = path.join(PROMPTS_DIR, 'carousel-templates.json');

export function isMainModule(metaUrl) {
  return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(metaUrl));
}
