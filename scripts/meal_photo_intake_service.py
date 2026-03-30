from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import default as default_email_policy
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from _common import ROOT
from meal_photo_intake_common import (
    DEFAULT_CAPTURE_PORT,
    generate_capture_id,
    analyze_meal_photo,
    file_lock,
    load_capture_record,
    load_food_reference,
    local_now,
    meal_photo_settings_from_env,
    normalize_confidence,
    normalize_image_content_type,
    normalize_unit,
    normalize_analysis_to_draft,
    persist_import_document,
    require_intake_secret,
    run_refresh_pipeline,
    save_capture_record,
    store_photo_capture,
    truncate_text,
    verify_intake_ticket,
    extract_photo_capture_context,
    coerce_float,
    INTAKE_LOCK_PATH,
)


@dataclass(slots=True)
class CaptureResponse:
    status: int
    payload: dict


@dataclass(slots=True)
class MultipartFile:
    filename: str
    content_type: str
    data: bytes


@dataclass(slots=True)
class MultipartForm:
    fields: dict[str, list[str]]
    files: dict[str, MultipartFile]

    def getfirst(self, name: str, default: str = "") -> str:
        values = self.fields.get(name)
        if not values:
            return default
        return values[0]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Private meal-photo ingestion service for Atlas.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_CAPTURE_PORT)
    return parser.parse_args()


def sanitize_draft(raw_draft: dict, *, fallback_draft: dict, capture_context: dict | None = None) -> dict:
    capture_context = capture_context or {}
    meal_assessment = raw_draft.get("meal_assessment", {}) if isinstance(raw_draft.get("meal_assessment"), dict) else {}
    source_assessment = fallback_draft.get("meal_assessment", {})

    sanitized_items = []
    for raw_item in raw_draft.get("items", []):
        if not isinstance(raw_item, dict):
            continue
        label = truncate_text(str(raw_item.get("label", "")).strip(), 120)
        if not label:
            continue
        quantity = coerce_float(raw_item.get("quantity"))
        unit = normalize_unit(raw_item.get("unit"))
        portion_text = truncate_text(str(raw_item.get("portion_text") or "").strip(), 120)
        item = {
            "label": label,
            "quantity_source": "estimated" if quantity is not None and unit else "unknown",
        }
        raw_food_key = str(raw_item.get("food_key", "")).strip()
        if raw_food_key:
            item["food_key"] = raw_food_key
        if quantity is not None and unit:
            item["quantity"] = round(quantity, 1)
            item["unit"] = unit
        if portion_text:
            item["portion_text"] = portion_text
        notes = truncate_text(str(raw_item.get("notes") or "").strip(), 220)
        if notes:
            item["notes"] = notes
        preparation = truncate_text(str(raw_item.get("preparation") or "").strip(), 80)
        if preparation:
            item["preparation"] = preparation
        item_kcal = coerce_float(raw_item.get("estimated_energy_kcal"))
        if item_kcal is not None and item_kcal > 0:
            item["estimated_nutrition"] = {"energy_kcal": round(item_kcal, 1)}
        if "quantity" not in item and "portion_text" not in item:
            item["portion_text"] = "portion non précisée"
        sanitized_items.append(item)

    if not sanitized_items:
        sanitized_items = fallback_draft.get("items", [])
    if not sanitized_items:
        raise ValueError("Le brouillon ne contient aucun aliment exploitable.")

    date_value = str(raw_draft.get("date") or fallback_draft.get("date") or capture_context.get("date") or "")
    time_value = str(raw_draft.get("time") or fallback_draft.get("time") or capture_context.get("time") or "")
    time_source = str(fallback_draft.get("time_source") or capture_context.get("time_source") or "")
    if not date_value or not time_value:
        raise ValueError("Le brouillon ne contient pas de date ou d'heure exploitable.")

    return {
        "date": date_value,
        "time": time_value,
        "meal_type": str(raw_draft.get("meal_type") or fallback_draft.get("meal_type") or "snack"),
        "confidence": normalize_confidence(raw_draft.get("confidence"), default=fallback_draft.get("confidence", "medium")),
        "capture_method": "photo_share",
        "source_text": truncate_text(
            str(raw_draft.get("source_text") or fallback_draft.get("source_text") or "").strip(),
            240,
        ),
        "time_source": time_source,
        "items": sanitized_items,
        "meal_assessment": {
            "estimated_energy_kcal": round(
                coerce_float(meal_assessment.get("estimated_energy_kcal"))
                or coerce_float(source_assessment.get("estimated_energy_kcal"))
                or 0.0,
                1,
            ),
            "quality_score": int(max(0, min(100, int(coerce_float(meal_assessment.get("quality_score")) or coerce_float(source_assessment.get("quality_score")) or 0)))),
            "estimation_confidence": normalize_confidence(
                meal_assessment.get("estimation_confidence"),
                default=source_assessment.get("estimation_confidence", "medium"),
            ),
            "recommendations": [
                truncate_text(str(value).strip(), 120)
                for value in (meal_assessment.get("recommendations") or source_assessment.get("recommendations") or [])
                if str(value).strip()
            ][:3],
            "notes": truncate_text(
                str(meal_assessment.get("notes") or source_assessment.get("notes") or "").strip(),
                240,
            ),
        },
        "auto_commit_eligible": False,
    }


