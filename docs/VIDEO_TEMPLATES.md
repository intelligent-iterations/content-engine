# Video Templates

Video generation is split into three layers:

1. `template`
Defines the repeatable creative system.
This can now include a structured creative contract:
- `workflow_contract`
- `tool_plan_contract`
- `video_execution_contract`
- `asset_contract`
- `cast_contract`
- `scene_contract`
- `continuity_contract`

2. `render settings`
Defines clip count, runtime, aspect ratio, and reference-image strategy.

3. `ai_prompt_contract`
Defines the reusable prompt rules used to build the compilation markdown and caption prompts.

Each run also saves a research artifact under `output/videos/<concept-slug>/research.json`.

Anything that goes into the model should come from [`prompts/video-templates.json`](../prompts/video-templates.json). The code should assemble saved prompt state, not invent a fresh prompt contract inline.

## Template Contract

Templates are allowed to encode more than high-level style notes.
For continuity-sensitive formats, a strong template should be able to specify:

- the required authoring workflow
- the asset requirements before rendering
- the concrete asset-generation and verification jobs the bridge CLI should execute
- the concrete video-execution prompt rules the bridge CLI should execute
- the cast roles and wardrobe-lock rules
- the scene structure and start-frame strategy
- the continuity priorities across clips

Example: a fruit-drama template can require a named cast, per-character reference assets, one start frame per scene, a five-beat betrayal arc, and shared-reference continuity.

Templates can also define `authoring_sections`, which the scaffold CLI turns into a starter markdown file. That keeps the system generic: fruit drama is one template that asks for cast sheets and scene start frames, but other formats can ask for product claims, mascot rules, or location locks without changing renderer code.

## Current Templates

- `anthropomorphic-fruit-infidelity-drama`
- `anthropomorphic-fruit-revenge-drama`
- `anthropomorphic-alphabet-infidelity-drama`
- `cute-character-asmr-destruction`

## Runtime Flow

1. The agent researches the format and request.
2. The agent chooses or creates a reusable template.
3. The agent scaffolds or authors the compilation markdown from the template contract.
4. The agent prepares any required cast, scene, and asset state, typically via `asset-manifest.json`.
5. The template expands into concrete image-generation and verification jobs via `tool_plan_contract`, saved as `plans/tool-plan.json`.
6. The template expands markdown clips into concrete video jobs via `video_execution_contract`, saved as `plans/execution-plan.json`.
7. Executors consume those saved JSON plans.
8. The agent writes the final clip prompts and caption prompt from saved repo state.
9. Grok generates the images and videos.
10. The run is saved under `output/videos/<slug>/`.

If browser fallback is used, the pipeline still stays template-first and artifact-driven.

## Key Files

- [prompts/video-templates.json](../prompts/video-templates.json)
- [code/video/template-registry.js](../code/video/template-registry.js)
- [code/video/generate-video.js](../code/video/generate-video.js)
- [code/video/generate-video-compilation.js](../code/video/generate-video-compilation.js)
- [code/video/plan-files.js](../code/video/plan-files.js)
- [docs/prompts/README.md](./prompts/README.md)
- [docs/prompts/CHARACTER_ASMR_PROMPT_BEST_PRACTICES.md](./prompts/CHARACTER_ASMR_PROMPT_BEST_PRACTICES.md)
- [docs/prompts/STORY_CHARACTER_PROMPT_GUIDE.md](./prompts/STORY_CHARACTER_PROMPT_GUIDE.md)

## Guidance Map

- `docs/prompts/` contains reusable prompt-authoring guidance and asset-chain rules.
- For continuity-sensitive character stories, the default required chain is:
  `hero portrait -> derived character sheet -> scene start frames -> video`
- For continuity-sensitive character stories, use the asset executor path before final render.
- Executors should run from saved plan JSON in `output/videos/<slug>/plans/`.

## CLI

List templates:

```bash
node code/cli/video.js --list-templates
```

High-level workflow entrypoint:

```bash
node code/cli/video-workflow.js prepare "anthropomorphic fruit cheating drama in a brunch cafe" --template anthropomorphic-fruit-infidelity-drama --output-name cheating-fruit-drama
node code/cli/video-workflow.js render "anthropomorphic fruit cheating drama in a brunch cafe" --template anthropomorphic-fruit-infidelity-drama --output-name cheating-fruit-drama
node code/cli/video-workflow.js prepare "absurd fruit revenge story in a dessert banquet hall" --template anthropomorphic-fruit-revenge-drama --output-name fruit-revenge
node code/cli/video-workflow.js render "absurd fruit revenge story in a dessert banquet hall" --template anthropomorphic-fruit-revenge-drama --output-name fruit-revenge
node code/cli/video-workflow.js queue "anthropomorphic fruit cheating drama in a brunch cafe" --output-name cheating-fruit-drama
```

Or, once the agent has authored the run artifacts:

```bash
node code/cli/video-workflow.js ship "anthropomorphic fruit cheating drama in a brunch cafe" --template anthropomorphic-fruit-infidelity-drama --output-name cheating-fruit-drama
```

Initialize asset helpers for a run:

```bash
node code/cli/video-assets.js init --topic "anthropomorphic fruit cheating drama in a brunch cafe" --template anthropomorphic-fruit-infidelity-drama --output-name cheating-fruit-drama
```

Render a video from an agent-authored markdown file:

```bash
node code/cli/video.js "absurd fruit revenge story in a dessert banquet hall" --template anthropomorphic-fruit-revenge-drama --md output/videos/fruit-revenge/fruit-revenge.md
```

Scaffold a new markdown file from the template contract:

```bash
node code/cli/video-template-scaffold.js "anthropomorphic fruit cheating drama in a brunch cafe" --template anthropomorphic-fruit-infidelity-drama --output-name cheating-fruit-drama
```

Generate cast assets or scene start frames from saved asset state:

```bash
node code/cli/video-tool-plan.js --manifest output/videos/cheating-fruit-drama/asset-manifest.json --json
node code/cli/video-execution-plan.js output/videos/cheating-fruit-drama/cheating-fruit-drama.md --json
node code/cli/video-assets.js cast --plan output/videos/cheating-fruit-drama/plans/tool-plan.json
node code/cli/video-assets.js scene-frames --plan output/videos/cheating-fruit-drama/plans/tool-plan.json
```

Render a single-clip ASMR cut:

```bash
node code/cli/video.js "cute moss mascot on a cutting board" --template cute-character-asmr-destruction --md output/videos/moss-asmr/moss-asmr.md
```

## Saved Run Files

Typical video run contents:

- `<slug>.md`
- `research.json`
- `asset-manifest.json`
- `plans/tool-plan.json`
- `plans/execution-plan.json`
- `<slug>_caption.txt`
- `clips/`
- `<slug>.mp4`

Caption terminology:

- `<slug>_caption.txt` is the post caption for TikTok / Instagram / X.
- Burned captions inside the final `.mp4` are on-video dialogue subtitles derived from the clip prompts.

The job is not complete if the agent gets a good result once but does not leave behind reusable repo state.
