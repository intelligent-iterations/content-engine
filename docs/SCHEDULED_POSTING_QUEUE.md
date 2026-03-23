# Scheduled Posting Queue

This note is for agents.

The posting system is simple now:

1. generate the asset
2. put the asset in the scheduled queue
3. let the autoposters read from that queue
4. let the autoposters write the real post permalink back onto that queued item

## Core Rule

Do not use old tracker markdown files.

Do not use old temporary export folders.

The source of truth for posting state is the queued folder itself:

- `output/scheduled_videos/<slug>/schedule.json`
- `output/scheduled_carousels/<slug>/schedule.json`

## Video Flow

1. Generate the video into `output/videos/<slug>/`
2. Queue it with:

```bash
node code/cli/schedule-video.js <slug>
```

That creates:

- `output/scheduled_videos/<slug>/<slug>.mp4`
- `output/scheduled_videos/<slug>/<slug>_caption.txt` if present
- `output/scheduled_videos/<slug>/<slug>.md` if present
- `output/scheduled_videos/<slug>/schedule.json`

## Carousel Flow

1. Generate the carousel into `output/carousels/<slug>/`
2. Queue it with:

```bash
node code/cli/schedule-carousel.js <slug>
```

That creates:

- `output/scheduled_carousels/<slug>/slide_*.jpg` or `slide_*.png`
- `output/scheduled_carousels/<slug>/metadata.json`
- `output/scheduled_carousels/<slug>/preview.html` if present
- `output/scheduled_carousels/<slug>/schedule.json`

## What Autoposters Do

Autoposters read from the scheduled folders only.

They pick the next queued item that does not already have a permalink for that platform.

After posting, they update `schedule.json`.

Examples:

- `posts.instagram.permalink`
- `posts.tiktok.permalink`
- `posts.x.permalink`

These should be direct real post URLs, for example:

- Instagram: `https://www.instagram.com/p/.../`
- TikTok: `https://www.tiktok.com/@account/video/...`
- X: `https://x.com/<account>/status/...`

## What An Agent Should Do

If the user wants something posted later, do this:

1. create the final video or carousel in `output/videos/` or `output/carousels/`
2. queue it into `output/scheduled_videos/` or `output/scheduled_carousels/`
3. make sure `schedule.json` exists
4. do not invent another tracking file

If the item is already queued, update that queued folder instead of creating a second tracking system.

## Short Examples

Queue a video:

```bash
node code/cli/schedule-video.js toadette-asmr
```

Queue a carousel:

```bash
node code/cli/schedule-carousel.js sunscreen-swaps
```

Run the autoposters:

```bash
node code/posting/auto-post-instagram-ai-video.js
python3 code/posting/auto-post-tiktok-ai-video.py
node code/posting/auto-post-x-ai-video.js
node code/posting/auto-post-instagram.js
node code/posting/auto-post-x.js
```

## Decision Rule

If an asset is meant for auto-posting, queue it.

If it is not queued, the autoposters should ignore it.
