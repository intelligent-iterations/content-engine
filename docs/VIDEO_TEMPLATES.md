# Video Templates

Video generation is split into three layers:

1. `template`
Defines the repeatable creative system.

2. `render settings`
Defines clip count, runtime, aspect ratio, and reference-image strategy.

3. `ai_prompt_contract`
Defines the reusable prompt rules used to build the compilation markdown and caption prompts.

Each run also saves a research artifact under `output/videos/<concept-slug>/research.json`.

Anything that goes into the model should come from [`prompts/video-templates.json`](../prompts/video-templates.json). The code should assemble saved prompt state, not invent a fresh prompt contract inline.

## Current Templates

- `story-driven-character-drama`
- `cute-character-asmr-destruction`
- `short-viral-promo`

## Runtime Flow

1. The agent researches the format and request.
2. The agent chooses or creates a reusable template.
3. The agent writes the compilation markdown and caption prompt from saved repo state.
4. Grok generates the images and videos.
5. The run is saved under `output/videos/<slug>/`.

If browser fallback is used, the pipeline still stays template-first and artifact-driven.

## Key Files

- [prompts/video-templates.json](../prompts/video-templates.json)
- [code/video/template-registry.js](../code/video/template-registry.js)
- [code/video/generate-video.js](../code/video/generate-video.js)
- [code/video/generate-video-compilation.js](../code/video/generate-video-compilation.js)

## CLI

List templates:

```bash
node code/cli/video.js --list-templates
```

Render a video from an agent-authored markdown file:

```bash
node code/cli/video.js "a tiny office feud between two mascot characters" --template story-driven-character-drama --md output/videos/mascot-feud/mascot-feud.md
```

Render a short promo:

```bash
node code/cli/video.js "a local bakery promo" --template short-viral-promo --md output/videos/bakery-promo/bakery-promo.md
```

## Saved Run Files

Typical video run contents:

- `<slug>.md`
- `research.json`
- `<slug>_caption.txt`
- `clips/`
- `<slug>.mp4`

The job is not complete if the agent gets a good result once but does not leave behind reusable repo state.
