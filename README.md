<p align="center">
  <img src="assets/logo.png" width="280" alt="Content Engine logo" />
</p>

<h1 align="center">II Content Engine</h1>

<p align="center">
  AI-powered content engine for videos and carousels.<br/>
  Say it in plain English, post it everywhere.
</p>

<p align="center">
  <a href="https://github.com/intelligent-iterations/content-engine/actions/workflows/ci.yml"><img src="https://github.com/intelligent-iterations/content-engine/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/intelligent-iterations/content-engine/releases"><img src="https://img.shields.io/github/v/release/intelligent-iterations/content-engine?label=version" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js >= 18" />
  <a href="https://discord.gg/DEGQX9RVNn"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>
</p>

---

Content Engine turns plain-English prompts into publish-ready videos and carousels for TikTok, Instagram, and X. Open the repo in [Claude Code](https://claude.ai) or [Codex](https://openai.com/codex), describe what you want, and the agent handles research, template selection, asset generation, captioning, and scheduled posting.

Everything is **template-first** — your ideas become reusable formats, not throwaway prompts. Generation is powered by **Grok** (API key or browser session), so you can produce content with or without an xAI API key. Approved assets flow into a scheduling queue that posts on your behalf.

## What It Makes

- **Videos** — short-form viral clips, multi-clip story arcs, promos, character pieces, ASMR-style content
- **Carousels** — educational breakdowns, comparison lists, product showcases
- **Auto-captioned assets** — captions baked into every video workflow
- **Scheduled posts** — queue approved content for TikTok, Instagram, and X

## Quick Start

```bash
npm install
pip install -r requirements.txt
npx playwright install chromium
cp .env.example .env
```

Optionally add your `XAI_API_KEY` to `.env`, or rely on browser-based Grok session reuse.

Then open the repo in Claude Code or Codex and ask:

```text
generate a video about a tired founder who clones himself to finish work
```

```text
generate a carousel about how to season a cast iron pan
```

```text
generate a 3-clip promo video for a local bakery
```

## How It Works

1. **You describe** what you want in plain English
2. **The agent researches** the format and finds or creates a reusable template
3. **Grok generates** images and video clips from the template's prompt contract
4. **The pipeline stitches** clips, adds captions, and saves all artifacts
5. **You approve** and the agent queues the asset for scheduled posting

## Auth Model

There are two separate auth tracks:

**Grok (generation)** — works with `XAI_API_KEY` in `.env` or via browser cookies extracted from Chrome (`npm run auth:grok`). Generation works without an API key.

**Platform posting** — requires saved cookies for each platform. Run `npm run auth:posting` (or platform-specific variants like `npm run auth:posting:tiktok`) to extract session cookies from Chrome.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for the full setup guide.

## Documentation

- [Installation Guide](docs/INSTALLATION.md)
- [Video Templates](docs/VIDEO_TEMPLATES.md)
- [Carousel Templates](docs/CAROUSEL_TEMPLATES.md)
- [Scheduled Posting Queue](docs/SCHEDULED_POSTING_QUEUE.md)
- [Crosspost to Instagram](docs/CROSSPOST_TO_INSTAGRAM.md)

## License

[MIT](LICENSE)
