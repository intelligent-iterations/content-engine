import fs from 'fs';
import path from 'path';

function safeSlug(value, fallback = 'asset') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return normalized || fallback;
}

function buildRoleBlueprintEntries(template) {
  const roleBlueprint = template?.cast_contract?.role_blueprint || [];
  if (roleBlueprint.length > 0) {
    return roleBlueprint.map((entry, index) => ({
      id: safeSlug(entry.role || `character-${index + 1}`, `character-${index + 1}`),
      name: '',
      role: entry.role || `character_${index + 1}`,
      archetype_notes: entry.energy || '',
      suggested_types: entry.good_picks || [],
      reference_image_paths: [],
      portrait_prompt: '',
      reference_sheet_prompt: '',
      portrait_output_path: `assets/cast/${safeSlug(entry.role || `character-${index + 1}`)}.png`,
      reference_sheet_output_path: `assets/reference-sheets/${safeSlug(entry.role || `character-${index + 1}`)}.png`
    }));
  }

  const minimumCastSize = template?.cast_contract?.minimum_cast_size || 0;
  return Array.from({ length: minimumCastSize }).map((_, index) => ({
    id: `character-${index + 1}`,
    name: '',
    role: `character_${index + 1}`,
    archetype_notes: '',
    suggested_types: [],
    reference_image_paths: [],
    portrait_prompt: '',
    reference_sheet_prompt: '',
    portrait_output_path: `assets/cast/character-${index + 1}.png`,
    reference_sheet_output_path: `assets/reference-sheets/character-${index + 1}.png`
  }));
}

export function assetManifestPathForRun(videosDir) {
  return path.join(videosDir, 'asset-manifest.json');
}

export function buildDefaultAssetManifest({ topic, resolvedTemplate, settings, videosDir, mdPath = null }) {
  const template = resolvedTemplate.template;
  const storyBeats = template?.scene_contract?.default_story_beats || [];
  const sceneStartFrames = Array.from({ length: settings.clipCount }).map((_, index) => ({
    clip_index: index + 1,
    clip_name: storyBeats[index] || `clip_${index + 1}`,
    source: mdPath ? 'compilation_markdown' : 'template_scaffold',
    image_prompt: '',
    reference_image_paths: [],
    output_path: `assets/scene-start-frames/clip${String(index + 1).padStart(2, '0')}-${safeSlug(storyBeats[index] || `clip-${index + 1}`)}.png`
  }));

  return {
    topic,
    template_id: template.id,
    template_label: template.label,
    render_settings: {
      clip_count: settings.clipCount,
      clip_duration_seconds: settings.clipDurationSeconds,
      reference_strategy: settings.referenceStrategy,
      aspect_ratio: settings.aspectRatio,
      resolution: settings.resolution,
      image_model: settings.imageModel,
      video_model: settings.videoModel
    },
    asset_contract: template.asset_contract || {},
    cast_assets: buildRoleBlueprintEntries(template),
    scene_start_frames: sceneStartFrames
  };
}

export function writeAssetManifestIfMissing({ topic, resolvedTemplate, settings, videosDir, mdPath = null }) {
  const manifestPath = assetManifestPathForRun(videosDir);
  if (fs.existsSync(manifestPath)) {
    return manifestPath;
  }

  fs.mkdirSync(videosDir, { recursive: true });
  const manifest = buildDefaultAssetManifest({
    topic,
    resolvedTemplate,
    settings,
    videosDir,
    mdPath,
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

export function loadAssetManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

export function saveAssetManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}
