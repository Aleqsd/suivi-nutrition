from __future__ import annotations

import json
import re
from datetime import date, datetime

from _common import ROOT, iter_journal_files, load_yaml, read_csv


PROFILE_PATH = ROOT / "data" / "profile" / "current.yaml"
HEALTH_REFERENCE_PATH = ROOT / "data" / "profile" / "health-reference.md"
FOOD_REFERENCE_PATH = ROOT / "data" / "reference" / "foods.yaml"
DERIVED_DIR = ROOT / "data" / "derived"
NORMALIZED_DIR = ROOT / "data" / "normalized"
SITE_DATA_PATH = ROOT / "site" / "data" / "dashboard.json"

KEY_LABS = [
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
    "crp",
]

LAB_HISTORY_KEYS = [
    "fasting_glucose",
    "total_cholesterol",
    "ldl_c",
    "hdl_c",
    "triglycerides",
    "vitamin_d_25_oh",
    "ferritin",
    "tsh",
    "crp",
]

MEAL_TYPE_ICONS = {
    "breakfast": "☀️",
    "lunch": "🍽️",
    "dinner": "🌙",
    "snack": "🍎",
}

MEAL_TYPE_LABELS = {
    "breakfast": "Petit dejeuner",
    "lunch": "Dejeuner",
    "dinner": "Diner",
    "snack": "Collation",
}

FOOD_CATEGORY_ICONS = {
    "starch": "🍞",
    "protein": "🍗",
    "dairy": "🧀",
    "fruit": "🍎",
    "vegetable": "🥦",
    "drink": "🥤",
    "fat": "🫒",
    "mixed_dish": "🍽️",
}

DOCUMENT_CATEGORY_LABELS = {
    "lab_results": "Bilans biologiques",
    "medical_reports": "Comptes rendus medicaux",
    "medical_imaging": "Imagerie medicale",
    "functional_tests": "Tests fonctionnels",
}


def parse_markdown_sections(markdown: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current_key = "intro"
    sections[current_key] = []
    for line in markdown.splitlines():
        if line.startswith("## "):
            current_key = line[3:].strip()
            sections[current_key] = []
            continue
        sections.setdefault(current_key, []).append(line)
    return sections


def load_profile() -> dict:
    if not PROFILE_PATH.exists():
        return {}
    document = load_yaml(PROFILE_PATH)
    return document if isinstance(document, dict) else {}


def load_health_reference() -> dict[str, list[str]]:
    if not HEALTH_REFERENCE_PATH.exists():
        return {}
    return parse_markdown_sections(HEALTH_REFERENCE_PATH.read_text(encoding="utf-8"))


def load_food_reference() -> dict[str, dict]:
    if not FOOD_REFERENCE_PATH.exists():
        return {}
    document = load_yaml(FOOD_REFERENCE_PATH)
    if not isinstance(document, list):
        return {}
    foods: dict[str, dict] = {}
    for item in document:
        if not isinstance(item, dict):
            continue
        key = item.get("key")
        if key:
            foods[key] = item
    return foods


def load_monthly_summaries() -> list[dict]:
    rows: list[dict] = []
    monthly_dir = DERIVED_DIR / "monthly_summary"
    if not monthly_dir.exists():
        return rows
    for path in sorted(monthly_dir.glob("*.json")):
        with path.open("r", encoding="utf-8") as handle:
            rows.append(json.load(handle))
    return rows


def load_daily_summaries() -> list[dict]:
    rows: list[dict] = []
    daily_dir = DERIVED_DIR / "daily_summary"
    if not daily_dir.exists():
        return rows
    for path in sorted(daily_dir.glob("*.csv")):
        rows.extend(read_csv(path))
    return rows


def load_food_frequency() -> list[dict]:
    rows: list[dict] = []
    freq_dir = DERIVED_DIR / "food_frequency"
    if not freq_dir.exists():
        return rows
    for path in sorted(freq_dir.glob("*.csv")):
        rows.extend(read_csv(path))
    return rows


def load_all_meals() -> list[dict]:
    meal_dir = NORMALIZED_DIR / "meals"
    if not meal_dir.exists():
        return []
    rows: list[dict] = []
    for path in sorted(meal_dir.glob("*.csv")):
        rows.extend(read_csv(path))
    return [row for row in rows if row.get("is_duplicate") != "true"]


def load_all_meal_items() -> list[dict]:
    meal_dir = NORMALIZED_DIR / "meal_items"
    if not meal_dir.exists():
        return []
    rows: list[dict] = []
    for path in sorted(meal_dir.glob("*.csv")):
        rows.extend(read_csv(path))
    return [row for row in rows if row.get("is_duplicate") != "true"]


def load_latest_lab_panel() -> tuple[str | None, list[dict]]:
    lab_dir = NORMALIZED_DIR / "lab_results"
    if not lab_dir.exists():
        return None, []

    rows: list[dict] = []
    for path in sorted(lab_dir.glob("*.csv")):
        rows.extend(read_csv(path))
    if not rows:
        return None, []

    latest_date = max(row["collected_at"] for row in rows if row.get("collected_at"))
    panel = [row for row in rows if row.get("collected_at") == latest_date and row.get("is_duplicate") != "true"]
    return latest_date, panel


def load_all_lab_rows() -> list[dict]:
    lab_dir = NORMALIZED_DIR / "lab_results"
    if not lab_dir.exists():
        return []
    rows: list[dict] = []
    for path in sorted(lab_dir.glob("*.csv")):
        rows.extend(read_csv(path))
    return [row for row in rows if row.get("is_duplicate") != "true"]


def parse_numeric(value: str | int | float | None) -> float | None:
    if value in ("", None):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value))
    if not match:
        return None
    return float(match.group(0).replace(",", "."))


