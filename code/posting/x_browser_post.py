#!/usr/bin/env python3
"""
Post to X using browser automation and cookie auth.

Input:
    python3.12 code/x_browser_post.py /path/to/args.json

Args JSON:
    {
      "text": "tweet text",
      "media_paths": ["/abs/path/to/file1", "/abs/path/to/file2"],
      "headless": true
    }
"""

import asyncio
import json
import os
import platform
import re
import sys
from pathlib import Path
from urllib.parse import quote

import zendriver as zd
from zendriver.core.config import Config as ZDConfig


REPO_ROOT = Path(__file__).resolve().parent.parent
COOKIE_FILE = REPO_ROOT / "cookies" / "x_cookies.json"
CHROME_PATH_MACOS = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROMIUM_PATH_LINUX = "/usr/bin/chromium"


def load_args():
    if len(sys.argv) < 2:
        raise RuntimeError("missing args json path")
    with open(sys.argv[1], "r") as handle:
        return json.load(handle)


def load_x_cookies():
    if not COOKIE_FILE.exists():
        raise RuntimeError(f"X cookies not found: {COOKIE_FILE}")
    with COOKIE_FILE.open("r") as handle:
        raw = json.load(handle)
    if not isinstance(raw, list) or not raw:
        raise RuntimeError(f"X cookies file is empty: {COOKIE_FILE}")

    cookies = []
    for item in raw:
        if not isinstance(item, dict) or not item.get("name"):
            continue
        cookies.append({
            "name": str(item["name"]),
            "value": str(item.get("value", "")),
            "domain": item.get("domain") or ".x.com",
            "path": item.get("path") or "/",
            "secure": bool(item.get("secure", False)),
            "httpOnly": bool(item.get("httpOnly", item.get("http_only", False))),
        })
    if not cookies:
        raise RuntimeError(f"No valid X cookies found in: {COOKIE_FILE}")
    return cookies


async def sleep_brief(seconds=1.5):
    await asyncio.sleep(seconds)


async def start_x_browser(headless=True):
    kwargs = {
        "headless": headless,
        "browser_connection_timeout": 10.0,
        "browser_connection_max_tries": 10,
    }
    system = platform.system()
    if system == "Darwin" and os.path.exists(CHROME_PATH_MACOS):
        kwargs["browser_executable_path"] = CHROME_PATH_MACOS
    elif system == "Linux" and os.path.exists(CHROMIUM_PATH_LINUX):
        kwargs["browser_executable_path"] = CHROMIUM_PATH_LINUX
        kwargs["browser_args"] = [
            "--disable-gpu",
            "--disable-dev-shm-usage",
        ]
        if os.environ.get("CONTENT_GEN_DISABLE_BROWSER_SANDBOX") == "1":
            kwargs["no_sandbox"] = True
            kwargs["browser_args"].extend([
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ])
            kwargs["sandbox"] = False
    return await zd.start(ZDConfig(**kwargs))


async def ensure_x_logged_in(page):
    href = await page.evaluate("() => window.location.href || ''")
    title = await page.evaluate("() => document.title || ''")
    page_text = await page.evaluate("() => (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 1200)")
    haystack = " ".join([href or "", title or "", page_text or ""]).lower()
    if "/i/flow/login" in (href or "") or ("sign in" in haystack and "create account" in haystack):
        raise RuntimeError("X browser session is not logged in")


async def open_x_session(browser, url="https://x.com/home"):
    await browser.get("https://x.com/")
    await sleep_brief(2)
    await browser.cookies.set_all(load_x_cookies())
    page = await browser.get(url)
    await sleep_brief(5)
    await ensure_x_logged_in(page)
    return page


async def try_select(page, selector, timeout=3):
    try:
        return await page.select(selector, timeout=timeout)
    except Exception:
        return None


async def try_find(page, text, timeout=4):
    try:
        return await page.find(text, best_match=True, timeout=timeout)
    except Exception:
        return None


async def click_element(element):
    if not element:
        return False
    try:
        await element.click()
        await sleep_brief(1)
        return True
    except Exception:
        try:
            await element.evaluate("(el) => el.click()")
            await sleep_brief(1)
            return True
        except Exception:
            return False


