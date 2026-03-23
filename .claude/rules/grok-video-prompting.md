# Grok Video Prompting Rules

Use this rule file for Grok image/video generation work.

## Grok-Native Prompt Structure

Treat Grok image prompting and Grok video prompting as separate jobs.

- Image prompt:
  lock the opening frame, subject identity, wardrobe, set, composition, lighting, and overall style
- Video prompt:
  animate that established frame with one dominant action, dialogue in quotes, and simple audio/camera notes

## Per-Clip Required Sections

Every Grok multi-clip shot should carry:
- `Continuity Anchors`
- `Image Prompt`
- `Video Prompt`
- `Fallback Video Prompt`

## Length Targets

Default target ranges unless the format clearly needs a justified exception:
- image prompt: `70-180` words
- video prompt: `35-110` words
- fallback video prompt: `25-80` words

These are floors/guidance, not a reason to inflate weak prose.

## Continuity Rules

For recurring characters or worlds, restate:
- character identity
- face/head type
- wardrobe palette
- body proportions
- environment/set
- overall style

Continuity anchors should survive across all scenes unless the user explicitly asks for a change.

For stitched character videos:
- continuity beats novelty
- write image prompts like reference-sheet locks, not fresh reinterpretations
- preserve the same face geometry, costume logic, body proportions, and cinematic grade across clips
- if the system supports reference-image reuse, prefer it over text-only re-description
- if dialogue hurts acting quality, shorten it and let the visual beat do more of the work

## Motion Rules

- One dominant action per clip
- Action before dialogue
- Natural-language film direction, not keyword spam
- Keep lip-sync scenes simple and readable
- Do not rely on readable on-screen text

## Fallback Prompt Policy

Always save a fallback video prompt for every clip.

Fallback prompts should:
- preserve the same story beat
- use softer wording
- reduce explicitness if moderation risk exists
- keep the same dialogue if possible

Execute fallback prompts automatically only if the primary video prompt is rejected or fails in a moderation/invalid-argument style way.

## Research Expectations

For Grok-first work, prefer this order:
1. narrow practitioner research on X for the exact format, subject, or failure mode
2. narrow practitioner research on Reddit for the exact format, subject, or failure mode
3. wider practitioner research on X and Reddit for adjacent prompt tactics and continuity workflows
4. official xAI docs for product limits, API behavior, and supported mechanics
5. recent implementation writeups as secondary support

For narrow research, begin with likely creator wording at the right level of abstraction. Search terms should usually be broad, highly relevant, and around 4 words or fewer before you narrow toward the exact scenario or continuity problem.

If the first narrow pass is weak, reformulate and retry multiple times with adjacent niche phrasings, slang, synonymous subject labels, and likely post wording. Do not conclude that there is no signal after one weak pass when the format is likely something practitioners have explored.

Do at least 5 distinct web research searches or passes before moving on from research into prompt writing for a new or materially changed format.

Do not jump straight to broad generic prompting advice if the format is niche or visually specific.

Persist Grok-specific findings in `research.json`.
