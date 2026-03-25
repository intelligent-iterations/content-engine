/**
 * Text overlay using Sharp (with SVG text rendering)
 * TikTok-style text with safe zones
 *
 * Used for product, hook, and CTA slides in the carousel pipeline.
 */

import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// TikTok dimensions
const WIDTH = 1080;
const HEIGHT = 1920;

// Safe zones for text placement (based on TikTok UI research)
// - Top 120px: status bar, notch/dynamic island
// - Bottom 350-500px: captions, hashtags, music info
// - Right 150px: engagement buttons (heart, comment, share)
// - Safe zone: 1080 x 1420px centered
// Text should be more centered for better visual impact
const SAFE_ZONES = {
  top: { y: 650, maxWidth: WIDTH - 200 },              // ~34% down, upper-mid area
  center: { y: 900, maxWidth: WIDTH - 200 },           // ~47% down, near true visual center
  'bottom-safe': { y: 1150, maxWidth: WIDTH - 250 }    // ~60% down, lower area above caption
};



/**
 * Strip emojis from text (SVG doesn't render them well)
 */
function stripEmojis(text) {
  return text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu, '').trim();
}

/**
 * Escape special characters for SVG
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word wrap text to fit within maxWidth
 */
function wrapText(text, maxWidth, fontSize) {
  // Approximate character width for bold fonts
  const charWidth = fontSize * 0.52;
  const maxCharsPerLine = Math.floor(maxWidth / charWidth);

  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;

    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);

  return lines;
}

/**
 * Create SVG text overlay with TikTok-style formatting
 */
function createTextSvg(text, position = 'top') {
  const zone = SAFE_ZONES[position] || SAFE_ZONES.top;
  const fontSize = 82;
  const lineHeight = 100;

  // Strip emojis and word wrap — keep sentence case (no ALL CAPS)
  const cleanText = stripEmojis(text);
  const lines = wrapText(cleanText, zone.maxWidth, fontSize);

  // Calculate total text block height
  const textBlockHeight = lines.length * lineHeight;

  // Center the text block vertically around the zone.y position
  const startY = zone.y - (textBlockHeight / 2) + (lineHeight / 2);

  // Build SVG text elements with stroke for outline effect
  const textElements = lines.map((line, i) => {
    const y = startY + (i * lineHeight);
    const escapedLine = escapeXml(line);

    // Black stroke (outline) first, then white fill on top
    return `
      <text x="50%" y="${y}" text-anchor="middle"
            font-family="'Inter', 'Helvetica Neue', 'Arial Black', sans-serif"
            font-size="${fontSize}"
            font-weight="900"
            letter-spacing="1">
        <tspan stroke="black" stroke-width="10" stroke-linejoin="round" fill="black">${escapedLine}</tspan>
      </text>
      <text x="50%" y="${y}" text-anchor="middle"
            font-family="'Inter', 'Helvetica Neue', 'Arial Black', sans-serif"
            font-size="${fontSize}"
            font-weight="900"
            letter-spacing="1"
            fill="white">
        ${escapedLine}
      </text>
    `;
  }).join('\n');

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    ${textElements}
  </svg>`;

  return Buffer.from(svg);
}

/**
 * Add text overlay to an image
 * @param {Buffer} imageBuffer - The source image as a buffer
 * @param {string} text - The text to overlay
 * @param {string} position - Position: 'top', 'center', or 'bottom-safe'
 * @returns {Promise<Buffer>} - The processed image as a JPG buffer
 */
export async function addTextOverlay(imageBuffer, text, position = 'top') {
  // Create SVG overlay
  const textSvg = createTextSvg(text, position);

  // Process image with Sharp
  // Use median filter to reduce JPEG block artifacts before upscaling,
  // lanczos3 for high-quality resampling, and subtle sharpening to
  // restore edge definition lost during resize.
  const result = await sharp(imageBuffer)
    .median(3)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
    .sharpen({ sigma: 0.5 })
    .composite([
      {
        input: textSvg,
        top: 0,
        left: 0
      }
    ])
    .jpeg({ quality: 92 })
    .toBuffer();

  return result;
}


/**
 * Process all slides and add text overlays.
 */
export async function processAllSlides(slides) {
  const results = [];

  for (const slide of slides) {
    console.log(`Adding text overlay to slide ${slide.slide_number}...`);

    const processedImage = await addTextOverlay(
      slide.imageBuffer,
      slide.text_overlay,
      slide.text_position || 'top'
    );

    results.push({
      ...slide,
      processedImage
    });
  }

  return results;
}

// Export safe zones for documentation
export { SAFE_ZONES };

// CLI usage / Test
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  import('fs').then(async (fs) => {
    // Create a test gradient image
    const testImage = await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 4,
        background: { r: 255, g: 200, b: 220, alpha: 1 }
      }
    })
      .png()
      .toBuffer();

    // Add text overlay
    const result = await addTextOverlay(testImage, 'YOUR SUNSCREEN MIGHT BE TOXIC', 'top');

    // Save test image
    const outputPath = path.join(__dirname, '..', '..', 'output', 'test-overlay.jpg');
    fs.writeFileSync(outputPath, result);
    console.log(`Test image saved to: ${outputPath}`);
  });
}
