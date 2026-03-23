#!/usr/bin/env python3
"""
Auto-post AI video variants to TikTok.

Posts 1 scheduled video per run from output/scheduled_videos/.
Source assets are expected under output/videos/.

Usage:
    python code/posting/auto-post-tiktok-ai-video.py
    python code/posting/auto-post-tiktok-ai-video.py --dry-run
"""

import os
import re
import sys
import json
import time
import asyncio
import shutil
from datetime import datetime
from tiktokautouploader import upload_tiktok

# Add parent repo to path for shared cookies
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
REPO_ROOT = os.path.dirname(PROJECT_DIR)
sys.path.insert(0, REPO_ROOT)

try:
    from shared.cookies import get_cookies, cookies_exist, COOKIES_DIR
    HAS_SHARED_COOKIES = True
except ImportError:
    HAS_SHARED_COOKIES = False
    COOKIES_DIR = None

try:
    import zendriver as zd
    from zendriver.core.config import Config as ZDConfig
    HAS_ZENDRIVER = True
except ImportError:
    HAS_ZENDRIVER = False

SCHEDULED_VIDEOS_DIR = os.path.join(PROJECT_DIR, 'output', 'scheduled_videos')

ACCOUNT_NAME = os.getenv('TIKTOK_ACCOUNT_NAME', 'contentgen')
TIKTOK_PROFILE_URL = f'https://www.tiktok.com/@{ACCOUNT_NAME}'
POSTS_PER_RUN = 1

# tiktokautouploader looks for cookies in specific locations
TIKTOK_COOKIE_NAMES = [
    f'TK_cookies_{ACCOUNT_NAME}.json',
    'TK_cookies.json',
]


def ensure_tiktok_cookies():
    """
    Ensure TikTok cookies are available where tiktokautouploader expects them.
    Copies from shared cookies location if available.
    """
    if not HAS_SHARED_COOKIES:
        return False

    # Check if shared TikTok cookies exist
    shared_cookie_path = os.path.join(COOKIES_DIR, 'tiktok_cookies.json')
    if not os.path.exists(shared_cookie_path):
        return False

    # tiktokautouploader looks for cookies in cwd or specific paths
    # Copy to the locations it expects
    for cookie_name in TIKTOK_COOKIE_NAMES:
        # Copy to repo root (common cwd when running scripts)
        dest_path = os.path.join(REPO_ROOT, cookie_name)
        if not os.path.exists(dest_path):
            try:
                shutil.copy(shared_cookie_path, dest_path)
                print(f'  Copied cookies to {dest_path}')
            except Exception as e:
                print(f'  Warning: Could not copy cookies: {e}')

    return True


async def get_video_ids_async():
    """
    Scrape the TikTok profile page using zendriver to get all video IDs.
    Returns a list of video ID strings (most recent first), or empty list.
    """
    if not HAS_ZENDRIVER:
        print('  Warning: zendriver not installed, cannot fetch video IDs')
        return []

    try:
        zd_config = ZDConfig(headless=True, browser_connection_timeout=2.0)
        browser = await zd.start(zd_config)

        try:
            page = await browser.get(TIKTOK_PROFILE_URL)
            await asyncio.sleep(8)  # Wait for page to load

            html = await page.get_content()

            # Extract video IDs from page JSON
            video_ids = re.findall(r'"itemId":"(\d+)"', html)
            if video_ids:
                return list(dict.fromkeys(video_ids))  # dedupe, preserve order

            # Fallback: try to find video links directly
            video_pattern = rf'@{re.escape(ACCOUNT_NAME)}/video/(\d+)'
            matches = re.findall(video_pattern, html)
            if matches:
                return list(dict.fromkeys(matches))

        finally:
            await browser.stop()

    except Exception as e:
        print(f'  Warning: Could not fetch video IDs: {e}')

    return []


def get_video_ids():
    """Synchronous wrapper for get_video_ids_async."""
    try:
        return asyncio.run(get_video_ids_async())
    except Exception as e:
        print(f'  Warning: Error running async video ID fetch: {e}')
        return []


def find_new_video_url(before_ids, max_retries=4, retry_delay=15):
    """
    Compare video IDs before and after posting to find the newly posted video.
    Retries a few times in case TikTok is still processing.
    Returns the permalink URL or None.
    """
    before_set = set(before_ids)

    for attempt in range(1, max_retries + 1):
        after_ids = get_video_ids()
        new_ids = [vid for vid in after_ids if vid not in before_set]

        if new_ids:
            video_id = new_ids[0]
            return f"https://www.tiktok.com/@{ACCOUNT_NAME}/video/{video_id}"

        if attempt < max_retries:
            print(f'  No new video found yet (attempt {attempt}/{max_retries}), waiting {retry_delay}s...')
            time.sleep(retry_delay)

    # Fallback: return the most recent video if we couldn't diff the exact new one
    # This is still a concrete permalink, not just the profile URL.
    after_ids = get_video_ids()
    if after_ids:
        return f"https://www.tiktok.com/@{ACCOUNT_NAME}/video/{after_ids[0]}"

    return None


