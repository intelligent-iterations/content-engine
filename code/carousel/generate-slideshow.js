/**
 * Main slideshow generation script (v2)
 *
 * Workflow:
 * 1. Agent prepares a saved carousel research/content artifact
 * 2. Renderer loads that artifact
 * 3. Grok generates images only
 * 4. Text overlays are applied and output is saved
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { generateImage, downloadImage, IMAGE_MODELS } from '../shared/generate-image.js';
import { processAllSlides } from '../shared/add-text-overlay.js';
import { createPreviewHTML } from '../shared/create-preview.js';
import { getLogger, resetLogger } from '../shared/debug-logger.js';
import { buildCarouselCaption } from '../shared/caption-writer.js';
import { loadCarouselContentFromArtifact } from './research-artifact.js';
import { CAROUSELS_DIR, CAROUSEL_TEMPLATE_REGISTRY_PATH, isMainModule } from '../core/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
let runtimeConfig = {
  xaiApiKey: process.env.XAI_API_KEY || null,
  imageModel: IMAGE_MODELS.grok
};

function readCarouselRegistry() {
  return JSON.parse(fs.readFileSync(CAROUSEL_TEMPLATE_REGISTRY_PATH, 'utf-8'));
}

function listCarouselTemplates() {
  const registry = readCarouselRegistry();
  return registry.templates.map(template => ({
    id: template.id,
    label: template.label,
    description: template.description,
  }));
}

function resolveCarouselTemplate(templateId = null) {
  const registry = readCarouselRegistry();
  const resolvedId = templateId || 'comparison-list';
  const template = registry.templates.find(item => item.id === resolvedId);

  if (!template) {
    const valid = registry.templates.map(item => item.id).join(', ');
    throw new Error(`Unknown carousel template "${resolvedId}". Available templates: ${valid}`);
  }

  return {
    defaults: registry.defaults,
    template,
  };
}

function resolveCarouselSettings(options = {}, resolvedTemplate) {
  const defaults = resolvedTemplate.defaults;
  const slideCount = options.slides || resolvedTemplate.template.slide_count || defaults.slide_count;
  const pairCount = options.pairs || resolvedTemplate.template.pair_count || defaults.pair_count;

  return {
    templateId: resolvedTemplate.template.id,
    templateLabel: resolvedTemplate.template.label,
    structureType: resolvedTemplate.template.structure_type,
    slideCount,
    pairCount,
    imageStyle: resolvedTemplate.template.image_style || defaults.image_style,
    overlayStyle: resolvedTemplate.template.overlay_style || defaults.overlay_style,
  };
}

function parseArgs(args = process.argv.slice(2)) {
  const parsed = {
    imageModel: IMAGE_MODELS.grok,
    template: null,
    slides: null,
    pairs: null,
    outputName: null,
    researchFile: null,
    listTemplates: false,
  };

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower === 'grok' || lower === '--grok') {
      parsed.imageModel = IMAGE_MODELS.grok;
    }
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template' && args[i + 1]) {
      parsed.template = args[++i];
    } else if (args[i] === '--slides' && args[i + 1]) {
      parsed.slides = parseInt(args[++i], 10);
    } else if (args[i] === '--pairs' && args[i + 1]) {
      parsed.pairs = parseInt(args[++i], 10);
    } else if (args[i] === '--output-name' && args[i + 1]) {
      parsed.outputName = args[++i];
    } else if (args[i] === '--research-file' && args[i + 1]) {
      parsed.researchFile = args[++i];
    } else if (args[i] === '--list-templates') {
      parsed.listTemplates = true;
    }
  }

  return parsed;
}

function safeOutputName(value, fallback = 'carousel') {
  const normalized = (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);

  return normalized || fallback;
}

// Rate limit delay between image requests
const FLUX_DELAY = 10000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Validate configuration based on selected image model
 */