def lab_status(row: dict) -> str:
    value = parse_numeric(row.get("value"))
    low = parse_numeric(row.get("reference_low"))
    high = parse_numeric(row.get("reference_high"))
    if value is None:
        return "info"
    if low is not None and value < low:
        return "low"
    if high is not None and value > high:
        return "high"
    return "normal"


def lab_note(row: dict) -> str:
    status = lab_status(row)
    if row.get("notes"):
        return row["notes"]
    if status == "high":
        return "Au-dessus de l intervalle de reference du document source."
    if status == "low":
        return "En dessous de l intervalle de reference du document source."
    return ""


def build_lab_cards(panel: list[dict]) -> list[dict]:
    by_code = {row.get("test_code", ""): row for row in panel}
    cards: list[dict] = []
    for code in KEY_LABS:
        row = by_code.get(code)
        if not row:
            continue
        cards.append(
            {
                "code": code,
                "label": row.get("label", code),
                "value": row.get("value", ""),
                "unit": row.get("unit", ""),
                "status": lab_status(row),
                "note": lab_note(row),
                "referenceLow": row.get("reference_low", ""),
                "referenceHigh": row.get("reference_high", ""),
            }
        )
    return cards


def translate_document_category(value: str) -> str:
    return DOCUMENT_CATEGORY_LABELS.get(value, value.replace("_", " "))


def build_timeline() -> list[dict]:
    entries: list[dict] = []
    for path in iter_journal_files():
        document = load_yaml(path)
        if not isinstance(document, dict):
            continue
        journal_date = document.get("date", "")
        for event in document.get("health_events", []):
            entries.append(
                {
                    "date": event.get("start_date", "") or journal_date,
                    "title": event.get("label", ""),
                    "type": event.get("type", ""),
                    "status": event.get("status", ""),
                    "practitioner": event.get("practitioner", ""),
                    "notes": event.get("notes", ""),
                }
            )
    return sorted(entries, key=lambda item: (item["date"], item["title"]), reverse=True)


