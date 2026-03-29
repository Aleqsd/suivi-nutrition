from __future__ import annotations

import csv
import json
import sys
from collections.abc import Iterable
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
JOURNAL_DIR = ROOT / "data" / "journal"
SCHEMA_PATH = ROOT / "schemas" / "day_log.schema.json"
PROFILE_PATH = ROOT / "data" / "profile" / "current.yaml"
PROFILE_SCHEMA_PATH = ROOT / "schemas" / "profile.schema.json"


def require_dependencies():
    try:
        import yaml  # type: ignore
    except ImportError as exc:  # pragma: no cover - direct CLI feedback
        print("Missing dependency: PyYAML. Run `python -m pip install -r requirements.txt`.", file=sys.stderr)
        raise SystemExit(1) from exc

    try:
        import jsonschema  # type: ignore
    except ImportError as exc:  # pragma: no cover - direct CLI feedback
        print("Missing dependency: jsonschema. Run `python -m pip install -r requirements.txt`.", file=sys.stderr)
        raise SystemExit(1) from exc

    return yaml, jsonschema


def project_root() -> Path:
    return ROOT


def iter_journal_files() -> list[Path]:
    return sorted(JOURNAL_DIR.rglob("*.yaml"))


def load_yaml(path: Path):
    yaml, _ = require_dependencies()
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_schema(schema_path: Path) -> dict:
    with schema_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def build_validator(schema_path: Path):
    _, jsonschema = require_dependencies()
    schema = load_schema(schema_path)
    validator_cls = jsonschema.Draft202012Validator
    validator = validator_cls(schema)
    return validator


def validate_document(document: dict, source_path: Path, schema_path: Path) -> list[str]:
    validator = build_validator(schema_path)
    errors = []
    for error in sorted(validator.iter_errors(document), key=lambda item: list(item.path)):
        json_path = ".".join(str(part) for part in error.path) or "<root>"
        errors.append(f"{source_path}: {json_path}: {error.message}")
    return errors


def validate_day_log(document: dict, source_path: Path) -> list[str]:
    return validate_document(document, source_path, SCHEMA_PATH)


def validate_profile(document: dict, source_path: Path) -> list[str]:
    return validate_document(document, source_path, PROFILE_SCHEMA_PATH)


def month_key(date_value: str) -> str:
    return date_value[:7]


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_csv(path: Path, fieldnames: list[str], rows: Iterable[dict]) -> None:
    ensure_parent(path)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name, "") for name in fieldnames})


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))
