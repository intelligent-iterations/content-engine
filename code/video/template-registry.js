import fs from 'fs';
import { VIDEO_TEMPLATE_REGISTRY_PATH } from '../core/paths.js';

function mustReadFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

export function loadTemplateRegistry() {
  return JSON.parse(mustReadFile(VIDEO_TEMPLATE_REGISTRY_PATH, 'video template registry'));
}

function getRuleProfile(registry, ruleProfile = 'general_story') {
  return registry.ai_prompt_contract?.rule_profiles?.[ruleProfile]
    || registry.ai_prompt_contract?.rule_profiles?.general_story;
}

function getCaptionProfile(registry, captionProfile = 'general_story') {
  return registry.ai_prompt_contract?.caption_profiles?.[captionProfile]
    || registry.ai_prompt_contract?.caption_profiles?.general_story;
}

function getGrokPromptRequirements(registry) {
  return registry.ai_prompt_contract?.grok_prompt_requirements || null;
}

function getCompilationMarkdownContract(registry) {
  return registry.ai_prompt_contract?.compilation_markdown || {};
}

function getTemplateContract(template) {
  return {
    contract_version: template.contract_version || 1,
    authoring_sections: template.authoring_sections || [],
    workflow_contract: template.workflow_contract || null,
    asset_contract: template.asset_contract || null,
    cast_contract: template.cast_contract || null,
    scene_contract: template.scene_contract || null,
    continuity_contract: template.continuity_contract || null,
  };
}

