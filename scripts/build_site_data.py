from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta

from _common import ROOT, iter_journal_files, load_yaml, read_csv


PROFILE_PATH = ROOT / "data" / "profile" / "current.yaml"
HEALTH_REFERENCE_PATH = ROOT / "data" / "profile" / "health-reference.md"
FOOD_REFERENCE_PATH = ROOT / "data" / "reference" / "foods.yaml"
DERIVED_DIR = ROOT / "data" / "derived"
NORMALIZED_DIR = ROOT / "data" / "normalized"
SITE_DATA_PATH = ROOT / "site" / "app" / "data" / "dashboard.json"

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
    "breakfast": "Petit déjeuner",
    "lunch": "Déjeuner",
    "dinner": "Dîner",
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

FOOD_CATEGORY_LABELS = {
    "starch": "Féculent",
    "protein": "Protéine",
    "dairy": "Produit laitier",
    "fruit": "Fruit",
    "vegetable": "Légume",
    "drink": "Boisson",
    "fat": "Matière grasse",
    "mixed_dish": "Plat composé",
}

FOOD_CATEGORY_ORDER = [
    "starch",
    "vegetable",
    "fruit",
    "protein",
    "dairy",
    "fat",
    "drink",
    "mixed_dish",
]

NUTRITION_BALANCE_WINDOW_DAYS = 30

NUTRITION_BALANCE_SCOPES = {
    "all": {"label": "Global", "meal_types": None},
    "breakfast": {"label": "Petit déjeuner", "meal_types": {"breakfast"}},
    "lunch": {"label": "Déjeuner", "meal_types": {"lunch"}},
    "dinner": {"label": "Dîner", "meal_types": {"dinner"}},
}

DOCUMENT_CATEGORY_LABELS = {
    "lab_results": "Bilans biologiques",
    "medical_reports": "Comptes rendus médicaux",
    "medical_imaging": "Imagerie médicale",
    "functional_tests": "Tests fonctionnels",
}

