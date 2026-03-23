#!/usr/bin/env python3
"""
Interactive auth setup for content-gen.

Logs into TikTok and/or X in a real browser session, then saves cookies to
repo-local JSON files under content-gen/cookies/.

Usage:
    python3 setup.py
    python3 setup.py --tiktok
    python3 setup.py --x
    python3 setup.py --instagram
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent
COOKIES_DIR = REPO_ROOT / "cookies"
COOKIES_DIR.mkdir(exist_ok=True)
ENV_FILE = REPO_ROOT / ".env"

COOKIE_FILES = {
    "tiktok": COOKIES_DIR / "tiktok_cookies.json",
    "x": COOKIES_DIR / "x_cookies.json",
    "instagram": COOKIES_DIR / "instagram_cookies.json",
}

TIKTOK_LEGACY_FILES = [
    REPO_ROOT / "TK_cookies.json",
    REPO_ROOT / "TK_cookies_contentgen.json",
]

PLATFORMS = {
    "tiktok": {
        "login_url": "https://www.tiktok.com/login",
        "after_login_url": "https://www.tiktok.com/upload",
        "cookie_file": COOKIE_FILES["tiktok"],
    },
    "x": {
        "login_url": "https://x.com/i/flow/login",
        "after_login_url": "https://x.com/home",
        "cookie_file": COOKIE_FILES["x"],
    },
    "instagram": {
        "login_url": "https://www.instagram.com/accounts/login/",
        "after_login_url": f"https://www.instagram.com/{os.environ.get('INSTAGRAM_USERNAME', 'contentgen').replace('@', '')}/",
        "cookie_file": COOKIE_FILES["instagram"],
    },
}


def _load_repo_env() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or os.environ.get(key):
            continue
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        os.environ[key] = value


_load_repo_env()


def _load_zendriver():
    try:
        import zendriver as zd
        from zendriver.core.config import Config as ZDConfig
    except ImportError:
        print("ERROR: zendriver not installed. Run: pip install zendriver")
        sys.exit(1)
    return zd, ZDConfig


def _same_site_value(raw):
    if hasattr(raw, "value"):
        return str(raw.value)
    if hasattr(raw, "name"):
        return str(raw.name)
    return str(raw) if raw else None


async def _load_cookies(browser, cookie_file: Path) -> bool:
    if not cookie_file.exists():
        return False

    try:
        cookies = json.loads(cookie_file.read_text())
    except Exception as exc:
        print(f"  Warning: could not read {cookie_file}: {exc}")
        return False

    loaded = 0
    for cookie in cookies:
        try:
            await browser.cookies.set(
                name=str(cookie["name"]),
                value=str(cookie.get("value", "")),
                domain=str(cookie.get("domain", "")),
                path=str(cookie.get("path", "/")),
            )
            loaded += 1
        except Exception:
            continue

    if loaded:
        print(f"  Loaded {loaded} cookies from {cookie_file}")
    return loaded > 0


async def _save_cookies(browser, platform: str) -> list[dict]:
    raw_cookies = await browser.cookies.get_all()
    cookies = []
    for cookie in raw_cookies:
        cookies.append({
            "name": cookie.name,
            "value": cookie.value,
            "domain": cookie.domain,
            "path": cookie.path,
            "expires": cookie.expires,
            "httpOnly": bool(cookie.http_only),
            "secure": bool(cookie.secure),
            "sameSite": _same_site_value(cookie.same_site),
        })

    cookie_file = COOKIE_FILES[platform]
    cookie_file.write_text(json.dumps(cookies, indent=2))
    print(f"  Saved {len(cookies)} cookies to {cookie_file}")
    return cookies


def _write_tiktok_legacy_files(cookies: list[dict]) -> None:
    payload = json.dumps(cookies, indent=2)
    for path in TIKTOK_LEGACY_FILES:
        path.write_text(payload)
        print(f"  Mirrored TikTok cookies to {path}")


async def authenticate(platform: str) -> None:
    if platform == "instagram":
        node_bin = "node"
        helper = REPO_ROOT / "code" / "posting" / "instagram-auth.js"
        result = subprocess.run(
            [node_bin, str(helper)],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
        )
        if result.stdout:
            print(result.stdout.strip())
        if result.stderr:
            print(result.stderr.strip())
        if result.returncode != 0:
            raise RuntimeError("instagram auth helper failed")
        print("✅ instagram authentication complete")
        return

    meta = PLATFORMS[platform]
    zd, ZDConfig = _load_zendriver()
    print(f"\n{'=' * 50}")
    print(f"{platform.upper()} Authentication")
    print(f"{'=' * 50}")

    browser = await zd.start(ZDConfig(headless=False, browser_connection_timeout=10.0))
    try:
        page = await browser.get(meta["login_url"])
        await asyncio.sleep(2)
        await _load_cookies(browser, meta["cookie_file"])

        if platform == "tiktok":
            page = await browser.get("https://www.tiktok.com/login")
        else:
            page = await browser.get("https://x.com/home")

        print(f"\nBrowser opened for {platform}.")
        print("Log in or refresh the session in the browser window.")
        print("When the account is fully authenticated, press Enter here.")
        input()

        await browser.get(meta["after_login_url"])
        await asyncio.sleep(5)
        cookies = await _save_cookies(browser, platform)

        if platform == "tiktok":
            _write_tiktok_legacy_files(cookies)

        print(f"✅ {platform} authentication complete")
    finally:
        await browser.stop()


def parse_args():
    parser = argparse.ArgumentParser(description="Authenticate TikTok and X for content-gen")
    parser.add_argument("--tiktok", action="store_true", help="Authenticate TikTok only")
    parser.add_argument("--x", action="store_true", help="Authenticate X only")
    parser.add_argument("--instagram", action="store_true", help="Authenticate Instagram only")
    return parser.parse_args()


async def main():
    args = parse_args()
    selected = []
    if args.tiktok:
        selected.append("tiktok")
    if args.x:
        selected.append("x")
    if args.instagram:
        selected.append("instagram")
    if not selected:
        selected = ["tiktok", "x", "instagram"]

    print(f"Cookies directory: {COOKIES_DIR}")
    for platform in selected:
        await authenticate(platform)


if __name__ == "__main__":
    asyncio.run(main())
