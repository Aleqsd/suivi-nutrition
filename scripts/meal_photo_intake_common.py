from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import secrets
import subprocess
import sys
import unicodedata
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from _common import RAW_MEAL_PHOTOS_DIR, ROOT, ensure_parent, load_yaml, write_yaml


DEFAULT_TIMEZONE = "Europe/Paris"
DEFAULT_MAX_UPLOAD_BYTES = 12 * 1024 * 1024
DEFAULT_TICKET_TTL_SECONDS = 30 * 60
DEFAULT_CAPTURE_PORT = 43818
HASH_INDEX_PATH = RAW_MEAL_PHOTOS_DIR / "hash-index.json"
PIPELINE_LOCK_PATH = ROOT / "tmp" / "refresh-site.lock"
INTAKE_LOCK_PATH = ROOT / "tmp" / "meal-photo-intake.lock"
VALID_UNITS = {
    "g",
    "kg",
    "ml",
    "l",
    "unit",
    "piece",
    "slice",
    "plate",
    "bowl",
    "cup",
    "glass",
    "pack",
    "tbsp",
    "tsp",
}
UNIT_ALIASES = {
    "gram": "g",
    "grams": "g",
    "gramme": "g",
    "grammes": "g",
    "kg": "kg",
    "kilogram": "kg",
    "kilograms": "kg",
    "ml": "ml",
    "milliliter": "ml",
    "milliliters": "ml",
    "millilitre": "ml",
    "millilitres": "ml",
    "l": "l",
    "liter": "l",
    "liters": "l",
    "litre": "l",
    "litres": "l",
    "unit": "unit",
    "units": "unit",
    "piece": "piece",
    "pieces": "piece",
    "piecee": "piece",
    "pièce": "piece",
    "pièces": "piece",
    "slice": "slice",
    "slices": "slice",
    "tranche": "slice",
    "tranches": "slice",
    "plate": "plate",
    "assiette": "plate",
    "bowl": "bowl",
    "bol": "bowl",
    "cup": "cup",
    "tasse": "cup",
    "glass": "glass",
    "verre": "glass",
    "pack": "pack",
    "packs": "pack",
    "tbsp": "tbsp",
    "cuillere_a_soupe": "tbsp",
    "cuillère_a_soupe": "tbsp",
    "tsp": "tsp",
    "cuillere_a_cafe": "tsp",
    "cuillère_a_cafe": "tsp",
}
MEAL_ANALYSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "meal_confidence",
        "estimation_confidence",
        "estimated_energy_kcal",
        "quality_score",
        "recommendations",
        "notes",
        "items",
    ],
    "properties": {
        "meal_confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "estimation_confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "estimated_energy_kcal": {"type": "number", "minimum": 0},
        "quality_score": {"type": "integer", "minimum": 0, "maximum": 100},
        "recommendations": {
            "type": "array",
            "maxItems": 3,
            "items": {"type": "string"},
        },
        "notes": {"type": "string"},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "label",
                        "confidence",
                        "quantity",
                        "unit",
                        "portion_text",
                        "preparation",
                        "notes",
                        "estimated_energy_kcal",
                    ],
                    "properties": {
                        "label": {"type": "string"},
                        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                    "quantity": {"type": ["number", "null"], "minimum": 0},
                    "unit": {"type": ["string", "null"]},
                    "portion_text": {"type": ["string", "null"]},
                    "preparation": {"type": ["string", "null"]},
                    "notes": {"type": ["string", "null"]},
                    "estimated_energy_kcal": {"type": ["number", "null"], "minimum": 0},
                },
            },
        },
    },
}


@dataclass(slots=True)
class IntakeSettings:
    capture_base_url: str
    public_base_url: str
    intake_shared_secret: str
    openai_api_key: str
    openai_meal_vision_model: str
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES
    timezone_name: str = DEFAULT_TIMEZONE
    skip_publish: bool = False


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=False)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def local_now(timezone_name: str = DEFAULT_TIMEZONE) -> datetime:
    return utc_now().astimezone(ZoneInfo(timezone_name))


def normalize_token(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or ""))
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = "".join(char if char.isalnum() else " " for char in ascii_only.lower())
    return " ".join(cleaned.split())


