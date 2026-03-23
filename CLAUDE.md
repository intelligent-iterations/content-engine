# CLAUDE.md

## Repo Role

This repo is template-first. Treat user ideas as reusable formats whenever possible, not disposable prompt requests.

Keep separate:
1. `template`
2. `research artifact`
3. `render settings`

Anything that matters for reruns must be saved in repo state.

## Output Rules

- Video runs go under `output/videos/<concept-slug>/`
- Carousel runs go under `output/carousels/<concept-slug>/`
- Post-ready assets go under `output/scheduled_videos/` or `output/scheduled_carousels/`

For video runs, save:
- `<slug>.md`
- `research.json`
- `<slug>_caption.txt`
- `clips/`
- `<slug>.mp4`

Do not scatter video artifacts across the repo root, `downloads/`, or ad hoc folders. A video run is complete only when its working files and final outputs live together inside that run's own folder.

## Required Rule Files

Read and follow the matching rule file before doing substantial work:

- Video template work:
  - `.claude/rules/video-template-first.md`
  - `.codex/rules/video-template-first.md`
- Grok image/video prompting:
  - `.claude/rules/grok-video-prompting.md`
  - `.codex/rules/grok-video-prompting.md`
- Carousel work:
  - `.claude/rules/carousel-template-first.md`
  - `.codex/rules/carousel-template-first.md`

## Default Behavior

- New or materially changed formats require research first.
- For new or materially changed prompting work, do narrow research first, then wide research.
- Narrow research means starting with the exact format, character type, visual style, or failure mode involved in the request.
- Narrow research should begin with likely creator language at the right level of abstraction, not generic umbrella labels and not hyper-specific one-off phrasing. Search terms should usually be broad, highly relevant, and around 4 words or fewer.
- If the first narrow pass is weak, reformulate and retry several times with adjacent niche phrasings, platform-native slang, and likely creator wording before treating the niche as under-documented.
- Do not stop after one weak search round when the format is plausibly something creators have already tested. Try multiple query shapes across X, Reddit, search engines, and adjacent practitioner communities first.
- Do at least 5 distinct web research searches or passes before moving on from research into prompt writing for a new or materially changed format.
- Wide research means expanding into broader model behavior, continuity tactics, reference-image reuse patterns, and adjacent prompt strategies.
- For prompting quality research, prioritize recent practitioner advice on X and Reddit over official docs. Use official docs mainly for capability limits, API behavior, and product mechanics.
- The agent is the primary brain for planning, scripting, template design, prompt contracts, and saved run artifacts. The agent must author the compilation markdown locally and save it before any render step starts.
- Do not use Grok chat to author, repair, or rewrite the core shot plan, compilation markdown, reusable template, or caption strategy.
- Use Grok text/chat only as a research input when needed, such as checking recent practitioner advice from X or collecting external prompt opinions that are then rewritten and distilled locally by the agent into repo state.
- The video CLI/render pipeline should consume an existing local `<slug>.md` artifact. Treat markdown generation as agent work, not a Grok runtime step.
- Prefer adding or adapting templates over hard-coded prompt branches.
- If `XAI_API_KEY` is missing, keep the run template-driven and render from saved artifacts.
- If `XAI_API_KEY` is missing but a saved Grok web session exists, continue with the browser automation path from the saved artifacts rather than stopping at markdown/research generation.
- Before treating a video render as blocked, check for browser-session fallback files such as `auth/grok-session-cookies.json` or `auth/grok-storage-state.json`.
- Caption nudge: carousel captions and reel/video captions should usually land between 2100 and 2200 characters, front-load the hook in the first 125 characters, stay SEO-friendly, and use the local caption-writing fallback instead of treating missing `XAI_API_KEY` as a caption blocker.
- For stitched multi-clip videos, treat continuity as a first-order requirement: the script, acting beats, character design, wardrobe, environment, and cinematic style should survive across clips unless the format explicitly calls for change.
- If continuity matters across clips, prefer image-conditioned generation and reference-image reuse whenever the toolchain supports it. Do not let each clip reinvent the same character, environment, object, or world style from scratch if that can be avoided.
- The video system supports both `per_clip` image-to-video references and `shared_reference` reuse across clips. Use `per_clip` for isolated beats or loose compilations; use `shared_reference` whenever a stitched sequence depends on continuity of characters, environments, objects, or overall world style.
- If native dialogue harms acting quality, reduce dialogue complexity and let visuals or captions carry more of the story.
- Do not render first-pass videos for unfamiliar or continuity-sensitive formats until the research has been distilled into saved repo state.
- Preserve reusable knowledge in repo files, not in chat.

## Key Files

- Video templates: `prompts/video-templates.json`
- Video template builder: `code/video/template-registry.js`
- Video generator: `code/video/generate-video.js`
- Video pipeline: `code/video/generate-video-compilation.js`
- Carousel templates: `prompts/carousel-templates.json`

## Grok Auth Flow

If `XAI_API_KEY` is not set and no valid session exists at `auth/grok-storage-state.json`, the agent needs browser cookies to use Grok.

To authenticate:

1. Ask the user to confirm they are logged into [grok.com](https://grok.com) in one of their Chrome profiles.
2. Ask which Chrome profile (email) they are logged in with.
3. Run the export script with that profile:
   ```bash
   npm run auth:grok -- --profile "Profile 3"
   ```
   The user will need to approve the macOS Keychain prompt to decrypt Chrome cookies.
4. Verify the output shows auth cookies (sso, auth_token, ct0, etc.).

The exported cookies are saved to `auth/grok-storage-state.json` and gitignored. No secrets are committed.

If the user does not know their profile directory name, run without `--profile` to show a numbered list of all Chrome profiles with their email addresses.

## Posting Auth Flow

The same Chrome cookie extraction approach works for Instagram, TikTok, and X posting cookies. The user must be logged into the relevant platform in a Chrome profile.

To extract posting cookies, run `browser-cookie3` for the target domain and save to the expected cookie file:

- **Instagram** → `cookies/instagram_cookies.json` (domain: `.instagram.com`)
- **TikTok** → `cookies/tiktok_cookies.json` (domain: `.tiktok.com`)
- **X** → `cookies/x_cookies.json` (domain: `.x.com`)

The user may use different Chrome profiles for different platforms (e.g. one account for Instagram, another for TikTok). Always ask which Chrome profile to use for each platform.

Cookie files are a JSON array of objects with fields: `name`, `value`, `domain`, `path`, `expires`, `httpOnly`, `secure`, `sameSite`.

All cookie files are gitignored. No secrets are committed.

## Standard

The work is not done if the output succeeded once but the reusable template/research state was not saved.
