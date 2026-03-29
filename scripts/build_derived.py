from __future__ import annotations

import build_site_data
import json
from collections import defaultdict
from datetime import date

from _common import ensure_parent, iter_journal_files, load_yaml, month_key, project_root, read_csv, write_csv


ROOT = project_root()
NORMALIZED_DIR = ROOT / "data" / "normalized"
DERIVED_DIR = ROOT / "data" / "derived"
PROFILE_PATH = ROOT / "data" / "profile" / "current.yaml"
HEALTH_REFERENCE_PATH = ROOT / "data" / "profile" / "health-reference.md"


DAILY_SUMMARY_FIELDS = [
    "date",
    "month",
    "meals_count",
    "meal_items_count",
    "structured_meal_items_count",
    "nutrition_estimated_items_count",
    "nutrition_coverage_ratio",
    "water_ml",
    "symptoms_count",
    "total_energy_kcal",
    "total_protein_g",
    "total_carbs_g",
    "total_fat_g",
    "total_fiber_g"
]

FOOD_FREQUENCY_FIELDS = [
    "month",
    "food_key",
    "label",
    "unit",
    "occurrence_count",
    "distinct_days",
    "total_quantity",
    "portion_text_examples"
]

KEY_LAB_TESTS = [
    "fasting_glucose",
    "total_cholesterol",
    "ldl_c",
    "hdl_c",
    "triglycerides",
    "vitamin_d_25_oh",
    "ferritin",
    "tsh",
    "creatinine",
    "egfr_ckd_epi",
    "crp"
]

VALUE_LABELS = {
    "male": "homme",
    "female": "femme",
    "very_sedentary": "très sédentaire",
    "telework": "télétravail",
    "none": "aucune",
    "active": "en cours",
    "resolved": "résolue",
    "level_1": "niveau 1",
    "level 1": "niveau 1",
    "relatively_well_controlled": "relativement bien contrôlé",
    "allergy": "allergie",
    "intolerance": "intolérance",
    "high": "élevé",
    "low": "faible",
    "moderate_low": "modéré à faible",
    "none_or_rare": "aucun ou rare",
    "generally_ok": "plutôt correct",
    "appointment": "consultation",
    "diagnosis": "diagnostic",
    "note": "note",
    "user-report": "déclaration utilisateur",
    "imaging-report": "compte-rendu d'imagerie",
    "psychology-report": "compte-rendu psychologique",
}


def read_optional_csv(dataset: str) -> list[dict[str, str]]:
    dataset_dir = NORMALIZED_DIR / dataset
    if not dataset_dir.exists():
        return []

    rows: list[dict[str, str]] = []
    for csv_path in sorted(dataset_dir.glob("*.csv")):
        rows.extend(read_csv(csv_path))
    return rows


def to_float(value: str) -> float:
    if value in ("", None):
        return 0.0
    return float(value)


def pretty_value(value: str | None) -> str:
    raw = str(value or "unknown")
    return VALUE_LABELS.get(raw, raw.replace("_", " "))


def load_profile() -> dict:
    if not PROFILE_PATH.exists():
        return {}
    document = load_yaml(PROFILE_PATH)
    return document if isinstance(document, dict) else {}


def latest_lab_snapshot(journal_documents: list[dict]) -> tuple[str | None, list[dict]]:
    latest_date = None
    latest_results: list[dict] = []
    for document in journal_documents:
        for result in document.get("lab_results", []):
            collected_at = result.get("collected_at", "")
            if not collected_at:
                continue
            if latest_date is None or collected_at > latest_date:
                latest_date = collected_at
                latest_results = [result]
            elif collected_at == latest_date:
                latest_results.append(result)
    return latest_date, latest_results