def truncate_text(value: str, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def meal_photo_settings_from_env() -> IntakeSettings:
    return IntakeSettings(
        capture_base_url=str(os.getenv("CAPTURE_BASE_URL", "")).strip().rstrip("/"),
        public_base_url=str(os.getenv("PUBLIC_BASE_URL", "")).strip().rstrip("/"),
        intake_shared_secret=str(os.getenv("INTAKE_SHARED_SECRET", "")).strip(),
        openai_api_key=str(os.getenv("OPENAI_API_KEY", "")).strip(),
        openai_meal_vision_model=str(os.getenv("OPENAI_MEAL_VISION_MODEL", "gpt-4.1")).strip(),
        max_upload_bytes=int(os.getenv("INTAKE_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES)),
        timezone_name=str(os.getenv("APP_TIMEZONE", DEFAULT_TIMEZONE)).strip() or DEFAULT_TIMEZONE,
        skip_publish=str(os.getenv("INTAKE_SKIP_PUBLISH", "")).strip().lower() in {"1", "true", "yes"},
    )


def require_intake_secret(settings: IntakeSettings) -> None:
    if not settings.intake_shared_secret:
        raise ValueError("Missing INTAKE_SHARED_SECRET.")
    if not settings.capture_base_url:
        raise ValueError("Missing CAPTURE_BASE_URL.")


def _sign_ticket_payload(encoded_payload: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256).hexdigest()


def issue_intake_ticket(
    *,
    secret: str,
    capture_base_url: str,
    email: str,
    provider: str,
    origin: str,
    max_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    ttl_seconds: int = DEFAULT_TICKET_TTL_SECONDS,
) -> dict[str, Any]:
    issued_at = int(utc_now().timestamp())
    payload = {
        "email": email,
        "provider": provider,
        "origin": origin,
        "aud": capture_base_url.rstrip("/"),
        "max_bytes": max_bytes,
        "iat": issued_at,
        "exp": issued_at + ttl_seconds,
        "nonce": secrets.token_hex(8),
    }
    encoded_payload = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")).decode("ascii")
    signature = _sign_ticket_payload(encoded_payload, secret)
    return {
        "ticket": f"{encoded_payload}.{signature}",
        "expires_at": datetime.fromtimestamp(payload["exp"], tz=timezone.utc).isoformat().replace("+00:00", "Z"),
        "upload_url": capture_base_url.rstrip("/") + "/v1/meal-photo-intake",
        "max_bytes": max_bytes,
    }


def verify_intake_ticket(ticket: str, *, secret: str, capture_base_url: str) -> dict[str, Any]:
    try:
        encoded_payload, signature = str(ticket).split(".", 1)
    except ValueError as exc:
        raise ValueError("Malformed intake ticket.") from exc
    expected_signature = _sign_ticket_payload(encoded_payload, secret)
    if not hmac.compare_digest(signature, expected_signature):
        raise ValueError("Invalid intake ticket signature.")
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded_payload.encode("ascii") + b"==="))
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Invalid intake ticket payload.") from exc
    now_ts = int(utc_now().timestamp())
    if int(payload.get("exp", 0)) < now_ts:
        raise ValueError("Expired intake ticket.")
    if str(payload.get("aud", "")).rstrip("/") != capture_base_url.rstrip("/"):
        raise ValueError("Intake ticket audience mismatch.")
    return payload


@contextmanager
def file_lock(path: Path):
    ensure_parent(path)
    with path.open("a+", encoding="utf-8") as handle:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield handle
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield handle
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def load_food_reference() -> list[dict[str, Any]]:
    path = ROOT / "data" / "reference" / "foods.yaml"
    document = load_yaml(path)
    return [item for item in document if isinstance(item, dict)] if isinstance(document, list) else []


def normalize_unit(value: Any) -> str:
    token = normalize_token(str(value or "")).replace(" ", "_")
    if token in UNIT_ALIASES:
        return UNIT_ALIASES[token]
    if token in VALID_UNITS:
        return token
    return ""


def normalize_confidence(value: Any, *, default: str = "medium") -> str:
    token = normalize_token(str(value or ""))
    if token.startswith("high"):
        return "high"
    if token.startswith("low"):
        return "low"
    if token.startswith("medium") or token.startswith("moy"):
        return "medium"
    return default


def coerce_float(value: Any) -> float | None:
    if value in ("", None):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_client_datetime(value: str | None, *, timezone_name: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return parsed.astimezone(ZoneInfo(timezone_name))


def extract_photo_capture_context(
    image_path: Path,
    *,
    shared_at: str | None = None,
    timezone_name: str = DEFAULT_TIMEZONE,
) -> dict[str, str]:
    tz = ZoneInfo(timezone_name)
    captured_at: datetime | None = None
    source = "server_now"
    notes = ""

    try:
        from PIL import Image, ExifTags

        tag_names = {name: tag for tag, name in ExifTags.TAGS.items()}
        offset_names = {name: tag for tag, name in getattr(ExifTags, "GPSTAGS", {}).items()}
        del offset_names  # silence unused on older Pillow
        with Image.open(image_path) as image:
            exif = image.getexif()
        date_time_original = exif.get(tag_names.get("DateTimeOriginal")) if exif else None
        offset_time_original = exif.get(tag_names.get("OffsetTimeOriginal")) if exif else None
        for tag_name, label in (
            ("DateTimeOriginal", "exif_datetime_original"),
            ("DateTimeDigitized", "exif_datetime"),
            ("DateTime", "exif_datetime"),
        ):
            raw_value = exif.get(tag_names.get(tag_name)) if exif else None
            if not raw_value:
                continue
            parsed = datetime.strptime(str(raw_value), "%Y:%m:%d %H:%M:%S")
            if label == "exif_datetime_original" and offset_time_original:
                offset_text = str(offset_time_original)
                if len(offset_text) == 6 and offset_text[0] in {"+", "-"}:
                    hours = int(offset_text[1:3])
                    minutes = int(offset_text[4:6])
                    offset = timezone((1 if offset_text[0] == "+" else -1) * timedelta(hours=hours, minutes=minutes))
                    parsed = parsed.replace(tzinfo=offset).astimezone(tz)
                else:
                    parsed = parsed.replace(tzinfo=tz)
            else:
                parsed = parsed.replace(tzinfo=tz)
            captured_at = parsed.astimezone(tz)
            source = label
            break
        if captured_at is None and date_time_original:
            parsed = datetime.strptime(str(date_time_original), "%Y:%m:%d %H:%M:%S").replace(tzinfo=tz)
            captured_at = parsed.astimezone(tz)
            source = "exif_datetime"
    except ImportError:
        notes = "Pillow indisponible: métadonnées EXIF non lues."
    except Exception as exc:  # noqa: BLE001
        notes = f"Métadonnées EXIF inexploitables: {truncate_text(str(exc), 120)}"

    if captured_at is None:
        shared_at_dt = parse_client_datetime(shared_at, timezone_name=timezone_name)
        if shared_at_dt is not None:
            captured_at = shared_at_dt
            source = "shared_at"

    if captured_at is None:
        captured_at = local_now(timezone_name)
        source = "server_now"

    return {
        "date": captured_at.strftime("%Y-%m-%d"),
        "time": captured_at.strftime("%H:%M"),
        "captured_at": captured_at.isoformat(timespec="seconds"),
        "time_source": source,
        "notes": notes,
    }


def infer_meal_type(time_text: str) -> str:
    try:
        hours, minutes = (int(part) for part in time_text.split(":", 1))
    except (TypeError, ValueError):
        return "snack"
    minute_of_day = hours * 60 + minutes
    if 5 * 60 <= minute_of_day <= 10 * 60 + 59:
        return "breakfast"
    if 11 * 60 <= minute_of_day <= 14 * 60 + 59:
        return "lunch"
    if 15 * 60 <= minute_of_day <= 18 * 60 + 29:
        return "snack"
    if 18 * 60 + 30 <= minute_of_day <= 23 * 60 + 59:
        return "dinner"
    return "snack"


def _reference_candidates(food: dict[str, Any]) -> list[str]:
    candidates = [str(food.get("key", "")), str(food.get("label", ""))]
    default_portion = food.get("default_portion", {})
    if isinstance(default_portion, dict):
        candidates.append(str(default_portion.get("portion_text", "")))
    return [candidate for candidate in candidates if candidate.strip()]


def match_food_reference(label: str, food_reference: list[dict[str, Any]]) -> dict[str, Any] | None:
    normalized_label = normalize_token(label)
    if not normalized_label:
        return None

    best_score = 0.0
    best_match: dict[str, Any] | None = None
    for entry in food_reference:
        candidates = _reference_candidates(entry)
        for candidate in candidates:
            normalized_candidate = normalize_token(candidate)
            if not normalized_candidate:
                continue
            if normalized_label == normalized_candidate:
                return entry
            contains_bonus = 0.12 if normalized_label in normalized_candidate or normalized_candidate in normalized_label else 0.0
            score = SequenceMatcher(a=normalized_label, b=normalized_candidate).ratio() + contains_bonus
            if score > best_score:
                best_score = score
                best_match = entry
    return best_match if best_score >= 0.78 else None


def _build_known_foods_prompt(food_reference: list[dict[str, Any]]) -> str:
    rendered = []
    for entry in food_reference:
        label = str(entry.get("label", "")).strip()
        key = str(entry.get("key", "")).strip()
        portion = entry.get("default_portion", {}) if isinstance(entry.get("default_portion"), dict) else {}
        portion_text = str(portion.get("portion_text", "")).strip()
        category = str(entry.get("category", "")).strip()
        parts = [part for part in [label, key, category, portion_text] if part]
        if parts:
            rendered.append(" | ".join(parts))
    return "\n".join(f"- {line}" for line in rendered[:80])


def _extract_response_text(response: Any) -> str:
    output_text = getattr(response, "output_text", "")
    if output_text:
        return str(output_text)
    output = getattr(response, "output", []) or []
    for item in output:
        for content in getattr(item, "content", []) or []:
            text_value = getattr(content, "text", "")
            if text_value:
                return str(text_value)
    raise ValueError("OpenAI response did not contain output text.")


def analyze_meal_photo(
    image_bytes: bytes,
    *,
    filename: str,
    content_type: str,
    model: str,
    api_key: str,
    food_reference: list[dict[str, Any]],
) -> dict[str, Any]:
    if not api_key:
        raise ValueError("Missing OPENAI_API_KEY.")

    from openai import OpenAI

    data_url = f"data:{content_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    prompt = (
        "Tu analyses une photo de repas pour un journal nutritionnel personnel.\n"
        "Réponds uniquement selon le JSON schema fourni.\n"
        "Règles:\n"
        "- Ne jamais inventer des aliments invisibles ou très incertains.\n"
        "- Si un aliment est ambigu, garde un label générique prudent.\n"
        "- Les quantités doivent être des estimations rondes et défendables.\n"
        "- N'utiliser que des unités compatibles avec cette liste: "
        + ", ".join(sorted(VALID_UNITS))
        + ".\n"
        "- Si la portion n'est pas chiffrable, laisse quantity null et renseigne portion_text.\n"
        "- Ne renvoie jamais de macros; seulement estimated_energy_kcal si c'est défendable.\n"
        "- Les recommandations doivent être courtes, concrètes et en français.\n"
        "- Les labels d'aliments doivent être en français si possible.\n"
        "- Le score qualité sur 100 est heuristique et non médical.\n\n"
        "Références alimentaires connues du dépôt:\n"
        f"{_build_known_foods_prompt(food_reference)}\n\n"
        f"Nom de fichier source: {filename}\n"
    )

    client = OpenAI(api_key=api_key)
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": data_url},
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "meal_photo_analysis",
                "schema": MEAL_ANALYSIS_SCHEMA,
                "strict": True,
            }
        },
    )
    return json.loads(_extract_response_text(response))


