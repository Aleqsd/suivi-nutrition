from __future__ import annotations

import argparse

from meal_photo_intake_common import run_refresh_pipeline


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate, rebuild and optionally publish Atlas from the VPS.")
    parser.add_argument("--skip-publish", action="store_true", help="Skip the Netlify publish step.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    run_refresh_pipeline(skip_publish=args.skip_publish)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
