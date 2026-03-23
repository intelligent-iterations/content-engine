# Launchd Scheduling

This folder contains sample macOS `launchd` agents for running the posting queue on a schedule.

What `launchd` does:
- it runs the autoposter commands automatically on your Mac
- it is optional
- it does not hold queue state

The actual posting queue lives in:
- `output/scheduled_videos/<slug>/schedule.json`
- `output/scheduled_carousels/<slug>/schedule.json`

The schedulers only run commands such as:
- `node code/posting/auto-post-instagram-ai-video.js`
- `python3 code/posting/auto-post-tiktok-ai-video.py`
- `node code/posting/auto-post-x-ai-video.js`
- `node code/posting/auto-post-instagram.js`
- `node code/posting/auto-post-x.js`

## Default Schedule

The sample plist files use these default times:
- `8:20 AM`
- `12:20 PM`
- `8:20 PM`

Each agent runs at all three times by default. Load only the ones you actually want active.

## Setup

1. Copy the plist files you want into `~/Library/LaunchAgents/`
2. Edit:
   - `WorkingDirectory`
   - absolute paths inside `ProgramArguments`
   - log paths in `StandardOutPath` and `StandardErrorPath`
3. Load them:

```bash
launchctl load ~/Library/LaunchAgents/com.contentgen.autopost-tiktok-video.plist
launchctl load ~/Library/LaunchAgents/com.contentgen.autopost-instagram-video.plist
launchctl load ~/Library/LaunchAgents/com.contentgen.autopost-x-video.plist
```

## Status

```bash
launchctl list | grep contentgen
```

## Logs

```bash
tail -f /path/to/content-gen/logs/autopost-tiktok-video.log
```