def normalize_analysis_to_draft(
    analysis: dict[str, Any],
    *,
    capture_context: dict[str, str],
    food_reference: list[dict[str, Any]],
) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    low_confidence_items = 0

    for raw_item in analysis.get("items", []):
        label = truncate_text(str(raw_item.get("label", "")).strip(), 120)
        if not label:
            continue
        confidence = normalize_confidence(raw_item.get("confidence"), default="medium")
        if confidence == "low":
            low_confidence_items += 1
        quantity = coerce_float(raw_item.get("quantity"))
        unit = normalize_unit(raw_item.get("unit"))
        portion_text = truncate_text(str(raw_item.get("portion_text") or "").strip(), 120)
        if quantity is None or not unit:
            quantity = None
            unit = ""
        if quantity is None and not portion_text:
            portion_text = "portion non précisée"
        reference = match_food_reference(label, food_reference)
        item_notes = [truncate_text(str(raw_item.get("notes") or "").strip(), 220)] if raw_item.get("notes") else []
        if confidence != "high":
            item_notes.append(f"Confiance IA {confidence}.")
        normalized_item: dict[str, Any] = {
            "label": label,
            "quantity_source": "estimated" if quantity is not None and unit else "unknown",
            "notes": " ".join(note for note in item_notes if note).strip(),
        }
        if reference:
            normalized_item["food_key"] = reference.get("key", "")
        if quantity is not None and unit:
            normalized_item["quantity"] = round(quantity, 1)
            normalized_item["unit"] = unit
        if portion_text:
            normalized_item["portion_text"] = portion_text
        preparation = truncate_text(str(raw_item.get("preparation") or "").strip(), 80)
        if preparation:
            normalized_item["preparation"] = preparation
        item_kcal = coerce_float(raw_item.get("estimated_energy_kcal"))
        if item_kcal is not None and item_kcal > 0:
            normalized_item["estimated_nutrition"] = {"energy_kcal": round(item_kcal, 1)}
        items.append(normalized_item)

    if not items:
        items.append(
            {
                "label": "Repas non reconnu précisément",
                "portion_text": "portion non précisée",
                "quantity_source": "unknown",
                "notes": "La photo n'a pas permis de distinguer les aliments de façon fiable.",
            }
        )

    meal_confidence = normalize_confidence(analysis.get("meal_confidence"), default="medium")
    assessment_confidence = normalize_confidence(analysis.get("estimation_confidence"), default=meal_confidence)
    recommendations = [truncate_text(str(value).strip(), 120) for value in analysis.get("recommendations", []) if str(value).strip()]
    top_labels = ", ".join(item["label"] for item in items[:4])
    source_text = f"Photo de repas partagée depuis Android. Aliments détectés: {top_labels}." if top_labels else "Photo de repas partagée depuis Android."
    notes = []
    if capture_context.get("notes"):
        notes.append(capture_context["notes"])
    notes.append(
        {
            "exif_datetime_original": "Heure issue des métadonnées EXIF d'origine.",
            "exif_datetime": "Heure issue d'une métadonnée EXIF secondaire.",
            "shared_at": "Heure issue du fichier partagé par le téléphone.",
            "server_now": "Heure repliée sur l'heure serveur Europe/Paris.",
        }.get(capture_context.get("time_source", ""), "")
    )
    analysis_notes = truncate_text(str(analysis.get("notes") or "").strip(), 240)
    if analysis_notes:
        notes.append(analysis_notes)

    estimated_energy_kcal = coerce_float(analysis.get("estimated_energy_kcal")) or 0.0
    quality_score = int(max(0, min(100, int(coerce_float(analysis.get("quality_score")) or 0))))
    meal_type = infer_meal_type(capture_context["time"])
    draft = {
        "date": capture_context["date"],
        "time": capture_context["time"],
        "meal_type": meal_type,
        "confidence": meal_confidence,
        "capture_method": "photo_share",
        "source_text": source_text,
        "time_source": capture_context["time_source"],
        "items": items,
        "meal_assessment": {
            "estimated_energy_kcal": round(estimated_energy_kcal, 1),
            "quality_score": quality_score,
            "estimation_confidence": assessment_confidence,
            "recommendations": recommendations[:3],
            "notes": " ".join(note for note in notes if note).strip(),
        },
    }
    draft["auto_commit_eligible"] = (
        capture_context["time_source"] == "exif_datetime_original"
        and meal_confidence == "high"
        and low_confidence_items == 0
    )
    return draft


