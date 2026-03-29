from __future__ import annotations

from collections import defaultdict
from pathlib import Path

from _common import iter_journal_files, load_yaml, month_key, project_root, validate_day_log, write_csv


ROOT = project_root()
NORMALIZED_DIR = ROOT / "data" / "normalized"


MEALS_FIELDS = [
    "date",
    "month",
    "meal_id",
    "time",
    "logged_at",
    "meal_type",
    "capture_method",
    "confidence",
    "location",
    "context",
    "source_text",
    "items_count",
    "structured_items_count",
    "portion_text_items_count",
    "notes",
    "estimated_energy_kcal",
    "quality_score",
    "estimation_confidence",
    "recommendations",
    "assessment_notes",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]

MEAL_ITEMS_FIELDS = [
    "date",
    "month",
    "meal_id",
    "item_index",
    "time",
    "logged_at",
    "meal_type",
    "food_key",
    "label",
    "brand",
    "quantity",
    "unit",
    "portion_text",
    "quantity_source",
    "preparation",
    "item_notes",
    "energy_kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]

BODY_METRICS_FIELDS = [
    "date",
    "month",
    "metric_id",
    "time",
    "metric_type",
    "value",
    "unit",
    "source_device",
    "notes",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]

SUPPLEMENTS_FIELDS = [
    "date",
    "month",
    "supplement_id",
    "time",
    "name",
    "dose",
    "unit",
    "frequency",
    "notes",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]

SYMPTOMS_FIELDS = [
    "date",
    "month",
    "symptom_id",
    "time",
    "name",
    "severity",
    "notes",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]

HEALTH_EVENTS_FIELDS = [
    "date",
    "month",
    "event_id",
    "event_type",
    "label",
    "status",
    "start_date",
    "end_date",
    "practitioner",
    "notes",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]

LAB_RESULTS_FIELDS = [
    "date",
    "month",
    "lab_result_id",
    "test_code",
    "label",
    "collected_at",
    "value",
    "unit",
    "reference_low",
    "reference_high",
    "laboratory",
    "source_label",
    "notes",
    "source_type",
    "source_origin",
    "source_record_id",
    "imported_at",
    "duplicate_key",
    "is_duplicate"
]


def duplicate_key(row: dict, fields: list[str]) -> str:
    return "|".join(str(row.get(field, "")) for field in fields)


def mark_duplicates(rows: list[dict], fields: list[str]) -> list[dict]:
    seen: set[str] = set()
    for row in rows:
        key = duplicate_key(row, fields)
        row["duplicate_key"] = key
        row["is_duplicate"] = "true" if key in seen else "false"
        seen.add(key)
    return rows


def parse_quantity(value: object) -> float | None:
    if value in ("", None):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def sort_meal_items(items: list[dict]) -> list[dict]:
    indexed_items = list(enumerate(items))
    indexed_items.sort(
        key=lambda indexed_item: (
            parse_quantity(indexed_item[1].get("quantity")) is None,
            -(parse_quantity(indexed_item[1].get("quantity")) or 0.0),
            indexed_item[0],
        )
    )
    return [item for _, item in indexed_items]


def write_monthly_csvs(dataset: str, fieldnames: list[str], rows: list[dict]) -> None:
    dataset_dir = NORMALIZED_DIR / dataset
    dataset_dir.mkdir(parents=True, exist_ok=True)
    for existing_csv in dataset_dir.glob("*.csv"):
        existing_csv.unlink()

    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[row["month"]].append(row)

    if not buckets:
        target = dataset_dir / ".gitkeep"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.touch(exist_ok=True)
        return

    for month, month_rows in sorted(buckets.items()):
        target = dataset_dir / f"{month}.csv"
        write_csv(target, fieldnames, month_rows)


def main() -> int:
    journal_files = iter_journal_files()
    meals: list[dict] = []
    meal_items: list[dict] = []
    body_metrics: list[dict] = []
    supplements: list[dict] = []
    symptoms: list[dict] = []
    health_events: list[dict] = []
    lab_results: list[dict] = []

    for path in journal_files:
        document = load_yaml(path)
        if not isinstance(document, dict):
            raise SystemExit(f"Expected a mapping in {path}")

        errors = validate_day_log(document, path)
        if errors:
            raise SystemExit("\n".join(errors))

        date_value = document["date"]
        month = month_key(date_value)
        source = document.get("source", {})
        source_type = source.get("type", "")
        source_origin = source.get("origin", "")
        source_record_id = source.get("record_id", "")
        imported_at = source.get("imported_at", "")

        for meal_index, meal in enumerate(document.get("meals", []), start=1):
            meal_id = f"{date_value}-meal-{meal_index:02d}"
            assessment = meal.get("meal_assessment", {})
            sorted_items = sort_meal_items(meal.get("items", []))
            meals.append(
                {
                    "date": date_value,
                    "month": month,
                    "meal_id": meal_id,
                    "time": meal.get("time", ""),
                    "logged_at": meal.get("logged_at", ""),
                    "meal_type": meal.get("meal_type", ""),
                    "capture_method": meal.get("capture_method", ""),
                    "confidence": meal.get("confidence", ""),
                    "location": meal.get("location", ""),
                    "context": meal.get("context", ""),
                    "source_text": meal.get("source_text", ""),
                    "items_count": len(sorted_items),
                    "structured_items_count": sum(1 for item in sorted_items if item.get("quantity") not in ("", None)),
                    "portion_text_items_count": sum(1 for item in sorted_items if item.get("portion_text", "")),
                    "notes": meal.get("notes", ""),
                    "estimated_energy_kcal": assessment.get("estimated_energy_kcal", ""),
                    "quality_score": assessment.get("quality_score", ""),
                    "estimation_confidence": assessment.get("estimation_confidence", ""),
                    "recommendations": " | ".join(assessment.get("recommendations", [])),
                    "assessment_notes": assessment.get("notes", ""),
                    "source_type": source_type,
                    "source_origin": source_origin,
                    "source_record_id": source_record_id,
                    "imported_at": imported_at
                }
            )

            for item_index, item in enumerate(sorted_items, start=1):
                nutrition = item.get("estimated_nutrition", {})
                meal_items.append(
                    {
                        "date": date_value,
                        "month": month,
                        "meal_id": meal_id,
                        "item_index": item_index,
                        "time": meal.get("time", ""),
                        "logged_at": meal.get("logged_at", ""),
                        "meal_type": meal.get("meal_type", ""),
                        "food_key": item.get("food_key", ""),
                        "label": item.get("label", ""),
                        "brand": item.get("brand", ""),
                        "quantity": item.get("quantity", ""),
                        "unit": item.get("unit", ""),
                        "portion_text": item.get("portion_text", ""),
                        "quantity_source": item.get("quantity_source", ""),
                        "preparation": item.get("preparation", ""),
                        "item_notes": item.get("notes", ""),
                        "energy_kcal": nutrition.get("energy_kcal", ""),
                        "protein_g": nutrition.get("protein_g", ""),
                        "carbs_g": nutrition.get("carbs_g", ""),
                        "fat_g": nutrition.get("fat_g", ""),
                        "fiber_g": nutrition.get("fiber_g", ""),
                        "source_type": source_type,
                        "source_origin": source_origin,
                        "source_record_id": source_record_id,
                        "imported_at": imported_at
                    }
                )

        for metric_index, metric in enumerate(document.get("body_metrics", []), start=1):
            body_metrics.append(
                {
                    "date": date_value,
                    "month": month,
                    "metric_id": f"{date_value}-metric-{metric_index:02d}",
                    "time": metric.get("time", ""),
                    "metric_type": metric.get("type", ""),
                    "value": metric.get("value", ""),
                    "unit": metric.get("unit", ""),
                    "source_device": metric.get("source", ""),
                    "notes": metric.get("notes", ""),
                    "source_type": source_type,
                    "source_origin": source_origin,
                    "source_record_id": source_record_id,
                    "imported_at": imported_at
                }
            )

        for supplement_index, supplement in enumerate(document.get("supplements", []), start=1):
            supplements.append(
                {
                    "date": date_value,
                    "month": month,
                    "supplement_id": f"{date_value}-supplement-{supplement_index:02d}",
                    "time": supplement.get("time", ""),
                    "name": supplement.get("name", ""),
                    "dose": supplement.get("dose", ""),
                    "unit": supplement.get("unit", ""),
                    "frequency": supplement.get("frequency", ""),
                    "notes": supplement.get("notes", ""),
                    "source_type": source_type,
                    "source_origin": source_origin,
                    "source_record_id": source_record_id,
                    "imported_at": imported_at
                }
            )

        for symptom_index, symptom in enumerate(document.get("symptoms", []), start=1):
            symptoms.append(
                {
                    "date": date_value,
                    "month": month,
                    "symptom_id": f"{date_value}-symptom-{symptom_index:02d}",
                    "time": symptom.get("time", ""),
                    "name": symptom.get("name", ""),
                    "severity": symptom.get("severity", ""),
                    "notes": symptom.get("notes", ""),
                    "source_type": source_type,
                    "source_origin": source_origin,
                    "source_record_id": source_record_id,
                    "imported_at": imported_at
                }
            )

        for event_index, event in enumerate(document.get("health_events", []), start=1):
            health_events.append(
                {
                    "date": date_value,
                    "month": month,
                    "event_id": f"{date_value}-event-{event_index:02d}",
                    "event_type": event.get("type", ""),
                    "label": event.get("label", ""),
                    "status": event.get("status", ""),
                    "start_date": event.get("start_date", ""),
                    "end_date": event.get("end_date", ""),
                    "practitioner": event.get("practitioner", ""),
                    "notes": event.get("notes", ""),
                    "source_type": source_type,
                    "source_origin": source_origin,
                    "source_record_id": source_record_id,
                    "imported_at": imported_at
                }
            )

        for result_index, result in enumerate(document.get("lab_results", []), start=1):
            lab_results.append(
                {
                    "date": date_value,
                    "month": month,
                    "lab_result_id": f"{date_value}-lab-{result_index:02d}",
                    "test_code": result.get("test_code", ""),
                    "label": result.get("label", ""),
                    "collected_at": result.get("collected_at", ""),
                    "value": result.get("value", ""),
                    "unit": result.get("unit", ""),
                    "reference_low": result.get("reference_low", ""),
                    "reference_high": result.get("reference_high", ""),
                    "laboratory": result.get("laboratory", ""),
                    "source_label": result.get("source", ""),
                    "notes": result.get("notes", ""),
                    "source_type": source_type,
                    "source_origin": source_origin,
                    "source_record_id": source_record_id,
                    "imported_at": imported_at
                }
            )

    write_monthly_csvs("meals", MEALS_FIELDS, mark_duplicates(meals, ["date", "time", "meal_type", "source_record_id"]))
    write_monthly_csvs(
        "meal_items",
        MEAL_ITEMS_FIELDS,
        mark_duplicates(meal_items, ["date", "time", "food_key", "label", "quantity", "unit", "source_record_id"])
    )
    write_monthly_csvs(
        "body_metrics",
        BODY_METRICS_FIELDS,
        mark_duplicates(body_metrics, ["date", "time", "metric_type", "value", "unit", "source_record_id"])
    )
    write_monthly_csvs(
        "supplements",
        SUPPLEMENTS_FIELDS,
        mark_duplicates(supplements, ["date", "time", "name", "dose", "unit", "source_record_id"])
    )
    write_monthly_csvs(
        "symptoms",
        SYMPTOMS_FIELDS,
        mark_duplicates(symptoms, ["date", "time", "name", "severity", "source_record_id"])
    )
    write_monthly_csvs(
        "health_events",
        HEALTH_EVENTS_FIELDS,
        mark_duplicates(health_events, ["date", "event_type", "label", "status", "source_record_id"])
    )
    write_monthly_csvs(
        "lab_results",
        LAB_RESULTS_FIELDS,
        mark_duplicates(lab_results, ["collected_at", "test_code", "value", "unit", "source_record_id"])
    )

    print(f"Generated normalized datasets from {len(journal_files)} journal file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
