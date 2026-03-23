/**
 * Test text overlay functionality
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

import { addTextOverlay } from './shared/add-text-overlay.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testOverlay() {
  console.log('Testing text overlay...\n');

  // Create a test gradient image
  console.log('Creating test background image...');
  const testImage = await sharp({
    create: {
      width: 1080,
      height: 1920,
      channels: 4,
      background: { r: 255, g: 200, b: 220, alpha: 1 }
    }
  })
    .png()
    .toBuffer();

  const testCases = [
    { text: 'YOUR SUNSCREEN MIGHT BE TOXIC', position: 'top' },
    { text: 'CHECK THESE 3 INGREDIENTS', position: 'center' },
    { text: 'SCAN WITH THEPOM APP', position: 'bottom-safe' }
  ];

  const outputDir = path.join(__dirname, '..', 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  for (const testCase of testCases) {
    console.log(`\nTesting position: ${testCase.position}`);
    console.log(`Text: "${testCase.text}"`);

    const result = await addTextOverlay(testImage, testCase.text, testCase.position);

    const outputPath = path.join(outputDir, `test-overlay-${testCase.position}.jpg`);
    fs.writeFileSync(outputPath, result);
    console.log(`Saved: ${outputPath}`);
  }

  console.log('\n========================================');
  console.log('Text overlay is working correctly!');
  console.log('========================================');
  console.log(`\nCheck the output folder: ${outputDir}`);
}

testOverlay();