def build_source_documents() -> list[dict]:
    documents: list[dict] = []
    for path in sorted((ROOT / "data" / "raw").rglob("*.pdf")):
        documents.append(
            {
                "name": path.name,
                "path": str(path.relative_to(ROOT)).replace("\\", "/"),
                "category": translate_document_category(
                    path.parent.parent.name if path.parent.parent != path.parent else path.parent.name
                ),
            }
        )
    return documents


def build_weight_history(profile: dict) -> list[dict]:
    history = profile.get("anthropometrics", {}).get("weight_history", [])
    items: list[dict] = []
    for entry in history:
        items.append(
            {
                "date": entry.get("date", ""),
                "weightKg": entry.get("weight_kg", ""),
                "notes": entry.get("notes", ""),
            }
        )
    return sorted(items, key=lambda item: item["date"])


def build_signal_list(profile: dict, latest_lab_cards: list[dict]) -> list[dict]:
    conditions = profile.get("conditions", [])
    hydration = profile.get("hydration", {})
    diet = profile.get("dietary_pattern", {})
    lifestyle = profile.get("lifestyle", {})
    signals: list[dict] = []

    if lifestyle.get("activity_level") == "very_sedentary":
        signals.append({"title": "Sedentarite tres marquee", "tone": "caution"})
    if hydration.get("water_intake_level") == "low":
        signals.append({"title": "Hydratation faible", "tone": "caution"})
    if diet.get("vegetable_intake") == "low":
        signals.append({"title": "Apport en legumes faible", "tone": "caution"})
    if diet.get("starch_intake") == "high":
        signals.append({"title": "Forte dependance aux feculents", "tone": "info"})

    for condition in conditions:
        label = condition.get("label", "")
        if label:
            signals.append({"title": label, "tone": "anchor"})

    for card in latest_lab_cards:
        if card["status"] in {"high", "low"}:
            status_label = "eleve" if card["status"] == "high" else "bas"
            signals.append({"title": f"{card['label']} {status_label}", "tone": "lab"})

    deduped: list[dict] = []
    seen: set[str] = set()
    for signal in signals:
        if signal["title"] in seen:
            continue
        seen.add(signal["title"])
        deduped.append(signal)
    return deduped[:10]


def fallback_food_icon(food_key: str, label: str, category: str) -> str:
    if category in FOOD_CATEGORY_ICONS:
        return FOOD_CATEGORY_ICONS[category]
    haystack = f"{food_key} {label}".lower()
    if "egg" in haystack or "oeuf" in haystack:
        return "🍳"
    if "bread" in haystack or "pain" in haystack:
        return "🍞"
    if "juice" in haystack or "jus" in haystack or "orange" in haystack:
        return "🍊"
    if "cheese" in haystack or "fromage" in haystack or "comte" in haystack:
        return "🧀"
    if "rice" in haystack or "riz" in haystack:
        return "🍚"
    if "pasta" in haystack or "pates" in haystack:
        return "🍝"
    if "burger" in haystack:
        return "🍔"
    if "fries" in haystack or "frites" in haystack:
        return "🍟"
    return "🍽️"


def format_quantity(value: str | int | float | None, unit: str) -> str:
    numeric = parse_numeric(value)
    if numeric is None or not unit:
        return ""
    if numeric.is_integer():
        rendered = str(int(numeric))
    else:
        rendered = f"{numeric:.1f}".rstrip("0").rstrip(".")
    return f"{rendered} {unit}"


