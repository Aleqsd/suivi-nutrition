from __future__ import annotations

import argparse
import json
import re
import sys
from http.client import HTTPResponse
from urllib.parse import urljoin
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


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


def assert_redirects_to_root(url: str, *, context: str) -> None:
    status, _, headers, _ = open_response(url, follow_redirects=False)
    if status not in {301, 302}:
        raise AssertionError(f"Expected redirect for {context}, got HTTP {status}")
    location = headers.get("location", "")
    if location != "/":
        raise AssertionError(f"Expected redirect to `/` for {context}, got {location!r}")


def assert_html_ok(url: str, *, context: str) -> tuple[dict[str, str], str]:
    status, _, headers, body = open_response(url)
    if status != 200:
        raise AssertionError(f"Expected HTTP 200 for {context}, got HTTP {status}")
    assert_header_contains(headers, "content-type", "text/html", context=context)
    return headers, body


def run_public(base_url: str) -> None:
    root_url = base_url.rstrip("/") + "/"
    _, _, root_headers, html = open_response(root_url)
    assert_contains(html, "Continuer avec Google", context="public login page")
    assert_contains(html, "auth.js?v=", context="public login page")
    assert_contains(html, "styles.css?v=", context="public login page")
    assert_header_contains(root_headers, "content-security-policy", "frame-ancestors 'none'", context="public login page")
    assert_header_contains(root_headers, "x-frame-options", "DENY", context="public login page")
    assert_header_contains(root_headers, "permissions-policy", "camera=()", context="public login page")
    asset_matches = re.findall(r"""(?:href|src)=["']([^"']+\?(?:v|version)=[^"']+)["']""", html)
    if not asset_matches:
        raise AssertionError("Missing versioned assets on public login page")
    for asset in asset_matches:
        fetch_text(urljoin(root_url, asset))

    _, app_html = assert_html_ok(urljoin(root_url, "app/"), context="anonymous /app/ shell")
    assert_contains(app_html, "dashboard-freshness", context="anonymous /app/ shell")
    assert_contains(app_html, "app.js?v=", context="anonymous /app/ shell")
    _, app_index_html = assert_html_ok(urljoin(root_url, "app/index.html"), context="anonymous /app/index.html shell")
    assert_contains(app_index_html, "dashboard-freshness", context="anonymous /app/index.html shell")
    _, capture_html = assert_html_ok(urljoin(root_url, "app/capture/"), context="anonymous /app/capture/ shell")
    assert_contains(capture_html, "Ajouter un repas depuis une photo", context="anonymous /app/capture/ shell")
    manifest = fetch_json(urljoin(root_url, "manifest.webmanifest"))
    if manifest.get("share_target", {}).get("action") != "/app/share-target/":
        raise AssertionError("PWA share target must point to /app/share-target/.")
    assert_redirects_to_root(urljoin(root_url, "app/data/dashboard.json"), context="anonymous dashboard JSON")

    identity_settings = fetch_json(urljoin(root_url, ".netlify/identity/settings"))
    external = identity_settings.get("external") or {}
    if not external.get("google"):
        raise AssertionError("Netlify Identity must keep Google enabled.")
    if identity_settings.get("disable_signup"):
        print("[smoke] Netlify Identity signup mode: invite only.")
    else:
        print("[smoke] WARN: Netlify Identity signup is open; runtime signup webhook must stay restrictive.")
    if external.get("email"):
        print("[smoke] WARN: Netlify Identity still exposes email auth in settings; runtime policy must block it.")

    print(f"[smoke] Public page OK: {base_url}")


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