def record_to_payload(record: dict) -> dict:
    return {
        "captureId": record.get("capture_id", ""),
        "status": record.get("status", ""),
        "duplicate": bool(record.get("duplicate")),
        "duplicateOf": record.get("duplicate_of", ""),
        "createdAt": record.get("created_at", ""),
        "updatedAt": record.get("updated_at", ""),
        "rawPhotoPath": record.get("raw_photo_path", ""),
        "sha256": record.get("sha256", ""),
        "captureContext": record.get("capture_context", {}),
        "draft": record.get("draft", {}),
        "importPath": record.get("import_path", ""),
        "error": record.get("error", ""),
        "refresh": record.get("refresh", {}),
    }


class IntakeRequestHandler(BaseHTTPRequestHandler):
    server_version = "AtlasMealPhotoIntake/1.0"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self._write_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/__health":
            self._send_json({"ok": True})
            return

        if parsed.path.startswith("/v1/meal-photo-intake/"):
            capture_id = parsed.path.rstrip("/").split("/")[-1]
            query = parse_qs(parsed.query)
            ticket = (query.get("ticket") or [""])[0]
            response = self._handle_status(capture_id=capture_id, ticket=ticket)
            self._send_json(response.payload, status=response.status)
            return

        self._send_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/v1/meal-photo-intake":
            response = self._handle_upload()
            self._send_json(response.payload, status=response.status)
            return

        if parsed.path.startswith("/v1/meal-photo-intake/") and parsed.path.endswith("/commit"):
            capture_id = parsed.path.rstrip("/").split("/")[-2]
            response = self._handle_commit(capture_id)
            self._send_json(response.payload, status=response.status)
            return

        self._send_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))

    def _settings(self):
        settings = meal_photo_settings_from_env()
        require_intake_secret(settings)
        return settings

    def _write_cors_headers(self, *, origin: str | None = None) -> None:
        settings = meal_photo_settings_from_env()
        allowed_origin = ""
        request_origin = origin or self.headers.get("Origin", "")
        if request_origin and settings.public_base_url and request_origin == settings.public_base_url:
            allowed_origin = request_origin
        elif settings.public_base_url:
            allowed_origin = settings.public_base_url
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Cache-Control", "private, no-store, max-age=0")

    def _send_json(self, payload: dict, *, status: int = HTTPStatus.OK, origin: str | None = None) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._write_cors_headers(origin=origin)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _error(self, message: str, *, status: int = HTTPStatus.BAD_REQUEST) -> CaptureResponse:
        return CaptureResponse(status=status, payload={"error": message})

    def _verify_ticket(self, ticket: str) -> tuple[dict, str]:
        settings = self._settings()
        payload = verify_intake_ticket(ticket, secret=settings.intake_shared_secret, capture_base_url=settings.capture_base_url)
        request_origin = self.headers.get("Origin", "")
        allowed_origin = str(payload.get("origin") or settings.public_base_url).rstrip("/")
        if request_origin and allowed_origin and request_origin.rstrip("/") != allowed_origin:
            raise ValueError("Origin not allowed for this intake ticket.")
        return payload, allowed_origin

    def _parse_multipart_form(self) -> MultipartForm:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise ValueError("Expected multipart/form-data.")
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length <= 0:
            raise ValueError("Expected a non-empty multipart/form-data body.")
        body = self.rfile.read(content_length)
        parser = BytesParser(policy=default_email_policy)
        message = parser.parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
        )
        if not message.is_multipart():
            raise ValueError("Expected multipart/form-data.")

        fields: dict[str, list[str]] = {}
        files: dict[str, MultipartFile] = {}
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            field_name = part.get_param("name", header="content-disposition")
            if not field_name:
                continue
            payload = part.get_payload(decode=True) or b""
            filename = part.get_filename()
            if filename:
                files[field_name] = MultipartFile(
                    filename=filename,
                    content_type=part.get_content_type() or "application/octet-stream",
                    data=payload,
                )
                continue
            fields.setdefault(field_name, []).append(
                payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            )

        return MultipartForm(fields=fields, files=files)

    def _parse_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            parsed = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON request body.") from exc
        if not isinstance(parsed, dict):
            raise ValueError("Expected a JSON object.")
        return parsed

    def _handle_status(self, *, capture_id: str, ticket: str) -> CaptureResponse:
        try:
            payload, _allowed_origin = self._verify_ticket(ticket)
            record = load_capture_record(capture_id)
        except FileNotFoundError:
            return self._error("Capture inconnue.", status=HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            return self._error(str(exc), status=HTTPStatus.FORBIDDEN)

        if record.get("uploader_email") != payload.get("email"):
            return self._error("Accès refusé pour cette capture.", status=HTTPStatus.FORBIDDEN)
        return CaptureResponse(status=HTTPStatus.OK, payload=record_to_payload(record))

    def _handle_upload(self) -> CaptureResponse:
        try:
            settings = self._settings()
            form = self._parse_multipart_form()
            ticket = form.getfirst("ticket", "")
            shared_at = form.getfirst("shared_at", "")
            ticket_payload, _allowed_origin = self._verify_ticket(ticket)
            photo_field = form.files.get("photo")
            if photo_field is None:
                return self._error("Aucune photo reçue.")
            image_bytes = photo_field.data
            if not image_bytes:
                return self._error("Le fichier photo est vide.")
            if len(image_bytes) > int(ticket_payload.get("max_bytes", settings.max_upload_bytes)):
                return self._error("La photo dépasse la taille maximale autorisée.", status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)

            original_filename = photo_field.filename or "meal-photo.jpg"
            content_type = normalize_image_content_type(
                original_filename,
                photo_field.content_type or "application/octet-stream",
                image_bytes,
            )
            capture_id = generate_capture_id()

            temp_dir = Path.cwd() / "tmp"
            temp_image_path = temp_dir / Path(original_filename).name
            temp_dir.mkdir(parents=True, exist_ok=True)
            temp_image_path.write_bytes(image_bytes)
            capture_context = extract_photo_capture_context(
                temp_image_path,
                shared_at=shared_at,
                timezone_name=settings.timezone_name,
            )
            temp_image_path.unlink(missing_ok=True)

            stored_result = store_photo_capture(
                capture_id=capture_id,
                original_filename=original_filename,
                content_type=content_type,
                image_bytes=image_bytes,
                capture_context=capture_context,
                uploader_email=str(ticket_payload.get("email", "")),
            )
            if stored_result.get("duplicate"):
                duplicate_record = load_capture_record(stored_result["capture_id"])
                duplicate_payload = record_to_payload(duplicate_record)
                duplicate_payload["duplicate"] = True
                duplicate_payload["duplicateOf"] = stored_result["capture_id"]
                return CaptureResponse(status=HTTPStatus.OK, payload=duplicate_payload)

            sidecar_path = stored_result["sidecar_path"]
            record = {
                **load_capture_record(capture_id),
                "capture_id": capture_id,
                "status": "processing",
                "updated_at": local_now(settings.timezone_name).isoformat(timespec="seconds"),
            }
            save_capture_record(record, sidecar_path=sidecar_path)

            food_reference = load_food_reference()
            analysis = analyze_meal_photo(
                image_bytes,
                filename=original_filename,
                content_type=content_type,
                model=settings.openai_meal_vision_model,
                api_key=settings.openai_api_key,
                food_reference=food_reference,
            )
            draft = normalize_analysis_to_draft(analysis, capture_context=capture_context, food_reference=food_reference)
            record.update(
                {
                    "status": "needs_review",
                    "updated_at": local_now(settings.timezone_name).isoformat(timespec="seconds"),
                    "draft": draft,
                    "analysis_model": settings.openai_meal_vision_model,
                    "duplicate": False,
                }
            )

            if draft.get("auto_commit_eligible"):
                import_path = persist_import_document(
                    capture_id=capture_id,
                    draft=draft,
                    raw_photo_relative_path=record["raw_photo_path"],
                    timezone_name=settings.timezone_name,
                )
                refresh_result = {"status": "running", "published": False}
                try:
                    run_refresh_pipeline(skip_publish=settings.skip_publish)
                    refresh_result = {"status": "done", "published": not settings.skip_publish}
                except Exception as exc:  # noqa: BLE001
                    refresh_result = {"status": "failed", "published": False, "error": truncate_text(str(exc), 220)}
                record["refresh"] = refresh_result
                record["status"] = "committed"
                record["import_path"] = import_path.relative_to(ROOT).as_posix()
            save_capture_record(record, sidecar_path=sidecar_path)
            return CaptureResponse(status=HTTPStatus.OK, payload=record_to_payload(record))
        except Exception as exc:  # noqa: BLE001
            if "sidecar_path" in locals():
                record = locals().get("record", {})
                record.update(
                    {
                        "capture_id": locals().get("capture_id", ""),
                        "status": "failed",
                        "updated_at": local_now(meal_photo_settings_from_env().timezone_name).isoformat(timespec="seconds"),
                        "error": truncate_text(str(exc), 220),
                    }
                )
                save_capture_record(record, sidecar_path=sidecar_path)
            return self._error(str(exc), status=HTTPStatus.BAD_REQUEST)

    def _handle_commit(self, capture_id: str) -> CaptureResponse:
        try:
            settings = self._settings()
            body = self._parse_json_body()
            ticket_payload, _allowed_origin = self._verify_ticket(str(body.get("ticket", "")))
            with file_lock(INTAKE_LOCK_PATH):
                record = load_capture_record(capture_id)
                if record.get("uploader_email") != ticket_payload.get("email"):
                    return self._error("Accès refusé pour cette capture.", status=HTTPStatus.FORBIDDEN)
                if record.get("status") == "committed":
                    return CaptureResponse(status=HTTPStatus.OK, payload=record_to_payload(record))
                sanitized_draft = sanitize_draft(
                    body.get("draft", {}),
                    fallback_draft=record.get("draft", {}),
                    capture_context=record.get("capture_context", {}),
                )
                import_path = persist_import_document(
                    capture_id=capture_id,
                    draft=sanitized_draft,
                    raw_photo_relative_path=record.get("raw_photo_path", ""),
                    timezone_name=settings.timezone_name,
                )
                record.update(
                    {
                        "status": "committed",
                        "updated_at": local_now(settings.timezone_name).isoformat(timespec="seconds"),
                        "draft": sanitized_draft,
                        "import_path": import_path.relative_to(ROOT).as_posix(),
                    }
                )
                save_capture_record(record, sidecar_path=(ROOT / str(record["raw_photo_path"])).with_suffix(".json"))

            refresh_result = {"status": "running", "published": False}
            try:
                run_refresh_pipeline(skip_publish=settings.skip_publish)
                refresh_result = {"status": "done", "published": not settings.skip_publish}
            except Exception as exc:  # noqa: BLE001
                refresh_result = {"status": "failed", "published": False, "error": truncate_text(str(exc), 220)}
            finally:
                record["refresh"] = refresh_result
                save_capture_record(record, sidecar_path=(ROOT / str(record["raw_photo_path"])).with_suffix(".json"))

            return CaptureResponse(status=HTTPStatus.OK, payload=record_to_payload(record))
        except FileNotFoundError:
            return self._error("Capture inconnue.", status=HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001
            return self._error(str(exc), status=HTTPStatus.BAD_REQUEST)


def main() -> int:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), IntakeRequestHandler)
    print(f"[meal-photo-intake] Serving on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[meal-photo-intake] Stopping.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
