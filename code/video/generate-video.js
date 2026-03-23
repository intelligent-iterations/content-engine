import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { parseCompilationMD, generateClip, stitchClips, lastHit429 } from './generate-video-compilation.js';
import { burnCaptions } from './add-captions.js';
import {
  buildCaptionPrompt,
  buildVideoResearchArtifact,
  listTemplates,
  prependCompilationMeta,
  resolveGenerationSettings,
  resolveTemplate,
} from './template-registry.js';
import { VIDEOS_DIR, isMainModule } from '../core/paths.js';
import { buildVideoCaption } from '../shared/caption-writer.js';

const XAI_API_KEY = process.env.XAI_API_KEY;

function parseArgs(args) {
  const opts = {
    topic: null,
    format: null,
    template: null,
    clips: null,
    clipDuration: null,
    targetLength: null,
    outputName: null,
    md: null,
    dryRun: false,
    listTemplates: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format' && args[i + 1]) {
      opts.format = args[++i];
    } else if (args[i] === '--template' && args[i + 1]) {
      opts.template = args[++i];
    } else if (args[i] === '--clips' && args[i + 1]) {
      opts.clips = parseInt(args[++i], 10);
    } else if (args[i] === '--clip-duration' && args[i + 1]) {
      opts.clipDuration = parseInt(args[++i], 10);
    } else if (args[i] === '--target-length' && args[i + 1]) {
      opts.targetLength = parseInt(args[++i], 10);
    } else if (args[i] === '--output-name' && args[i + 1]) {
      opts.outputName = args[++i];
    } else if (args[i] === '--md' && args[i + 1]) {
      opts.md = args[++i];
    } else if (args[i] === '--dry-run') {
      opts.dryRun = true;
    } else if (args[i] === '--list-templates') {
      opts.listTemplates = true;
    } else if (!args[i].startsWith('--')) {
      opts.topic = args[i];
    }
  }

  return opts;
}

