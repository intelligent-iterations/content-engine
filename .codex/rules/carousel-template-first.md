# Codex Carousel Template-First Rules

Use this file for carousel requests in Codex.

## Core Flow

1. Research the topic and prompt strategy.
2. Decide whether an existing carousel template fits.
3. Add or adapt a reusable template.
4. Save a research/content artifact.
5. Run generation from the template plus saved artifact.

## Source Of Truth

- `prompts/carousel-templates.json`
- `code/carousel/template-registry.js`
- `code/carousel/generate-slideshow.js`
- `code/carousel/prompts.js`
- `code/carousel/orchestrator.js`

## Core Rules

- Carousel work is template-first.
- Keep template separate from runtime settings.
- Do not use Grok chat for carousel research or slide writing at render time.
- Grok is only for image generation in the carousel pipeline.
- Save output under `output/carousels/<concept-slug>/`.
- Save `research.json` or `research.md` alongside the run.
