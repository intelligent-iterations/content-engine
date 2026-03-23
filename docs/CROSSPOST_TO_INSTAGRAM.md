# Cross-Post to Instagram

This repo now uses the scheduled queue system.

The old pre-queue cross-post flow is gone.

## Current Flow

1. Generate a carousel in `output/carousels/<slug>/`
2. Crop it for Instagram if needed
3. Queue it in `output/scheduled_carousels/<slug>/`
4. Post it with `code/posting/post-to-instagram.js` or `code/posting/auto-post-instagram.js`
5. Read the direct Instagram permalink from `output/scheduled_carousels/<slug>/schedule.json`

## Commands

Generate:

```bash
node code/cli/carousel.js --template comparison-list --output-name example-topic --research-file output/carousels/example-topic/research.json
```

Crop:

```bash
node code/crop-for-instagram.js sunscreen-swaps
```

Queue:

```bash
node code/cli/schedule-carousel.js sunscreen-swaps
```

Manual post:

```bash
node code/posting/post-to-instagram.js sunscreen-swaps
```

Auto-post next queued carousel:

```bash
node code/posting/auto-post-instagram.js
```

## Permalink

After a successful post, the queue manifest stores a direct Instagram permalink in this shape:

```text
https://www.instagram.com/p/.../
```

## Source Of Truth

Use:

- `output/scheduled_carousels/<slug>/schedule.json`

Do not create or rely on tracker markdown files.