def list_scheduled_videos():
    """Load scheduled video manifests from output/scheduled_videos/*/schedule.json."""
    videos = []
    os.makedirs(SCHEDULED_VIDEOS_DIR, exist_ok=True)

    for name in sorted(os.listdir(SCHEDULED_VIDEOS_DIR)):
        item_dir = os.path.join(SCHEDULED_VIDEOS_DIR, name)
        manifest_path = os.path.join(item_dir, 'schedule.json')
        if not os.path.isdir(item_dir) or not os.path.exists(manifest_path):
            continue

        with open(manifest_path, 'r') as f:
            manifest = json.load(f)

        videos.append({
            'id': manifest.get('id', name),
            'dir': item_dir,
            'manifest_path': manifest_path,
            'manifest': manifest,
            'video_path': manifest.get('assets', {}).get('video_path'),
            'caption_path': manifest.get('assets', {}).get('caption_path'),
        })

    return videos


def update_scheduled_post(video, permalink):
    manifest = video['manifest']
    posts = manifest.get('posts') or {}
    posts['tiktok'] = {
        'platform': 'tiktok',
        'permalink': permalink,
        'posted_at': datetime.now().isoformat(),
        'source_file': video['video_path'],
    }
    manifest['posts'] = posts

    with open(video['manifest_path'], 'w') as f:
        json.dump(manifest, f, indent=2)


def post_one_video(video):
    """Post a single video to TikTok."""
    video_file = os.path.join(PROJECT_DIR, video['video_path'])
    if not os.path.exists(video_file):
        print(f'  File not found: {video["video_path"]}')
        return False

    size_mb = os.path.getsize(video_file) / (1024 * 1024)
    print(f'  File: {video["video_path"]} ({size_mb:.1f} MB)')

    # Ensure cookies are available
    ensure_tiktok_cookies()

    # Load caption
    caption = f'{video["id"]} #content #video'
    if video['caption_path']:
        caption_file = os.path.join(PROJECT_DIR, video['caption_path'])
        if os.path.exists(caption_file):
            with open(caption_file, 'r') as f:
                caption = f.read().strip()
            print(f'  Caption loaded ({len(caption)} chars)')
    else:
        print('  No caption file, using default')

    # Snapshot video IDs before posting so we can diff after
    print('  Snapshotting current video IDs...')
    before_ids = get_video_ids()
    print(f'  Found {len(before_ids)} existing videos')

    print('  Uploading to TikTok...')
    headless = '--visible' not in sys.argv
    upload_tiktok(
        video=video_file,
        description=caption,
        accountname=ACCOUNT_NAME,
        headless=headless,
    )

    # Wait for TikTok to process and make the video available
    print('  Waiting for video to appear on profile...')
    time.sleep(15)

    # Find the newly posted video by comparing before/after IDs
    print('  Fetching video permalink...')
    video_url = find_new_video_url(before_ids)
    if not video_url:
        raise RuntimeError('TikTok upload completed but no video permalink could be resolved')

    print(f'  Permalink: {video_url}')

    update_scheduled_post(video, video_url)
    return video_url


def main():
    dry_run = '--dry-run' in sys.argv

    print('=' * 50)
    print('  TikTok AI Video Auto-Poster (1/run, 3x/day)')
    print(f'  {datetime.now().isoformat()}')
    if dry_run:
        print('  ** DRY RUN **')
    print('=' * 50)
    print()

    all_videos = list_scheduled_videos()
    print(f'Total scheduled videos: {len(all_videos)}')

    unposted = [v for v in all_videos if not v['manifest'].get('posts', {}).get('tiktok', {}).get('permalink')]
    print(f'Unposted to TikTok: {len(unposted)}')

    if not unposted:
        print('\nNo unposted variants available!')
        return

    batch = unposted[:POSTS_PER_RUN]
    print(f'\nPosting {len(batch)} video(s) this run:\n')

    posted_count = 0
    for i, video in enumerate(batch):
        print(f'--- [{i + 1}/{len(batch)}] {video["id"]} ---')

        if dry_run:
            print(f'  [dry-run] Would post: {video["video_path"]}\n')
            continue

        try:
            permalink = post_one_video(video)
            if permalink:
                print(f'  Posted! {permalink}\n')
                posted_count += 1
        except Exception as e:
            print(f'  FAILED: {e}\n')

    print('=' * 50)
    print(f'  Done! Posted {posted_count}/{len(batch)}')
    print('=' * 50)


if __name__ == '__main__':
    main()