DISPLAY_TEXT_EXACT = {
    "Oeuf brouille": "Oeuf brouillé",
    "Comte": "Comté",
    "Yaourt La Laitiere caramel": "Yaourt La Laitière caramel",
    "Jus d'orange presse maison": "Jus d'orange pressé maison",
    "petite portion melangee": "petite portion mélangée",
    "portion non precisee": "portion non précisée",
    "matiere grasse de cuisson non precisee": "matière grasse de cuisson non précisée",
    "Profil courant consolide a partir d'informations utilisateur et de documents sources historises dans data/raw/. Homme, 33 ans au 2026-03-29.": "Profil courant consolidé à partir d'informations utilisateur et de documents sources historisés dans data/raw/. Homme, 33 ans au 2026-03-29.",
    "Une tartine le matin, pas systematiquement.": "Une tartine le matin, pas systématiquement.",
    "Un repas le midi, souvent centre sur des feculents.": "Un repas le midi, souvent centré sur des féculents.",
    "Un repas le soir similaire au midi, mais plutot leger.": "Un repas le soir similaire au midi, mais plutôt léger.",
    "Mange leger le soir pour limiter les inconforts digestifs.": "Mange léger le soir pour limiter les inconforts digestifs.",
    "Privilegier un diner leger.": "Privilégier un dîner léger.",
    "Sommeil plutot correct, mais agite recemment.": "Sommeil plutôt correct, mais agité récemment.",
    "Poids repere indique par l'utilisateur pour decembre 2025.": "Poids repère indiqué par l'utilisateur pour décembre 2025.",
    "Poids courant declare par l'utilisateur.": "Poids courant déclaré par l'utilisateur.",
    "Prelevement effectue le 2025-04-30 a 07:15.": "Prélèvement effectué le 2025-04-30 à 07:15.",
    "Prelevement effectue le 2023-08-16 a 09:17.": "Prélèvement effectué le 2023-08-16 à 09:17.",
    "Interpretation du laboratoire: DFG stade G2, legerement augmente (60-89 mL/min/1,73m2).": "Interprétation du laboratoire: DFG stade G2, légèrement augmenté (60-89 mL/min/1,73m2).",
    "Conclusion explicite du compte-rendu d'echographie.": "Conclusion explicite du compte-rendu d'échographie.",
    "Resultats complementaires de l'echographie abdominale": "Résultats complémentaires de l'échographie abdominale",
    "Echographie abdominale": "Échographie abdominale",
    "Bilan biologique digestif": "Bilan biologique digestif",
    "Steatose hepatique": "Stéatose hépatique",
    "Steatose hepatique sans signe d'hepatopathie chronique": "Stéatose hépatique sans signe d'hépatopathie chronique",
    "Echographie abdominale du 2023-09-18: foie de steatose sans signe d'hepatopathie chronique.": "Échographie abdominale du 2023-09-18: foie de stéatose sans signe d'hépatopathie chronique.",
    "Aucun traitement regulier": "Aucun traitement régulier",
    "Cholesterol eleve": "Cholestérol élevé",
    "pates": "pâtes",
    "Heure estimee car le repas est rapporte comme etant ce matin sans heure precise.": "Heure estimée car le repas est rapporté comme étant ce matin sans heure précise.",
    "Quantites estimees faute de portions explicites. Le riz frit est decompose en riz cuit, matiere grasse de cuisson estimee, legumes, poisson et dessert.": "Quantités estimées faute de portions explicites. Le riz frit est décomposé en riz cuit, matière grasse de cuisson estimée, légumes, poisson et dessert.",
    "Portion standard estimee d'oeuf brouille pour un petit-dejeuner.": "Portion standard estimée d'oeuf brouillé pour un petit-déjeuner.",
    "Equivalent conversationnel estime pour une tranche de pain de mie complet.": "Equivalent conversationnel estimé pour une tranche de pain de mie complet.",
    "Equivalent conversationnel estime.": "Equivalent conversationnel estimé.",
    "Equivalent conversationnel estime pour un verre standard.": "Equivalent conversationnel estimé pour un verre standard.",
    "Estimation prudente pour un riz frit maison ou type poelee.": "Estimation prudente pour un riz frit maison ou type poêlée.",
    "Base de riz estimee a partir d'une assiette moyenne. L'huile de cuisson est comptee a part.": "Base de riz estimée à partir d'une assiette moyenne. L'huile de cuisson est comptée à part.",
    "Legume cite explicitement par l'utilisateur.": "Légume cité explicitement par l'utilisateur.",
    "Type de poisson non precise; estimation moyenne prudente pour une portion cuite.": "Type de poisson non précisé; estimation moyenne prudente pour une portion cuite.",
    "Poids estime a partir d'un dessert lacte individuel standard au caramel.": "Poids estimé à partir d'un dessert lacté individuel standard au caramel.",
    "Estimation prudente basee sur une tranche de pain de mie complet, une portion standard d'oeuf brouille, un petit morceau de comte et un verre de jus d'orange maison.": "Estimation prudente basée sur une tranche de pain de mie complet, une portion standard d'oeuf brouillé, un petit morceau de comté et un verre de jus d'orange maison.",
    "Estimation prudente basee sur une assiette moyenne de riz frit, une portion standard de poisson et un pot individuel de dessert lacte caramel.": "Estimation prudente basée sur une assiette moyenne de riz frit, une portion standard de poisson et un pot individuel de dessert lacté caramel.",
    "Ajouter un fruit entier ou un peu plus de fibres pour completer le verre de jus.": "Ajouter un fruit entier ou un peu plus de fibres pour compléter le verre de jus.",
    "Si ce petit-dejeuner doit tenir plus longtemps, augmenter legerement la portion proteinee.": "Si ce petit-déjeuner doit tenir plus longtemps, augmenter légèrement la portion protéinée.",
    "Garder le jus presse occasionnel ou reduire le volume si l objectif est de limiter les sucres liquides.": "Garder le jus pressé occasionnel ou réduire le volume si l'objectif est de limiter les sucres liquides.",
    "Ajouter un peu plus de legumes si la portion etait plutot symbolique.": "Ajouter un peu plus de légumes si la portion était plutôt symbolique.",
    "Surveiller la quantite d huile ou de matiere grasse si ce type de riz frit revient souvent.": "Surveiller la quantité d'huile ou de matière grasse si ce type de riz frit revient souvent.",
    "Si le dessert caramel provoque des symptomes, preferer un yaourt nature, skyr ou une option sans lactose.": "Si le dessert caramel provoque des symptômes, préférer un yaourt nature, skyr ou une option sans lactose.",
}

