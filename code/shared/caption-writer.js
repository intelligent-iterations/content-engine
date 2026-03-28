const DEFAULT_MIN_CAPTION_CHARS = 2100;
const DEFAULT_MAX_CAPTION_CHARS = 2200;
const DEFAULT_HASHTAG_COUNT = 5;
const DEFAULT_VIDEO_PROMO_LINE = 'Search ii-content-engine on GitHub.';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'at', 'be', 'but', 'by', 'for', 'from', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'so', 'that', 'the',
  'their', 'this', 'to', 'up', 'with', 'you', 'your'
]);

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toSentence(value) {
  const text = cleanText(value);
  if (!text) {
    return '';
  }

  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function titleCase(value) {
  return cleanText(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugWord(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function dedupe(items = []) {
  const seen = new Set();
  const results = [];

  for (const item of items) {
    const value = cleanText(item);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(value);
  }

  return results;
}

function summarizeList(items = [], conjunction = 'and') {
  const values = dedupe(items);
  if (values.length === 0) {
    return '';
  }
  if (values.length === 1) {
    return values[0];
  }
  if (values.length === 2) {
    return `${values[0]} ${conjunction} ${values[1]}`;
  }
  return `${values.slice(0, -1).join(', ')}, ${conjunction} ${values.at(-1)}`;
}

function extractKeywords(...inputs) {
  const words = [];

  for (const input of inputs.flat()) {
    const text = cleanText(input).toLowerCase();
    if (!text) {
      continue;
    }

    const matches = text.match(/[a-z0-9][a-z0-9'-]*/g) || [];
    for (const match of matches) {
      if (match.length < 3 || STOPWORDS.has(match)) {
        continue;
      }
      words.push(match);
    }
  }

  return dedupe(words);
}

function normalizeHashtag(tag) {
  return cleanText(tag)
    .replace(/^#+/, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function buildHashtags({ existing = [], topic = '', extras = [] }) {
  const candidates = [
    ...existing,
    ...extras,
    ...extractKeywords(topic).slice(0, 10),
    'pomapp'
  ];

  const tags = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const tag = normalizeHashtag(candidate);
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    tags.push(tag.slice(0, 24));
    if (tags.length >= DEFAULT_HASHTAG_COUNT) {
      break;
    }
  }

  while (tags.length < DEFAULT_HASHTAG_COUNT) {
    const fallback = `topic${tags.length + 1}`;
    if (!seen.has(fallback)) {
      seen.add(fallback);
      tags.push(fallback);
    }
  }

  return tags.slice(0, DEFAULT_HASHTAG_COUNT);
}

function joinHashtags(tags = []) {
  return tags.map((tag) => `#${normalizeHashtag(tag)}`).join(' ');
}

function trimToSentenceBoundary(text, maxChars) {
  const clean = cleanText(text);
  if (clean.length <= maxChars) {
    return clean;
  }

  const slice = clean.slice(0, maxChars);
  const boundary = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n')
  );

  if (boundary >= Math.floor(maxChars * 0.75)) {
    return cleanText(slice.slice(0, boundary + 1));
  }

  return cleanText(`${slice.slice(0, Math.max(0, maxChars - 1)).trim()}…`);
}

function fitCaptionLength({ paragraphs, minChars, maxChars, suffix = '' }) {
  const joined = () => `${paragraphs.filter(Boolean).join('\n\n')}${suffix}`;

  while (joined().length > maxChars && paragraphs.length > 1) {
    paragraphs.pop();
  }

  let text = joined();
  if (text.length > maxChars) {
    const bodyMax = Math.max(minChars, maxChars - suffix.length);
    const trimmedBody = trimToSentenceBoundary(paragraphs.join('\n\n'), bodyMax);
    text = `${trimmedBody}${suffix}`;
  }

  if (text.length < minChars) {
    const remaining = maxChars - text.length;
    if (remaining > 40) {
      const filler = cleanText(
        `Save this, share it, and come back when you need a fast reference for ${extractKeywords(text).slice(0, 3).join(', ') || 'the topic'}.`
      );
      const combined = `${text}\n\n${filler}`;
      text = combined.length <= maxChars ? combined : `${text}${suffix}`;
    }
  }

  return trimToSentenceBoundary(text, maxChars);
}

function buildSeoPhrases(topic, detailLines = []) {
  const cleanedTopic = cleanText(topic) || 'this topic';
  const keywordPool = extractKeywords(cleanedTopic, detailLines).slice(0, 8);
  const phraseSeed = keywordPool.length ? keywordPool.join(', ') : cleanedTopic.toLowerCase();

  return [
    `If you searched for ${cleanedTopic.toLowerCase()}, this post is meant to be a practical reference you can return to later.`,
    `It is also useful for people looking up ${phraseSeed}, easy step-by-step walkthroughs, realistic examples, and save-worthy instructions instead of vague summaries.`,
    `The goal is to make ${cleanedTopic.toLowerCase()} easier to understand, easier to repeat, and easier to share with someone who wants a fast but complete breakdown.`
  ];
}

function padParagraphsToMinimum(paragraphs, minChars, generator) {
  const result = [...paragraphs];
  let guard = 0;

  while (result.join('\n\n').length < minChars && guard < 8) {
    result.push(generator(result.length));
    guard += 1;
  }

  return result;
}

function buildCarouselStepSummary(slides = []) {
  const instructionalSlides = slides.filter((slide) => slide.slide_type !== 'cta');
  return instructionalSlides.map((slide, index) => {
    const overlay = cleanText(slide.text_overlay || slide.product_name || `Step ${index + 1}`);
    const prompt = cleanText(slide.image_prompt || '');
    if (index === 0) {
      return `Start with ${overlay.toLowerCase()} so the viewer instantly understands what the tutorial will teach and what the finished result should look like.`;
    }
    return `${titleCase(overlay)} is covered with a realistic visual that reinforces the action, using cues like ${prompt.split(',').slice(0, 3).join(', ').toLowerCase() || 'a believable home setup'}.`;
  });
}

export function buildCarouselCaption({
  content,
  template = {},
  minChars = DEFAULT_MIN_CAPTION_CHARS,
  maxChars = DEFAULT_MAX_CAPTION_CHARS,
}) {
  const topic = cleanText(content?.topic || template?.label || 'this carousel');
  const hook = cleanText(content?.hook || template?.hook_examples?.[0] || topic);
  const slides = Array.isArray(content?.slides) ? content.slides : [];
  const hashtags = buildHashtags({
    existing: content?.hashtags || [],
    topic,
    extras: extractKeywords(
      template?.label,
      template?.description,
      template?.content_angle,
      slides.map((slide) => slide.text_overlay || slide.product_name || '')
    )
  });

  const stepSummary = buildCarouselStepSummary(slides);
  const seoPhrases = buildSeoPhrases(topic, stepSummary);
  const usefulTerms = summarizeList(extractKeywords(topic, hook, stepSummary).slice(0, 6), 'and');
  const templateExamples = dedupe([
    ...(template?.caption_examples || []),
    ...(template?.slide_examples || [])
  ]).slice(0, 6);

  const paragraphs = [
    toSentence(`${hook} This carousel is a practical guide to ${topic.toLowerCase()}, written so someone can save it, come back later, and still understand the full flow without rereading a long recipe post`),
    toSentence(`The short version is simple: this post shows the order, texture cues, and key details that matter most. Instead of vague food-content filler, it walks through the process in a way that is easier to follow on a phone. If you are looking for ${usefulTerms || topic.toLowerCase()}, the goal is to make the process feel clear and repeatable`),
    stepSummary.join(' '),
    toSentence(`A useful carousel caption should do more than repeat the slide text. It should make the topic searchable, explain why the sequence matters, and tell the viewer what they will get from saving it. That is why this caption leans into clear phrasing around ${topic.toLowerCase()}, realistic kitchen context, and practical language that helps on TikTok, Reels, and short-form search surfaces`),
    seoPhrases.join(' '),
    templateExamples.length
      ? toSentence(`The content structure also stays aligned with the template logic behind this format. It favors simple lines like ${templateExamples.map((line) => `"${cleanText(line)}"`).join(', ')}, because those phrases are scannable on-screen while the longer caption handles explanation, search coverage, and save intent`)
      : toSentence(`The content structure stays focused on fast comprehension on-screen while the caption carries the deeper explanation, searchable phrasing, and save-forward context`),
    toSentence(`If this helped, save it before your next cook day, send it to someone who has been asking how ${topic.toLowerCase()} works, and keep it as a quick reference when you want the method in one place`)
  ];

  const expanded = padParagraphsToMinimum(paragraphs, minChars, (index) => (
    `Search-friendly note ${index - paragraphs.length + 1}: ${seoPhrases[index % seoPhrases.length]} ` +
    `This is also why the carousel repeats the topic in natural language instead of relying on clickbait. The post should be discoverable for people searching ${topic.toLowerCase()}, easy tutorials, step-by-step guidance, practical breakdowns, and realistic examples they can actually use.`
  ));

  return {
    caption: fitCaptionLength({
      paragraphs: expanded,
      minChars,
      maxChars,
    }),
    hashtags,
  };
}

function buildClipSummary(clips = []) {
  return clips.map((clip, index) => {
    const name = cleanText(clip?.name || `clip ${index + 1}`);
    const mood = cleanText(clip?.mood || '');
    return `${index + 1}. ${titleCase(name)}${mood ? ` with a ${mood.toLowerCase()} beat` : ''}`;
  });
}

export function buildVideoCaption({
  topic,
  clips = [],
  template = {},
  minChars = DEFAULT_MIN_CAPTION_CHARS,
  maxChars = DEFAULT_MAX_CAPTION_CHARS,
}) {
  const cleanTopic = cleanText(topic || template?.label || 'this reel');
  const clipSummary = buildClipSummary(clips);
  const hashtags = buildHashtags({
    existing: extractKeywords(cleanTopic, template?.label, template?.description).slice(0, 5),
    topic: cleanTopic,
    extras: clipSummary
  });
  const seoPhrases = buildSeoPhrases(cleanTopic, clipSummary);
  const hookLine = toSentence(`This reel is built around ${cleanTopic.toLowerCase()} and is written to be searchable, specific, and easy to reshare`);

  const bodyParagraphs = [
    DEFAULT_VIDEO_PROMO_LINE,
    hookLine,
    toSentence(`If you searched for ${cleanTopic.toLowerCase()}, this caption is meant to work harder than a generic teaser. It is here to reinforce the topic, describe the payoff in plain language, and give the post enough useful context to perform better across TikTok, Reels, and short-form search`),
    clipSummary.length
      ? toSentence(`The reel moves through these beats: ${clipSummary.join('; ')}. That structure matters because strong short-form captions should echo the visual sequence without sounding like a transcript`)
      : toSentence(`The reel is designed to move through a clear sequence with a strong opening, a visible transformation, and a payoff that rewards the viewer for staying through the end`),
    toSentence(`For SEO, the wording stays anchored on ${cleanTopic.toLowerCase()} instead of drifting into filler. That makes the post more useful for people looking for exact examples, how-it-works context, short-form references, or shareable creative inspiration tied to this specific topic`),
    seoPhrases.join(' '),
    toSentence(`A strong reel caption should help with discovery, retention, and saves at the same time. It should front-load the hook, reinforce the payoff, add context the visuals do not have room to say, and still end with a clear action for the audience`),
    toSentence(`Save this if you want a quick reference, send it to someone who would care about ${cleanTopic.toLowerCase()}, and use it as a reminder that stronger captions are not just decoration. They help the post index for the right phrases and give the viewer a reason to come back`)
  ];

  const expanded = padParagraphsToMinimum(bodyParagraphs, minChars, (index) => (
    `Search-friendly expansion ${index - bodyParagraphs.length + 1}: ${seoPhrases[index % seoPhrases.length]} ` +
    `In practice, that means repeating the core topic naturally, adding one more plain-language explanation of the value, and giving the viewer a concrete reason to save or share the reel.`
  ));

  return fitCaptionLength({
    paragraphs: expanded,
    minChars,
    maxChars,
    suffix: `\n\n${joinHashtags(hashtags)}`,
  });
}
