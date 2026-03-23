# Codex Video Template-First Rules

Use this file for video requests in Codex.

## Core Flow

1. Research the requested output type and current prompting practices.
2. Decide whether an existing video template fits.
3. Add or adapt a reusable template if needed.
4. Distill the research into the template and prompt contract.
5. Run generation from the saved template.
6. Leave behind reusable repo state.

## Source Of Truth

- `prompts/video-templates.json`
- `code/video/template-registry.js`
- `code/video/generate-video.js`
- `code/video/generate-video-compilation.js`
- `docs/VIDEO_TEMPLATES.md`

## Separation Rules

Keep separate:
- `template`
- `research artifact`
- `render settings`

Anything that goes into prompts should come from saved repo state, not ad hoc code branches.

## Output Rules

Save video runs under `output/videos/<concept-slug>/`.

Expected files:
- `<slug>.md`
- `research.json`
- `<slug>_caption.txt`
- `clips/`
- `<slug>.mp4`

Keep all artifacts for a given video run inside that one folder. Do not leave shot plans, captions, finals, or helper assets scattered elsewhere in the repo.

If `XAI_API_KEY` is missing, stay template-first and render from saved artifacts rather than raw-topic browser prompting.

## Continuity Standard

For stitched multi-clip videos:

- continuity is a core quality bar, not a polish step
- the script should read as one coherent piece, not disconnected prompt fragments
- recurring subjects and worlds should preserve the same identity, silhouette, wardrobe/design logic, palette, environment, props, and overall world style across clips
- if the pipeline supports image-conditioned generation or reference-image reuse, use it whenever continuity matters
- choose a `reference_strategy` intentionally: `per_clip` for isolated beats, `shared_reference` for continuity-sensitive stitched sequences
- if native dialogue makes performance worse, simplify the spoken lines and shift more story load into visuals or captions