DISPLAY_TEXT_REPLACEMENTS = [
    ("Derniere", "Dernière"),
    ("Dejeuner", "Déjeuner"),
    ("Diner", "Dîner"),
    ("Fiabilite", "Fiabilité"),
    ("Identite", "Identité"),
    ("intolerances", "intolérances"),
    ("Intolerances", "Intolérances"),
    ("resume", "résumé"),
    ("Resume", "Résumé"),
    ("precisee", "précisée"),
    ("precise", "précise"),
    ("consolide", "consolidé"),
    ("historises", "historisés"),
    ("estimees", "estimées"),
    ("estimee", "estimée"),
    ("estime", "estimé"),
    ("rapporte", "rapporté"),
    ("etant", "étant"),
    ("decompose", "décomposé"),
    ("legumes", "légumes"),
    ("legume", "légume"),
    ("proteines", "protéines"),
    ("qualite", "qualité"),
    ("quantites", "quantités"),
    ("quantite", "quantité"),
    ("medicales", "médicales"),
    ("medicaux", "médicaux"),
    ("medicale", "médicale"),
    ("medical", "médical"),
    ("sante", "santé"),
    ("indique", "indiqué"),
    ("declare", "déclaré"),
    ("decembre", "décembre"),
    ("regulier", "régulier"),
    ("repere", "repère"),
    ("reperes", "repères"),
    ("declencheurs", "déclencheurs"),
    ("Declencheurs", "Déclencheurs"),
    ("declencheur", "déclencheur"),
    ("Evenement", "Événement"),
    ("evenement", "événement"),
    ("Evenements", "Événements"),
    ("evolution", "évolution"),
    ("Evolution", "Évolution"),
    ("enregistres", "enregistrés"),
    ("enregistree", "enregistrée"),
    ("enregistre", "enregistré"),
    ("marquee", "marquée"),
    ("tres", "très"),
    ("dependance", "dépendance"),
    ("frequence", "fréquence"),
    ("frequents", "fréquents"),
    ("frequent", "fréquent"),
    ("frequente", "fréquente"),
    ("complementaire", "complémentaire"),
    ("concernee", "concernée"),
    ("intolerance", "intolérance"),
    ("symptomes", "symptômes"),
    ("associes", "associés"),
    ("aerophagie", "aérophagie"),
    ("Steatose", "Stéatose"),
    ("steatose", "stéatose"),
    ("hepatique", "hépatique"),
    ("hepatopathie", "hépatopathie"),
    ("Cholesterol", "Cholestérol"),
    ("cholesterol", "cholestérol"),
    ("eleve", "élevé"),
    ("presence", "présence"),
    ("intensite", "intensité"),
    ("competences", "compétences"),
    ("superieur", "supérieur"),
    ("heterogene", "hétérogène"),
    ("Cypres", "Cyprès"),
    ("Resultats", "Résultats"),
    ("Echographie", "Échographie"),
    ("pates", "pâtes"),
    ("calcule", "calculé"),
    ("confirmee", "confirmée"),
    ("apres", "après"),
    ("debut", "début"),
    ("melangee", "mélangée"),
    ("plutot", "plutôt"),
    ("legerement", "légèrement"),
    ("leger", "léger"),
    ("agite", "agité"),
    ("recemment", "récemment"),
    ("systematiquement", "systématiquement"),
    ("centre", "centré"),
    ("feculents", "féculents"),
    ("prelevement", "prélèvement"),
    ("effectue", "effectué"),
    ("presse", "pressé"),
    ("Privilegier", "Privilégier"),
    ("diner", "dîner"),
    ("Interpretation", "Interprétation"),
    ("echographie", "échographie"),
]


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
    sections = parse_markdown_sections(HEALTH_REFERENCE_PATH.read_text(encoding="utf-8"))
    return {
        section: [normalize_display_text(line) for line in lines]
        for section, lines in sections.items()
    }


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


def normalize_display_text(value: str | None) -> str:
    if value in ("", None):
        return ""
    text = str(value)
    text = DISPLAY_TEXT_EXACT.get(text, text)
    for source, target in DISPLAY_TEXT_REPLACEMENTS:
        text = text.replace(source, target)
    return text


def normalize_display_value(value):
    if isinstance(value, str):
        return normalize_display_text(value)
    if isinstance(value, list):
        return [normalize_display_value(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_display_value(item) for key, item in value.items()}
    return value


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


def parse_iso_date(value: str | None) -> date | None:
    if value in ("", None):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


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
        return "Au-dessus de l'intervalle de référence du document source."
    if status == "low":
        return "En dessous de l'intervalle de référence du document source."
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
                "label": normalize_display_text(row.get("label", code)),
                "value": row.get("value", ""),
                "unit": row.get("unit", ""),
                "status": lab_status(row),
                "note": normalize_display_text(lab_note(row)),
                "referenceLow": row.get("reference_low", ""),
                "referenceHigh": row.get("reference_high", ""),
            }
        )
    return cards