function validateConfig(config) {
  if (!config.xaiApiKey) {
    console.warn('XAI_API_KEY not found.');
    console.warn('Image generation will use Grok browser automation fallback if a saved web session is available.');
  } else {
    console.log('XAI_API_KEY found.');
  }

  console.log(`Image model: ${config.imageModel.toUpperCase()}`);
}

/**
 * Get image for a slide - supports both text2img and img2img
 * @param {Object} slide - Slide configuration
 * @param {Buffer} referenceImage - Optional product image for img2img
 */
async function getSlideImage(slide, referenceImage = null) {
  const prompt = slide.image_prompt || '9:16 vertical aspect ratio, aesthetic bathroom vanity with skincare products, soft natural lighting, clean minimal composition, pink and white tones, space at top for text overlay, no text in image';

  if (referenceImage) {
    // Image-to-image generation with product photo
    return await generateAIImage(prompt, { referenceImage });
  } else {
    // Text-to-image generation
    return await generateAIImage(prompt);
  }
}

/**
 * Generate AI image (supports both text2img and img2img)
 * @param {string} prompt - Text prompt
 * @param {Object} options - Options including referenceImage for img2img
 */
async function generateAIImage(prompt, options = {}) {
  if (options.referenceImage) {
    console.log('  Generating IMAGE-TO-IMAGE with Grok...');
  } else {
    console.log('  Generating text-to-image with Grok...');
  }
  const tokens = {
    xaiApiKey: runtimeConfig.xaiApiKey
  };
  const imageUrl = await generateImage(tokens, prompt, { ...options, model: runtimeConfig.imageModel });
  const buffer = await downloadImage(imageUrl);
  return {
    buffer,
    source: options.referenceImage ? 'img2img' : 'ai',
    prompt,
    usedReferenceImage: !!options.referenceImage
  };
}

/**
 * Get images for all slides
 */
