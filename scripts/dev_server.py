from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from _common import project_root


ROOT = project_root()
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 43817
WATCH_INTERVAL_SECONDS = 1.0

WATCH_ROOTS = [
    ROOT / "data" / "journal",
    ROOT / "data" / "journal-imports",
    ROOT / "data" / "profile",
    ROOT / "data" / "reference",
    ROOT / "data" / "raw",
    ROOT / "schemas",
    ROOT / "scripts",
    ROOT / "site",
]

IGNORED_ROOTS = [
    ROOT / ".git",
    ROOT / "data" / "normalized",
    ROOT / "data" / "derived",
    ROOT / "site" / "app" / "data",
    ROOT / "tmp",
    ROOT / "scripts" / "__pycache__",
]

IGNORED_FILES = {
    ROOT / "data" / "profile" / "health-reference.md",
}

WATCHED_SUFFIXES = {
    ".py",
    ".yaml",
    ".yml",
    ".json",
    ".md",
    ".html",
    ".css",
    ".js",
    ".pdf",
    ".csv",
}

SITE_ONLY_SUFFIXES = {".html", ".css", ".js"}


@dataclass
class ChangeSet:
    changed_paths: list[Path]
    requires_rebuild: bool


class DevServerState:
    def __init__(self) -> None:
        self.version = 0
        self.last_build_status = "not_started"
        self.last_build_at = ""
        self.last_change = ""
        self.last_error = ""
        self.condition = threading.Condition()

    def notify_reload(self, reason: str) -> None:
        with self.condition:
            self.version += 1
            self.last_change = reason
            self.condition.notify_all()

    def update_build_status(self, status: str, error: str = "") -> None:
        self.last_build_status = status
        self.last_build_at = time.strftime("%Y-%m-%dT%H:%M:%S")
        self.last_error = error


class DashboardHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], handler_class, state: DevServerState) -> None:
        self.state = state
        super().__init__(server_address, handler_class)


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    server: DashboardHTTPServer

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/site/")
            self.end_headers()
            return
        if parsed.path == "/__status":
            self.handle_status()
            return
        if parsed.path == "/__events":
            self.handle_events()
            return
        super().do_GET()

    def handle_status(self) -> None:
        payload = {
            "host": self.server.server_address[0],
            "port": self.server.server_address[1],
            "version": self.server.state.version,
            "lastBuildStatus": self.server.state.last_build_status,
            "lastBuildAt": self.server.state.last_build_at,
            "lastChange": self.server.state.last_change,
            "lastError": self.server.state.last_error,
        }
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def handle_events(self) -> None:
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        last_version = self.server.state.version
        try:
            while True:
                with self.server.state.condition:
                    self.server.state.condition.wait(timeout=15)
                    current_version = self.server.state.version
                    if current_version == last_version:
                        payload = "event: ping\ndata: keepalive\n\n"
                    else:
                        payload = f"event: reload\ndata: {current_version}\n\n"
                        last_version = current_version
                self.wfile.write(payload.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        message = "%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        )
        sys.stdout.write(message)


def is_ignored(path: Path) -> bool:
    resolved = path.resolve()
    if resolved in {item.resolve() for item in IGNORED_FILES}:
        return True
    for ignored in IGNORED_ROOTS:
        try:
            resolved.relative_to(ignored)
            return True
        except ValueError:
            continue
    return False


def iter_watched_files() -> dict[Path, float]:
    snapshot: dict[Path, float] = {}
    for root in WATCH_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in WATCHED_SUFFIXES:
                continue
            if is_ignored(path):
                continue
            try:
                snapshot[path.resolve()] = path.stat().st_mtime
            except FileNotFoundError:
                continue
    return snapshot


def classify_changes(previous: dict[Path, float], current: dict[Path, float]) -> ChangeSet | None:
    changed_paths: list[Path] = []
    all_paths = set(previous) | set(current)
    for path in sorted(all_paths):
        before = previous.get(path)
        after = current.get(path)
        if before != after:
            changed_paths.append(path)
    if not changed_paths:
        return None

    requires_rebuild = False
    for path in changed_paths:
        if is_ignored(path):
            continue
        relative = path.relative_to(ROOT).as_posix()
        if relative.startswith("site/") and not relative.startswith("site/app/data/") and path.suffix.lower() in SITE_ONLY_SUFFIXES:
            continue
        requires_rebuild = True
        break

    return ChangeSet(changed_paths=changed_paths, requires_rebuild=requires_rebuild)


def build_all(state: DevServerState) -> bool:
    command = [sys.executable, str(ROOT / "scripts" / "build_derived.py")]
    print("[dev-server] Running build_derived.py ...")
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)

    if result.returncode == 0:
        state.update_build_status("ok")
        return True

    state.update_build_status("failed", error=result.stderr.strip() or result.stdout.strip())
    print("[dev-server] Build failed.", file=sys.stderr)
    return False


def watcher_loop(state: DevServerState) -> None:
    previous = iter_watched_files()
    while True:
        time.sleep(WATCH_INTERVAL_SECONDS)
        current = iter_watched_files()
        change_set = classify_changes(previous, current)
        previous = current
        if not change_set:
            continue

        rendered_paths = [path.relative_to(ROOT).as_posix() for path in change_set.changed_paths[:5]]
        if len(change_set.changed_paths) > 5:
            rendered_paths.append(f"+{len(change_set.changed_paths) - 5} more")
        reason = ", ".join(rendered_paths)
        print(f"[dev-server] Change detected: {reason}")

        if change_set.requires_rebuild:
            if build_all(state):
                state.notify_reload(reason)
        else:
            state.notify_reload(reason)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Local dashboard server with rebuild and live reload.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Bind address. Defaults to 127.0.0.1.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Bind port. Defaults to {DEFAULT_PORT}.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os.chdir(ROOT)

    state = DevServerState()
    if not build_all(state):
        print("[dev-server] Initial build failed. Fix the issue and save a file to trigger another build.", file=sys.stderr)

    watcher = threading.Thread(target=watcher_loop, args=(state,), daemon=True)
    watcher.start()

    server = DashboardHTTPServer((args.host, args.port), DashboardRequestHandler, state)
    print(f"[dev-server] Serving local dashboard at http://{args.host}:{args.port}/site/")
    print("[dev-server] Live reload endpoint available at /__events")
    print("[dev-server] Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[dev-server] Stopping.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
