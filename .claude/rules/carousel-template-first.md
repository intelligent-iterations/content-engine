# Carousel Template-First Rules

Use this rule file for any carousel request.

## Core Flow

1. Research the topic and current prompt strategy.
2. Decide whether an existing carousel template fits.
3. Add or adapt a reusable template if needed.
4. Save a research/content artifact.
5. Run generation from the template plus saved artifact.

## Source Of Truth

- Registry: `prompts/carousel-templates.json`
- Helper: `code/carousel/template-registry.js`
- Generator: `code/carousel/generate-slideshow.js`
- Prompt/orchestrator logic: `code/carousel/prompts.js` and `code/carousel/orchestrator.js`

## Core Rules

- Carousel work is template-first.
- Keep `template` separate from runtime settings.
- Do not rely on Grok chat for carousel research or slide writing at render time.
- Grok is only for image generation in the carousel pipeline.
- Save output under `output/carousels/<concept-slug>/`.
- Save a research/content artifact under `output/carousels/<concept-slug>/research.json` or `research.md`.

## System Improvement Rule

If a carousel concept exposes a quality gap, fix it in the shared system:
- template fields
- shared prompt-building logic
- shared prompt behavior
- render/runtime behavior

Do not bury the fix in one frozen output unless the user explicitly wants a one-off locked artifact.
