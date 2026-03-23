# Codex Grok Video Prompting Rules

Use this file for Grok image/video work in Codex.

## Grok-Native Split

Treat image prompting and video prompting as separate jobs.

- Image prompt:
  lock first frame, identity, wardrobe, set, composition, lighting, and style
- Video prompt:
  animate that frame with one dominant action, dialogue in quotes, and simple audio/camera notes

## Per-Clip Required Sections

- `Continuity Anchors`
- `Image Prompt`
- `Video Prompt`
- `Fallback Video Prompt`

## Length Targets

- image prompt: `70-180` words
- video prompt: `35-110` words
- fallback video prompt: `25-80` words

## Fallback Policy

Always save a fallback video prompt.

Only execute fallback prompts automatically if the primary video prompt is rejected or fails in a moderation / invalid-argument style way.

## Continuity

Restate recurring:
- character identity
- face/head type
- wardrobe palette
- body proportions
- environment/set
- overall style

For stitched character videos:
- continuity beats novelty
- write image prompts like reference-sheet locks, not fresh reinterpretations
- preserve the same face geometry, age signal, costume logic, and cinematic grade across clips
- if the system supports reference-image reuse, prefer that over text-only re-description
- if dialogue weakens expressions or acting, reduce the spoken line and let the visual beat lead

Persist Grok-specific findings in `research.json`.

## Research Expectations

Prefer this order for prompting-quality work:
1. narrow practitioner research on X for the exact format, subject, or failure mode
2. narrow practitioner research on Reddit for the exact format, subject, or failure mode
3. wider practitioner research on X and Reddit for adjacent prompt tactics and continuity workflows
4. official xAI docs for product limits, API behavior, and supported mechanics
5. recent implementation writeups as secondary support

For narrow research, begin with likely creator wording at the right level of abstraction. Search terms should usually be broad, highly relevant, and around 4 words or fewer before you narrow toward the exact scenario or continuity problem.

If the first narrow pass is weak, reformulate and retry multiple times with adjacent niche phrasings, slang, synonymous subject labels, and likely post wording. Do not conclude that there is no signal after one weak pass when the format is likely something practitioners have explored.

Do at least 5 distinct web research searches or passes before moving on from research into prompt writing for a new or materially changed format.

Do not jump straight to broad generic prompting advice if the format is niche or visually specific.
