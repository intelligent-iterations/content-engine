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
  const clipSummary = clips.map((clip, index) => `${index + 1}. ${clip.name} (${clip.mood})`).join('\n');

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