def build_profile_summary(profile: dict) -> dict:
    identity = profile.get("identity", {})
    anthropometrics = profile.get("anthropometrics", {})
    lifestyle = profile.get("lifestyle", {})
    sleep = profile.get("sleep_pattern", {})
    digestive = profile.get("digestive_pattern", {})
    goals = profile.get("goals", [])
    birth_date = identity.get("birth_date")
    age = None
    if birth_date:
        born = datetime.strptime(birth_date, "%Y-%m-%d").date()
        today = date.today()
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))

    return {
        "age": age,
        "sex": identity.get("sex", "unknown"),
        "heightCm": anthropometrics.get("height_cm"),
        "weightKg": anthropometrics.get("weight_kg"),
        "activityLevel": lifestyle.get("activity_level", "unknown"),
        "workContext": lifestyle.get("work_context", "unknown"),
        "sportActivity": lifestyle.get("sport_activity", "unknown"),
        "sleepQuality": sleep.get("quality", "unknown"),
        "digestiveSummary": digestive.get("summary", ""),
        "goals": goals,
    }


def build_digestive_focus(profile: dict, timeline: list[dict], lab_rows: list[dict]) -> dict:
    digestive = profile.get("digestive_pattern", {})
    allergies = profile.get("allergies", [])
    conditions = profile.get("conditions", [])

    digestive_conditions = [
        condition for condition in conditions
        if condition.get("key") in {"irritable_bowel_syndrome", "hepatic_steatosis", "dyslipidemia"}
    ]
    lactose = next((item for item in allergies if item.get("label", "").lower() == "lactose"), None)

    relevant_events = [
        event for event in timeline
        if any(
            token in " ".join([event.get("title", ""), event.get("notes", "")]).lower()
            for token in ["lactose", "digest", "foie", "echographie", "steatose", "transglutaminase"]
        )
    ][:6]

    digestive_labs = []
    for code in ["anti_transglutaminase_iga", "crp", "asat", "alat", "ggt", "vitamin_d_25_oh"]:
        matches = [row for row in lab_rows if row.get("test_code") == code]
        if not matches:
            continue
        latest = sorted(matches, key=lambda row: row.get("collected_at", ""))[-1]
        digestive_labs.append(
            {
                "label": latest.get("label", code),
                "value": latest.get("value", ""),
                "unit": latest.get("unit", ""),
                "date": latest.get("collected_at", ""),
                "status": lab_status(latest),
                "note": latest.get("notes", ""),
            }
        )

    return {
        "summary": digestive.get("summary", ""),
        "triggers": digestive.get("common_triggers", []),
        "management": digestive.get("management_strategy", ""),
        "lactoseNote": lactose.get("notes", "") if lactose else "",
        "conditions": [
            {
                "label": condition.get("label", ""),
                "notes": condition.get("notes", ""),
                "status": condition.get("status", ""),
            }
            for condition in digestive_conditions
        ],
        "events": relevant_events,
        "labs": digestive_labs,
    }


def build_lab_history(all_rows: list[dict]) -> list[dict]:
    history: list[dict] = []
    for code in LAB_HISTORY_KEYS:
        rows = sorted(
            [row for row in all_rows if row.get("test_code") == code],
            key=lambda row: row.get("collected_at", ""),
        )
        if not rows:
            continue
        series = [
            {
                "date": row.get("collected_at", ""),
                "value": row.get("value", ""),
                "unit": row.get("unit", ""),
                "status": lab_status(row),
            }
            for row in rows
        ]
        latest = series[-1]
        previous = series[-2] if len(series) > 1 else None
        latest_numeric = parse_numeric(latest["value"])
        previous_numeric = parse_numeric(previous["value"]) if previous else None
        delta = None
        if latest_numeric is not None and previous_numeric is not None:
            delta = round(latest_numeric - previous_numeric, 2)
        history.append(
            {
                "code": code,
                "label": rows[-1].get("label", code),
                "unit": rows[-1].get("unit", ""),
                "latestDate": latest["date"],
                "latestValue": latest["value"],
                "latestStatus": latest["status"],
                "previousDate": previous["date"] if previous else "",
                "previousValue": previous["value"] if previous else "",
                "delta": delta,
                "series": series,
            }
        )
    return history