async function getAllSlideImages(slides, productImages = []) {
  const logger = getLogger();
  const results = [];
  let needsDelay = false;

  for (const slide of slides) {
    // Check if this slide wants to use a captured product image
    const useProductImage = slide.use_product_image;
    let productImageRef = null;

    if (useProductImage && productImages[useProductImage - 1]) {
      productImageRef = productImages[useProductImage - 1];

      // Check if prompt is just showing product plainly - if so, use original image
      const promptLower = (slide.image_prompt || '').toLowerCase();
      const isPlainProductShot = promptLower.includes('product shot') ||
                                  promptLower.includes('product image') ||
                                  promptLower.includes('simple product') ||
                                  promptLower.includes('product on white') ||
                                  promptLower.includes('product only') ||
                                  (promptLower.includes('product') && !promptLower.includes('person') && !promptLower.includes('woman') && !promptLower.includes('hand') && !promptLower.includes('bathroom') && !promptLower.includes('shelf') && !promptLower.includes('store'));

      if (isPlainProductShot) {
        console.log(`\nSlide ${slide.slide_number}: using ORIGINAL product image "${productImageRef.productName}" (no AI needed)`);
        // Use original image directly
        results.push({
          ...slide,
          imageBuffer: productImageRef.imageBuffer,
          imageSource: 'product_image'
        });

        logger.logStep(`Using Original Product Image: Slide ${slide.slide_number}`, 'image-generation', {
          slide_number: slide.slide_number,
          product_name: productImageRef.productName,
          reason: 'Prompt requests plain product shot - using original captured image'
        }, {
          imagePreview: `data:image/jpeg;base64,${productImageRef.imageBuffer.toString('base64')}`
        });

        continue; // Skip AI generation
      }

      console.log(`\nSlide ${slide.slide_number}: using product image "${productImageRef.productName}" for IMG2IMG`);
    } else {
      console.log(`\nSlide ${slide.slide_number}: generating AI image`);
    }

    // CTA slides: generate a clean gradient programmatically (skip AI entirely)
    // This avoids content filter issues — a gradient doesn't need AI
    if (slide.slide_type === 'cta') {
      console.log(`  CTA slide — generating gradient background (no AI needed)`);
      const sharp = (await import('sharp')).default;
      // Create a warm gradient using SVG
      const svgGradient = `<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#f5f0e8"/>
            <stop offset="50%" stop-color="#ede4d3"/>
            <stop offset="100%" stop-color="#e8dcc8"/>
          </linearGradient>
        </defs>
        <rect width="1080" height="1920" fill="url(#bg)"/>
      </svg>`;
      const ctaBuffer = await sharp(Buffer.from(svgGradient)).jpeg({ quality: 92 }).toBuffer();
      results.push({
        ...slide,
        imageBuffer: ctaBuffer,
        imageSource: 'gradient'
      });
      logger.logStep(`CTA Gradient: Slide ${slide.slide_number}`, 'image-generation', {
        slide_number: slide.slide_number,
        reason: 'CTA slides use programmatic gradient to avoid content filter'
      }, null);
      continue;
    }

    // Log image request (include reference image if img2img)
    const referenceImagePreview = productImageRef?.imageBuffer
      ? `data:image/jpeg;base64,${productImageRef.imageBuffer.toString('base64')}`
      : null;

    logger.logStep(`Image Request: Slide ${slide.slide_number}`, 'image-generation', {
      slide_number: slide.slide_number,
      image_prompt: slide.image_prompt,
      use_product_image: useProductImage || null,
      product_image_name: productImageRef?.productName || null,
      generation_mode: productImageRef ? 'img2img' : 'text2img',
      referenceImagePreview: referenceImagePreview
    }, null);

    // Add delay between AI requests
    if (needsDelay) {
      console.log(`  Waiting ${FLUX_DELAY / 1000}s before next image request...`);
      await sleep(FLUX_DELAY);
    }

    // Generate image - use img2img if product image available, otherwise text2img
    const referenceBuffer = productImageRef?.imageBuffer || null;
    let imageData;
    try {
      imageData = await getSlideImage(slide, referenceBuffer);
    } catch (imgErr) {
      throw new Error(`Image generation failed for slide ${slide.slide_number}: ${imgErr.message}`);
    }

    // Convert buffer to base64 for debug report preview
    const imageBase64 = imageData.buffer.toString('base64');

    // Log image result with preview
    logger.logStep(`Image Generated: Slide ${slide.slide_number}`, 'image-generation', {
      prompt: slide.image_prompt || 'fallback prompt',
      generation_mode: imageData.usedReferenceImage ? 'img2img' : 'text2img',
      product_reference: productImageRef?.productName || null
    }, {
      source: imageData.source,
      bufferSize: imageData.buffer?.length || 0,
      usedImg2Img: imageData.usedReferenceImage || false,
      imagePreview: `data:image/jpeg;base64,${imageBase64}`
    });

    results.push({
      ...slide,
      imageBuffer: imageData.buffer,
      imageSource: 'ai'
    });

    needsDelay = true;
  }

  return results;
}

/**
 * Normalize the processed slides for save/export.
 */
async function finalizeSlides(processedSlides) {
  return processedSlides.map((slide, index) => ({
    ...slide,
    slide_number: index + 1,
    slideType: 'product',
    imageSource: slide.imageSource || slide.image_source || 'ai'
  }));
}

/**
 * Save images and metadata locally
 */
