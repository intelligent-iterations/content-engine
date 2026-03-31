# Launchd Scheduling

This folder contains ready-to-load macOS `launchd` agents for the default weekly queue plan.

The schedulers now invoke Dockerized slot jobs, not the host Node process directly. Resource caps live in [`docker-compose.yml`](../docker-compose.yml):

- `autopost`: `2 vCPU`, `3 GB RAM`
- `generate`: `2 vCPU`, `4 GB RAM`

- Instagram: `3` posts/day
- X: `3` posts/day
- TikTok: `2` posts/day

Slot mapping:

- `08:20` — Instagram video, X video, TikTok video
- `12:20` — Instagram carousel, X carousel
- `20:20` — Instagram video, X video, TikTok video

The queue state lives in:

- `output/scheduled_videos/<slug>/schedule.json`
- `output/scheduled_carousels/<slug>/schedule.json`

Each agent runs one slot-specific Docker command through [`scripts/docker-slot.sh`](../scripts/docker-slot.sh):

- `docker compose run --rm --no-deps autopost node code/posting/run-instagram-slot.js <morning|midday|evening>`
- `docker compose run --rm --no-deps autopost node code/posting/run-x-slot.js <morning|midday|evening>`
- `docker compose run --rm --no-deps autopost node code/posting/run-tiktok-slot.js <morning|evening>`

## Build

Before the schedulers can run, build the image once:

```bash
sh scripts/docker-build.sh
```

## Install

```bash
mkdir -p ~/Library/LaunchAgents output/logs
cp launchd/com.contentengine.*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.instagram.morning.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.instagram.midday.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.instagram.evening.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.x.morning.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.x.midday.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.x.evening.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.tiktok.morning.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.tiktok.evening.plist
```

## Check Status

```bash
launchctl print gui/$(id -u)/com.contentengine.instagram.morning
launchctl list | grep contentengine
```

## Logs

```bash
tail -f output/logs/instagram-morning.log
tail -f output/logs/x-midday.log
tail -f output/logs/tiktok-evening.log
```

## Manual Runs

```bash
npm run docker:build
npm run docker:instagram:morning
npm run docker:x:midday
npm run docker:tiktok:evening
```

## Dry-Run Audit

Use the same shell entrypoint that the plists call, but append `--dry-run` so each slot can be validated without posting:

```bash
scripts/docker-slot.sh instagram morning --dry-run
scripts/docker-slot.sh instagram midday --dry-run
scripts/docker-slot.sh instagram evening --dry-run
scripts/docker-slot.sh tiktok morning --dry-run
scripts/docker-slot.sh tiktok evening --dry-run
scripts/docker-slot.sh x morning --dry-run
scripts/docker-slot.sh x midday --dry-run
scripts/docker-slot.sh x evening --dry-run
```

## Remove

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.instagram.morning.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.instagram.midday.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.instagram.evening.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.x.morning.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.x.midday.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.x.evening.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.tiktok.morning.plist
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.contentengine.tiktok.evening.plist
```
