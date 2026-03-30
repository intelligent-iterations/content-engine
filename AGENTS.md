# AGENTS.md

## Repo Role

This repo expects agents to turn user ideas into reusable templates, save the research and prompt contract behind those ideas, and run generation from saved artifacts rather than disposable prompts.

Keep separate:
1. `template`
2. `research artifact`
3. `render settings`

Anything that goes into an AI prompt should come from saved repo state, not one-off inline prompt logic.

## Research

All research artifacts go under `research/`. This directory is gitignored — research is local working state, not committed to the repo. Use it for format research, prompt strategy notes, practitioner findings, and any intermediate research files. Reference research from templates and run artifacts, but keep the raw research in `research/`.

If the user provides substantial research directly in chat, such as a long pasted guide, strategy memo, or prompt reference they want used, treat that as valid research input. Distill it into saved repo state and rely on it by default instead of doing redundant external research that could overwrite or dilute the user's supplied direction. Only do additional research if the user asks for it or if there is a clear gap that blocks execution.

## Output Rules

- Video outputs go under `output/videos/<concept-slug>/`
- Carousel outputs go under `output/carousels/<concept-slug>/`
- Scheduled outputs go under `output/scheduled_videos/` or `output/scheduled_carousels/`

For video runs, save:
- `<slug>.md`
- `research.json`
- `<slug>_caption.txt`
- `asset-manifest.json`
- `plans/tool-plan.json`
- `plans/execution-plan.json`
- `clips/`
- `<slug>.mp4`

Do not scatter video artifacts across the repo root, `downloads/`, or ad hoc folders. A video run is complete only when its working files and final outputs live together inside that run's own folder.

## Required Rule Files

When the task matches, read and follow:

- Video work:
  - `.claude/rules/video-template-first.md`
  - `.codex/rules/video-template-first.md`
- Grok video/image prompting:
  - `.claude/rules/grok-video-prompting.md`
  - `.codex/rules/grok-video-prompting.md`
- Carousel work:
  - `.claude/rules/carousel-template-first.md`
  - `.codex/rules/carousel-template-first.md`
- Prompt best practices:
  - `docs/prompts/STORY_CHARACTER_PROMPT_GUIDE.md`

## Guidance Folders

Treat this folder as the source of truth for reusable documentation guidance:

- `docs/prompts/` for prompt-authoring guidance, asset-chain rules, and prompt best practices

Before authoring prompts, assets, or render jobs:

1. Check `docs/prompts/` for matching prompt guidance.
2. If the task is a continuity-sensitive character story, follow the workflow chain:
   `hero portrait -> derived character sheet -> scene start frames -> video`
3. For continuity-sensitive character stories, run the asset executor path before rendering clips.
4. For continuity-sensitive character stories, scene start frames should default to the approved ordered reference sheets for the visible characters. Do not auto-expand scene references back into sibling hero portraits unless the template explicitly needs that.

## Default Behavior

- New reusable video concepts should usually become templates.
- If the user request matches a saved prompt-best-practices guide, read the relevant file under `docs/prompts/` and apply it before authoring prompts or assets.
- Research is required for new or materially changed formats.
- Substantial user-supplied research can satisfy the research requirement for a format change if it is specific enough to drive the template or run artifact.
- For new or materially changed prompting work, do narrow research first, then wide research.
- Narrow research means searching for the exact format, subject type, and failure mode first, such as the specific character style, medium, or continuity problem you are trying to solve.
- Narrow research should start with likely creator language at the right level of abstraction, not abstract umbrella terms and not overfitted one-off phrasing. Search terms should usually be broad, highly relevant, and around 4 words or fewer.
- If the first narrow search pass is weak, reformulate and retry multiple times with adjacent niche phrasings, platform-native slang, and likely creator wording before concluding that the signal is missing.
- Do not stop after one weak search result set when the format is likely something practitioners have already explored. Try multiple query shapes across X, Reddit, search engines, and adjacent communities first.
- Do at least 5 distinct web research searches or passes before moving on from research into prompt writing for a new or materially changed format.
- Wide research means expanding from that niche into broader model tactics, continuity tactics, reference-image workflows, and adjacent successful formats.
- For prompting quality research, prioritize recent practitioner advice on X and Reddit over official docs. Use official docs mainly for capability limits, API behavior, and product mechanics.
- The agent is the primary brain for planning, scripting, template design, prompt contracts, and saved run artifacts. The agent must author the compilation markdown locally and save it under the run folder before rendering.
- Do not use Grok text/chat to generate, repair, or rewrite the core shot plan, compilation markdown, caption strategy, or reusable template authoring.
- Use Grok text/chat only as a research input when needed, such as checking recent practitioner advice from X or summarizing external prompt opinions that are then rewritten and distilled locally by the agent into repo state.
- The important boundary is this:
  - Codex/Claude should author the template and filled run artifacts.
  - The repo should then render and queue the output.
