# Data Dictionary

## Principes

- Un fichier journalier represente une journee et sert de source de verite humaine
- Les objets canoniques sont definis dans le schema `schemas/day_log.schema.json`
- Les tables normalisees servent aux requetes, comparaisons et calculs

## Objets

### day_log

Une journee complete de suivi:

- `date`
- `timezone`
- `source`
- `sleep`
- `meals`
- `hydration`
- `activity`
- `body_metrics`
- `supplements`
- `symptoms`
- `digestion`
- `health_events`
- `notes`

### meal_entry

Un repas ou collation:

- `time`
- `meal_type`
- `location`
- `notes`
- `items[]`

### meal_item

Un aliment ou produit consomme:

- `food_key`
- `label`
- `quantity`
- `unit`
- `brand`
- `estimated_nutrition`

### body_metric

Une mesure corporelle ou physiologique:

- `type`
- `time`
- `value`
- `unit`
- `source`
- `notes`

### health_event

Un evenement de sante ponctuel ou suivi:

- `type`
- `label`
- `status`
- `start_date`
- `end_date`
- `practitioner`
- `notes`

### lab_result

Un resultat biologique structure:

- `test_code`
- `label`
- `collected_at`
- `value`
- `unit`
- `reference_low`
- `reference_high`
- `laboratory`
- `source`

### supplement_intake

Une prise de complement:

- `name`
- `dose`
- `unit`
- `time`
- `frequency`
- `notes`

## Unites imposees

- Energie: `kcal`
- Proteines, glucides, lipides, fibres: `g`
- Eau: `ml`
- Poids: `kg`
- Taille et tours: `cm`
- Temperature: `celsius`
- Frequence cardiaque: `bpm`
- Tension: `mmHg`

