#!/usr/bin/env python3
"""
Extract Grok/X auth cookies directly from Chrome's cookie database.

Uses browser-cookie3 to decrypt Chrome cookies without needing Chrome open.
Lists Chrome profiles so you can pick the right one.
"""

import argparse
import json
import os
import sys
import time

CHROME_DIR = os.path.expanduser(
    "~/Library/Application Support/Google/Chrome"
)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
AUTH_DIR = os.path.join(REPO_ROOT, "auth")
DEFAULT_OUTPUT = os.path.join(AUTH_DIR, "grok-storage-state.json")

COOKIE_DOMAINS = [".grok.com", ".x.com", ".x.ai", "accounts.x.ai"]
AUTH_COOKIE_NAMES = [
    "auth_token", "ct0", "kdt", "twid",
    "sso", "sso-rw", "cf_clearance",
]


def discover_profiles():
    """Find Chrome profiles and read their display name / email from Preferences."""
    profiles = []
    if not os.path.isdir(CHROME_DIR):
        return profiles

    for entry in sorted(os.listdir(CHROME_DIR)):
        prefs_path = os.path.join(CHROME_DIR, entry, "Preferences")
        if not os.path.isfile(prefs_path):
            continue
        try:
            with open(prefs_path, "r") as f:
                prefs = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue

        account_info = prefs.get("account_info", [])
        email = account_info[0].get("email", "") if account_info else ""
        display_name = (
            account_info[0].get("full_name", "") if account_info else ""
        )
        profile_name = prefs.get("profile", {}).get("name", entry)

        profiles.append({
            "dir_name": entry,
            "profile_name": profile_name,
            "email": email,
            "display_name": display_name,
        })

    return profiles


def pick_profile(profiles):
    """Print a numbered list and let the user choose."""
    print("\nChrome profiles found:\n")
    for i, p in enumerate(profiles, 1):
        label = p["profile_name"]
        if p["email"]:
            label += f"  ({p['email']})"
        elif p["display_name"]:
            label += f"  ({p['display_name']})"
        print(f"  {i}. {label}  [{p['dir_name']}]")

    print()
    while True:
        try:
            choice = input(f"Pick a profile (1-{len(profiles)}): ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(profiles):
                return profiles[idx]
        except (ValueError, EOFError):
            pass
        print("Invalid choice, try again.")


def extract_cookies(profile_dir_name):
    """Use browser-cookie3 to get decrypted cookies for our target domains."""
    try:
        import browser_cookie3
    except ImportError:
        print(
            "ERROR: browser-cookie3 is not installed.\n"
            "Run: pip install -r requirements.txt",
            file=sys.stderr,
        )
        sys.exit(1)

    cookie_db = os.path.join(CHROME_DIR, profile_dir_name, "Cookies")
    if not os.path.isfile(cookie_db):
        print(f"ERROR: Cookie database not found at {cookie_db}", file=sys.stderr)
        sys.exit(1)

    all_cookies = []
    for domain in COOKIE_DOMAINS:
        try:
            cj = browser_cookie3.chrome(
                cookie_file=cookie_db,
                domain_name=domain,
            )
            for c in cj:
                all_cookies.append({
                    "name": c.name,
                    "value": c.value,
                    "domain": c.domain,
                    "path": c.path,
                    "expires": c.expires if c.expires else -1,
                    "httpOnly": c.has_nonstandard_attr("HttpOnly"),
                    "secure": 1 if c.secure else 0,
                    "sameSite": "Lax",
                })
        except Exception as e:
            print(f"  Warning: could not read cookies for {domain}: {e}", file=sys.stderr)

    # Deduplicate by name+domain
    seen = set()
    unique = []
    for c in all_cookies:
        key = f"{c['name']}|{c['domain']}"
        if key not in seen:
            seen.add(key)
            unique.append(c)

    return unique


def save_storage_state(cookies, output_path):
    """Save in the same format the repo already expects."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    state = {
        "cookies": cookies,
        "origins": [],
    }
    with open(output_path, "w") as f:
        json.dump(state, f, indent=2)


def print_summary(cookies):
    """Print which auth cookies were found."""
    auth_found = [c for c in cookies if c["name"] in AUTH_COOKIE_NAMES]
    print(f"\nSaved {len(cookies)} cookies total.")
    if auth_found:
        print("Auth cookies found:")
        for c in auth_found:
            print(f"  {c['name']} ({c['domain']})")
    else:
        print("WARNING: No auth cookies found. Are you logged into grok.com in this Chrome profile?")


def main():
    parser = argparse.ArgumentParser(
        description="Extract Grok auth cookies from Chrome"
    )
    parser.add_argument(
        "--profile",
        help="Chrome profile directory name (e.g. 'Profile 3') to skip the prompt",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
        help=f"Output path (default: {DEFAULT_OUTPUT})",
    )
    args = parser.parse_args()

    profiles = discover_profiles()
    if not profiles:
        print("ERROR: No Chrome profiles found.", file=sys.stderr)
        sys.exit(1)

    if args.profile:
        match = [p for p in profiles if p["dir_name"] == args.profile]
        if not match:
            print(f"ERROR: Profile '{args.profile}' not found.", file=sys.stderr)
            print("Available profiles:")
            for p in profiles:
                print(f"  {p['dir_name']}  ({p.get('email') or p['profile_name']})")
            sys.exit(1)
        profile = match[0]
        print(f"Using profile: {profile['profile_name']} ({profile.get('email', '')})")
    else:
        profile = pick_profile(profiles)

    print(f"\nExtracting cookies from {profile['dir_name']}...")
    cookies = extract_cookies(profile["dir_name"])

    if not cookies:
        print("ERROR: No cookies extracted. Is Chrome installed and has this profile been used?", file=sys.stderr)
        sys.exit(1)

    save_storage_state(cookies, args.output)
    print(f"Saved to {args.output}")
    print_summary(cookies)


if __name__ == "__main__":
    main()
