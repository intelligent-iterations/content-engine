import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..', '..');
const DEFAULT_FONT = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const CAPTION_MAX_CPS = 16;
const CAPTION_MIN_DURATION = 0.9;
const CAPTION_SAFE_Y_RATIO = 0.86;
const SILENCE_NOISE_THRESHOLD = '-35dB';
const SILENCE_MIN_DURATION = 0.12;
const SPEECH_GAP_MERGE_SECONDS = 0.18;
const DEFAULT_WHISPER_MODEL = process.env.WHISPER_MODEL || 'base.en';

// --- Extract dialogue from compilation MD ---

function extractDialogues(mdPath) {
  const md = fs.readFileSync(mdPath, 'utf-8');
  const clipSections = md.split(/^## Clip \d+:/m).slice(1);
  const dialogues = [];

  for (const section of clipSections) {
    const videoMatch = section.match(/### Video Prompt\s*```\s*([\s\S]*?)```/);
    if (!videoMatch) {
      dialogues.push(null);
      continue;
    }

    const prompt = videoMatch[1];
    const dialogueMatch = prompt.match(/(?:^|\n)Dialogue:\s*"([^"]+)"/im)
      || prompt.match(/clearly speaking:\s*"([^"]+)"/);
    if (dialogueMatch) {
      dialogues.push(dialogueMatch[1]);
    } else {
      // Fallback: try to find any quoted dialogue, including very short ASMR lines.
      const quoteMatch = prompt.match(/"([^"\n]+)"/);
      dialogues.push(quoteMatch ? quoteMatch[1] : null);
    }
  }

  return dialogues;
}

// --- Get clip duration via ffprobe ---

function getClipDuration(clipPath) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    clipPath,
  ], { encoding: 'utf-8' });
  return parseFloat(out.trim());
}

// --- Format time for ASS (H:MM:SS.cc) ---

function assTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const sWhole = Math.floor(s);
  const cs = Math.round((s - sWhole) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sWhole).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCaptionLayout(videoWidth, videoHeight) {
  const portrait = videoHeight >= videoWidth;
  const fontSize = clamp(Math.round(videoHeight * (portrait ? 0.0335 : 0.031)), 24, 44);
  const lineHeight = Math.round(fontSize * 1.12);
  const maxCharsPerLine = portrait ? 22 : 36;
  const outlineSize = clamp(Math.round(fontSize * 0.08), 2, 4);
  const shadowSize = 0;
  const bottomMargin = Math.round(videoHeight * (portrait ? 0.075 : 0.065));

  return {
    fontSize,
    lineHeight,
    maxCharsPerLine,
    maxLines: 2,
    outlineSize,
    shadowSize,
    bottomMargin,
    anchorY: Math.round(videoHeight * CAPTION_SAFE_Y_RATIO),
  };
}

