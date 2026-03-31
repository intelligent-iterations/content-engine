# Carousel Templates

Carousel generation is artifact-driven and split into three layers:

1. `template`
Defines the repeatable creative format.

2. `settings`
Defines the mechanical output such as slide count and image style.

3. `ai_prompt_contract`
Stores reusable prompt rules and format guidance for agents when they create carousel artifacts.

The current carousel renderer is artifact-driven. Template listing and default resolution now live directly inside [`generate-slideshow.js`](../code/carousel/generate-slideshow.js), so there is no separate carousel template-registry module anymore.

## Current Templates

- `how-to-tutorial`
- `comparison-list`
- `single-topic-breakdown`

## Runtime Flow

1. Codex or Claude researches the request.
2. The agent chooses or creates a reusable carousel template.
3. The agent saves a resolved carousel artifact under `output/carousels/<slug>/research.json` or `research.md`.
4. [`generate-slideshow.js`](../code/carousel/generate-slideshow.js) loads that artifact and renders the slides.

Grok is only used for image generation in the carousel path. The agent is responsible for the thinking, structure, and saved artifact.

## How To Do A Carousel

The carousel workflow should feel exactly like the video workflow in one important way: the saved artifact is the source of truth.

1. Choose or create a reusable carousel template.
2. Save the run under `output/carousels/<slug>/`.
3. Put the hook, slide plan, caption, and image prompts into the saved artifact.
4. Render from that artifact, not from a one-off inline prompt.

Videos need markdown, asset state, and plan JSON because they have more moving parts. Carousels are simpler. Most carousel runs can be fully described by one saved `research.json` file plus the rendered outputs beside it.

## Example

Example output:

- Preview: [example/fufu-how-to-carousel/preview.html](../example/fufu-how-to-carousel/preview.html)
- Research artifact: [example/fufu-how-to-carousel/research.json](../example/fufu-how-to-carousel/research.json)
- Slides: [example/fufu-how-to-carousel](../example/fufu-how-to-carousel)

This is the current tracked carousel showcase. It lives under `example/`, not `output/`, so the docs point at a real committed artifact instead of a gitignored runtime folder.

## Key Files

- [prompts/carousel-templates.json](../prompts/carousel-templates.json)
- [code/carousel/generate-slideshow.js](../code/carousel/generate-slideshow.js)
- [code/carousel/research-artifact.js](../code/carousel/research-artifact.js)

## CLI

List templates:

```bash
node code/cli/carousel.js --list-templates
```

Render a saved artifact:

```bash
node code/cli/carousel.js --template comparison-list --research-file output/carousels/example-topic/research.json
```

Concrete example:

```bash
node code/cli/carousel.js \
  --template how-to-tutorial \
  --research-file example/fufu-how-to-carousel/research.json
```

## Artifact Shape

Typical saved carousel artifact:

```json
{
  "template_id": "comparison-list",
  "topic": "3 landing page mistakes and better fixes",
  "hook": "3 landing page mistakes most people miss",
  "caption": "Long SEO-friendly caption text",
  "hashtags": ["landingpage", "marketing", "copywriting", "webdesign", "conversion"],
  "slides": [
    {
      "slide_number": 1,
      "slide_type": "hook",
      "image_source": "ai",
      "image_prompt": "text-free visual prompt",
      "text_overlay": "3 landing page mistakes",
      "text_position": "top"
    }
  ],
  "research_context": {
    "summary": ["short saved notes"],
    "sources": [
      {
        "label": "Source name",
        "url": "https://example.com"
      }
    ]
  }
}
```