def build_recent_meals(food_reference: dict[str, dict]) -> list[dict]:
    meals = load_all_meals()
    meal_items = load_all_meal_items()
    items_by_meal: dict[str, list[dict]] = {}
    for item in meal_items:
        items_by_meal.setdefault(item.get("meal_id", ""), []).append(item)

    ordered_meals = sorted(
        meals,
        key=lambda row: (
            row.get("date", ""),
            row.get("time", ""),
            row.get("logged_at", ""),
            row.get("meal_id", ""),
        ),
        reverse=True,
    )

    recent: list[dict] = []
    for meal in ordered_meals[:6]:
        rendered_items: list[dict] = []
        for item in sorted(items_by_meal.get(meal.get("meal_id", ""), []), key=lambda row: int(row.get("item_index", 0) or 0)):
            reference = food_reference.get(item.get("food_key", ""), {})
            category = reference.get("category", "")
            icon = reference.get("icon") or fallback_food_icon(item.get("food_key", ""), item.get("label", ""), category)
            quantity_text = format_quantity(item.get("quantity"), item.get("unit", ""))
            if quantity_text and item.get("quantity_source") == "estimated":
                quantity_text = f"~{quantity_text}"
            rendered_items.append(
                {
                    "icon": icon,
                    "label": item.get("label") or reference.get("label") or item.get("food_key") or "Aliment inconnu",
                    "quantityText": quantity_text,
                    "portionText": item.get("portion_text", ""),
                    "quantitySource": item.get("quantity_source", ""),
                    "notes": item.get("item_notes", ""),
                }
            )

        recent.append(
            {
                "mealId": meal.get("meal_id", ""),
                "date": meal.get("date", ""),
                "time": meal.get("time", ""),
                "mealType": meal.get("meal_type", ""),
                "mealTypeLabel": MEAL_TYPE_LABELS.get(
                    meal.get("meal_type", ""),
                    meal.get("meal_type", "").replace("_", " ").title(),
                ),
                "mealTypeIcon": MEAL_TYPE_ICONS.get(meal.get("meal_type", ""), "🍽️"),
                "confidence": meal.get("confidence", ""),
                "captureMethod": meal.get("capture_method", ""),
                "sourceText": meal.get("source_text", ""),
                "notes": meal.get("notes", ""),
                "itemsCount": meal.get("items_count", ""),
                "structuredItemsCount": meal.get("structured_items_count", ""),
                "items": rendered_items,
            }
        )
    return recent


def build_dashboard_site_data() -> dict:
    profile = load_profile()
    reference_sections = load_health_reference()
    food_reference = load_food_reference()
    all_lab_rows = load_all_lab_rows()
    latest_lab_date, latest_lab_panel = load_latest_lab_panel()
    latest_lab_cards = build_lab_cards(latest_lab_panel)
    food_frequency = load_food_frequency()
    timeline = build_timeline()

    dashboard = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "profileSummary": build_profile_summary(profile),
        "profile": profile,
        "referenceSections": reference_sections,
        "monthlySummaries": load_monthly_summaries(),
        "dailySummaries": load_daily_summaries(),
        "latestLabDate": latest_lab_date,
        "latestLabCards": latest_lab_cards,
        "labHistory": build_lab_history(all_lab_rows),
        "recentMeals": build_recent_meals(food_reference),
        "timeline": timeline,
        "weightHistory": build_weight_history(profile),
        "signals": build_signal_list(profile, latest_lab_cards),
        "digestiveFocus": build_digestive_focus(profile, timeline, all_lab_rows),
        "foodFrequency": sorted(
            food_frequency,
            key=lambda row: (-int(row.get("occurrence_count", 0)), row.get("label", "")),
        )[:12],
        "sourceDocuments": build_source_documents(),
    }

    SITE_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    with SITE_DATA_PATH.open("w", encoding="utf-8") as handle:
        json.dump(dashboard, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return dashboard


def main() -> int:
    build_dashboard_site_data()
    print(f"Generated site data at {SITE_DATA_PATH}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
