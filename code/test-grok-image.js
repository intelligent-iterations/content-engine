/**
 * Test image generation with Grok.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { generateImage, downloadImage, IMAGE_MODELS } from './shared/generate-image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function testImageGeneration() {
  const model = IMAGE_MODELS.grok;
  console.log('Testing Grok image generation...\n');

  const tokens = {
    xaiApiKey: process.env.XAI_API_KEY
  };

  if (!tokens.xaiApiKey) {
    console.error('ERROR: XAI_API_KEY not set in .env file');
    process.exit(1);
  }
  console.log('API Key:', tokens.xaiApiKey.substring(0, 10) + '...');
  console.log();

  const testPrompt = '9:16 vertical aspect ratio, clean minimal gradient background transitioning from soft pink to light purple, abstract floating molecular structures and chemical bonds, wellness and health aesthetic, ethereal glow, no text, ample space at top third for text overlay';

  console.log('Test prompt:');
  console.log(testPrompt);
  console.log();

  try {
    console.log('Generating image...');
    const imageUrl = await generateImage(tokens, testPrompt, { model });

    console.log('\nImage URL:', imageUrl);

    // Download and save
    console.log('\nDownloading image...');
    const imageBuffer = await downloadImage(imageUrl);

    const outputPath = path.join(__dirname, '..', 'output', `test-${model}.jpg`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, imageBuffer);

    console.log(`Saved to: ${outputPath}`);

    console.log('\n========================================');
    console.log('Grok image generation is working correctly!');
    console.log('========================================');

  } catch (error) {
    console.error('\nERROR:', error.message);
    process.exit(1);
  }
}

testImageGeneration();
