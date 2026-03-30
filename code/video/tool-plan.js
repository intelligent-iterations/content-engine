import fs from 'fs';
import path from 'path';
import { resolveTemplate } from './template-registry.js';
import { toolPlanPathForManifest, readJsonArtifact, writeJsonArtifact } from './plan-files.js';

function dedupePaths(paths = []) {
  const seen = new Set();
  const results = [];

  for (const rawPath of paths) {
    const normalized = String(rawPath || '').trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    results.push(normalized);
  }

  return results;
}

function maybeSiblingReferencePath(referenceImagePath, manifestDir) {
  const normalized = String(referenceImagePath || '').trim();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('assets/cast/')) {
    const sibling = normalized.replace('assets/cast/', 'assets/reference-sheets/');
    return fs.existsSync(path.resolve(manifestDir, sibling)) ? sibling : null;
  }

  if (normalized.includes('assets/reference-sheets/')) {
    const sibling = normalized.replace('assets/reference-sheets/', 'assets/cast/');
    return fs.existsSync(path.resolve(manifestDir, sibling)) ? sibling : null;
  }

  return null;
}

function expandReferenceImagePaths(referenceImagePaths = [], manifestDir) {
  const expanded = [];

  for (const referenceImagePath of dedupePaths(referenceImagePaths)) {
    expanded.push(referenceImagePath);
    const sibling = maybeSiblingReferencePath(referenceImagePath, manifestDir);
    if (sibling) {
      expanded.push(sibling);
    }
  }

  return dedupePaths(expanded);
}

function collectFieldPaths(item, fields = []) {
  const collected = [];

  for (const field of fields) {
    const value = item?.[field];
    if (Array.isArray(value)) {
      collected.push(...value);
    } else if (value) {
      collected.push(value);
    }
  }

  return dedupePaths(collected);
}

function createDefaultToolPlanContract(template) {
  const jobs = [];

  if (template?.asset_contract?.requires_character_assets) {
    jobs.push({
      id: 'cast-portrait',
      stage: 'cast',
      kind: 'generate_image',
      source: 'cast_assets',
      prompt_field: 'portrait_prompt',
      output_field: 'portrait_output_path',
      reference_fields: ['reference_image_paths'],
      include_reference_siblings: true,
      allow_letter_characters_from_prompt: true,
    });
    jobs.push({
      id: 'cast-reference-sheet',
      stage: 'cast',
      kind: 'generate_image',
      source: 'cast_assets',
      prompt_field: 'reference_sheet_prompt',
      output_field: 'reference_sheet_output_path',
      reference_fields: ['reference_image_paths'],
      prepend_output_fields: ['portrait_output_path'],
      include_reference_siblings: true,
      allow_letter_characters_from_prompt: true,
    });
    jobs.push({
      id: 'cast-reference-sheet-match',
      stage: 'cast',
      kind: 'verify_reference_consistency',
      source: 'cast_assets',
      subject_output_field: 'reference_sheet_output_path',
      reference_fields: ['reference_image_paths'],
      prepend_output_fields: ['portrait_output_path'],
      include_reference_siblings: true,
      rules: [
        'Match the same exact character identity as the approved hero portrait.',
        'Do not redesign the subject into a new face, silhouette, outfit, or material treatment.',
        'Keep the same proportions, palette, and wardrobe logic while changing only the presentation into turnaround-sheet form.'
      ],
    });
  }

  if (template?.asset_contract?.requires_scene_start_frames) {
    jobs.push({
      id: 'scene-start-frame',
      stage: 'scene-frames',
      kind: 'generate_image',
      source: 'scene_start_frames',
      prompt_field: 'image_prompt',
      output_field: 'output_path',
      reference_fields: ['reference_image_paths'],
      include_reference_siblings: true,
      allow_letter_characters_from_prompt: true,
    });
    jobs.push({
      id: 'scene-start-frame-match',
      stage: 'scene-frames',
      kind: 'verify_reference_consistency',
      source: 'scene_start_frames',
      subject_output_field: 'output_path',
      reference_fields: ['reference_image_paths'],
      include_reference_siblings: true,
      rules_from_continuity_priority: true,
    });
  }

  return { asset_jobs: jobs };
}

function inferEntityLabel(item, source, index) {
  if (item?.name) {
    return item.name;
  }
  if (item?.clip_name) {
    return item.clip_name;
  }
  if (item?.id) {
    return item.id;
  }
  return `${source}-${index + 1}`;
}

function getCollection(manifest, source) {
  const value = manifest?.[source];
  return Array.isArray(value) ? value : [];
}

function shouldAllowLetterCharacters(prompt) {
  const text = String(prompt || '').toLowerCase();
  return text.includes('anthropomorphic alphabet')
    || text.includes('alphabet drama')
    || text.includes('letterform')
    || /anthropomorphic\s+(capital\s+)?[a-z]\b/.test(text);
}

function resolveJobRules(jobDef, template) {
  const rules = [];

  if (Array.isArray(jobDef.rules)) {
    rules.push(...jobDef.rules);
  }

  if (jobDef.rules_from_continuity_priority && Array.isArray(template?.continuity_contract?.priority_order)) {
    for (const priority of template.continuity_contract.priority_order) {
      rules.push(`Preserve ${priority}.`);
    }
  }

  return rules;
}

