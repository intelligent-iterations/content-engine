# Installation

## Requirements

- Node.js 18+
- Python 3.10+
- Chromium for Playwright

## Install Everything

```bash
npm install
pip install -r requirements.txt
npx playwright install chromium
cp .env.example .env
```

What each command does:

- `npm install`: installs the Node/JavaScript dependencies
- `pip install -r requirements.txt`: installs the Python dependencies used by setup and posting scripts
- `npx playwright install chromium`: installs the browser binary required for Playwright automation
- `cp .env.example .env`: creates your local environment file

## First-Time Setup Checklist

1. Clone the repo
2. Run the install commands above
3. Choose your AI auth method:
   - add `XAI_API_KEY` to `.env`
   - or save a Grok browser session
4. If you want automated posting, run the cookie setup script for the platforms you use
5. Run a first command to verify the install

Example verification commands:

```bash
node code/shared/generate-image.js
npm run grok:image -- --help
python3.12 setup.py --help
```

## AI Auth

You have two options for AI generation:

### Option 1: xAI API key

Put your key in `.env`:

```bash
XAI_API_KEY=your_xai_key
XAI_SPEND_BUDGET_USD=25
XAI_SPEND_CAP_USD=40
```

This is the primary path for:

- image generation
- video generation where supported
- Grok-written X captions when those posting flows use the API

Carousel rendering does not use xAI text generation. It expects a saved research/content artifact created by Claude Code / Codex first, then uses Grok only for image generation.

If you set `XAI_SPEND_BUDGET_USD`, the repo will warn when projected monthly spend crosses that budget. If you set `XAI_SPEND_CAP_USD`, the repo will block new billable xAI calls once the projected monthly spend would cross the cap. Spend logs are written to `output/tracking/api-spend-events.jsonl` and `output/tracking/api-spend-summary.json`.

### Option 2: Chrome cookie extraction

If you do not want to use an API key, you can extract your existing Grok session cookies from Chrome.

Prerequisites:
- Be logged into [grok.com](https://grok.com) in Chrome
- `browser-cookie3` installed (`pip install -r requirements.txt`)

Then run:

```bash
npm run auth:grok
```

This reads cookies directly from Chrome's local database. It will list your Chrome profiles with email addresses so you can pick the right one. No need to close Chrome.

You can also pass a profile directly for automation:

```bash
npm run auth:grok -- --profile "Profile 3"
```

Saved Grok auth is read from:

- `auth/grok-storage-state.json`

If cookies expire, just re-run `npm run auth:grok` — it takes a few seconds.

Important browser fallback note:

- Saved Grok/X cookies are only enough if browser submit reaches a real generation job.
- If Grok opens the `SuperGrok` subscribe modal instead of generating, browser rendering is blocked for that session and the repo should not treat Discover/gallery media as a valid result.

## Automated Posting Auth

Posting auth (Instagram, TikTok, X cookies) lives in the social media poster package (`ii-social-media-poster-internal`), not here. See that package's `setup.py` for cookie capture and GitHub Secrets setup.

## Common Commands

Render a carousel from a saved artifact:

```bash
node code/cli/carousel.js --template comparison-list --output-name example-topic --research-file output/carousels/example-topic/research.json
```

Render a video from a saved markdown artifact:

```bash
node code/cli/video.js "absurd fruit revenge story in a dessert banquet hall" --template anthropomorphic-fruit-revenge-drama --output-name fruit-revenge --md output/videos/fruit-revenge/fruit-revenge.md
```

Export Grok cookies from Chrome and push to GitHub Secrets:

```bash
npm run auth:grok
```

Build the local Docker images used by launchd/autopost:

```bash
npm run docker:build
```

Inspect spend totals:

```bash
npm run spend:report
```

## Summary

- AI usage: either set `XAI_API_KEY` in `.env`, or log into grok.com in Chrome and run `npm run auth:grok` to push Grok cookies to GitHub Secrets
- Browser fallback still requires a session that can actually submit a generation job. If submit opens the `SuperGrok` subscribe modal, browser rendering is blocked for that session.
- Automated posting: managed by `ii-social-media-poster-internal`, not this package
- Saved videos go under `output/videos/<concept-slug>/`
- Saved carousels go under `output/carousels/<concept-slug>/`
- Scheduled auto-post queues live under `output/scheduled_videos/<slug>/` and `output/scheduled_carousels/<slug>/`
