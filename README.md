# Content Engine

An agent-driven content tool for generating videos and carousels from plain English.

The intended UX is simple:

1. open the repo in Codex or Claude Code
2. ask for what you want
3. let the agent handle the rest

Examples:

```text
generate a video about a tired founder who clones himself to finish work
```

```text
generate a carousel about how to season a cast iron pan
```

```text
generate a 3-clip promo video for a local bakery
```

You should not need to manually stitch prompts, manage shot plans, or learn the internal scripts first. The repo is designed so the agent can research, pick or create a template, generate assets, save reusable state, and prepare approved content for posting.

## Core Idea

This repo is built around a few simple rules:

- Codex/Claude is the brain
- user requests are turned into reusable templates when appropriate
- prompt logic is saved in repo state, not hidden in ad hoc chat prompts
- Grok powers image and video generation
- Grok still works without an API key by onboarding browser auth and reusing cookies/session state
- approved content can be staged for scheduled posting to TikTok, Instagram, and X
- auto captions are part of the video workflow

## What It Can Make

- AI videos
- multi-clip story videos
- promos
- absurd character videos
- ASMR-style clips
- educational carousels
- product/service carousels
- scheduled ready-to-post assets

The goal is not a niche one-off generator. It should be a tool where people can generate anything they want.

## Main Workflow

Ask the agent for output in plain English.

Typical flow:

1. agent reads repo instructions
2. agent researches the format if needed
3. agent reuses or creates a template
4. agent generates images/video/carousel assets
5. agent saves the run artifacts
6. agent writes captions
7. approved assets can be added to the scheduled posting queue

Key repo instructions:

- [AGENTS.md](AGENTS.md)
- [CLAUDE.md](CLAUDE.md)

## Auth Model

There are two different auth tracks in this repo.

### 1. Grok Generation Auth

Grok can run in two ways:

- with `XAI_API_KEY`
- without an API key, using cookies extracted from your Chrome browser

If you want browser-based generation, log into [grok.com](https://grok.com) in Chrome first, then extract your session cookies:

```bash
npm run auth:grok
```

This reads cookies directly from Chrome's local database — no need to close Chrome or open a special browser window. It will list your Chrome profiles so you can pick the right one.

That saves Grok session state under [`auth/`](auth/).

This repo is explicitly built so generation can still work without an API key.

### 2. Posting Auth

Posting is separate from generation.

To post to TikTok, Instagram, or X, you need saved platform cookies/onboarding:

```bash
npm run auth:posting
```

Or platform-specific:

```bash
npm run auth:posting:tiktok
npm run auth:posting:instagram
npm run auth:posting:x
```

Posting only works after that onboarding has been done.

## Installation

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the full setup guide.

Quick start:

```bash
npm install
pip install -r requirements.txt
npx playwright install chromium
cp .env.example .env
```

Optional:

- add `XAI_API_KEY` to `.env`
- or rely on browser-based Grok session reuse

## Generation Paths

### Video

Video generation is template-first and Grok-powered.

- the agent writes the shot-plan markdown locally first
- image generation via Grok
- video generation via Grok
- browser fallback when API key is missing
- auto captions in the final workflow

List templates:

```bash
node code/cli/video.js --list-templates
```

Render a video from an agent-authored markdown artifact:

```bash
node code/cli/video.js "a chaotic startup ad where the product fixes everything" --template short-viral-promo --md output/videos/startup-chaos/startup-chaos.md
```

### Carousel

Carousel generation is also template-first.

List templates:

```bash
node code/cli/carousel.js --list-templates
```

Generate a carousel:

```bash
node code/cli/carousel.js --template comparison-list --research-file output/carousels/example-topic/research.json
```

In normal use, you usually just ask the agent instead of calling the CLI directly.

## Saved Outputs

Outputs are written under [`output/`](output/).

Typical video run contents:

- `<slug>.md`
- `research.json`
- `<slug>_caption.txt`
- `clips/`
- `<slug>.mp4`

Typical carousel run contents:

- `research.json`
- rendered slides
- caption/hook artifacts
- preview/output assets

## Scheduling And Posting

Approved assets can be moved into the scheduled posting flow for:

- TikTok
- Instagram
- X

See:

- [docs/SCHEDULED_POSTING_QUEUE.md](docs/SCHEDULED_POSTING_QUEUE.md)
- [docs/CROSSPOST_TO_INSTAGRAM.md](docs/CROSSPOST_TO_INSTAGRAM.md)

The important distinction is:

- generation can work through Grok browser auth reuse
- posting requires platform-specific cookie onboarding

## Important Files

- [prompts/video-templates.json](prompts/video-templates.json)
- [prompts/carousel-templates.json](prompts/carousel-templates.json)
- [docs/VIDEO_TEMPLATES.md](docs/VIDEO_TEMPLATES.md)
- [docs/CAROUSEL_TEMPLATES.md](docs/CAROUSEL_TEMPLATES.md)
- [code/cli/video.js](code/cli/video.js)
- [code/cli/carousel.js](code/cli/carousel.js)

## Short Version

If the repo is set up correctly, you should be able to open Codex or Claude Code and say:

```text
generate x video about x
```

or:

```text
generate y carousel about y
```

and the agent should handle the rest.