async def click_first(page, selectors=(), labels=(), timeout=4):
    for selector in selectors:
        element = await try_select(page, selector, timeout=timeout)
        if await click_element(element):
            return selector
    for label in labels:
        element = await try_find(page, label, timeout=timeout)
        if await click_element(element):
            return label
    return None


async def type_text(page, text):
    editor = None
    selectors = (
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"]',
        '[contenteditable="true"]',
    )
    for _ in range(5):
        for selector in selectors:
            editor = await try_select(page, selector, timeout=2)
            if editor:
                break
        if editor:
            break
        await sleep_brief(1)
    if not editor:
        raise RuntimeError("Could not locate X composer textbox")
    await click_element(editor)
    for char in str(text or ""):
        await editor.send_keys(char)
    await sleep_brief(1)


async def click_visible_x_submit(page):
    try:
        result = await page.evaluate(
            """
            () => {
                const buttons = Array.from(document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]'));
                for (const btn of buttons) {
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
                    const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                    if (!disabled && visible) {
                        btn.click();
                        return {
                            ok: true,
                            text: (btn.innerText || btn.textContent || '').trim(),
                            testid: btn.getAttribute('data-testid') || '',
                        };
                    }
                }
                return { ok: false };
            }
            """
        )
    except Exception:
        result = None
    if isinstance(result, dict) and result.get("ok"):
        await sleep_brief(1)
        return result.get("testid") or result.get("text") or "submit"
    return None


async def actor_username(page):
    href = await page.evaluate(
        """
        () => {
            const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
            return link ? (link.getAttribute('href') || '') : '';
        }
        """
    )
    if isinstance(href, str):
        match = re.search(r"/([A-Za-z0-9_]+)$", href)
        if match:
            return match.group(1)
    env_username = os.environ.get("X_USERNAME", "").strip().lstrip("@")
    return env_username or "user"