def render_latest_labs(latest_date: str | None, latest_results: list[dict]) -> list[str]:
    if not latest_date or not latest_results:
        return [
            "## Dernier bilan biologique structuré",
            "",
            "Aucun résultat biologique structuré disponible.",
            ""
        ]

    by_code = {result.get("test_code", ""): result for result in latest_results}
    ordered_results = [by_code[test_code] for test_code in KEY_LAB_TESTS if test_code in by_code]
    other_results_count = max(0, len(latest_results) - len(ordered_results))

    lines = [
        "## Dernier bilan biologique structuré",
        "",
        f"Date du dernier panel: `{latest_date}`",
        ""
    ]
    for result in ordered_results:
        value = result.get("value", "")
        unit = result.get("unit", "")
        label = result.get("label", result.get("test_code", ""))
        ref_low = result.get("reference_low", "")
        ref_high = result.get("reference_high", "")
        range_parts = []
        if ref_low != "":
            range_parts.append(f"borne basse {ref_low}")
        if ref_high != "":
            range_parts.append(f"borne haute {ref_high}")
        range_suffix = f" (référence: {', '.join(range_parts)})" if range_parts else ""
        lines.append(f"- {label}: `{value} {unit}`{range_suffix}")
        notes = result.get("notes", "")
        if notes:
            lines.append(f"  note : {notes}")

    if other_results_count:
        lines.extend(
            [
                "",
                f"{other_results_count} autre(s) résultat(s) sont disponibles dans le journal structuré pour ce même panel."
            ]
        )

    lines.append("")
    return lines


def render_health_events(journal_documents: list[dict]) -> list[str]:
    entries: list[dict] = []
    for document in journal_documents:
        journal_date = document.get("date", "")
        for event in document.get("health_events", []):
            entries.append(
                {
                    "event_date": event.get("start_date", "") or journal_date,
                    "label": event.get("label", ""),
                    "status": event.get("status", ""),
                    "type": event.get("type", ""),
                    "practitioner": event.get("practitioner", ""),
                    "notes": event.get("notes", "")
                }
            )

    if not entries:
        return [
            "## Chronologie santé notable",
            "",
            "Aucun événement de santé structuré disponible.",
            ""
        ]

    lines = [
        "## Chronologie santé notable",
        ""
    ]
    for entry in sorted(entries, key=lambda item: (item["event_date"], item["label"]), reverse=True):
        suffix = []
        if entry["type"]:
            suffix.append(pretty_value(entry["type"]))
        if entry["status"]:
            suffix.append(pretty_value(entry["status"]))
        if entry["practitioner"]:
            suffix.append(entry["practitioner"])
        suffix_text = f" ({', '.join(suffix)})" if suffix else ""
        lines.append(f"- `{entry['event_date']}` {entry['label']}{suffix_text}")
        if entry["notes"]:
            lines.append(f"  note : {entry['notes']}")
    lines.append("")
    return lines


def render_source_documents(journal_documents: list[dict]) -> list[str]:
    origins: set[str] = set()
    for document in journal_documents:
        source_origin = document.get("source", {}).get("origin", "")
        if source_origin.startswith("data/raw/"):
            origins.add(source_origin)

    if not origins:
        return [
            "## Documents source",
            "",
            "Aucun document source brut référencé pour le moment.",
            ""
        ]

    lines = [
        "## Documents source",
        ""
    ]
    for origin in sorted(origins):
        lines.append(f"- `{origin}`")
    lines.append("")
    return lines