def build_day_log_document(
    *,
    capture_id: str,
    draft: dict[str, Any],
    raw_photo_relative_path: str,
    imported_at: datetime,
    timezone_name: str = DEFAULT_TIMEZONE,
) -> dict[str, Any]:
    logged_at = imported_at.astimezone(ZoneInfo(timezone_name)).isoformat(timespec="seconds")
    meal_entry = {
        "time": draft["time"],
        "logged_at": logged_at,
        "meal_type": draft["meal_type"],
        "capture_method": "photo_share",
        "confidence": normalize_confidence(draft.get("confidence"), default="medium"),
        "context": "photo partagée Android",
        "source_text": draft.get("source_text", ""),
        "notes": draft.get("meal_assessment", {}).get("notes", ""),
        "meal_assessment": draft.get("meal_assessment", {}),
        "items": draft.get("items", []),
    }
    return {
        "date": draft["date"],
        "timezone": timezone_name,
        "source": {
            "type": "import",
            "origin": raw_photo_relative_path,
            "record_id": capture_id,
            "imported_at": imported_at.isoformat(timespec="seconds"),
        },
        "meals": [meal_entry],
    }


def import_document_path(date_value: str, capture_id: str) -> Path:
    month = date_value[:7]
    return ROOT / "data" / "journal-imports" / month[:4] / month[5:7] / f"{date_value}-photo-{capture_id}.yaml"


