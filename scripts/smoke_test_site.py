from __future__ import annotations

import argparse
import json
import re
import sys
from http.client import HTTPResponse
from urllib.parse import urljoin, urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


USER_AGENT = "suivi-nutrition-smoke/1"


class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_response(url: str, *, method: str = "GET", follow_redirects: bool = True) -> tuple[int, str, dict[str, str], str]:
    request = Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
            "User-Agent": USER_AGENT,
        },
        method=method,
    )
    opener = build_opener() if follow_redirects else build_opener(NoRedirectHandler())
    try:
        with opener.open(request, timeout=30) as response:
            return read_response(response)
    except HTTPError as error:
        if not follow_redirects and 300 <= error.code < 400:
            return read_response(error)
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code} for {url}\n{body}") from error
    except URLError as error:
        raise RuntimeError(f"Unable to reach {url}: {error.reason}") from error


def read_response(response: HTTPResponse) -> tuple[int, str, dict[str, str], str]:
    body = response.read().decode("utf-8", errors="replace")
    headers = {key.lower(): value for key, value in response.headers.items()}
    return response.status, response.geturl(), headers, body


def fetch_text(url: str) -> str:
    _, _, _, body = open_response(url)
    return body


def fetch_json(url: str) -> dict:
    return json.loads(fetch_text(url))


def assert_contains(haystack: str, needle: str, *, context: str) -> None:
    if needle not in haystack:
        raise AssertionError(f"Missing `{needle}` in {context}")


def assert_header_contains(headers: dict[str, str], name: str, needle: str, *, context: str) -> None:
    value = headers.get(name.lower(), "")
    if needle not in value:
        raise AssertionError(f"Missing `{needle}` in header `{name}` for {context}: {value!r}")


ANONYMOUS_PATHS = [
    ("GET", ""),
    ("GET", "index.html"),
    ("GET", "app/"),
    ("GET", "app/index.html"),
    ("GET", "app/capture/"),
    ("GET", "app/data/dashboard.json"),
    ("GET", "manifest.webmanifest"),
    ("GET", "sw.js"),
    ("GET", "auth.js"),
    ("GET", "icon-192.png"),
    ("GET", "missing-page"),
    ("POST", "api/create-intake-ticket"),
    ("POST", ".netlify/functions/create-intake-ticket"),
]


def open_status(url: str, *, method: str = "GET") -> tuple[int, dict[str, str]]:
    # Cloudflare refuses the default Python-urllib user agent (error 1010).
    headers = {"Cache-Control": "no-cache", "Accept": "*/*", "User-Agent": USER_AGENT}
    request = Request(url, headers=headers, method=method, data=b"" if method == "POST" else None)
    try:
        with build_opener(NoRedirectHandler()).open(request, timeout=30) as response:
            return response.status, {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as error:
        return error.code, {key.lower(): value for key, value in error.headers.items()}
    except URLError as error:
        raise RuntimeError(f"Unable to reach {url}: {error.reason}") from error


def run_public(base_url: str) -> None:
    """Anonymous visitor: every route must stop at Cloudflare Access (redirect to *.cloudflareaccess.com)
    or at the Worker check (401/403, or 503 when Access is not configured). Nothing may answer 2xx."""
    root_url = base_url.rstrip("/") + "/"
    for method, path in ANONYMOUS_PATHS:
        url = urljoin(root_url, path)
        status, headers = open_status(url, method=method)
        location = headers.get("location", "")
        if status in {301, 302, 303, 307, 308}:
            host = urlsplit(urljoin(url, location)).hostname or ""
            if not host.endswith(".cloudflareaccess.com"):
                raise AssertionError(f"{method} {url}: redirect outside Cloudflare Access ({location!r})")
        elif status not in {401, 403, 503}:
            raise AssertionError(f"{method} {url}: anonymous request answered HTTP {status}")
        if status in {401, 403, 503}:
            assert_header_contains(headers, "cache-control", "no-store", context=f"{method} {url}")
            assert_header_contains(headers, "x-frame-options", "DENY", context=f"{method} {url}")
        print(f"[smoke] {method} /{path}: {status} {location}".rstrip())
    print(f"[smoke] Public site closed to anonymous visitors: {base_url}")


def run_vps(base_url: str) -> None:
    app_url = base_url.rstrip("/") + "/app/"
    data_url = base_url.rstrip("/") + "/app/data/dashboard.json"
    _, _, app_headers, app_html = open_response(app_url)
    _, _, data_headers, dashboard_json = open_response(data_url)
    dashboard = json.loads(dashboard_json)

    assert_contains(app_html, "dashboard-freshness", context="VPS app page")
    assert_header_contains(app_headers, "content-type", "text/html", context="VPS app page")
    assert_header_contains(data_headers, "content-type", "application/json", context="VPS dashboard JSON")
    if not dashboard.get("generatedAt"):
        raise AssertionError("Missing generatedAt in dashboard JSON")
    recent_meals = dashboard.get("recentMeals") or []
    if not recent_meals:
        raise AssertionError("Missing recentMeals in dashboard JSON")
    first_items = recent_meals[0].get("items") or []
    if not first_items or not first_items[0].get("icon"):
        raise AssertionError("Missing food icons in recentMeals items")
    print(f"[smoke] VPS dashboard OK: {base_url}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke test public or VPS-served site endpoints.")
    parser.add_argument("target", choices=["public", "vps"])
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()

    if args.target == "public":
        run_public(args.base_url)
    else:
        run_vps(args.base_url)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001
        print(f"[smoke] FAILED: {error}", file=sys.stderr)
        raise
