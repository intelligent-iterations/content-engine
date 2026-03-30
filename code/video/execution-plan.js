import path from 'path';
import { resolveTemplate } from './template-registry.js';
import { executionPlanPathForMd, readJsonArtifact, writeJsonArtifact } from './plan-files.js';

function renderTemplate(value, variables) {
  return String(value || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const resolved = variables[key];
    return resolved == null ? '' : String(resolved);
  });
}

function parseStructuredVideoPrompt(promptText) {
  return {
    speaker: promptText?.match(/(?:^|\n)Speaker:\s*(.+)$/im)?.[1]?.trim() || null,
    silentCharacters: promptText?.match(/(?:^|\n)Silent characters:\s*(.+)$/im)?.[1]?.trim() || null,
    dialogue: promptText?.match(/(?:^|\n)Dialogue:\s*"([^"]+)"/im)?.[1]?.trim() || null,
    action: promptText?.match(/(?:^|\n)Action:\s*(.+)$/im)?.[1]?.trim() || null,
    direction: promptText?.match(/(?:^|\n)Direction:\s*(.+)$/im)?.[1]?.trim() || null,
  };
}

function appendLines(lines, values) {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    lines.push(value);
  }
}

function createDefaultVideoExecutionContract() {
  return {
    builder_version: 1,
    lines: {
      preamble: [
        'Create a vertical 9:16 video clip.',
        'Target duration: {{clip_duration_seconds}} seconds.',
        'Treat the following image direction as the opening frame and visual identity to preserve.',
        'Continuity is more important than novelty or extra detail.',
        'If recurring characters are present, keep the exact same face/head design, silhouette, wardrobe logic, proportions, palette, environment, and cinematic style established by the image direction and continuity anchors.',
        'Do not redesign characters into generic humans, new costumes, or a different art style.',
        'If dialogue makes the acting feel weak, keep the acting simple and let the visual beat stay dominant.'
      ],
      image_direction_header: 'IMAGE DIRECTION:',
      continuity_header: 'CONTINUITY ANCHORS:',
      default_continuity_anchors: 'Preserve the same identity, wardrobe, set, and overall style established by the image prompt.',
      motion_intro: 'Animate that exact scene using this motion and dialogue direction:',
      video_direction_header: 'VIDEO DIRECTION:',
      speaker_named: 'Only {{speaker}} may deliver the spoken line in this clip.',
      speaker_none: 'If a spoken line is present, keep it assigned to one clearly readable speaker.',
      speaker_lock_named: 'Speaker lock: {{speaker}} is the only character allowed to produce audible speech, lip-sync, whisper words, narrate, or mouth the dialogue.',
      speaker_lock_none: 'If no named speaker is provided, prefer no audible dialogue over assigning the line to the wrong character.',
      silent_characters_named: '{{silent_characters}} stay on-screen silent and must not mouth, lip-sync, whisper, narrate, or appear to say the line.',
      silent_characters_none: 'Any other visible characters stay silent unless the prompt explicitly says otherwise.',
      dialogue_named: 'Use exactly this spoken line: "{{dialogue}}"',
      dialogue_none: 'Use no spoken dialogue unless the motion direction explicitly requires it.',
      wrong_speaker_failsafe_named: 'If the line cannot be cleanly assigned to {{speaker}}, output no audible dialogue instead of giving the line to another character.',
      wrong_speaker_failsafe_none: 'Do not let the wrong character deliver the line.',
      staging_named: 'Keep staging and face visibility clear so {{speaker}} is the obvious readable source of the line when speech occurs.',
      staging_none: 'Keep staging clear so any speaking source is visually unambiguous.',
      action_none: 'Keep one dominant visible action.',
      ending: [
        'Keep the framing, character, body-part context, and action clear and legible.',
        'Output a single finished video clip.'
      ]
    }
  };
}