def normalize_x_url(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    if raw.startswith("/"):
        return f"https://x.com{raw}"
    if raw.startswith("http://"):
        raw = "https://" + raw[len("http://"):]
    raw = raw.replace("https://twitter.com/", "https://x.com/")
    raw = raw.replace("https://www.twitter.com/", "https://x.com/")
    raw = raw.replace("https://www.x.com/", "https://x.com/")
    return raw


def status_id_from_url(url):
    match = re.search(r"/status/([^/?#]+)", str(url or ""))
    return match.group(1) if match else ""


async def status_urls_on_page(page, username=""):
    handles = await page.evaluate(
        """
        () => Array.from(document.querySelectorAll('a[href*="/status/"]'))
          .map((el) => el.getAttribute('href') || '')
          .filter(Boolean)
        """
    )
    urls = []
    if isinstance(handles, list):
        for href in handles:
            if not isinstance(href, str):
                continue
            normalized = normalize_x_url(href)
            if username:
                prefix = f"https://x.com/{username.lower()}/status/"
                if normalized.lower().startswith(prefix):
                    urls.append(normalized)
            else:
                urls.append(normalized)
    deduped = []
    seen = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


async def latest_profile_status_url(browser, username, expected_text=""):
    if not username:
        return ""
    page = await open_x_session(browser, f"https://x.com/{username}")
    expected = str(expected_text or "").strip().lower()
    for _ in range(5):
        await sleep_brief(3)
        candidates = await status_urls_on_page(page, username=username)
        if not candidates:
            continue
        if not expected:
            return candidates[0]
        for candidate in candidates:
            status_id = status_id_from_url(candidate)
            if not status_id:
                continue
            article_text = await page.evaluate(
                f"""
                () => {{
                    const link = document.querySelector('a[href="/{username}/status/{status_id}"]');
                    const article = link ? link.closest('article') : null;
                    return article ? (article.innerText || '') : '';
                }}
                """
            )
            if isinstance(article_text, str) and expected[:80] in article_text.lower():
                return candidate
        try:
            page = await browser.get(f"https://x.com/{username}")
        except Exception:
            pass
    candidates = await status_urls_on_page(page, username=username)
    return candidates[0] if candidates else ""


async def latest_search_status_url(browser, username, expected_text=""):
    username = str(username or "").strip().lstrip("@")
    expected = str(expected_text or "").strip()
    if not username or not expected:
        return ""
    query = quote(f"from:{username} {expected[:80]}")
    page = await open_x_session(browser, f"https://x.com/search?q={query}&src=typed_query&f=live")
    username_json = json.dumps(username)
    expected_json = json.dumps(expected.lower()[:40])
    for _ in range(5):
        await sleep_brief(3)
        matches = await page.evaluate(
            f"""
            () => Array.from(document.querySelectorAll('article')).map((article) => {{
                const text = (article.innerText || '').trim();
                const statusLink = article.querySelector('a[href*="/status/"]');
                const href = statusLink ? (statusLink.getAttribute('href') || '') : '';
                return {{ text, href }};
            }}).filter((item) => {{
                const href = String(item.href || '');
                const text = String(item.text || '').toLowerCase();
                return href.includes('/status/') &&
                    href.toLowerCase().includes('/' + {username_json}.toLowerCase() + '/status/') &&
                    text.includes({expected_json});
            }})
            """
        )
        if isinstance(matches, list):
            for match in matches:
                href = match.get("href") if isinstance(match, dict) else None
                if isinstance(href, str) and href:
                    return normalize_x_url(href)
        try:
            page = await browser.get(f"https://x.com/search?q={query}&src=typed_query&f=live")
        except Exception:
            pass
    return ""


async def upload_media(page, media_paths):
    if not media_paths:
        return
    file_input = await try_select(page, "input[type=\"file\"]", timeout=6)
    if not file_input:
        raise RuntimeError("Could not locate X media upload input")
    await file_input.send_file(*media_paths)
    wait_seconds = 12 if len(media_paths) == 1 and str(media_paths[0]).lower().endswith(".mp4") else 6
    await sleep_brief(wait_seconds)


async def run():
    args = load_args()
    text = str(args.get("text") or "").strip()
    media_paths = [str(Path(p).resolve()) for p in (args.get("media_paths") or [])]
    headless = bool(args.get("headless", True))

    if not text:
        raise RuntimeError("text is required")
    for media_path in media_paths:
        if not os.path.exists(media_path):
            raise RuntimeError(f"Media file not found: {media_path}")

    browser = None
    try:
        browser = await start_x_browser(headless=headless)
        page = await open_x_session(browser, "https://x.com/compose/post")

        try:
            await type_text(page, text)
        except Exception:
            await click_first(
                page,
                selectors=('[data-testid="SideNav_NewTweet_Button"]', '[data-testid="tweetButtonInline"]'),
                labels=("Post",),
                timeout=4,
            )
            await type_text(page, text)

        await upload_media(page, media_paths)

        clicked = await click_visible_x_submit(page)
        if not clicked:
            clicked = await click_first(
                page,
                selectors=('[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]'),
                labels=("Post", "Tweet"),
                timeout=5,
            )
        if not clicked:
            raise RuntimeError("Could not locate X post submit button")

        await sleep_brief(5)
        username = await actor_username(page)
        current_url = await page.evaluate("() => window.location.href || ''")
        permalink = ""
        if isinstance(current_url, str) and "/status/" in current_url:
            permalink = normalize_x_url(current_url)
        if not permalink:
            permalink = await latest_profile_status_url(browser, username, expected_text=text)
        if not permalink:
            permalink = await latest_search_status_url(browser, username, expected_text=text)
        if not permalink:
            permalink = await latest_profile_status_url(browser, username)

        tweet_id = status_id_from_url(permalink)
        if not permalink or not tweet_id:
            raise RuntimeError("X post may have submitted, but permalink could not be resolved")

        print(json.dumps({
            "ok": True,
            "id": tweet_id,
            "permalink": permalink,
            "username": username,
            "platform": "x",
            "method": "browser_cookies",
        }))
    finally:
        if browser:
            try:
                await browser.stop()
            except Exception:
                pass


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception as exc:
        import traceback

        print(json.dumps({
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }))
        sys.exit(1)
