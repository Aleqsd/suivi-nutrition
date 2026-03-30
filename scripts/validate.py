from __future__ import annotations

import sys

from _common import PROFILE_PATH, iter_day_log_files, load_yaml, validate_day_log, validate_profile


def main() -> int:
    files = iter_day_log_files()
    if not files:
        print("No journal files found.")
        return 0

    all_errors: list[str] = []
    for path in files:
        document = load_yaml(path)
        if not isinstance(document, dict):
            all_errors.append(f"{path}: <root>: expected an object at top level")
            continue
        all_errors.extend(validate_day_log(document, path))

    if PROFILE_PATH.exists():
        profile_document = load_yaml(PROFILE_PATH)
        if not isinstance(profile_document, dict):
            all_errors.append(f"{PROFILE_PATH}: <root>: expected an object at top level")
        else:
            all_errors.extend(validate_profile(profile_document, PROFILE_PATH))

    if all_errors:
        for error in all_errors:
            print(error, file=sys.stderr)
        print(f"Validation failed: {len(all_errors)} error(s).", file=sys.stderr)
        return 1

    profile_suffix = " and profile" if PROFILE_PATH.exists() else ""
    print(f"Validated {len(files)} journal file(s){profile_suffix} successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