function buildPromptFromContract(contract, clip, promptText, clipDurationSeconds) {
  const parsed = parseStructuredVideoPrompt(promptText);
  const variables = {
    clip_duration_seconds: clipDurationSeconds,
    speaker: parsed.speaker || '',
    silent_characters: parsed.silentCharacters || '',
    dialogue: parsed.dialogue || '',
    action: parsed.action || '',
    direction: parsed.direction || '',
    image_prompt: clip.imagePrompt || '',
    continuity_anchors: clip.continuityAnchors || '',
    raw_video_prompt: promptText || '',
    clip_name: clip.name || '',
    clip_mood: clip.mood || '',
  };
  const lines = contract.lines || {};
  const rendered = [];

  appendLines(rendered, (lines.preamble || []).map((line) => renderTemplate(line, variables)));
  rendered.push('');
  appendLines(rendered, [
    renderTemplate(lines.image_direction_header, variables),
    clip.imagePrompt || '',
    '',
    renderTemplate(lines.continuity_header, variables),
    clip.continuityAnchors || renderTemplate(lines.default_continuity_anchors, variables),
    '',
    renderTemplate(lines.motion_intro, variables),
    '',
    renderTemplate(lines.video_direction_header, variables),
  ]);

  const hasNamedSpeaker = parsed.speaker && !/^none$/i.test(parsed.speaker);
  const hasSilentCharacters = parsed.silentCharacters && !/^none$/i.test(parsed.silentCharacters);
  const hasDialogue = Boolean(parsed.dialogue);

  appendLines(rendered, [
    renderTemplate(hasNamedSpeaker ? lines.speaker_named : lines.speaker_none, variables),
    renderTemplate(hasNamedSpeaker ? lines.speaker_lock_named : lines.speaker_lock_none, variables),
    renderTemplate(hasSilentCharacters ? lines.silent_characters_named : lines.silent_characters_none, variables),
    renderTemplate(hasDialogue ? lines.dialogue_named : lines.dialogue_none, variables),
    renderTemplate(hasDialogue && hasNamedSpeaker ? lines.wrong_speaker_failsafe_named : lines.wrong_speaker_failsafe_none, variables),
    renderTemplate(hasNamedSpeaker ? lines.staging_named : lines.staging_none, variables),
    parsed.action || renderTemplate(lines.action_none, variables),
    parsed.direction || promptText,
    '',
  ]);

  appendLines(rendered, (lines.ending || []).map((line) => renderTemplate(line, variables)));

  return rendered.join('\n');
}

export function buildVideoExecutionPlan({ clips, meta, assetManifest }) {
  const templateId = meta.template || assetManifest?.template_id || null;
  const resolvedTemplate = resolveTemplate(templateId);
  const contract = resolvedTemplate.template.video_execution_contract || createDefaultVideoExecutionContract();
  const renderSettings = assetManifest?.render_settings || {};
  const clipDurationSeconds = Number(meta.clip_duration_seconds || renderSettings.clip_duration_seconds) || resolvedTemplate.template.clip_duration_seconds || 6;
  const referenceStrategy = String(meta.reference_strategy || renderSettings.reference_strategy || resolvedTemplate.template.reference_strategy || 'per_clip');
  const aspectRatio = String(meta.aspect_ratio || renderSettings.aspect_ratio || resolvedTemplate.template.aspect_ratio || '9:16');
  const resolution = String(meta.resolution || renderSettings.resolution || resolvedTemplate.template.resolution || '720p');
  const imageModel = meta.image_model || renderSettings.image_model || resolvedTemplate.template.image_model || null;
  const videoModel = meta.video_model || renderSettings.video_model || resolvedTemplate.template.video_model || null;
  const compilationMdPath = meta.compilation_md_path ? path.resolve(meta.compilation_md_path) : null;
  const runDir = compilationMdPath ? path.dirname(compilationMdPath) : null;
  const baseName = compilationMdPath ? path.basename(compilationMdPath, path.extname(compilationMdPath)) : null;
  const assetManifestPath = runDir ? path.join(runDir, 'asset-manifest.json') : null;

  const jobs = clips.map((clip, index) => ({
    id: `clip-${index + 1}`,
    clipIndex: index + 1,
    name: clip.name,
    mood: clip.mood || null,
    imagePrompt: clip.imagePrompt,
    continuityAnchors: clip.continuityAnchors,
    sceneReferenceImagePath: clip.sceneReferenceImagePath || null,
    primaryVideoPrompt: buildPromptFromContract(contract, clip, clip.videoPrompt, clipDurationSeconds),
    fallbackVideoPrompt: clip.fallbackVideoPrompt
      ? buildPromptFromContract(contract, clip, clip.fallbackVideoPrompt, clipDurationSeconds)
      : null,
  }));

  return {
    plan_version: 1,
    plan_type: 'video_execution_plan',
    templateId: resolvedTemplate.template.id,
    templateLabel: resolvedTemplate.template.label,
    compilationMdPath,
    assetManifestPath,
    runDir,
    baseName,
    clipsOutputDir: runDir && baseName ? path.join(runDir, 'clips') : null,
    stitchedVideoPath: runDir && baseName ? path.join(runDir, `${baseName}_stitched.mp4`) : null,
    finalVideoPath: runDir && baseName ? path.join(runDir, `${baseName}.mp4`) : null,
    clipDurationSeconds,
    referenceStrategy,
    aspectRatio,
    resolution,
    imageModel,
    videoModel,
    jobs,
  };
}

export function saveVideoExecutionPlan(executionPlan, mdPath, outputPath = executionPlanPathForMd(mdPath)) {
  const resolvedOutputPath = path.resolve(outputPath);
  writeJsonArtifact(resolvedOutputPath, {
    ...executionPlan,
    planPath: resolvedOutputPath,
  });
  return resolvedOutputPath;
}

export function loadVideoExecutionPlan(planPath) {
  return readJsonArtifact(planPath);
}