def translate_document_category(value: str) -> str:
    return DOCUMENT_CATEGORY_LABELS.get(value, normalize_display_text(value.replace("_", " ")))


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
                    "title": normalize_display_text(event.get("label", "")),
                    "type": event.get("type", ""),
                    "status": event.get("status", ""),
                    "practitioner": event.get("practitioner", ""),
                    "notes": normalize_display_text(event.get("notes", "")),
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
                "notes": normalize_display_text(entry.get("notes", "")),
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
        signals.append({"title": "Sédentarité très marquée", "tone": "caution"})
    if hydration.get("water_intake_level") == "low":
        signals.append({"title": "Hydratation faible", "tone": "caution"})
    if diet.get("vegetable_intake") == "low":
        signals.append({"title": "Apport en légumes faible", "tone": "caution"})
    if diet.get("starch_intake") == "high":
        signals.append({"title": "Forte dépendance aux féculents", "tone": "info"})

    for condition in conditions:
        label = condition.get("label", "")
        if label:
            signals.append({"title": normalize_display_text(label), "tone": "anchor"})

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
    haystack = f"{food_key} {label}".lower()
    if "fish" in haystack or "poisson" in haystack or "saumon" in haystack or "thon" in haystack:
        return "🐟"
    if "chicken" in haystack or "poulet" in haystack:
        return "🍗"
    if "egg" in haystack or "oeuf" in haystack:
        return "🍳"
    if "bread" in haystack or "pain" in haystack:
        return "🍞"
    if "juice" in haystack or "jus" in haystack:
        return "🧃"
    if "yaourt" in haystack or "yogurt" in haystack or "skyr" in haystack:
        return "🥣"
    if "caramel" in haystack or "dessert" in haystack:
        return "🍮"
    if "cheese" in haystack or "fromage" in haystack or "comte" in haystack:
        return "🧀"
    if "courgette" in haystack or "zucchini" in haystack:
        return "🥒"
    if "poivron" in haystack or "pepper" in haystack:
        return "🫑"
    if "carotte" in haystack or "carrot" in haystack:
        return "🥕"
    if "salade" in haystack:
        return "🥗"
    if "legume" in haystack or "vegetable" in haystack:
        return "🥦"
    if "huile" in haystack or "oil" in haystack or "olive" in haystack:
        return "🫒"
    if "banana" in haystack or "banane" in haystack:
        return "🍌"
    if "orange" in haystack:
        return "🍊"
    if "rice" in haystack or "riz" in haystack:
        return "🍚"
    if "pasta" in haystack or "pates" in haystack:
        return "🍝"
    if "burger" in haystack:
        return "🍔"
    if "fries" in haystack or "frites" in haystack:
        return "🍟"
    if category in FOOD_CATEGORY_ICONS:
        return FOOD_CATEGORY_ICONS[category]
    return "🍽️"


def fallback_food_category(food_key: str, label: str) -> str:
    haystack = f"{food_key} {label}".lower()
    if "fish" in haystack or "poisson" in haystack or "saumon" in haystack or "thon" in haystack:
        return "protein"
    if "chicken" in haystack or "poulet" in haystack:
        return "protein"
    if "egg" in haystack or "oeuf" in haystack:
        return "protein"
    if "bread" in haystack or "pain" in haystack:
        return "starch"
    if "juice" in haystack or "jus" in haystack:
        return "drink"
    if "yaourt" in haystack or "yogurt" in haystack or "skyr" in haystack:
        return "dairy"
    if "caramel" in haystack or "dessert" in haystack:
        return "dairy"
    if "cheese" in haystack or "fromage" in haystack or "comte" in haystack:
        return "dairy"
    if "courgette" in haystack or "zucchini" in haystack:
        return "vegetable"
    if "poivron" in haystack or "pepper" in haystack:
        return "vegetable"
    if "carotte" in haystack or "carrot" in haystack:
        return "vegetable"
    if "salade" in haystack:
        return "vegetable"
    if "legume" in haystack or "vegetable" in haystack:
        return "vegetable"
    if "huile" in haystack or "oil" in haystack or "olive" in haystack:
        return "fat"
    if "banana" in haystack or "banane" in haystack or "orange" in haystack:
        return "fruit"
    if "rice" in haystack or "riz" in haystack or "pasta" in haystack or "pates" in haystack:
        return "starch"
    if "burger" in haystack:
        return "mixed_dish"
    if "fries" in haystack or "frites" in haystack:
        return "starch"
    return "mixed_dish"


def resolve_food_icon(food_reference: dict[str, dict], food_key: str, label: str) -> str:
    reference = food_reference.get(food_key, {})
    category = reference.get("category", "")
    return reference.get("icon") or fallback_food_icon(food_key, label, category)


def resolve_food_category(food_reference: dict[str, dict], food_key: str, label: str) -> str:
    resolved_categories = resolve_food_category_allocations(food_reference, food_key, label)
    if not resolved_categories:
        return fallback_food_category(food_key, label)
    return resolved_categories[0][0]


