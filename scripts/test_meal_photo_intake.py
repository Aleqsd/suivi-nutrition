from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import meal_photo_intake_common as common
import meal_photo_intake_service as service


class MealPhotoIntakeTests(unittest.TestCase):
    def test_ticket_round_trip(self) -> None:
        issued = common.issue_intake_ticket(
            secret="secret",
            capture_base_url="https://capture.example.com",
            email="authorized@example.com",
            provider="google",
            origin="https://atlas.example.com",
            max_bytes=4096,
            ttl_seconds=60,
        )
        payload = common.verify_intake_ticket(
            issued["ticket"],
            secret="secret",
            capture_base_url="https://capture.example.com",
        )
        self.assertEqual(payload["email"], "authorized@example.com")
        self.assertEqual(payload["provider"], "google")
        self.assertEqual(payload["max_bytes"], 4096)

    def test_extract_capture_context_prefers_shared_at_when_exif_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            image_path = Path(tmp_dir) / "image.jpg"
            image_path.write_bytes(b"not-a-real-image")
            context = common.extract_photo_capture_context(
                image_path,
                shared_at="2026-03-30T10:32:00+02:00",
                timezone_name="Europe/Paris",
            )
        self.assertEqual(context["date"], "2026-03-30")
        self.assertEqual(context["time"], "10:32")
        self.assertEqual(context["time_source"], "shared_at")

    def test_normalize_analysis_to_draft_marks_auto_commit_only_for_strict_case(self) -> None:
        food_reference = [
            {"key": "rice_cooked", "label": "Riz cuit"},
            {"key": "fish_generic_cooked", "label": "Poisson"},
        ]
        analysis = {
            "meal_confidence": "high",
            "image_confidence": "high",
            "portion_confidence": "medium",
            "nutrition_confidence": "medium",
            "estimation_confidence": "high",
            "estimated_energy_kcal": 620,
            "quality_score": 72,
            "recommendations": ["Ajouter un légume."],
            "notes": "Assiette visuellement nette.",
            "items": [
                {
                    "label": "Riz cuit",
                    "confidence": "high",
                    "quantity": 180,
                    "unit": "g",
                    "portion_text": None,
                    "preparation": None,
                    "notes": None,
                    "estimated_energy_kcal": 230,
                },
                {
                    "label": "Poisson",
                    "confidence": "high",
                    "quantity": 120,
                    "unit": "g",
                    "portion_text": None,
                    "preparation": None,
                    "notes": None,
                    "estimated_energy_kcal": 190,
                },
            ],
        }
        draft = common.normalize_analysis_to_draft(
            analysis,
            capture_context={
                "date": "2026-03-30",
                "time": "12:14",
                "captured_at": "2026-03-30T12:14:00+02:00",
                "time_source": "exif_datetime_original",
                "notes": "",
            },
            food_reference=food_reference,
        )
        self.assertTrue(draft["auto_commit_eligible"])
        self.assertEqual(draft["meal_type"], "lunch")
        self.assertEqual(draft["items"][0]["food_key"], "rice_cooked")
        self.assertEqual(draft["meal_assessment"]["image_confidence"], "high")
        self.assertEqual(draft["meal_assessment"]["portion_confidence"], "medium")
        self.assertEqual(draft["meal_assessment"]["nutrition_confidence"], "medium")
        self.assertEqual(draft["meal_assessment"]["estimation_confidence"], "medium")

    def test_normalize_analysis_to_draft_keeps_unknown_food_without_food_key(self) -> None:
        draft = common.normalize_analysis_to_draft(
            {
                "meal_confidence": "medium",
                "image_confidence": "medium",
                "portion_confidence": "low",
                "nutrition_confidence": "low",
                "estimation_confidence": "low",
                "estimated_energy_kcal": 300,
                "quality_score": 55,
                "recommendations": ["Ajouter une protéine."],
                "notes": "Photo partielle.",
                "items": [
                    {
                        "label": "Plat rouge non identifié",
                        "confidence": "low",
                        "quantity": None,
                        "unit": None,
                        "portion_text": "1 portion",
                        "preparation": None,
                        "notes": None,
                        "estimated_energy_kcal": None,
                    }
                ],
            },
            capture_context={
                "date": "2026-03-30",
                "time": "20:10",
                "captured_at": "2026-03-30T20:10:00+02:00",
                "time_source": "shared_at",
                "notes": "",
            },
            food_reference=[],
        )
        self.assertFalse(draft["auto_commit_eligible"])
        self.assertNotIn("food_key", draft["items"][0])
        self.assertEqual(draft["items"][0]["quantity_source"], "unknown")
        self.assertEqual(draft["meal_assessment"]["nutrition_confidence"], "low")

    def test_normalize_image_content_type_falls_back_to_filename(self) -> None:
        content_type = common.normalize_image_content_type(
            "meal.jpg",
            "application/octet-stream",
            b"not-an-image-but-filename-is-enough",
        )
        self.assertEqual(content_type, "image/jpeg")

    def test_meal_analysis_schema_item_required_matches_properties(self) -> None:
        item_schema = common.MEAL_ANALYSIS_SCHEMA["properties"]["items"]["items"]
        self.assertEqual(
            set(item_schema["required"]),
            set(item_schema["properties"].keys()),
        )

    def test_sanitize_draft_uses_capture_context_when_review_payload_is_empty(self) -> None:
        sanitized = service.sanitize_draft(
            {},
            fallback_draft={
                "meal_type": "lunch",
                "confidence": "medium",
                "time_source": "shared_at",
                "items": [
                    {
                        "label": "Saumon",
                        "quantity_source": "unknown",
                    }
                ],
                "meal_assessment": {
                    "image_confidence": "medium",
                    "portion_confidence": "low",
                    "nutrition_confidence": "low",
                    "estimation_confidence": "low",
                },
            },
            capture_context={
                "date": "2026-03-30",
                "time": "10:39",
                "time_source": "shared_at",
            },
        )
        self.assertEqual(sanitized["date"], "2026-03-30")
        self.assertEqual(sanitized["time"], "10:39")
        self.assertEqual(sanitized["items"][0]["label"], "Saumon")
        self.assertEqual(sanitized["meal_assessment"]["image_confidence"], "medium")
        self.assertEqual(sanitized["meal_assessment"]["portion_confidence"], "low")
        self.assertEqual(sanitized["meal_assessment"]["nutrition_confidence"], "low")

    def test_refresh_needs_retry_only_for_failed_or_missing_publish(self) -> None:
        self.assertTrue(
            service.refresh_needs_retry(
                {"status": "committed", "refresh": {"status": "failed", "published": False}},
                skip_publish=False,
            )
        )
        self.assertTrue(
            service.refresh_needs_retry(
                {"status": "committed", "refresh": {}},
                skip_publish=False,
            )
        )
        self.assertFalse(
            service.refresh_needs_retry(
                {"status": "committed", "refresh": {"status": "done", "published": True}},
                skip_publish=False,
            )
        )
        self.assertFalse(
            service.refresh_needs_retry(
                {"status": "committed", "refresh": {"status": "done", "published": False}},
                skip_publish=True,
            )
        )

    def test_refresh_committed_record_persists_failure_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            sidecar_path = Path(tmp_dir) / "capture.json"
            record = {"status": "committed", "capture_id": "capture-a"}
            with mock.patch.object(service, "run_refresh_pipeline", side_effect=RuntimeError("publish down")), mock.patch.object(
                service,
                "save_capture_record",
            ) as save_record:
                updated = service.refresh_committed_record(
                    record,
                    sidecar_path=sidecar_path,
                    timezone_name="Europe/Paris",
                    skip_publish=False,
                )

        self.assertEqual(updated["refresh"]["status"], "failed")
        self.assertFalse(updated["refresh"]["published"])
        self.assertIn("publish down", updated["refresh"]["error"])
        self.assertEqual(save_record.call_count, 2)

    def test_store_photo_capture_deduplicates_by_hash(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            capture_context = {
                "date": "2026-03-30",
                "time": "12:00",
                "captured_at": "2026-03-30T12:00:00+02:00",
                "time_source": "shared_at",
                "notes": "",
            }
            with mock.patch.object(common, "ROOT", temp_root), mock.patch.object(
                common,
                "RAW_MEAL_PHOTOS_DIR",
                temp_root / "data" / "raw" / "meal-photos",
            ), mock.patch.object(common, "HASH_INDEX_PATH", temp_root / "data" / "raw" / "meal-photos" / "hash-index.json"), mock.patch.object(
                common,
                "INTAKE_LOCK_PATH",
                temp_root / "tmp" / "meal-photo-intake.lock",
            ):
                first = common.store_photo_capture(
                    capture_id="capture-a",
                    original_filename="meal.jpg",
                    content_type="image/jpeg",
                    image_bytes=b"same-image",
                    capture_context=capture_context,
                    uploader_email="authorized@example.com",
                )
                second = common.store_photo_capture(
                    capture_id="capture-b",
                    original_filename="meal.jpg",
                    content_type="image/jpeg",
                    image_bytes=b"same-image",
                    capture_context=capture_context,
                    uploader_email="authorized@example.com",
                )

        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(second["capture_id"], "capture-a")

    def test_store_photo_capture_allows_retry_after_failed_duplicate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            capture_context = {
                "date": "2026-03-30",
                "time": "12:00",
                "captured_at": "2026-03-30T12:00:00+02:00",
                "time_source": "shared_at",
                "notes": "",
            }
            with mock.patch.object(common, "ROOT", temp_root), mock.patch.object(
                common,
                "RAW_MEAL_PHOTOS_DIR",
                temp_root / "data" / "raw" / "meal-photos",
            ), mock.patch.object(common, "HASH_INDEX_PATH", temp_root / "data" / "raw" / "meal-photos" / "hash-index.json"), mock.patch.object(
                common,
                "INTAKE_LOCK_PATH",
                temp_root / "tmp" / "meal-photo-intake.lock",
            ):
                first = common.store_photo_capture(
                    capture_id="capture-a",
                    original_filename="meal.jpg",
                    content_type="image/jpeg",
                    image_bytes=b"same-image",
                    capture_context=capture_context,
                    uploader_email="authorized@example.com",
                )
                sidecar_path = Path(first["sidecar_path"])
                record = json.loads(sidecar_path.read_text(encoding="utf-8"))
                record["status"] = "failed"
                sidecar_path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

                second = common.store_photo_capture(
                    capture_id="capture-b",
                    original_filename="meal.jpg",
                    content_type="image/jpeg",
                    image_bytes=b"same-image",
                    capture_context=capture_context,
                    uploader_email="authorized@example.com",
                )

        self.assertFalse(second["duplicate"])
        self.assertEqual(second["capture_id"], "capture-b")

    def test_list_capture_records_for_uploader_returns_recent_first(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_root = Path(tmp_dir)
            raw_dir = temp_root / "data" / "raw" / "meal-photos" / "2026" / "03"
            raw_dir.mkdir(parents=True, exist_ok=True)
            (raw_dir / "capture-a.json").write_text(json.dumps({
                "capture_id": "capture-a",
                "uploader_email": "authorized@example.com",
                "updated_at": "2026-03-30T09:00:00+00:00",
                "status": "needs_review",
            }), encoding="utf-8")
            (raw_dir / "capture-b.json").write_text(json.dumps({
                "capture_id": "capture-b",
                "uploader_email": "authorized@example.com",
                "updated_at": "2026-03-30T10:00:00+00:00",
                "status": "committed",
            }), encoding="utf-8")
            (raw_dir / "capture-c.json").write_text(json.dumps({
                "capture_id": "capture-c",
                "uploader_email": "other@example.com",
                "updated_at": "2026-03-30T11:00:00+00:00",
                "status": "failed",
            }), encoding="utf-8")
            with mock.patch.object(common, "RAW_MEAL_PHOTOS_DIR", temp_root / "data" / "raw" / "meal-photos"), mock.patch.object(
                common,
                "HASH_INDEX_PATH",
                temp_root / "data" / "raw" / "meal-photos" / "hash-index.json",
            ):
                records = common.list_capture_records_for_uploader("authorized@example.com", limit=8)

        self.assertEqual([record["capture_id"] for record in records], ["capture-b", "capture-a"])


if __name__ == "__main__":
    unittest.main()
