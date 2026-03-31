export const DEFAULT_POST_PROMO_LINE = 'Make videos like this by searching ii-content-engine on GitHub.';

export const LEGACY_POST_CAPTION_PATTERNS = [
  /make these videos using content engine on github!? just search up ii content engine\.?/i,
  /make these videos using content engine on github!? just search up content-engine\.?/i,
  /search ii-content-engine on github\.?/i,
  /make videos like this by searching ii-content-engine on github\.?/i,
];

function cleanLine(value) {
  return String(value || '').trim();
}

export function stripPromoLines(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => {
      const trimmed = cleanLine(line);
      if (!trimmed) {
        return false;
      }
      return !LEGACY_POST_CAPTION_PATTERNS.some((pattern) => pattern.test(trimmed));
    })
    .join('\n')
    .trim();
}

export function normalizeCaptionForPosting(text, options = {}) {
  const promoLine = cleanLine(options.promoLine || DEFAULT_POST_PROMO_LINE);
  const body = stripPromoLines(text);

  if (!body) {
    return promoLine;
  }

  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines[0]?.toLowerCase() === promoLine.toLowerCase()) {
    return lines.join('\n');
  }

  return `${promoLine}\n\n${lines.join('\n')}`;
}

export function buildShortPostWithPromo(text, maxChars = 280) {
  const promoLine = DEFAULT_POST_PROMO_LINE;
  const body = stripPromoLines(text).replace(/\s+/g, ' ').trim();

  if (!body) {
    return promoLine.slice(0, maxChars);
  }

  const combined = `${promoLine} ${body}`.trim();
  if (combined.length <= maxChars) {
    return combined;
  }

  const remaining = Math.max(0, maxChars - promoLine.length - 2);
  if (remaining <= 0) {
    return promoLine.slice(0, maxChars);
  }

  const trimmedBody = body.length > remaining
    ? `${body.slice(0, Math.max(0, remaining - 1)).trimEnd()}…`
    : body;

  return `${promoLine} ${trimmedBody}`.trim();
}