- The video CLI/render pipeline should consume an existing local `<slug>.md` artifact. Treat markdown authoring as an agent responsibility, not a runtime Grok step.
- Executors should consume saved JSON plans under `output/videos/<slug>/plans/`, not ad hoc inline prompt assembly.
- Post captions in `<slug>_caption.txt` should be authored locally by the agent/local caption writer from saved repo state, not by Grok.
- On-video dialogue captions should come from the rendered clip audio/transcription pipeline, with prompt dialogue used only as fallback alignment data.
- If `XAI_API_KEY` is missing, stay template-first and render from saved artifacts rather than raw-topic browser prompting.
- If `XAI_API_KEY` is missing but a saved Grok web session exists, agents should still run the browser-based generation path from the saved artifacts instead of stopping at prompt files.
- Before declaring a video run blocked on missing `XAI_API_KEY`, check for browser-session fallbacks such as `auth/grok-session-cookies.json` or `auth/grok-storage-state.json`.
- Caption nudge: carousel captions and reel/video captions should usually land between 2100 and 2200 characters, front-load the hook in the first 125 characters, stay SEO-friendly, and use the local caption-writing fallback rather than treating missing `XAI_API_KEY` as a caption blocker.
- Posted-video default: queued videos should stay raw in `output/scheduled_videos/`, the standard promo clip from `/Users/admin/Documents/plug.mov` should be appended immediately before each platform post attempt, and the caption opener should be `Make videos like this by searching ii-content-engine on GitHub.`
- For stitched multi-clip videos, continuity is a primary quality requirement, not a nice-to-have. Agents should optimize for a coherent script, stable character/world design, and visual consistency across clips before optimizing for novelty.
- If continuity matters across clips, prefer image-conditioned generation and reference-image reuse whenever the model or pipeline supports it. Do not rely on fresh text-only reinterpretation of the same character, environment, object, or world style across clips unless there is no better option.
- For continuity-sensitive character stories, the required default asset chain is:
  `hero portrait -> derived character sheet -> scene start frames -> video`
- For continuity-sensitive character stories, the scene-start-frame stage should normally use the ordered approved character sheets as its reference inputs.
- For continuity-sensitive character stories, scene-start-frame assets should be saved at the target render aspect ratio, normally portrait `9:16`, rather than left as landscape references.
- For continuity-sensitive character stories, do not jump straight from markdown to video render if the required asset chain has not been generated from saved repo state.
- The video system supports both `per_clip` image-to-video references and `shared_reference` reuse across clips. Use `per_clip` for isolated beats or loosely connected compilations; use `shared_reference` whenever a stitched sequence depends on continuity of characters, environments, objects, or overall world style.
- If native dialogue weakens performance or continuity, simplify the spoken lines or move more of the storytelling burden into visuals and captions.
- Voice-line best practice for multi-character clips: default to one named speaker per clip, explicitly mark `Speaker:`, `Silent characters:`, `Dialogue:`, `Action:`, and `Direction:` in the saved markdown, keep spoken lines short and literal, and do not let silent on-screen characters share or mouth the line.
- Do not render first-pass videos for unfamiliar or continuity-sensitive formats until the research has been distilled into saved repo state.
- Do not hide reusable prompt logic in ad hoc code branches.

## Key Files

- Video templates: `prompts/video-templates.json`
- Video prompt builder: `code/video/template-registry.js`
- Video generator: `code/video/generate-video.js`
- Video render pipeline: `code/video/generate-video-compilation.js`
- Carousel templates: `prompts/carousel-templates.json`

## Grok Auth Flow

If `XAI_API_KEY` is not set and no valid session exists at `auth/grok-storage-state.json`, the agent needs browser cookies to use Grok.

Before starting auth, the user should tell the agent which platform(s) they are already signed into and which Chrome profile email each one uses.

On macOS, Chrome cookie extraction may fail unless the login keychain is unlocked first. If cookie decryption errors appear or `security` reports that user interaction is not allowed, unlock `~/Library/Keychains/login.keychain-db` before retrying.

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

Before extracting cookies, ask the user which of Instagram, TikTok, and X they are already signed into and which Chrome profile email each platform uses.

On macOS, onboarding the posting cookies may require unlocking the login keychain first so Chrome cookies can be decrypted. If extraction fails with a browser-cookie decryption error or keychain access error, unlock `~/Library/Keychains/login.keychain-db` and retry.

To extract posting cookies, run `browser-cookie3` for the target domain and save to the expected cookie file:

- **Instagram** → `cookies/instagram_cookies.json` (domain: `.instagram.com`)
- **TikTok** → `cookies/tiktok_cookies.json` (domain: `.tiktok.com`)
- **X** → `cookies/x_cookies.json` (domain: `.x.com`)

The user may use different Chrome profiles for different platforms (e.g. one account for Instagram, another for TikTok). Always ask which Chrome profile to use for each platform.

Cookie files are a JSON array of objects with fields: `name`, `value`, `domain`, `path`, `expires`, `httpOnly`, `secure`, `sameSite`.

All cookie files are gitignored. No secrets are committed.

The posting scripts detect usernames at runtime by logging in with cookies and reading the username from the platform page (e.g. TikTok Studio HTML, Instagram nav, X profile). No username env vars are required. The following env vars are optional hints — if set, they're used as a starting point, but the scripts always verify from the platform:

- `INSTAGRAM_USERNAME` — optional, detected from logged-in page
- `TIKTOK_ACCOUNT_NAME` — optional, detected from TikTok Studio
- `X_USERNAME` — optional, detected from X profile

## Social Media Accounts — Source of Truth

Never hardcode, guess, or assume usernames. The posting scripts derive them at runtime by logging in with stored cookies and reading the username from the platform's own page or API data. If a username is needed to construct a permalink or URL, fetch it from the platform first.

## Standard

The job is incomplete if the agent gets a good result once but does not leave behind reusable repo state.