function validateCompilationMD(mdContent, expectedClips) {
  const errors = [];
  const clipHeaders = mdContent.match(/^## Clip \d+:/gm) || [];

  if (clipHeaders.length === 0) {
    errors.push('No "## Clip N:" headers found. Each clip must start with "## Clip 1:", "## Clip 2:", etc.');
    return errors;
  }

  if (clipHeaders.length < expectedClips) {
    errors.push(`Expected ${expectedClips} clips but found ${clipHeaders.length} clip headers.`);
  }

  const clipSections = mdContent.split(/^## Clip \d+:/m).slice(1);

  for (let i = 0; i < clipSections.length; i++) {
    const section = clipSections[i];
    const clipNum = i + 1;

    const continuityMatch = section.match(/### Continuity Anchors\s*```\s*([\s\S]*?)```/);
    if (!continuityMatch) {
      errors.push(`Clip ${clipNum}: Missing ### Continuity Anchors with code block.`);
    } else if (continuityMatch[1].trim().split(/\s+/).filter(Boolean).length < 15) {
      errors.push(`Clip ${clipNum}: Continuity anchors are too short.`);
    }

    const imageMatch = section.match(/### Image Prompt\s*```\s*([\s\S]*?)```/);
    if (!imageMatch) {
      errors.push(`Clip ${clipNum}: Missing ### Image Prompt with code block.`);
    } else {
      const imageWords = imageMatch[1].trim().split(/\s+/).filter(Boolean).length;
      if (imageWords < 70) {
        errors.push(`Clip ${clipNum}: Image prompt is too short (${imageWords} words, need 70+).`);
      }
    }

    const videoMatch = section.match(/### Video Prompt\s*```\s*([\s\S]*?)```/);
    if (!videoMatch) {
      errors.push(`Clip ${clipNum}: Missing ### Video Prompt with code block.`);
    } else {
      const videoPrompt = videoMatch[1].trim();
      const videoWords = videoPrompt.split(/\s+/).filter(Boolean).length;
      if (videoWords < 35) {
        errors.push(`Clip ${clipNum}: Video prompt is too short (${videoWords} words, need 35+).`);
      }
      if (!videoPrompt.includes('"')) {
        errors.push(`Clip ${clipNum}: Video prompt must contain dialogue in quotes.`);
      }
    }

    const fallbackMatch = section.match(/### Fallback Video Prompt\s*```\s*([\s\S]*?)```/);
    if (!fallbackMatch) {
      errors.push(`Clip ${clipNum}: Missing ### Fallback Video Prompt with code block.`);
    } else {
      const fallbackPrompt = fallbackMatch[1].trim();
      const fallbackWords = fallbackPrompt.split(/\s+/).filter(Boolean).length;
      if (fallbackWords < 25) {
        errors.push(`Clip ${clipNum}: Fallback video prompt is too short (${fallbackWords} words, need 25+).`);
      }
      if (!fallbackPrompt.includes('"')) {
        errors.push(`Clip ${clipNum}: Fallback video prompt must contain dialogue in quotes.`);
      }
    }

    const firstLine = section.split('\n')[0].trim();
    if (!firstLine.includes('Wonder') && !firstLine.includes('Fear')) {
      errors.push(`Clip ${clipNum}: Missing mood marker (Wonder or Fear) in clip header.`);
    }
  }

  return errors;
}

async function generateCaption(topic, clips, resolvedTemplate) {
  if (!XAI_API_KEY) {
    throw new Error('Missing XAI_API_KEY in .env');
  }

  const { systemPrompt, userPrompt } = buildCaptionPrompt({
    topic,
    clips,
    template: resolvedTemplate?.template || {},
  });

  const res = await axios.post('https://api.x.ai/v1/chat/completions', {
    model: 'grok-4-1-fast',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1000,
    temperature: 0.8,
  }, {
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  return res.data.choices[0].message.content;
}

function topicSlug(topic) {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 50)
    .replace(/-$/, '');
}

function safeOutputName(value, fallback = 'video') {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  return normalized || fallback;
}

async function generateCaptionViaBrowser({ topic, clips, resolvedTemplate }) {
  return buildVideoCaption({
    topic,
    clips,
    template: resolvedTemplate?.template || {},
  });
}

function withUpdatedFrontmatter(mdContent, settings) {
  const stripped = String(mdContent || '').replace(/^---\n[\s\S]*?\n---\n*/, '');
  return prependCompilationMeta(stripped, settings);
}

function resolveCompilationArtifactPath({ topic, outputName, md }) {
  const baseName = safeOutputName(outputName || topicSlug(topic), 'video');
  const defaultVideoDir = path.join(VIDEOS_DIR, baseName);
  const mdPath = md
    ? path.resolve(md)
    : path.join(defaultVideoDir, `${baseName}.md`);

  return {
    baseName,
    videosDir: path.dirname(mdPath),
    mdPath,
  };
}

function loadCompilationArtifacts({ topic, settings, outputName, md }) {
  const resolved = resolveCompilationArtifactPath({ topic, outputName, md });

  if (!fs.existsSync(resolved.mdPath)) {
    throw new Error(
      `Missing compilation markdown: ${resolved.mdPath}\nCreate the shot-plan markdown locally first, then rerun the video renderer.`
    );
  }

  const mdContent = fs.readFileSync(resolved.mdPath, 'utf8');
  const validationErrors = validateCompilationMD(mdContent, settings.clipCount);
  if (validationErrors.length > 0) {
    throw new Error(
      `Compilation markdown failed validation:\n${validationErrors.map((error) => `- ${error}`).join('\n')}`
    );
  }

  fs.mkdirSync(resolved.videosDir, { recursive: true });
  fs.writeFileSync(resolved.mdPath, withUpdatedFrontmatter(mdContent, settings));

  return resolved;
}

function saveResearchArtifact({ topic, resolvedTemplate, settings, outputDir, route }) {
  fs.mkdirSync(outputDir, { recursive: true });

  const researchPath = path.join(outputDir, 'research.json');
  const artifact = buildVideoResearchArtifact({
    topic,
    resolvedTemplate,
    settings,
    route,
  });
  fs.writeFileSync(researchPath, JSON.stringify(artifact, null, 2));

  return researchPath;
}

async function runClipPipeline({ mdPath, baseName, videosDir, settings, dryRun }) {
  if (dryRun) {
    console.log('=== Dry run complete ===');
    console.log(`Validated MD: ${mdPath}`);
    console.log('Skipping image/video generation.');
    return;
  }

  console.log('[4/5] Running video generation pipeline...\n');

  const clips = parseCompilationMD(mdPath);
  console.log(`Parsed ${clips.length} clips:\n`);
  for (const clip of clips) {
    console.log(`  - ${clip.name} (${clip.mood})`);
  }

  const outputDir = path.join(videosDir, 'clips');
  fs.mkdirSync(outputDir, { recursive: true });

  const clipPaths = [];
  for (let i = 0; i < clips.length; i++) {
    try {
      const clipPath = await generateClip(clips[i], i, outputDir, {
        clipDurationSeconds: settings.clipDurationSeconds,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        videoModel: settings.videoModel,
        imageModel: settings.imageModel,
      });
      clipPaths.push(clipPath);

      if (i < clips.length - 1) {
        const cooldown = lastHit429 ? 15000 : 5000;
        console.log(`\n  [cooldown] Waiting ${cooldown / 1000}s before next clip...${lastHit429 ? ' (extended: hit rate limit)' : ''}`);
        await new Promise((resolve) => setTimeout(resolve, cooldown));
      }
    } catch (err) {
      console.error(`\nFailed on clip ${i + 1} (${clips[i].name}): ${err.message}`);
      console.error('Continuing with remaining clips...\n');
    }
  }

  if (clipPaths.length === 0) {
    console.error('All clips failed to generate.');
    process.exit(1);
  }

  const stitchedPath = path.join(videosDir, `${baseName}_stitched.mp4`);
  try {
    stitchClips(clipPaths, stitchedPath);
  } catch (err) {
    if (err.message.includes('ffmpeg')) {
      console.error('\nffmpeg is required for stitching clips. Install it with:');
      console.error('  brew install ffmpeg');
      process.exit(1);
    }
    throw err;
  }

  const finalPath = path.join(videosDir, `${baseName}.mp4`);
  console.log('\n[5/5] Burning captions into video...');
  try {
    await burnCaptions({
      mdPath,
      clipsDir: outputDir,
      inputVideo: stitchedPath,
      outputVideo: finalPath,
    });
    fs.unlinkSync(stitchedPath);
  } catch (err) {
    console.error(`  Caption burning failed: ${err.message}`);
    console.error('  Using uncaptioned video as final...');
    fs.renameSync(stitchedPath, finalPath);
  }

  console.log(`\n=== Done! ===`);
  console.log(`Clips generated: ${clipPaths.length}/${clips.length}`);
  console.log(`Final video: ${finalPath}`);
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);

  if (opts.listTemplates) {
    console.log('\nAvailable video templates:\n');
    for (const template of listTemplates()) {
      console.log(`- ${template.id}: ${template.description}`);
    }
    return;
  }

  if (!opts.topic) {
    console.error('Usage: node code/cli/video.js "topic" [--template id] [--clips N] [--clip-duration N] [--target-length N] [--output-name slug] [--md path] [--dry-run]');
    console.error('Legacy alias: --format hero|villain');
    console.error('Example: node code/cli/video.js "a tiny office feud between mascot characters" --template story-driven-character-drama --md output/videos/mascot-feud/mascot-feud.md');
    process.exit(1);
  }

  const resolvedTemplate = resolveTemplate(opts.template, opts.format);
  const settings = resolveGenerationSettings(opts, resolvedTemplate);
  const generationRoute = 'local_agent_authored_md';

  console.log('\n=== Automated Video Generation ===');
  console.log(`Topic: ${opts.topic}`);
  console.log(`Template: ${settings.templateId}`);
  console.log(`Clips: ${settings.clipCount}`);
  console.log(`Clip duration: ${settings.clipDurationSeconds}s`);
  console.log(`Target length: ${settings.targetLengthSeconds}s`);
  console.log(`MD source: ${opts.md ? path.resolve(opts.md) : 'derived from output-name/topic slug'}`);
  console.log(`Dry run: ${opts.dryRun}\n`);

  console.log('[1/5] Loading locally authored compilation markdown...');
  let resolvedArtifacts;
  try {
    resolvedArtifacts = loadCompilationArtifacts({
      topic: opts.topic,
      settings,
      outputName: opts.outputName,
      md: opts.md,
    });
  } catch (err) {
    console.error(`\nCompilation markdown is required before rendering: ${err.message}`);
    process.exit(1);
  }

  const { baseName, videosDir, mdPath } = resolvedArtifacts;
  console.log(`  Using compilation MD: ${mdPath}`);
  console.log('  Validation passed and frontmatter refreshed.\n');

  const researchPath = saveResearchArtifact({
    topic: opts.topic,
    resolvedTemplate,
    settings,
    outputDir: videosDir,
    route: generationRoute,
  });
  console.log(`[2/5] Saved research artifact: ${researchPath}\n`);

  console.log('[3/5] Generating caption...');
  const parsedForCaption = parseCompilationMD(mdPath);
  try {
    const seedCaption = XAI_API_KEY
      ? await generateCaption(opts.topic, parsedForCaption, resolvedTemplate)
      : await generateCaptionViaBrowser({
        topic: opts.topic,
        clips: parsedForCaption,
        resolvedTemplate,
      });

    const caption = buildVideoCaption({
      topic: opts.topic,
      clips: parsedForCaption,
      template: resolvedTemplate?.template || {},
      seedCaption,
    });

    const captionPath = path.join(videosDir, `${baseName}_caption.txt`);
    fs.writeFileSync(captionPath, caption);
    console.log(`  Saved caption: ${captionPath}`);
    console.log(`\n--- Caption Preview ---\n${caption}\n--- End Caption ---\n`);
  } catch (err) {
    console.error(`  Caption generation failed: ${err.message}`);
    console.error('  Continuing without caption...\n');
  }

  await runClipPipeline({
    mdPath,
    baseName,
    videosDir,
    settings,
    dryRun: opts.dryRun,
  });
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