function normalizeDialogue(dialogue) {
  return String(dialogue || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .trim();
}

function normalizeTranscriptWord(word) {
  return normalizeDialogue(word)
    .replace(/^[^\w']+/, '')
    .replace(/[^\w'.!?,-]+$/g, '');
}

function wrapCueText(text, maxCharsPerLine, maxLines = 2) {
  const normalized = normalizeDialogue(text);
  if (!normalized) {
    return [];
  }

  if (normalized.length <= maxCharsPerLine) {
    return [normalized];
  }

  const words = normalized.split(' ');
  if (maxLines === 2) {
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const left = words.slice(0, i).join(' ');
      const right = words.slice(i).join(' ');
      if (left.length > maxCharsPerLine || right.length > maxCharsPerLine) {
        continue;
      }

      const lengthDelta = Math.abs(left.length - right.length);
      const prefersBottomHeavy = right.length >= left.length ? 0 : 6;
      const score = lengthDelta + prefersBottomHeavy;
      if (!best || score < best.score) {
        best = { score, lines: [left, right] };
      }
    }

    if (best) {
      return best.lines;
    }
  }

  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length <= maxLines ? lines : null;
}

function splitDialogueIntoCues(dialogue, maxCharsPerLine, maxLines = 2, maxCueCharsOverride = null) {
  const normalized = normalizeDialogue(dialogue);
  if (!normalized) {
    return [];
  }

  const maxCueChars = maxCueCharsOverride || (maxCharsPerLine * maxLines);
  const words = normalized.split(' ');
  const cues = [];
  let currentWords = [];

  const flushCurrent = () => {
    if (!currentWords.length) {
      return;
    }
    cues.push(currentWords.join(' '));
    currentWords = [];
  };

  for (const word of words) {
    const candidateWords = [...currentWords, word];
    const candidate = candidateWords.join(' ');
    const wrapped = wrapCueText(candidate, maxCharsPerLine, maxLines);
    const strongBoundary = /[.!?,:]$/.test(word);
    const nearCapacity = candidate.length >= Math.round(maxCueChars * 0.9);

    if (wrapped && candidate.length <= maxCueChars) {
      currentWords = candidateWords;
      if (strongBoundary && candidate.length >= Math.round(maxCueChars * 0.55)) {
        flushCurrent();
      } else if (nearCapacity) {
        flushCurrent();
      }
      continue;
    }

    flushCurrent();
    currentWords = [word];
  }

  flushCurrent();

  // If any cue still can't fit in two lines, split it further at word boundaries.
  const safeCues = [];
  for (const cue of cues) {
    if (wrapCueText(cue, maxCharsPerLine, maxLines)) {
      safeCues.push(cue);
      continue;
    }

    const cueWords = cue.split(' ');
    const mid = Math.max(1, Math.floor(cueWords.length / 2));
    safeCues.push(cueWords.slice(0, mid).join(' '));
    safeCues.push(cueWords.slice(mid).join(' '));
  }

  return safeCues.filter(Boolean);
}

function parseSilenceDetectionOutput(output) {
  const events = [];
  const startRegex = /silence_start:\s*([0-9.]+)/g;
  const endRegex = /silence_end:\s*([0-9.]+)/g;

  let match;
  while ((match = startRegex.exec(output))) {
    events.push({ type: 'start', time: parseFloat(match[1]) });
  }
  while ((match = endRegex.exec(output))) {
    events.push({ type: 'end', time: parseFloat(match[1]) });
  }

  return events.sort((a, b) => a.time - b.time);
}

function transcribeClipAudioBatch(clipPaths) {
  if (!clipPaths.length) {
    return new Map();
  }

  try {
    const scriptPath = path.join(__dirname, 'transcribe-audio.py');
    const raw = execFileSync('python3', [scriptPath, ...clipPaths], {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PYTHONWARNINGS: 'ignore',
        WHISPER_MODEL: DEFAULT_WHISPER_MODEL,
      },
      maxBuffer: 1024 * 1024 * 20,
    });
    const parsed = JSON.parse(raw);
    const results = new Map();
    for (const item of parsed.results || []) {
      results.set(item.path, item);
    }
    return results;
  } catch (error) {
    console.warn(`  Warning: transcription failed, using timing fallback. ${error.message}`);
    return new Map();
  }
}

function mergeSpeechSegments(segments) {
  if (!segments.length) {
    return [];
  }

  const merged = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const previous = merged[merged.length - 1];
    if (current.start - previous.end <= SPEECH_GAP_MERGE_SECONDS) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function detectSpeechWindow(clipPath, clipDuration) {
  try {
    const result = spawnSync('ffmpeg', [
      '-hide_banner',
      '-i', clipPath,
      '-af', `silencedetect=noise=${SILENCE_NOISE_THRESHOLD}:d=${SILENCE_MIN_DURATION}`,
      '-f', 'null',
      '-',
    ], { encoding: 'utf-8' });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;

    const events = parseSilenceDetectionOutput(output);
    const segments = [];
    let cursor = 0;

    for (const event of events) {
      if (event.type === 'start') {
        if (event.time > cursor) {
          segments.push({ start: cursor, end: event.time });
        }
      } else if (event.type === 'end') {
        cursor = event.time;
      }
    }

    if (cursor < clipDuration) {
      segments.push({ start: cursor, end: clipDuration });
    }

    const meaningfulSegments = mergeSpeechSegments(
      segments.filter((segment) => segment.end - segment.start >= 0.18)
    );

    if (meaningfulSegments.length) {
      const best = meaningfulSegments.reduce((longest, current) => {
        const currentDuration = current.end - current.start;
        const longestDuration = longest.end - longest.start;
        return currentDuration > longestDuration ? current : longest;
      });

      return {
        start: clamp(best.start - 0.05, 0, Math.max(0, clipDuration - 0.1)),
        end: clamp(best.end + 0.08, 0.1, clipDuration),
      };
    }
  } catch {
    // Fall back to a conservative heuristic below.
  }

  const fallbackStart = clamp(clipDuration * 0.18, 0.35, 1.1);
  const fallbackEnd = clamp(clipDuration - 0.28, fallbackStart + 0.9, clipDuration);
  return { start: fallbackStart, end: fallbackEnd };
}

function estimateWordsAcrossWindow(text, speechStart, speechEnd) {
  const words = normalizeDialogue(text).split(' ').filter(Boolean);
  if (!words.length) {
    return [];
  }

  const duration = Math.max(0.3, speechEnd - speechStart);
  const slice = duration / words.length;
  return words.map((word, index) => ({
    word,
    start: speechStart + index * slice,
    end: index === words.length - 1 ? speechEnd : speechStart + (index + 1) * slice,
  }));
}

function buildCuesFromTimedWords(wordRecords, offset, layout) {
  const normalizedWords = wordRecords
    .map((word) => ({
      ...word,
      word: normalizeTranscriptWord(word.word),
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);

  if (!normalizedWords.length) {
    return [];
  }

  const maxCueChars = layout.maxCharsPerLine * layout.maxLines;
  const cues = [];
  let current = [];

  const flush = () => {
    if (!current.length) {
      return;
    }
    const text = current.map((word) => word.word).join(' ').trim();
    const lines = wrapCueText(text, layout.maxCharsPerLine, layout.maxLines) || [text];
    cues.push({
      start: offset + current[0].start,
      end: offset + current[current.length - 1].end + 0.04,
      text,
      lines,
    });
    current = [];
  };

  for (const word of normalizedWords) {
    const candidate = [...current, word];
    const candidateText = candidate.map((item) => item.word).join(' ').trim();
    const wrapped = wrapCueText(candidateText, layout.maxCharsPerLine, layout.maxLines);
    const cueDuration = candidate[candidate.length - 1].end - candidate[0].start;
    const exceedsReadingSpeed = candidateText.length > Math.max(maxCueChars, Math.floor(cueDuration * CAPTION_MAX_CPS));
    const punctuationBreak = /[.!?]$/.test(word.word);

    if (wrapped && !exceedsReadingSpeed) {
      current = candidate;
      if (punctuationBreak && candidateText.length >= Math.round(layout.maxCharsPerLine * 0.6)) {
        flush();
      }
      continue;
    }

    flush();
    current = [word];
  }

  flush();
  return cues;
}

function allocateCueTimings(cueTexts, speechStart, speechEnd) {
  if (!cueTexts.length) {
    return [];
  }

  const totalDuration = Math.max(0.3, speechEnd - speechStart);
  const cueCount = cueTexts.length;
  const minCueDuration = Math.min(CAPTION_MIN_DURATION, totalDuration / cueCount);
  const totalChars = cueTexts.reduce((sum, text) => sum + text.length, 0) || cueCount;
  const timings = [];
  let cursor = speechStart;

  for (let i = 0; i < cueTexts.length; i++) {
    const remainingTexts = cueTexts.slice(i);
    const remainingChars = remainingTexts.reduce((sum, text) => sum + text.length, 0) || remainingTexts.length;
    const remainingDuration = speechEnd - cursor;
    const reservedTail = minCueDuration * (remainingTexts.length - 1);
    const availableNow = Math.max(minCueDuration, remainingDuration - reservedTail);
    const weightedDuration = remainingDuration * (cueTexts[i].length / remainingChars);
    const duration = clamp(weightedDuration, minCueDuration, availableNow);
    const end = i === cueTexts.length - 1 ? speechEnd : Math.min(speechEnd, cursor + duration);
    timings.push({ start: cursor, end, text: cueTexts[i] });
    cursor = end;
  }

  return timings;
}

function buildCaptionCues(dialogues, clipFiles, clipDurations, videoWidth, videoHeight, transcriptionByPath = new Map()) {
  const layout = getCaptionLayout(videoWidth, videoHeight);
  const cues = [];
  let offset = 0;

  for (let i = 0; i < dialogues.length; i++) {
    const dialogue = normalizeDialogue(dialogues[i]);
    const clipDur = clipDurations[i];
    const clipPath = clipFiles[i];

    if (!dialogue || !clipDur || !clipPath) {
      offset += clipDur || 0;
      continue;
    }

    const transcription = transcriptionByPath.get(clipPath);
    const transcriptionWords = transcription?.words || [];
    const transcriptText = normalizeDialogue(transcription?.text || '');
    const expectedText = normalizeDialogue(dialogue);
    const speechWindow = transcriptionWords.length
      ? {
          start: clamp(transcriptionWords[0].start - 0.03, 0, Math.max(0, clipDur - 0.1)),
          end: clamp(transcriptionWords[transcriptionWords.length - 1].end + 0.06, 0.1, clipDur),
        }
      : detectSpeechWindow(clipPath, clipDur);
    const speechDuration = Math.max(0.4, speechWindow.end - speechWindow.start);
    const asrCoverageGood = transcriptText && transcriptText.length >= Math.max(6, expectedText.length * 0.55);

    if (transcriptionWords.length && asrCoverageGood) {
      cues.push(...buildCuesFromTimedWords(transcriptionWords, offset, layout));
    } else if (transcriptionWords.length) {
      const estimatedWords = estimateWordsAcrossWindow(expectedText, speechWindow.start, speechWindow.end);
      cues.push(...buildCuesFromTimedWords(estimatedWords, offset, layout));
    } else {
      const maxCharsBySpeed = Math.max(
        layout.maxCharsPerLine,
        Math.floor(speechDuration * CAPTION_MAX_CPS)
      );
      const cueTexts = splitDialogueIntoCues(
        dialogue,
        layout.maxCharsPerLine,
        layout.maxLines,
        Math.min(layout.maxCharsPerLine * layout.maxLines, maxCharsBySpeed)
      );
      const timedCues = allocateCueTimings(cueTexts, offset + speechWindow.start, offset + speechWindow.end);

      for (const cue of timedCues) {
        const lines = wrapCueText(cue.text, layout.maxCharsPerLine, layout.maxLines) || [cue.text];
        cues.push({ ...cue, lines });
      }
    }

    offset += clipDur;
  }

  return { cues, layout };
}

// --- Generate ASS subtitle content ---

function generateASS(cues, videoWidth, videoHeight) {
  const layout = getCaptionLayout(videoWidth, videoHeight);

  let ass = `[Script Info]
Title: TikTok Style Captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,${layout.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,${layout.outlineSize},${layout.shadowSize},2,72,72,${layout.bottomMargin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const cue of cues) {
    const text = cue.lines
      .join('\\N')
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}');
    ass += `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${text}\n`;
  }

  return ass;
}

function ffmpegHasFilter(filterName) {
  try {
    const out = execFileSync('ffmpeg', ['-filters'], { encoding: 'utf-8' });
    return new RegExp(`\\s${filterName}\\s`).test(out);
  } catch {
    return false;
  }
}

function escapeDrawtextText(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
    .replace(/%/g, '\\%');
}

function generateDrawtextFilters(cues, videoWidth, videoHeight) {
  const layout = getCaptionLayout(videoWidth, videoHeight);
  const filters = [];

  for (const cue of cues) {
    const text = escapeDrawtextText(cue.lines.join('\\n'));
    filters.push(
      `drawtext=fontfile='${DEFAULT_FONT}':text='${text}':fontcolor=white:fontsize=${layout.fontSize}:line_spacing=${Math.round(layout.fontSize * 0.14)}:borderw=${layout.outlineSize}:bordercolor=0x000000@1.0:x=(w-text_w)/2:y=h-${layout.bottomMargin}-text_h:enable='between(t,${cue.start.toFixed(2)},${cue.end.toFixed(2)})'`
    );
  }

  return filters.join(',');
}

function escapeFilterPath(filePath) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

async function createCaptionOverlayPngs(cues, videoWidth, videoHeight, workDir) {
  const layout = getCaptionLayout(videoWidth, videoHeight);
  const overlaySpecs = [];
  let overlayIndex = 0;

  for (const cue of cues) {
    const lines = cue.lines.map((line) => line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'));
    const maxLineLength = Math.max(...cue.lines.map((line) => line.length), 1);
    const textHeight = Math.round(lines.length * layout.lineHeight);
    const textStartY = Math.round(videoHeight - layout.bottomMargin - textHeight + layout.fontSize * 0.82);
    const tspans = lines
      .map((line, index) => `<tspan x="50%" dy="${index === 0 ? 0 : layout.lineHeight}">${line}</tspan>`)
      .join('');

    const svg = `<svg width="${videoWidth}" height="${videoHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .caption {
      font-family: Arial, Helvetica, sans-serif;
      font-size: ${layout.fontSize}px;
      font-weight: 700;
      fill: white;
      stroke: rgba(0,0,0,1);
      stroke-width: ${Math.max(2.5, layout.outlineSize * 1.25)}px;
      stroke-linejoin: round;
      paint-order: stroke fill;
      letter-spacing: -0.2px;
    }
  </style>
  <text x="50%" y="${textStartY}" text-anchor="middle" class="caption">${tspans}</text>
</svg>`;

    const overlayPath = path.join(workDir, `caption-${String(++overlayIndex).padStart(3, '0')}.png`);
    await sharp(Buffer.from(svg)).png().toFile(overlayPath);
    overlaySpecs.push({ start: cue.start, end: cue.end, overlayPath });
  }

  return overlaySpecs;
}

function buildOverlayFilterGraph(overlaySpecs) {
  const inputChains = ['[0:v]'];
  const filterParts = [];

  overlaySpecs.forEach((spec, index) => {
    const previous = index === 0 ? '[0:v]' : `[v${index}]`;
    const next = `[v${index + 1}]`;
    filterParts.push(
      `${previous}[${index + 1}:v]overlay=(W-w)/2:0:enable='between(t,${spec.start.toFixed(2)},${spec.end.toFixed(2)})'${next}`
    );
  });

  return {
    filterGraph: filterParts.join(';'),
    outputLabel: overlaySpecs.length > 0 ? `[v${overlaySpecs.length}]` : '[0:v]',
  };
}

function listClipFiles(clipsDir) {
  const preferred = fs.readdirSync(clipsDir)
    .filter(f => f.match(/^clip\d+/i) && f.endsWith('.mp4') && !f.endsWith('.tmp.mp4'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0], 10);
      const numB = parseInt(b.match(/\d+/)[0], 10);
      return numA - numB;
    });

  if (preferred.length > 0) {
    return preferred;
  }

  return fs.readdirSync(clipsDir)
    .filter(f => f.endsWith('.mp4') && !f.endsWith('.tmp.mp4'))
    .sort();
}

// --- Burn captions into a video (importable) ---

export async function burnCaptions({ mdPath, clipsDir, inputVideo, outputVideo }) {
  // 1. Extract dialogues
  const dialogues = extractDialogues(mdPath);
  console.log(`  Extracted ${dialogues.length} dialogues`);

  // 2. Get clip durations
  const clipFiles = listClipFiles(clipsDir);

  if (clipFiles.length !== dialogues.length) {
    console.warn(`  Warning: ${clipFiles.length} clips found but ${dialogues.length} dialogues extracted`);
  }

  const clipDurations = clipFiles.map(f => getClipDuration(path.join(clipsDir, f)));
  const clipPaths = clipFiles.map(f => path.join(clipsDir, f));

  // 3. Get video dimensions
  const dimOut = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    inputVideo,
  ], { encoding: 'utf-8' });
  const [width, height] = dimOut.trim().split('\n')[0].split(',').map(Number);
  const transcriptionByPath = transcribeClipAudioBatch(clipPaths);
  const { cues } = buildCaptionCues(dialogues, clipPaths, clipDurations, width, height, transcriptionByPath);
  console.log(`  Built ${cues.length} caption cues`);

  if (cues.length === 0) {
    fs.copyFileSync(inputVideo, outputVideo);
    console.log('  No caption cues could be built. Copied video without overlays.');
    console.log(`  Captioned video: ${outputVideo}`);
    return outputVideo;
  }

  if (ffmpegHasFilter('ass')) {
    const assContent = generateASS(cues, width, height);
    const assPath = inputVideo.replace(/\.mp4$/, '-captions.ass');
    fs.writeFileSync(assPath, assContent);

    const escapedAssPath = escapeFilterPath(assPath);

    execFileSync('ffmpeg', [
      '-y',
      '-i', inputVideo,
      '-vf', `ass=filename='${escapedAssPath}'`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'copy',
      outputVideo,
    ], { stdio: 'inherit' });

    fs.unlinkSync(assPath);
  } else if (ffmpegHasFilter('drawtext')) {
    const drawtextFilters = generateDrawtextFilters(cues, width, height);
    execFileSync('ffmpeg', [
      '-y',
      '-i', inputVideo,
      '-vf', drawtextFilters,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'copy',
      outputVideo,
    ], { stdio: 'inherit' });
  } else {
    const overlayDir = inputVideo.replace(/\.mp4$/, '-caption-overlays');
    fs.mkdirSync(overlayDir, { recursive: true });
    const overlaySpecs = await createCaptionOverlayPngs(cues, width, height, overlayDir);

    const { filterGraph, outputLabel } = buildOverlayFilterGraph(overlaySpecs);
    const ffmpegArgs = ['-y', '-i', inputVideo];
    for (const spec of overlaySpecs) {
      ffmpegArgs.push('-i', spec.overlayPath);
    }
    ffmpegArgs.push(
      '-filter_complex', filterGraph,
      '-map', outputLabel,
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'copy',
      outputVideo,
    );
    execFileSync('ffmpeg', ffmpegArgs, { stdio: 'inherit' });

    fs.rmSync(overlayDir, { recursive: true, force: true });
  }

  console.log(`  Captioned video: ${outputVideo}`);
  return outputVideo;
}

export { extractDialogues, generateASS };

// --- CLI Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: node code/add-captions.js <compilation.md> [--output <path>]');
    console.error('');
    console.error('Looks for clips and final video based on the MD filename.');
    process.exit(1);
  }

  const mdPath = path.resolve(args[0]);
  const baseName = path.basename(mdPath, '.md');

  let outputPath = null;
  const outputIdx = args.indexOf('--output');
  if (outputIdx !== -1 && args[outputIdx + 1]) {
    outputPath = path.resolve(args[outputIdx + 1]);
  }

  const videoDir = path.dirname(mdPath);
  const clipsDir = path.join(videoDir, 'clips');
  const finalVideo = path.join(videoDir, `${baseName}.mp4`);

  if (!fs.existsSync(finalVideo)) {
    console.error(`Final video not found: ${finalVideo}`);
    process.exit(1);
  }
  if (!fs.existsSync(clipsDir)) {
    console.error(`Clips directory not found: ${clipsDir}`);
    process.exit(1);
  }

  if (!outputPath) {
    outputPath = path.join(videoDir, `${baseName}_captioned.mp4`);
  }

  console.log(`\n=== Adding TikTok-Style Captions ===`);
  await burnCaptions({ mdPath, clipsDir, inputVideo: finalVideo, outputVideo: outputPath });
  console.log(`\n=== Done! ===`);
}

// Only run CLI if invoked directly
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
  main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
  });
}