function formatSectionTemplate(section) {
  const lines = [`## ${section.title}`];
  if (section.instruction) {
    lines.push(section.instruction);
  }

  if (section.prompt) {
    lines.push('');
    lines.push(`Prompt: ${section.prompt}`);
  }

  if (section.items?.length) {
    lines.push('');
    for (const item of section.items) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

export function listTemplates() {
  const registry = loadTemplateRegistry();
  return registry.templates.map(template => ({
    id: template.id,
    label: template.label,
    description: template.description,
  }));
}

export function resolveTemplate(templateId, legacyFormat = null) {
  const registry = loadTemplateRegistry();
  const requestedId = templateId || legacyFormat || 'story-driven-character-drama';
  const template = registry.templates.find(item => item.id === requestedId);

  if (!template) {
    const valid = registry.templates.map(item => item.id).join(', ');
    throw new Error(`Unknown video template "${requestedId}". Available templates: ${valid}`);
  }

  return {
    defaults: registry.defaults,
    template,
  };
}

export function resolveGenerationSettings(opts, resolvedTemplate) {
  const defaults = resolvedTemplate.defaults;
  const clipDurationSeconds = opts.clipDuration || resolvedTemplate.template.clip_duration_seconds || defaults.clip_duration_seconds;
  const targetLengthSeconds = opts.targetLength || resolvedTemplate.template.target_length_seconds || defaults.target_length_seconds;
  const explicitClipCount = opts.clips || resolvedTemplate.template.clip_count || defaults.clip_count;

  const clipCount = opts.targetLength && !opts.clips
    ? Math.max(1, Math.round(targetLengthSeconds / clipDurationSeconds))
    : explicitClipCount;

  return {
    templateId: resolvedTemplate.template.id,
    templateLabel: resolvedTemplate.template.label,
    clipCount,
    clipDurationSeconds,
    targetLengthSeconds,
    referenceStrategy: resolvedTemplate.template.reference_strategy || defaults.reference_strategy || 'per_clip',
    aspectRatio: resolvedTemplate.template.aspect_ratio || defaults.aspect_ratio,
    resolution: resolvedTemplate.template.resolution || defaults.resolution,
    imageModel: resolvedTemplate.template.image_model || defaults.image_model,
    videoModel: resolvedTemplate.template.video_model || defaults.video_model,
  };
}

export function buildCaptionPrompt({ topic, clips, template }) {
  const registry = loadTemplateRegistry();
  const captionProfileId = template.caption_profile || (template.rule_profile === 'promo' ? 'promo' : 'general_story');
  const profile = getCaptionProfile(registry, captionProfileId);
  const clipSummary = clips
    .map((clip, index) => `${index + 1}. ${clip.name} (${clip.mood || 'neutral'})`)
    .join('\n');

  const sectionLines = (profile.sections || []).map((section, index) => {
    const header = `${index + 1}. ${section.title}: ${section.instruction}`;
    const good = section.good_examples?.length
      ? `   Good examples:\n${section.good_examples.map(example => `   - "${example}"`).join('\n')}`
      : '';
    const bad = section.bad_examples?.length
      ? `\n   Bad examples:\n${section.bad_examples.map(example => `   - "${example}"`).join('\n')}`
      : '';
    const examples = section.examples?.length
      ? `\n   Examples:\n${section.examples.map(example => `   - "${example}"`).join('\n')}`
      : '';
    return `${header}${good}${bad}${examples}`;
  }).join('\n\n');

  const userPrompt = [
    profile.topic_intro.replace('{topic}', topic),
    '',
    profile.clip_intro,
    clipSummary,
    '',
    ...(profile.preface || []),
    '',
    sectionLines,
    '',
    'IMPORTANT:',
    ...(profile.important_rules || []).map(line => `- ${line}`),
    '',
    'Output ONLY the caption. No quotes. No explanation.',
  ].join('\n');

  return {
    systemPrompt: profile.system_prompt,
    userPrompt,
  };
}

export function prependCompilationMeta(mdContent, settings) {
  const registry = loadTemplateRegistry();
  const requirements = getGrokPromptRequirements(registry);
  const meta = [
    '---',
    `template: ${settings.templateId}`,
    `template_label: ${settings.templateLabel}`,
    `clip_count: ${settings.clipCount}`,
    `clip_duration_seconds: ${settings.clipDurationSeconds}`,
    `target_length_seconds: ${settings.targetLengthSeconds}`,
    `reference_strategy: ${settings.referenceStrategy}`,
    `aspect_ratio: ${settings.aspectRatio}`,
    `resolution: ${settings.resolution}`,
    `image_model: ${settings.imageModel}`,
    `video_model: ${settings.videoModel}`,
    `image_prompt_words_min: ${requirements?.image_prompt_word_range?.min || 0}`,
    `image_prompt_words_max: ${requirements?.image_prompt_word_range?.max || 0}`,
    `video_prompt_words_min: ${requirements?.video_prompt_word_range?.min || 0}`,
    `video_prompt_words_max: ${requirements?.video_prompt_word_range?.max || 0}`,
    `fallback_video_prompt_words_min: ${requirements?.fallback_video_prompt_word_range?.min || 0}`,
    `fallback_video_prompt_words_max: ${requirements?.fallback_video_prompt_word_range?.max || 0}`,
    '---',
    '',
  ].join('\n');

  return `${meta}${mdContent.trim()}\n`;
}

export function getCompilationRequirements() {
  const registry = loadTemplateRegistry();
  return {
    promptRequirements: getGrokPromptRequirements(registry),
    markdownContract: getCompilationMarkdownContract(registry),
  };
}

export function buildCompilationScaffold({ topic, resolvedTemplate, settings }) {
  const template = resolvedTemplate.template;
  const templateContract = getTemplateContract(template);
  const markdownContent = [];
  const authoringSections = template.authoring_sections || [];
  const storyBeats = template.scene_contract?.default_story_beats || [];

  markdownContent.push(`# ${topic}`);
  markdownContent.push('');
  markdownContent.push(`Template: ${template.label}`);
  markdownContent.push('');

  for (const section of authoringSections) {
    markdownContent.push(formatSectionTemplate(section));
    markdownContent.push('');
  }

  if (storyBeats.length) {
    markdownContent.push('## Story Beats');
    markdownContent.push('Replace the placeholders with your actual beat plan before rendering.');
    markdownContent.push('');
    for (let i = 0; i < settings.clipCount; i++) {
      const beatLabel = storyBeats[i] || `beat_${i + 1}`;
      markdownContent.push(`${i + 1}. ${beatLabel}`);
    }
    markdownContent.push('');
  }

  markdownContent.push('## Template Contract Snapshot');
  markdownContent.push('Reference this while authoring so the saved markdown stays aligned with the template.');
  markdownContent.push('');
  markdownContent.push('```json');
  markdownContent.push(JSON.stringify(templateContract, null, 2));
  markdownContent.push('```');
  markdownContent.push('');

  for (let i = 0; i < settings.clipCount; i++) {
    const beat = storyBeats[i] || `Beat ${i + 1}`;
    markdownContent.push(`## Clip ${i + 1}: ${beat} -- Mood`);
    markdownContent.push('');
    markdownContent.push('### Continuity Anchors');
    markdownContent.push('```');
    markdownContent.push('Lock recurring identity, wardrobe, environment, and style here.');
    markdownContent.push('```');
    markdownContent.push('');
    markdownContent.push('### Image Prompt');
    markdownContent.push('```');
    markdownContent.push('Describe the exact first frame, cast, composition, lighting, environment, and visual style.');
    markdownContent.push('```');
    markdownContent.push('');
    markdownContent.push('### Video Prompt');
    markdownContent.push('```');
    markdownContent.push('Speaker: <exact character name who speaks>');
    markdownContent.push('Silent characters: <comma-separated on-screen characters who stay silent, or None>');
    markdownContent.push('Dialogue: "<one short spoken line>"');
    markdownContent.push('Action: <one dominant visible action>');
    markdownContent.push('Direction: <brief acting, camera, and motion direction. Keep the scene legible and do not let silent characters mouth the line.>');
    markdownContent.push('```');
    markdownContent.push('');
    markdownContent.push('### Fallback Video Prompt');
    markdownContent.push('```');
    markdownContent.push('Speaker: <exact character name who speaks>');
    markdownContent.push('Silent characters: <comma-separated on-screen characters who stay silent, or None>');
    markdownContent.push('Dialogue: "<same short spoken line>"');
    markdownContent.push('Action: <simpler backup action>');
    markdownContent.push('Direction: <brief backup direction with the same speaking assignment>');
    markdownContent.push('```');
    markdownContent.push('');
  }

  return prependCompilationMeta(markdownContent.join('\n').trim(), settings);
}

export function getTemplateAuthoringSections(template) {
  return template?.authoring_sections || [];
}

export function buildVideoResearchArtifact({ topic, resolvedTemplate, settings, route }) {
  const registry = loadTemplateRegistry();
  const requirements = getGrokPromptRequirements(registry);
  const template = resolvedTemplate.template;

  return {
    topic,
    route,
    template: {
      id: template.id,
      label: template.label,
      description: template.description,
      rule_profile: template.rule_profile || null,
      prompting_profile: template.prompting_profile || null,
      caption_profile: template.caption_profile || null,
      contract: getTemplateContract(template),
    },
    render_settings: {
      clip_count: settings.clipCount,
      clip_duration_seconds: settings.clipDurationSeconds,
      target_length_seconds: settings.targetLengthSeconds,
      reference_strategy: settings.referenceStrategy,
      aspect_ratio: settings.aspectRatio,
      resolution: settings.resolution,
      image_model: settings.imageModel,
      video_model: settings.videoModel,
    },
    grok_prompt_requirements: requirements,
    distilled_template_guidance: {
      format_hint: template.format_hint,
      ordering_strategy: template.ordering_strategy,
      voice_direction: template.voice_direction,
      research_notes: template.research_notes || [],
      creative_direction: template.creative_direction || [],
      metaphor_examples: template.metaphor_examples || [],
      video_examples: template.video_examples || [],
      dialogue_examples: template.dialogue_examples || [],
    },
  };
}