def resolve_food_category_allocations(food_reference: dict[str, dict], food_key: str, label: str) -> list[tuple[str, float]]:
    reference = food_reference.get(food_key, {})
    raw_categories = reference.get("categories")
    category_weights: list[tuple[str, float | None]] = []

    def push_category(category: str, weight: float | None) -> None:
        normalized = str(category).strip().lower().replace(" ", "_")
        if normalized:
            category_weights.append((normalized, weight))

    if isinstance(raw_categories, list):
        for entry in raw_categories:
            if isinstance(entry, str):
                push_category(entry, None)
            elif isinstance(entry, dict):
                if "category" in entry and "weight" in entry:
                    push_category(str(entry.get("category", "")), parse_numeric(entry.get("weight")))
                else:
                    for key, value in entry.items():
                        if isinstance(key, str) and value is not None:
                            push_category(key, parse_numeric(value))
                            break
    elif isinstance(raw_categories, dict):
        for key, value in raw_categories.items():
            push_category(key, parse_numeric(value))

    if not category_weights:
        legacy_category = reference.get("category")
        if isinstance(legacy_category, str) and legacy_category.strip():
            category_weights = [(legacy_category.strip().lower().replace(" ", "_"), 1.0)]
        else:
            category_weights = [(fallback_food_category(food_key, label), 1.0)]

    total_weight = 0.0
    for _, weight in category_weights:
        if weight is not None and weight > 0:
            total_weight += weight

    if total_weight <= 0:
        count = len(category_weights)
        if not count:
            return [(fallback_food_category(food_key, label), 1.0)]
        return [(category, 1.0 / count) for category, _ in category_weights]

    # Normalize weights; if some categories miss weight, treat them as 1
    normalized: list[tuple[str, float]] = []
    for category, weight in category_weights:
        normalized_weight = weight if weight is not None and weight > 0 else 1.0
        normalized_weight = normalized_weight / total_weight
        if normalized_weight > 0:
            normalized.append((category, normalized_weight))
    return normalized or [(fallback_food_category(food_key, label), 1.0)]


def normalize_food_category_labels(food_reference: dict[str, dict], food_key: str, label: str) -> tuple[list[str], list[str]]:
    allocations = resolve_food_category_allocations(food_reference, food_key, label)
    category_keys: list[str] = []
    category_labels: list[str] = []
    seen: set[str] = set()

    for category, _ in allocations:
        if category in seen:
            continue
        seen.add(category)
        category_keys.append(category)
        category_labels.append(translate_food_category(category))

    return category_keys, category_labels



def translate_food_category(category: str) -> str:
    return FOOD_CATEGORY_LABELS.get(category, normalize_display_text(category.replace("_", " ")))


def category_balance_template(category: str) -> dict:
    return {
        "key": category,
        "label": translate_food_category(category),
        "icon": FOOD_CATEGORY_ICONS.get(category, "🍽️"),
        "kcal": 0.0,
        "grams": 0.0,
        "averageGramsPerCoveredDay": 0.0,
        "sharePct": 0.0,
    }