def build_health_reference(journal_documents: list[dict]) -> None:
    profile = load_profile()
    identity = profile.get("identity", {})
    anthropometrics = profile.get("anthropometrics", {})
    lifestyle = profile.get("lifestyle", {})
    conditions = profile.get("conditions", [])
    allergies = profile.get("allergies", [])
    medications = profile.get("medications", [])
    dietary_pattern = profile.get("dietary_pattern", {})
    digestive_pattern = profile.get("digestive_pattern", {})
    hydration = profile.get("hydration", {})
    sleep_pattern = profile.get("sleep_pattern", {})
    goals = profile.get("goals", [])

    lines = [
        "# Référence santé",
        "",
        "Généré à partir des données structurées. Mettre à jour les fichiers source puis relancer `python scripts/build_derived.py`.",
        "",
        f"Dernière génération: `{date.today().isoformat()}`",
        "",
        "## Identité et situation actuelle",
        "",
        f"- Date de naissance: `{identity.get('birth_date', 'unknown')}`",
        f"- Sexe: `{pretty_value(identity.get('sex', 'unknown'))}`",
        f"- Taille: `{anthropometrics.get('height_cm', 'unknown')} cm`",
        f"- Poids actuel: `{anthropometrics.get('weight_kg', 'unknown')} kg`",
        f"- Date de référence anthropométrique: `{anthropometrics.get('effective_date', 'unknown')}`",
        f"- Niveau d'activité: `{pretty_value(lifestyle.get('activity_level', 'unknown'))}`",
        f"- Contexte de travail: `{pretty_value(lifestyle.get('work_context', 'unknown'))}`",
        f"- Activité sportive: `{pretty_value(lifestyle.get('sport_activity', 'unknown'))}`",
        "",
        "## Conditions actives et diagnostics",
        ""
    ]

    if conditions:
        for condition in conditions:
            parts = [pretty_value(condition.get("status", ""))]
            if condition.get("severity"):
                parts.append(pretty_value(condition["severity"]))
            if condition.get("control"):
                parts.append(pretty_value(condition["control"]))
            if condition.get("diagnosed_on"):
                parts.append(f"diagnostiqué le {condition['diagnosed_on']}")
            if condition.get("source"):
                parts.append(f"source {pretty_value(condition['source'])}")
            details = ", ".join(part for part in parts if part)
            lines.append(f"- {condition.get('label', condition.get('key', 'unknown'))}: {details}")
            if condition.get("notes"):
                lines.append(f"  note : {condition['notes']}")
    else:
        lines.append("Aucune condition active enregistrée.")
    lines.extend(
        [
            "",
            "## Allergies et intolérances",
            ""
        ]
    )
    if allergies:
        for allergy in allergies:
            lines.append(f"- {allergy.get('label', 'unknown')}: `{pretty_value(allergy.get('type', 'unknown'))}`")
            if allergy.get("notes"):
                lines.append(f"  note : {allergy['notes']}")
    else:
        lines.append("Aucune allergie ou intolérance enregistrée.")

    lines.extend(
        [
            "",
            "## Médicaments et traitements réguliers",
            ""
        ]
    )
    if medications:
        for medication in medications:
            parts = [pretty_value(medication.get("status", ""))]
            if medication.get("dose"):
                parts.append(medication["dose"])
            if medication.get("frequency"):
                parts.append(medication["frequency"])
            lines.append(f"- {medication.get('label', 'unknown')}: {', '.join(part for part in parts if part)}")
            if medication.get("notes"):
                lines.append(f"  note : {medication['notes']}")
    else:
        lines.append("Aucun médicament enregistré.")

    weight_history = anthropometrics.get("weight_history", [])
    lines.extend(
        [
            "",
            "## Historique du poids",
            ""
        ]
    )
    if weight_history:
        for entry in sorted(weight_history, key=lambda item: item.get("date", "")):
            lines.append(f"- `{entry.get('date', 'unknown')}`: `{entry.get('weight_kg', 'unknown')} kg`")
            if entry.get("notes"):
                lines.append(f"  note : {entry['notes']}")
    else:
        lines.append("Aucun historique de poids enregistré.")

    lines.extend(
        [
            "",
            "## Profil alimentaire",
            "",
            f"- Apport en féculents: `{pretty_value(dietary_pattern.get('starch_intake', 'unknown'))}`",
            f"- Apport en légumes: `{pretty_value(dietary_pattern.get('vegetable_intake', 'unknown'))}`",
            f"- Apport en protéines: `{pretty_value(dietary_pattern.get('protein_intake', 'unknown'))}`"
        ]
    )
    if dietary_pattern.get("typical_breakfast"):
        lines.append(f"- Petit-déjeuner type: {dietary_pattern['typical_breakfast']}")
    if dietary_pattern.get("typical_lunch"):
        lines.append(f"- Déjeuner type: {dietary_pattern['typical_lunch']}")
    if dietary_pattern.get("typical_dinner"):
        lines.append(f"- Dîner type: {dietary_pattern['typical_dinner']}")
    if dietary_pattern.get("common_foods"):
        lines.append(f"- Aliments fréquents: {', '.join(dietary_pattern['common_foods'])}")
    if dietary_pattern.get("evening_strategy"):
        lines.append(f"- Stratégie du soir: {dietary_pattern['evening_strategy']}")
    if dietary_pattern.get("notes"):
        lines.append(f"- Notes: {dietary_pattern['notes']}")
    lines.append("")

    lines.extend(
        [
            "## Digestion",
            ""
        ]
    )
    if digestive_pattern.get("summary"):
        lines.append(f"- Résumé: {digestive_pattern['summary']}")
    if digestive_pattern.get("common_triggers"):
        lines.append(f"- Déclencheurs fréquents: {', '.join(digestive_pattern['common_triggers'])}")
    if digestive_pattern.get("management_strategy"):
        lines.append(f"- Stratégie de gestion: {digestive_pattern['management_strategy']}")
    if not any(digestive_pattern.get(key) for key in ["summary", "common_triggers", "management_strategy"]):
        lines.append("Aucun profil digestif enregistré.")
    lines.append("")

    lines.extend(
        [
            "## Hydratation et sommeil",
            "",
            f"- Niveau d'hydratation en eau: `{pretty_value(hydration.get('water_intake_level', 'unknown'))}`",
            f"- Niveau de sodas: `{pretty_value(hydration.get('soda_intake_level', 'unknown'))}`",
            f"- Niveau d'alcool: `{pretty_value(hydration.get('alcohol_intake_level', 'unknown'))}`",
            f"- Heure habituelle de coucher: `{sleep_pattern.get('typical_bedtime', 'unknown')}`",
            f"- Heure habituelle de lever: `{sleep_pattern.get('typical_wake_time', 'unknown')}`",
            f"- Qualité du sommeil: `{pretty_value(sleep_pattern.get('quality', 'unknown'))}`"
        ]
    )
    if hydration.get("notes"):
        lines.append(f"- Notes hydratation: {hydration['notes']}")
    if sleep_pattern.get("notes"):
        lines.append(f"- Notes sommeil: {sleep_pattern['notes']}")
    lines.append("")

    lines.extend(
        [
            "## Objectifs",
            ""
        ]
    )
    if goals:
        for goal in goals:
            lines.append(f"- `{goal}`")
    else:
        lines.append("Aucun objectif explicite enregistré.")
    lines.append("")

    latest_date, latest_results = latest_lab_snapshot(journal_documents)
    lines.extend(render_latest_labs(latest_date, latest_results))
    lines.extend(render_health_events(journal_documents))
    lines.extend(render_source_documents(journal_documents))

    if profile.get("notes"):
        lines.extend(
            [
                "## Notes profil",
                "",
                profile["notes"],
                ""
            ]
        )

    ensure_parent(HEALTH_REFERENCE_PATH)
    with HEALTH_REFERENCE_PATH.open("w", encoding="utf-8") as handle:
        handle.write("\n".join(lines).rstrip() + "\n")


