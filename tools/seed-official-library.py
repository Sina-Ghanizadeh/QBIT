#!/usr/bin/env python3
"""Mirror the public QBIT library into a self-hosted instance (admin API).

Usage:
  python tools/seed-official-library.py --admin-url http://127.0.0.1:2326 \\
      --username ADMIN_USER --password ADMIN_PASS

Or set ADMIN_USERNAME / ADMIN_PASSWORD in the environment (same as docker .env).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def req(method: str, url: str, data=None, headers=None, cookies=None):
    headers = dict(headers or {})
    if cookies:
        headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in cookies.items())
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as resp:
            raw = resp.read()
            set_cookie = resp.headers.get_all("Set-Cookie") or []
            return resp.status, raw, set_cookie
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers.get_all("Set-Cookie") or []


def parse_cookies(set_cookie_headers):
    out = {}
    for h in set_cookie_headers:
        part = h.split(";", 1)[0]
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--admin-url", default=os.environ.get("ADMIN_URL", "http://127.0.0.1:2326"))
    ap.add_argument("--username", default=os.environ.get("ADMIN_USERNAME", ""))
    ap.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD", ""))
    ap.add_argument("--limit", type=int, default=60)
    args = ap.parse_args()
    if not args.username or not args.password:
        print("ADMIN_USERNAME and ADMIN_PASSWORD are required", file=sys.stderr)
        return 2

    base = args.admin_url.rstrip("/")
    status, raw, set_cookies = req(
        "POST",
        f"{base}/api/admin/login",
        {"username": args.username, "password": args.password},
        headers={"User-Agent": "QBIT-Seed/1.0"},
    )
    if status != 200:
        print(f"Admin login failed: HTTP {status} {raw[:200]!r}", file=sys.stderr)
        return 1
    cookies = parse_cookies(set_cookies)
    status, raw, _ = req(
        "POST",
        f"{base}/api/library/seed-official",
        {"limit": args.limit},
        headers={"User-Agent": "QBIT-Seed/1.0"},
        cookies=cookies,
    )
    text = raw.decode("utf-8", errors="replace")
    print(text)
    return 0 if status == 200 else 1


if __name__ == "__main__":
    raise SystemExit(main())