def build_who_comparison(scope: dict) -> list[dict]:
    totals = scope["categoryTotals"]
    total_kcal = scope["totalKcal"]
    days_covered = scope["daysCovered"]

    produce_grams = totals["vegetable"]["grams"] + totals["fruit"]["grams"]
    produce_avg = produce_grams / days_covered if days_covered else 0.0
    fat_share = totals["fat"]["sharePct"]
    starch_share = totals["starch"]["sharePct"]
    meaningful_categories = sum(
        1 for category in FOOD_CATEGORY_ORDER if totals[category]["sharePct"] >= 10
    )

    comparisons: list[dict] = []

    produce_target = 400.0
    produce_gap = produce_avg - produce_target
    produce_progress = min((produce_avg / produce_target) * 100, 100.0) if produce_target > 0 else 0.0

    if produce_avg >= produce_target:
        produce_status = "good"
        produce_message = (
            f"Environ {round(produce_avg)} g/jour couvert de fruits et légumes: "
            "le repère inspiré OMS de 400 g/jour est rejoint sur cette fenêtre."
        )
    elif produce_avg >= 250:
        produce_status = "watch"
        produce_message = (
            f"Environ {round(produce_avg)} g/jour couvert de fruits et légumes: "
            "c'est utile, mais encore sous le repère inspiré OMS de 400 g/jour."
        )
    else:
        produce_status = "low"
        produce_message = (
            f"Environ {round(produce_avg)} g/jour couvert de fruits et légumes: "
            "cela reste nettement sous le repère inspiré OMS de 400 g/jour."
        )
    comparisons.append(
        {
            "key": "produce",
            "status": produce_status,
            "label": "Fruits et légumes",
            "shortMessage": produce_message,
            "recommendedTarget": "Viser environ 400 g/jour de fruits et légumes sur les jours couverts.",
            "targetValue": produce_target,
            "currentValue": produce_avg,
            "unit": "g/j",
            "progressPct": round(produce_progress, 1),
            "delta": round(produce_gap, 1),
        }
    )

    fat_target = 12.0
    fat_gap = fat_share - fat_target
    fat_progress = min((fat_share / fat_target) * 100, 100.0) if fat_target > 0 else 0.0
    if fat_share <= fat_target:
        fat_status = "good"
        fat_message = f"Les matières grasses ajoutées restent contenues, autour de {round(fat_share)} % des kcal estimées."
    else:
        fat_status = "watch"
        fat_message = (
            f"Les matières grasses ajoutées représentent environ {round(fat_share)} % des kcal estimées: "
            "à surveiller si ce profil se répète."
        )
    comparisons.append(
        {
            "key": "fat",
            "status": fat_status,
            "label": "Matières grasses ajoutées",
            "shortMessage": fat_message,
            "recommendedTarget": "Garder les matières grasses ajoutées modestes et surtout régulières plutôt qu'abondantes.",
            "targetValue": fat_target,
            "currentValue": fat_share,
            "unit": "% kcal",
            "progressPct": round(fat_progress, 1),
            "delta": round(fat_gap, 1),
        }
    )

    starch_target = 45.0
    starch_gap = starch_share - starch_target
    starch_progress = min((starch_share / starch_target) * 100, 100.0) if starch_target > 0 else 0.0
    if starch_share <= starch_target:
        starch_status = "good"
        starch_message = f"Les féculents pèsent environ {round(starch_share)} % des kcal estimées sans écraser le reste."
    elif starch_share <= 60:
        starch_status = "watch"
        starch_message = f"Les féculents dominent déjà la fenêtre, autour de {round(starch_share)} % des kcal estimées."
    else:
        starch_status = "low"
        starch_message = f"Les féculents dominent très nettement la fenêtre, autour de {round(starch_share)} % des kcal estimées."
    comparisons.append(
        {
            "key": "starch",
            "status": starch_status,
            "label": "Poids des féculents",
            "shortMessage": starch_message,
            "recommendedTarget": "Éviter qu'une seule base féculente prenne systématiquement la plus grosse part du total.",
            "targetValue": starch_target,
            "currentValue": starch_share,
            "unit": "% kcal",
            "progressPct": round(starch_progress, 1),
            "delta": round(starch_gap, 1),
        }
    )

    diversity_target = 4.0
    diversity_gap = meaningful_categories - diversity_target
    diversity_progress = min((meaningful_categories / diversity_target) * 100, 100.0) if diversity_target > 0 else 0.0
    if meaningful_categories >= 4:
        diversity_status = "good"
        diversity_message = f"La répartition reste assez variée, avec {meaningful_categories} catégories qui comptent vraiment."
    elif meaningful_categories == 3:
        diversity_status = "watch"
        diversity_message = "La répartition reste un peu concentrée sur 3 catégories principales."
    else:
        diversity_status = "low"
        diversity_message = "L'apport est très concentré sur 1 ou 2 catégories principales."
    comparisons.append(
        {
            "key": "diversity",
            "status": diversity_status,
            "label": "Diversité alimentaire",
            "shortMessage": diversity_message,
            "recommendedTarget": "Chercher au moins 4 catégories qui contribuent réellement sur la période.",
            "targetValue": diversity_target,
            "currentValue": float(meaningful_categories),
            "unit": "catégories",
            "progressPct": round(diversity_progress, 1),
            "delta": round(diversity_gap, 1),
        }
    )

    return comparisons