def main() -> int:
    for dataset_dir in [DERIVED_DIR / "daily_summary", DERIVED_DIR / "monthly_summary", DERIVED_DIR / "food_frequency"]:
        dataset_dir.mkdir(parents=True, exist_ok=True)
        for artifact in dataset_dir.glob("*"):
            if artifact.is_file():
                artifact.unlink()

    day_context: dict[str, dict] = {}
    journal_documents: list[dict] = []
    for path in iter_journal_files():
        document = load_yaml(path)
        if not isinstance(document, dict):
            continue
        journal_documents.append(document)
        date_value = document["date"]
        day_context[date_value] = {
            "date": date_value,
            "month": month_key(date_value),
            "meals_count": len(document.get("meals", [])),
            "water_ml": document.get("hydration", {}).get("total_ml", 0),
            "symptoms_count": len(document.get("symptoms", []))
        }

    meal_item_rows = [row for row in read_optional_csv("meal_items") if row.get("is_duplicate") != "true"]
    body_metric_rows = [row for row in read_optional_csv("body_metrics") if row.get("is_duplicate") != "true"]

    nutrition_by_day: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    meal_item_stats_by_day: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    food_frequency: dict[tuple[str, str, str, str], dict] = {}
    for row in meal_item_rows:
        date_value = row["date"]
        month = row["month"]
        food_key = row.get("food_key", "")
        label = row.get("label", "")
        unit = row.get("unit", "")
        portion_text = row.get("portion_text", "")
        quantity = row.get("quantity", "")
        quantity_source = row.get("quantity_source", "")

        meal_item_stats_by_day[date_value]["meal_items_count"] += 1
        if quantity not in ("", None):
            meal_item_stats_by_day[date_value]["structured_meal_items_count"] += 1
        if any(row.get(field, "") not in ("", None) for field in ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"]):
            meal_item_stats_by_day[date_value]["nutrition_estimated_items_count"] += 1

        nutrition_by_day[date_value]["total_energy_kcal"] += to_float(row.get("energy_kcal", ""))
        nutrition_by_day[date_value]["total_protein_g"] += to_float(row.get("protein_g", ""))
        nutrition_by_day[date_value]["total_carbs_g"] += to_float(row.get("carbs_g", ""))
        nutrition_by_day[date_value]["total_fat_g"] += to_float(row.get("fat_g", ""))
        nutrition_by_day[date_value]["total_fiber_g"] += to_float(row.get("fiber_g", ""))

        frequency_key = (month, food_key, label, unit)
        if frequency_key not in food_frequency:
            food_frequency[frequency_key] = {
                "month": month,
                "food_key": food_key,
                "label": label,
                "unit": unit,
                "occurrence_count": 0,
                "distinct_days": set(),
                "total_quantity": 0.0,
                "portion_text_examples": set()
            }
        bucket = food_frequency[frequency_key]
        bucket["occurrence_count"] += 1
        bucket["distinct_days"].add(date_value)
        if quantity not in ("", None) and quantity_source != "unknown":
            bucket["total_quantity"] += float(quantity)
        if portion_text:
            bucket["portion_text_examples"].add(portion_text)

    daily_rows: list[dict] = []
    for date_value, context in sorted(day_context.items()):
        nutrition = nutrition_by_day.get(date_value, {})
        item_stats = meal_item_stats_by_day.get(date_value, {})
        item_count = item_stats.get("meal_items_count", 0.0)
        coverage_ratio = item_stats.get("nutrition_estimated_items_count", 0.0) / item_count if item_count else 0.0
        daily_rows.append(
            {
                "date": date_value,
                "month": context["month"],
                "meals_count": context["meals_count"],
                "meal_items_count": int(item_stats.get("meal_items_count", 0.0)),
                "structured_meal_items_count": int(item_stats.get("structured_meal_items_count", 0.0)),
                "nutrition_estimated_items_count": int(item_stats.get("nutrition_estimated_items_count", 0.0)),
                "nutrition_coverage_ratio": round(coverage_ratio, 3),
                "water_ml": context["water_ml"],
                "symptoms_count": context["symptoms_count"],
                "total_energy_kcal": round(nutrition.get("total_energy_kcal", 0.0), 2),
                "total_protein_g": round(nutrition.get("total_protein_g", 0.0), 2),
                "total_carbs_g": round(nutrition.get("total_carbs_g", 0.0), 2),
                "total_fat_g": round(nutrition.get("total_fat_g", 0.0), 2),
                "total_fiber_g": round(nutrition.get("total_fiber_g", 0.0), 2)
            }
        )

    daily_by_month: dict[str, list[dict]] = defaultdict(list)
    for row in daily_rows:
        daily_by_month[row["month"]].append(row)

    for month, rows in sorted(daily_by_month.items()):
        target = DERIVED_DIR / "daily_summary" / f"{month}.csv"
        write_csv(target, DAILY_SUMMARY_FIELDS, rows)

    food_rows_by_month: dict[str, list[dict]] = defaultdict(list)
    for bucket in food_frequency.values():
        food_rows_by_month[bucket["month"]].append(
            {
                "month": bucket["month"],
                "food_key": bucket["food_key"],
                "label": bucket["label"],
                "unit": bucket["unit"],
                "occurrence_count": bucket["occurrence_count"],
                "distinct_days": len(bucket["distinct_days"]),
                "total_quantity": round(bucket["total_quantity"], 2) if bucket["total_quantity"] else "",
                "portion_text_examples": " | ".join(sorted(bucket["portion_text_examples"]))[:250]
            }
        )

    for month, rows in sorted(food_rows_by_month.items()):
        sorted_rows = sorted(rows, key=lambda row: (-int(row["occurrence_count"]), row["label"], row["unit"]))
        target = DERIVED_DIR / "food_frequency" / f"{month}.csv"
        write_csv(target, FOOD_FREQUENCY_FIELDS, sorted_rows)

    weight_rows_by_month: dict[str, list[float]] = defaultdict(list)
    resting_hr_rows_by_month: dict[str, list[float]] = defaultdict(list)
    for row in body_metric_rows:
        if row.get("metric_type") == "weight" and row.get("value") not in ("", None):
            weight_rows_by_month[row["month"]].append(float(row["value"]))
        if row.get("metric_type") == "heart_rate" and row.get("value") not in ("", None):
            resting_hr_rows_by_month[row["month"]].append(float(row["value"]))

    for month, rows in sorted(daily_by_month.items()):
        calories = [float(row["total_energy_kcal"]) for row in rows]
        water = [float(row["water_ml"]) for row in rows]
        coverage = [float(row["nutrition_coverage_ratio"]) for row in rows]
        month_summary = {
            "month": month,
            "days_logged": len(rows),
            "meals_logged": sum(int(row["meals_count"]) for row in rows),
            "meal_items_logged": sum(int(row["meal_items_count"]) for row in rows),
            "structured_meal_items_logged": sum(int(row["structured_meal_items_count"]) for row in rows),
            "nutrition_estimated_items_logged": sum(int(row["nutrition_estimated_items_count"]) for row in rows),
            "nutrition_coverage_ratio_avg": round(sum(coverage) / len(coverage), 3) if coverage else 0,
            "energy_kcal_total": round(sum(calories), 2),
            "energy_kcal_avg": round(sum(calories) / len(calories), 2) if calories else 0,
            "water_ml_avg": round(sum(water) / len(water), 2) if water else 0,
            "weight_kg_avg": round(sum(weight_rows_by_month.get(month, [])) / len(weight_rows_by_month.get(month, [])), 2)
            if weight_rows_by_month.get(month)
            else None,
            "resting_heart_rate_avg": round(
                sum(resting_hr_rows_by_month.get(month, [])) / len(resting_hr_rows_by_month.get(month, [])),
                2
            )
            if resting_hr_rows_by_month.get(month)
            else None
        }

        target = DERIVED_DIR / "monthly_summary" / f"{month}.json"
        ensure_parent(target)
        with target.open("w", encoding="utf-8") as handle:
            json.dump(month_summary, handle, indent=2)
            handle.write("\n")

    build_health_reference(journal_documents)
    build_site_data.build_dashboard_site_data()

    print(f"Generated derived summaries for {len(daily_by_month)} month(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