function buildJobReferences(jobDef, item, manifestDir) {
  const referencePaths = dedupePaths([
    ...collectFieldPaths(item, jobDef.prepend_output_fields || []),
    ...collectFieldPaths(item, jobDef.reference_fields || []),
  ]);

  const expandedPaths = jobDef.include_reference_siblings
    ? expandReferenceImagePaths(referencePaths, manifestDir)
    : referencePaths;

  const priorityPatterns = Array.isArray(jobDef.reference_priority_patterns)
    ? jobDef.reference_priority_patterns
    : [];

  if (priorityPatterns.length === 0) {
    return expandedPaths;
  }

  const originalOrder = new Map(expandedPaths.map((referencePath, index) => [referencePath, index]));

  const scoreForPath = (referencePath) => {
    const index = priorityPatterns.findIndex((pattern) => String(referencePath).includes(pattern));
    return index === -1 ? priorityPatterns.length : index;
  };

  return [...expandedPaths].sort((a, b) => {
    const delta = scoreForPath(a) - scoreForPath(b);
    if (delta !== 0) {
      return delta;
    }
    return (originalOrder.get(a) ?? 0) - (originalOrder.get(b) ?? 0);
  });
}

function createGenerateJob({ jobDef, item, index, source, manifestDir }) {
  const prompt = String(item?.[jobDef.prompt_field] || '').trim();
  const outputPath = String(item?.[jobDef.output_field] || '').trim();

  if (!prompt || !outputPath) {
    return null;
  }

  const entityLabel = inferEntityLabel(item, source, index);
  const maxReferenceImages = Number(jobDef.max_reference_images) || 5;
  const referenceImagePaths = buildJobReferences(jobDef, item, manifestDir)
    .filter((referencePath) => referencePath !== outputPath)
    .slice(0, maxReferenceImages);
  const resolvedOutputPath = path.resolve(manifestDir, outputPath);

  return {
    id: `${jobDef.id}:${item?.id || item?.clip_index || index + 1}`,
    stage: jobDef.stage,
    kind: jobDef.kind,
    source,
    entity_label: entityLabel,
    prompt,
    output_path: outputPath,
    output_absolute_path: resolvedOutputPath,
    output_exists: fs.existsSync(resolvedOutputPath),
    reference_image_paths: referenceImagePaths,
    allow_letter_characters: jobDef.allow_letter_characters_from_prompt
      ? shouldAllowLetterCharacters(prompt)
      : false,
  };
}

function createVerificationJob({ jobDef, item, index, source, manifestDir, template }) {
  const subjectPath = String(item?.[jobDef.subject_output_field] || '').trim();
  if (!subjectPath) {
    return null;
  }

  const entityLabel = inferEntityLabel(item, source, index);
  const referenceImagePaths = buildJobReferences(jobDef, item, manifestDir)
    .filter((referencePath) => referencePath !== subjectPath);
  const resolvedSubjectPath = path.resolve(manifestDir, subjectPath);

  return {
    id: `${jobDef.id}:${item?.id || item?.clip_index || index + 1}`,
    stage: jobDef.stage,
    kind: jobDef.kind,
    source,
    entity_label: entityLabel,
    subject_image_path: subjectPath,
    subject_image_absolute_path: resolvedSubjectPath,
    subject_exists: fs.existsSync(resolvedSubjectPath),
    reference_image_paths: referenceImagePaths,
    verification_rules: resolveJobRules(jobDef, template),
  };
}

export function buildVideoToolPlan({ manifest, manifestPath }) {
  const resolvedTemplate = resolveTemplate(manifest.template_id);
  const template = resolvedTemplate.template;
  const manifestDir = path.dirname(path.resolve(manifestPath));
  const toolPlanContract = template.tool_plan_contract || createDefaultToolPlanContract(template);
  const jobs = [];

  for (const jobDef of toolPlanContract.asset_jobs || []) {
    const collection = getCollection(manifest, jobDef.source);

    for (let index = 0; index < collection.length; index += 1) {
      const item = collection[index];
      const job = jobDef.kind === 'generate_image'
        ? createGenerateJob({ jobDef, item, index, source: jobDef.source, manifestDir })
        : createVerificationJob({ jobDef, item, index, source: jobDef.source, manifestDir, template });

      if (job) {
        jobs.push(job);
      }
    }
  }

  return {
    plan_version: 1,
    plan_type: 'video_tool_plan',
    template_id: template.id,
    template_label: template.label,
    run_dir: manifestDir,
    manifest_path: path.resolve(manifestPath),
    jobs,
  };
}

export function saveVideoToolPlan(toolPlan, manifestPath, outputPath = toolPlanPathForManifest(manifestPath)) {
  const resolvedOutputPath = path.resolve(outputPath);
  writeJsonArtifact(resolvedOutputPath, {
    ...toolPlan,
    plan_path: resolvedOutputPath,
  });
  return resolvedOutputPath;
}

export function loadVideoToolPlan(planPath) {
  return readJsonArtifact(planPath);
}

export function filterJobsByStage(toolPlan, stage, kinds = []) {
  return (toolPlan.jobs || []).filter((job) => {
    if (stage && job.stage !== stage) {
      return false;
    }

    if (kinds.length > 0 && !kinds.includes(job.kind)) {
      return false;
    }

    return true;
  });
}