def build_nutrition_balance(food_reference: dict[str, dict], window_days: int = NUTRITION_BALANCE_WINDOW_DAYS) -> dict:
    end_date = date.today()
    start_date = end_date - timedelta(days=max(window_days, 1) - 1)
    rows = load_all_meal_items()

    filtered_rows: list[dict] = []
    for row in rows:
        row_date = parse_iso_date(row.get("date"))
        if row_date is None or row_date < start_date or row_date > end_date:
            continue
        label = row.get("label", "")
        category_allocations = resolve_food_category_allocations(food_reference, row.get("food_key", ""), label)
        filtered_rows.append(
            {
                "date": row_date,
                "meal_id": row.get("meal_id", ""),
                "meal_type": row.get("meal_type", ""),
                "category_allocations": category_allocations,
                "energy_kcal": parse_numeric(row.get("energy_kcal")) or 0.0,
                "quantity": parse_numeric(row.get("quantity")) or 0.0,
                "unit": row.get("unit", ""),
                "quantity_source": row.get("quantity_source", ""),
            }
        )

    scopes: dict[str, dict] = {}
    for scope_key, config in NUTRITION_BALANCE_SCOPES.items():
        scope_rows = [
            row for row in filtered_rows
            if config["meal_types"] is None or row["meal_type"] in config["meal_types"]
        ]
        meal_ids = {row["meal_id"] for row in scope_rows if row["meal_id"]}
        covered_days = {row["date"].isoformat() for row in scope_rows}
        total_kcal = sum(row["energy_kcal"] for row in scope_rows)
        category_totals = {category: category_balance_template(category) for category in FOOD_CATEGORY_ORDER}

        for row in scope_rows:
            energy_kcal = row["energy_kcal"]
            for category, weight in row["category_allocations"]:
                if category not in category_totals:
                    continue
                bucket = category_totals[category]
                bucket["kcal"] += energy_kcal * weight
            if row["unit"] == "g" and row["quantity_source"] != "unknown":
                for category, weight in row["category_allocations"]:
                    if category not in category_totals:
                        continue
                    bucket = category_totals[category]
                    bucket["grams"] += row["quantity"] * weight

        category_shares: list[dict] = []
        days_covered = len(covered_days)
        for category in FOOD_CATEGORY_ORDER:
            bucket = category_totals[category]
            bucket["kcal"] = round(bucket["kcal"], 1)
            bucket["grams"] = round(bucket["grams"], 1)
            bucket["averageGramsPerCoveredDay"] = round(bucket["grams"] / days_covered, 1) if days_covered else 0.0
            bucket["sharePct"] = round((bucket["kcal"] / total_kcal) * 100, 1) if total_kcal else 0.0
            if bucket["kcal"] > 0:
                category_shares.append(
                    {
                        "key": category,
                        "label": bucket["label"],
                        "icon": bucket["icon"],
                        "kcal": bucket["kcal"],
                        "sharePct": bucket["sharePct"],
                    }
                )

        insufficient_data = len(meal_ids) < 5 or days_covered < 3 or total_kcal <= 0
        scope = {
            "key": scope_key,
            "label": config["label"],
            "totalKcal": round(total_kcal, 1),
            "mealsCount": len(meal_ids),
            "daysCovered": days_covered,
            "categoryShares": category_shares,
            "categoryTotals": category_totals,
            "whoComparison": [],
            "insufficientData": insufficient_data,
            "insufficientDataMessage": (
                "Lecture encore fragile: moins de 5 repas ou moins de 3 jours couverts sur la fenêtre."
                if insufficient_data
                else ""
            ),
        }
        scope["whoComparison"] = build_who_comparison(scope)
        scopes[scope_key] = scope

    return {
        "windowDays": window_days,
        "startDate": start_date.isoformat(),
        "endDate": end_date.isoformat(),
        "scopes": scopes,
    }


def format_quantity(value: str | int | float | None, unit: str) -> str:
    numeric = parse_numeric(value)
    if numeric is None or not unit:
        return ""
    if numeric.is_integer():
        rendered = str(int(numeric))
    else:
        rendered = f"{numeric:.1f}".rstrip("0").rstrip(".")
    return f"{rendered} {unit}"


