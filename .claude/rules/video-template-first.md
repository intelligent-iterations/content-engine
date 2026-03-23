# Video Template-First Rules

Use this rule file for any video request.

## Core Operating Model

Treat each user request as a candidate reusable video format, not a disposable prompt.

Required flow:
1. Research the requested output type and current prompting practices.
2. Decide whether an existing video template truly fits.
3. If not, add a new template or duplicate and adapt an existing one.
4. Distill the research into the template and prompt contract.
5. Run generation from the saved template.
6. Leave behind reusable repo state.

## Source Of Truth

- Template registry: `prompts/video-templates.json`
- Template builder: `code/video/template-registry.js`
- Main generator: `code/video/generate-video.js`
- Clip generation and stitching: `code/video/generate-video-compilation.js`
- Docs: `docs/VIDEO_TEMPLATES.md`

## Separation Rules

Keep these layers separate:
- `template`
- `research artifact`
- `render settings`

Do not bury reusable creative logic in ad hoc code branches.
Anything that goes into an AI prompt should come from the registry, shared contract blocks, or saved run artifacts.

## Saved Output Rules

Video runs must be saved under `output/videos/<concept-slug>/`.

Expected files:
- `<slug>.md`
- `research.json`
- `<slug>_caption.txt`
- `clips/`
- `<slug>.mp4`

Keep all artifacts for a given video run inside that one folder. Do not leave shot plans, captions, finals, or helper assets scattered elsewhere in the repo.

If `XAI_API_KEY` is missing, do not bypass the template flow with a raw-topic browser fallback. Generate the saved artifacts first, then render from those artifacts.

## Continuity Standard

For stitched multi-clip videos:

- continuity is a primary quality requirement
- the script should feel like one piece with clear setup, escalation, and payoff
- recurring subjects and worlds should keep the same identity, silhouette, wardrobe/design logic, palette, environment, props, and overall world style across clips unless the format explicitly changes them
- when the pipeline supports image-conditioned generation or reference-image reuse, use it whenever continuity matters
- choose a `reference_strategy` intentionally: `per_clip` for isolated beats, `shared_reference` for continuity-sensitive stitched sequences
- if native dialogue degrades acting, lip sync, or clarity, simplify the spoken lines and let visuals/captions carry more story weight

## Template Quality Bar

A template is only done when:
- another agent can reuse it without the original chat
- the behavior is explicit in template fields and contract blocks
- runtime knobs are separate from concept
- multi-clip consistency is explicit where relevant
- the prompt approach reflects current research

## Implementation Rules

- New video formats: update `prompts/video-templates.json`
- Shared prompt behavior: update `code/video/template-registry.js`
- Shared render behavior: update `code/video/generate-video-compilation.js`
- Avoid one-off `if format === ...` branches
- Avoid assuming all clips are 6 seconds
- Preserve frontmatter in generated markdown

## Default Bias

Bias toward:
- saving a new template
- adapting an existing template cleanly
- persisting research conclusions

Do not bias toward:
- temporary prompt edits
- hidden prompt logic
- disposable one-off runs when the format is reusable
