# Launchd Scheduling

This folder contains ready-to-load macOS `launchd` agents for the default weekly queue plan:

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

Each agent runs one slot-specific command:

- `node code/posting/run-instagram-slot.js <morning|midday|evening>`
- `node code/posting/run-x-slot.js <morning|midday|evening>`
- `node code/posting/run-tiktok-slot.js <morning|evening>`

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