def meal_item_sort_key(row: dict) -> tuple[float, int]:
    quantity = parse_numeric(row.get("quantity"))
    item_index = int(row.get("item_index", 0) or 0)
    if quantity is None:
        return (float("inf"), item_index)
    return (-quantity, item_index)


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
        "digestiveSummary": normalize_display_text(digestive.get("summary", "")),
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
                "label": normalize_display_text(latest.get("label", code)),
                "value": latest.get("value", ""),
                "unit": latest.get("unit", ""),
                "date": latest.get("collected_at", ""),
                "status": lab_status(latest),
                "note": normalize_display_text(latest.get("notes", "")),
            }
        )

    return {
        "summary": normalize_display_text(digestive.get("summary", "")),
        "triggers": [normalize_display_text(trigger) for trigger in digestive.get("common_triggers", [])],
        "management": normalize_display_text(digestive.get("management_strategy", "")),
        "lactoseNote": normalize_display_text(lactose.get("notes", "")) if lactose else "",
        "conditions": [
            {
                "label": normalize_display_text(condition.get("label", "")),
                "notes": normalize_display_text(condition.get("notes", "")),
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
                "label": normalize_display_text(rows[-1].get("label", code)),
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
    for meal in ordered_meals[:24]:
        recommendations = [
            value.strip()
            for value in str(meal.get("recommendations", "")).split("|")
            if value.strip()
        ]
        rendered_items: list[dict] = []
        for item in sorted(items_by_meal.get(meal.get("meal_id", ""), []), key=meal_item_sort_key):
            reference = food_reference.get(item.get("food_key", ""), {})
            icon = resolve_food_icon(food_reference, item.get("food_key", ""), item.get("label", ""))
            category_keys, category_labels = normalize_food_category_labels(
                food_reference,
                item.get("food_key", ""),
                item.get("label", ""),
            )
            category = category_keys[0] if category_keys else "mixed_dish"
            quantity_text = format_quantity(item.get("quantity"), item.get("unit", ""))
            if quantity_text and item.get("quantity_source") == "estimated":
                quantity_text = f"~{quantity_text}"
            rendered_items.append(
                {
                    "icon": icon,
                    "categoryKey": category,
                    "categoryKeys": category_keys,
                    "categoryLabels": category_labels,
                    "categoryLabel": category_labels[0] if category_labels else translate_food_category(category),
                    "label": normalize_display_text(item.get("label") or reference.get("label") or item.get("food_key") or "Aliment inconnu"),
                    "quantityText": quantity_text,
                    "portionText": normalize_display_text(item.get("portion_text", "")),
                    "quantitySource": item.get("quantity_source", ""),
                    "notes": normalize_display_text(item.get("item_notes", "")),
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
                    normalize_display_text(meal.get("meal_type", "").replace("_", " ").title()),
                ),
                "mealTypeIcon": MEAL_TYPE_ICONS.get(meal.get("meal_type", ""), "🍽️"),
                "confidence": meal.get("confidence", ""),
                "captureMethod": meal.get("capture_method", ""),
                "sourceText": meal.get("source_text", ""),
                "notes": normalize_display_text(meal.get("notes", "")),
                "itemsCount": meal.get("items_count", ""),
                "structuredItemsCount": meal.get("structured_items_count", ""),
                "assessment": {
                    "estimatedEnergyKcal": meal.get("estimated_energy_kcal", ""),
                    "qualityScore": meal.get("quality_score", ""),
                    "estimationConfidence": meal.get("estimation_confidence", ""),
                    "recommendations": [normalize_display_text(value) for value in recommendations],
                    "notes": normalize_display_text(meal.get("assessment_notes", "")),
                },
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
    meal_items = load_all_meal_items()
    timeline = build_timeline()

    energy_by_month_food_key: dict[tuple[str, str], float] = {}
    for row in meal_items:
        if row.get("is_duplicate") == "true":
            continue
        month = str(row.get("month", "")).strip()
        food_key = str(row.get("food_key", "")).strip()
        if not month or not food_key:
            continue
        energy = parse_numeric(row.get("energy_kcal")) or 0.0
        if energy <= 0:
            continue
        energy_by_month_food_key[(month, food_key)] = energy_by_month_food_key.get((month, food_key), 0.0) + energy

    top_food_frequency = food_frequency[:]
    for row in top_food_frequency:
        month = str(row.get("month", "")).strip()
        food_key = str(row.get("food_key", "")).strip()
        category = resolve_food_category(
            food_reference,
            food_key,
            row.get("label", ""),
        )
        category_keys, category_labels = normalize_food_category_labels(
            food_reference,
            food_key,
            row.get("label", ""),
        )
        total_energy_kcal = energy_by_month_food_key.get((month, food_key), 0.0)
        row["icon"] = resolve_food_icon(
            food_reference,
            food_key,
            row.get("label", ""),
        )
        row["category_key"] = category
        row["category_label"] = translate_food_category(category)
        row["category_keys"] = category_keys
        row["category_labels"] = category_labels
        row["categoryKeys"] = category_keys
        row["categoryLabels"] = category_labels
        row["label"] = normalize_display_text(row.get("label", ""))
        row["portion_text_examples"] = normalize_display_text(row.get("portion_text_examples", ""))
        row["total_energy_kcal"] = str(round(total_energy_kcal, 1))

    dashboard = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "profileSummary": build_profile_summary(profile),
        "profile": normalize_display_value(profile),
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
        "nutritionBalance": {
            "defaultWindowDays": NUTRITION_BALANCE_WINDOW_DAYS,
            "windows": {
                str(window_days): build_nutrition_balance(
                    food_reference,
                    window_days=window_days,
                )
                for window_days in [7, 30, 90]
            },
        },
        "digestiveFocus": build_digestive_focus(profile, timeline, all_lab_rows),
        "foodFrequency": top_food_frequency,
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