function saveOutput(slides, content, options = {}) {
  const outputRoot = process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : CAROUSELS_DIR;

  const folderName = safeOutputName(options.outputName || options.templateId || content.topic, 'carousel');
  const folder = path.join(outputRoot, folderName);

  fs.mkdirSync(folder, { recursive: true });

  // Save each slide
  for (const slide of slides) {
    const filename = `slide_${slide.slide_number}.jpg`;
    fs.writeFileSync(path.join(folder, filename), slide.processedImage);
    console.log(`  Saved: ${filename} (${slide.imageSource || slide.slideType})`);
  }

  // Save content metadata
  const metadata = {
    topic: content.topic,
    hook: content.hook,
    caption: content.caption,
    hashtags: content.hashtags,
    template_id: content.template_id || null,
    template_label: content.template_label || null,
    template_slide_count: content.template_slide_count || slides.length,
    template_pair_count: content.template_pair_count || null,
    research_artifact_path: content.research_artifact_path || null,
    research_context: content.research_context || null,
    slides: slides.map(s => ({
      slide_number: s.slide_number,
      slide_type: s.slide_type || s.slideType || null,
      product_name: s.product_name || null,
      image_source: s.image_source,
      image_prompt: s.image_prompt,
      web_image_query: s.web_image_query,
      text_overlay: s.text_overlay,
      text_position: s.text_position,
      score: s.score || null
    })),
    generated_at: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(folder, 'metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  console.log(`  Saved: metadata.json`);

  if (content.caption) {
    fs.writeFileSync(path.join(folder, `${folderName}_caption.txt`), content.caption);
    console.log(`  Saved: ${folderName}_caption.txt`);
  }

  if (content.hook) {
    fs.writeFileSync(path.join(folder, `${folderName}_hook.txt`), content.hook);
    console.log(`  Saved: ${folderName}_hook.txt`);
  }

  // Create HTML preview
  createPreviewHTML(folder, content, slides);
  console.log(`  Saved: preview.html`);

  return folder;
}

/**
 * Main slideshow generation function
 */
async function generateSlideshowV2(argv = process.argv.slice(2)) {
  const cliArgs = parseArgs(argv);
  const config = {
    xaiApiKey: process.env.XAI_API_KEY,
    imageModel: cliArgs.imageModel
  };
  runtimeConfig = config;

  if (cliArgs.listTemplates) {
    console.log('\nAvailable carousel templates:\n');
    for (const template of listCarouselTemplates()) {
      console.log(`- ${template.id}: ${template.description}`);
    }
    return;
  }

  const resolvedTemplate = resolveCarouselTemplate(cliArgs.template);
  const carouselSettings = resolveCarouselSettings(cliArgs, resolvedTemplate);

  console.log('\n========================================');
  console.log('   Content Gen Carousel Renderer');
  console.log('   artifact-driven + Grok-powered');
  console.log('========================================\n');
  console.log(`Carousel template: ${carouselSettings.templateId}`);
  console.log(`Expected slides: ${carouselSettings.slideCount}`);
  console.log(`Expected pairs: ${carouselSettings.pairCount}`);
  console.log();

  validateConfig(config);

  // Reset the debug logger for this run
  const logger = resetLogger();

  const startTime = Date.now();

  try {
    // Step 1: Load saved research/content artifact
    console.log('STEP 1: Loading saved carousel artifact...');
    console.log('----------------------------------------');
    logger.logStep('Pipeline Started', 'save', { timestamp: new Date().toISOString() }, null);

    const content = loadCarouselContentFromArtifact({
      templateId: carouselSettings.templateId,
      templateLabel: carouselSettings.templateLabel,
      slideCount: carouselSettings.slideCount,
      pairCount: carouselSettings.pairCount,
      outputName: cliArgs.outputName,
      researchFile: cliArgs.researchFile,
    });
    const normalizedCaption = buildCarouselCaption({
      content,
      template: resolvedTemplate.template,
    });
    content.caption = normalizedCaption.caption;
    content.hashtags = normalizedCaption.hashtags;

    console.log(`Research artifact: ${content.research_artifact_path}`);

    // Enforce 5 hashtag limit (TikTok maximum)
    if (content.hashtags && content.hashtags.length > 5) {
      console.log(`  Trimming hashtags from ${content.hashtags.length} to 5 (TikTok limit)`);
      content.hashtags = content.hashtags.slice(0, 5);
    }
    // Ensure pomapp hashtag is included
    if (content.hashtags && !content.hashtags.some(h => h.toLowerCase() === 'pomapp')) {
      content.hashtags[content.hashtags.length - 1] = 'pomapp';
    }

    console.log(`\nTopic: ${content.topic}`);
    console.log(`Hook: ${content.hook}`);
    console.log(`Slides: ${content.slides.length}`);

    const webSlides = content.slides.filter(s => s.image_source === 'web').length;
    const aiSlides = content.slides.filter(s => s.image_source === 'ai').length;
    console.log(`Web images: ${webSlides}, AI images: ${aiSlides}`);
    console.log();

    // Step 2: Generate all images
    console.log('STEP 2: Generating images...');
    console.log('----------------------------------------');
    const slidesWithImages = await getAllSlideImages(content.slides, content._productImages || []);
    console.log(`\nGot ${slidesWithImages.length} images`);
    console.log();

    // Step 3: Add text overlays
    console.log('STEP 3: Adding text overlays...');
    console.log('----------------------------------------');
    const slidesWithText = await processAllSlides(slidesWithImages);
    console.log(`Added text overlays to ${slidesWithText.length} slides`);
    console.log();

    // Step 4: Finalize slides
    console.log('STEP 4: Finalizing slides...');
    console.log('----------------------------------------');
    const finalSlides = await finalizeSlides(slidesWithText);

    // Log final slide sequence
    for (const slide of finalSlides) {
      const imageBase64 = slide.processedImage.toString('base64');
      logger.logStep(`Final Slide ${slide.slide_number} (${slide.slideType || 'product'})`, 'save', {
        text_overlay: slide.text_overlay,
        slideType: slide.slideType
      }, {
        imagePreview: `data:image/jpeg;base64,${imageBase64}`
      });
    }

    console.log(`Total slides: ${finalSlides.length}`);
    console.log();

    // Step 5: Save output
    console.log('STEP 5: Saving output...');
    console.log('----------------------------------------');
    const outputFolder = saveOutput(finalSlides, content, {
      outputName: cliArgs.outputName,
      templateId: carouselSettings.templateId,
    });

    // Save debug report
    logger.logStep('Output Saved', 'save', null, { outputFolder });
    logger.saveJSON(outputFolder);
    const debugHtmlPath = logger.saveHTML(outputFolder);
    console.log(`  Saved: debug-log.json`);
    console.log(`  Saved: debug-report.html`);

    console.log(`\nOutput folder: ${outputFolder}`);
    console.log();

    // TikTok upload disabled pending audit approval
    // Preview HTML with copy/download buttons is the final output
    console.log('STEP 6: TikTok upload disabled (pending audit)');
    console.log('  Use preview.html to copy caption and download images');
    console.log();

    // Done!
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('========================================');
    console.log('   COMPLETE!');
    console.log('========================================');
    console.log();
    console.log(`Topic: ${content.topic}`);
    console.log(`Slides: ${content.slides.length} (${webSlides} web, ${aiSlides} AI)`);
    console.log(`Time: ${elapsed}s`);
    console.log();
    console.log(`Preview: file://${outputFolder}/preview.html`);
    console.log(`Debug Report: file://${debugHtmlPath}`);
    console.log();

    // Open both preview and debug report
    if (process.platform === 'darwin') {
      const { spawn } = await import('child_process');
      const previewProc = spawn('open', [path.join(outputFolder, 'preview.html')], {
        detached: true,
        stdio: 'ignore'
      });
      previewProc.unref();
      const debugProc = spawn('open', [debugHtmlPath], {
        detached: true,
        stdio: 'ignore'
      });
      debugProc.unref();
    }

    return {
      success: true,
      outputFolder,
      content,
      slides: finalSlides
    };

  } catch (error) {
    console.error('\nERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (isMainModule(import.meta.url)) {
  generateSlideshowV2().catch(error => {
    console.error('\nERROR:', error.message);
    process.exit(1);
  });
}

export { generateSlideshowV2 };
