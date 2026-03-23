import fs from 'fs';
import path from 'path';
import { CAROUSELS_DIR } from '../core/paths.js';

function safeSlug(value, fallback = 'carousel') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  return normalized || fallback;
}

function extractJsonBlock(markdown) {
  const match = markdown.match(/```json\s*([\s\S]*?)```/i) || markdown.match(/```\s*([\s\S]*?)```/);
  return match ? match[1].trim() : null;
}

function parseArtifactFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    return JSON.parse(raw);
  }

  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    const jsonBlock = extractJsonBlock(raw);
    if (!jsonBlock) {
      throw new Error(`Artifact markdown must include a JSON code block: ${filePath}`);
    }
    return JSON.parse(jsonBlock);
  }

  throw new Error(`Unsupported research artifact format: ${filePath}`);
}

function validateContentShape(content, expectedSlideCount, templateId, filePath) {
  if (!content || typeof content !== 'object') {
    throw new Error(`Research artifact did not contain a content object: ${filePath}`);
  }

  const required = ['topic', 'hook', 'caption', 'hashtags', 'slides'];
  for (const key of required) {
    if (content[key] === undefined || content[key] === null) {
      throw new Error(`Research artifact is missing "${key}": ${filePath}`);
    }
  }

  if (!Array.isArray(content.hashtags) || content.hashtags.length === 0) {
    throw new Error(`Research artifact must include a non-empty hashtags array: ${filePath}`);
  }

  if (!Array.isArray(content.slides) || content.slides.length !== expectedSlideCount) {
    throw new Error(
      `Research artifact for template "${templateId}" must include exactly ${expectedSlideCount} slides: ${filePath}`
    );
  }
}

export function resolveResearchArtifactPath({ templateId, outputName, researchFile }) {
  if (researchFile) {
    const explicitPath = path.resolve(researchFile);
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Research artifact not found: ${explicitPath}`);
    }
    return explicitPath;
  }

  const slug = safeSlug(outputName || templateId, templateId || 'carousel');
  const conceptDir = path.join(CAROUSELS_DIR, slug);
  const candidates = [
    path.join(conceptDir, 'research.json'),
    path.join(conceptDir, 'research.md'),
    path.join(conceptDir, 'carousel-content.json'),
    path.join(conceptDir, 'carousel-content.md'),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export function loadCarouselContentFromArtifact({ templateId, templateLabel, slideCount, pairCount, outputName, researchFile }) {
  const filePath = resolveResearchArtifactPath({ templateId, outputName, researchFile });

  if (!filePath) {
    const slug = safeSlug(outputName || templateId, templateId || 'carousel');
    throw new Error(
      `No saved carousel research artifact found for "${templateId}". Expected one of: ` +
      `${path.join(CAROUSELS_DIR, slug, 'research.json')}, ` +
      `${path.join(CAROUSELS_DIR, slug, 'research.md')}, ` +
      `${path.join(CAROUSELS_DIR, slug, 'carousel-content.json')}, or ` +
      `${path.join(CAROUSELS_DIR, slug, 'carousel-content.md')}.`
    );
  }

  const parsed = parseArtifactFile(filePath);
  const content = parsed.content || parsed.carousel_content || parsed.carousel || parsed;
  validateContentShape(content, slideCount, templateId, filePath);

  const slides = content.slides.map((slide, index) => ({
    slide_number: slide.slide_number || index + 1,
    image_source: slide.image_source || 'ai',
    text_position: slide.text_position || 'top',
    ...slide,
  }));

  return {
    ...content,
    slides,
    template_id: content.template_id || templateId,
    template_label: content.template_label || templateLabel,
    template_slide_count: slideCount,
    template_pair_count: pairCount,
    research_artifact_path: filePath,
    research_context: parsed.research || parsed.research_context || null,
  };
}