def capture_storage_dir(date_value: str) -> Path:
    month = date_value[:7]
    return RAW_MEAL_PHOTOS_DIR / month[:4] / month[5:7]


def guess_extension(filename: str, content_type: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".heic"}:
        return suffix
    if "png" in content_type:
        return ".png"
    if "webp" in content_type:
        return ".webp"
    if "heic" in content_type:
        return ".heic"
    return ".jpg"


def normalize_image_content_type(filename: str, content_type: str, image_bytes: bytes) -> str:
    normalized = str(content_type or "").strip().lower()
    if normalized.startswith("image/") and normalized != "image/octet-stream":
        return normalized

    suffix = Path(filename or "").suffix.lower()
    suffix_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
    }
    if suffix in suffix_map:
        return suffix_map[suffix]

    try:
        from PIL import Image

        with Image.open(io.BytesIO(image_bytes)) as image:
            format_name = str(image.format or "").strip().lower()
    except Exception:  # noqa: BLE001
        format_name = ""

    format_map = {
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "heic": "image/heic",
    }
    return format_map.get(format_name, "image/jpeg")


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def generate_capture_id(now: datetime | None = None) -> str:
    moment = (now or utc_now()).astimezone(timezone.utc)
    return f"{moment.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"


def load_hash_index() -> dict[str, dict[str, Any]]:
    if not HASH_INDEX_PATH.exists():
        return {}
    try:
        return json.loads(HASH_INDEX_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def save_hash_index(index: dict[str, dict[str, Any]]) -> None:
    ensure_parent(HASH_INDEX_PATH)
    HASH_INDEX_PATH.write_text(json_dumps(index) + "\n", encoding="utf-8")


def find_capture_sidecar(capture_id: str) -> Path | None:
    if not RAW_MEAL_PHOTOS_DIR.exists():
        return None
    matches = sorted(RAW_MEAL_PHOTOS_DIR.rglob(f"{capture_id}.json"))
    return matches[0] if matches else None


def load_capture_record(capture_id: str) -> dict[str, Any]:
    sidecar_path = find_capture_sidecar(capture_id)
    if sidecar_path is None:
        raise FileNotFoundError(f"Unknown capture id: {capture_id}")
    return json.loads(sidecar_path.read_text(encoding="utf-8"))


def save_capture_record(record: dict[str, Any], *, sidecar_path: Path) -> None:
    ensure_parent(sidecar_path)
    sidecar_path.write_text(json_dumps(record) + "\n", encoding="utf-8")


def store_photo_capture(
    *,
    capture_id: str,
    original_filename: str,
    content_type: str,
    image_bytes: bytes,
    capture_context: dict[str, str],
    uploader_email: str,
) -> dict[str, Any]:
    sha256 = compute_sha256(image_bytes)
    with file_lock(INTAKE_LOCK_PATH):
        hash_index = load_hash_index()
        duplicate = hash_index.get(sha256)
        if duplicate and duplicate.get("capture_id"):
            duplicate_capture_id = str(duplicate["capture_id"])
            try:
                duplicate_record = load_capture_record(duplicate_capture_id)
            except FileNotFoundError:
                hash_index.pop(sha256, None)
                save_hash_index(hash_index)
            else:
                if duplicate_record.get("status") != "failed":
                    return {"duplicate": True, "capture_id": duplicate_capture_id}
                stale_raw_path = str(duplicate_record.get("raw_photo_path", "")).strip()
                if stale_raw_path:
                    stale_raw = ROOT / stale_raw_path
                    if stale_raw.exists() and stale_raw.is_file():
                        stale_raw.unlink()
                stale_sidecar = find_capture_sidecar(duplicate_capture_id)
                if stale_sidecar and stale_sidecar.exists():
                    stale_sidecar.unlink()
                hash_index.pop(sha256, None)
                save_hash_index(hash_index)

        storage_dir = capture_storage_dir(capture_context["date"])
        extension = guess_extension(original_filename, content_type)
        raw_photo_path = storage_dir / f"{capture_id}{extension}"
        raw_photo_relative_path = raw_photo_path.relative_to(ROOT).as_posix()
        sidecar_path = storage_dir / f"{capture_id}.json"
        ensure_parent(raw_photo_path)
        raw_photo_path.write_bytes(image_bytes)

        record = {
            "capture_id": capture_id,
            "status": "uploaded",
            "created_at": utc_now().isoformat(timespec="seconds"),
            "updated_at": utc_now().isoformat(timespec="seconds"),
            "uploader_email": uploader_email,
            "original_filename": original_filename,
            "content_type": content_type,
            "size_bytes": len(image_bytes),
            "sha256": sha256,
            "raw_photo_path": raw_photo_relative_path,
            "capture_context": capture_context,
        }
        save_capture_record(record, sidecar_path=sidecar_path)
        hash_index[sha256] = {
            "capture_id": capture_id,
            "raw_photo_path": raw_photo_relative_path,
            "updated_at": record["updated_at"],
        }
        save_hash_index(hash_index)
        return {
            "duplicate": False,
            "capture_id": capture_id,
            "raw_photo_path": raw_photo_relative_path,
            "sidecar_path": sidecar_path,
        }


def run_refresh_pipeline(*, skip_publish: bool = False) -> None:
    commands = [
        [sys.executable, str(ROOT / "scripts" / "validate.py")],
        [sys.executable, str(ROOT / "scripts" / "normalize_journal.py")],
        [sys.executable, str(ROOT / "scripts" / "build_derived.py")],
    ]
    with file_lock(PIPELINE_LOCK_PATH):
        for command in commands:
            subprocess.run(command, cwd=ROOT, check=True)
        if skip_publish:
            return
        netlify_site_id = str(os.getenv("NETLIFY_SITE_ID", "")).strip()
        netlify_auth_token = str(os.getenv("NETLIFY_AUTH_TOKEN", "")).strip()
        if not netlify_site_id or not netlify_auth_token:
            raise RuntimeError("Missing NETLIFY_SITE_ID or NETLIFY_AUTH_TOKEN for publish.")
        env = os.environ.copy()
        env.setdefault("APP_DIR", str(ROOT))
        subprocess.run(
            ["bash", str(ROOT / "scripts" / "deploy_netlify_from_vps.sh")],
            cwd=ROOT,
            env=env,
            check=True,
        )


def persist_import_document(
    *,
    capture_id: str,
    draft: dict[str, Any],
    raw_photo_relative_path: str,
    timezone_name: str = DEFAULT_TIMEZONE,
) -> Path:
    imported_at = local_now(timezone_name)
    document = build_day_log_document(
        capture_id=capture_id,
        draft=draft,
        raw_photo_relative_path=raw_photo_relative_path,
        imported_at=imported_at,
        timezone_name=timezone_name,
    )
    target = import_document_path(draft["date"], capture_id)
    write_yaml(target, document)
    return target
