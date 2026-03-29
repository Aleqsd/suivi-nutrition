# Conversational Logging

## Objectif

Ce depot doit pouvoir etre alimente directement depuis des messages naturels du type:

- "Je viens de manger 120 g de riz et 2 oeufs"
- "Ce midi j ai pris un sandwich jambon fromage et un coca"
- "Ce soir resto italien, une grosse assiette de pates carbo"

L objectif n est pas d attendre une saisie parfaite. Il faut pouvoir enregistrer des repas utiles, meme incomplets, puis exploiter les tendances dans le temps.

## Regles de capture

- Toujours creer ou mettre a jour le journal de la date concernee.
- Si l heure n est pas donnee, utiliser l heure du message si le contexte est "je viens de", sinon laisser une heure estimee seulement si elle est explicitement inferee dans les notes.
- Si la quantite est precise, remplir `quantity` + `unit`.
- Si la quantite est vague, tenter d estimer une portion plausible en `g` ou `ml` et mettre `quantity_source: "estimated"`.
- Conserver `portion_text` meme quand une estimation en `g` ou `ml` est ajoutee, afin de garder la formulation d origine.
- Utiliser `data/reference/foods.yaml` comme base de portions conversationnelles par defaut.
- Si l aliment n est pas assez precis pour une estimation nutritionnelle fiable, ne pas inventer les macros.
- Conserver la formulation utile de l utilisateur dans `source_text` quand elle apporte du contexte.
- Si l estimation est trop fragile, laisser `quantity_source: "unknown"` et documenter pourquoi dans `notes`.

## Exemple minimal

```yaml
meals:
  - time: "12:40"
    logged_at: "2026-03-29T12:43:00+02:00"
    meal_type: "lunch"
    capture_method: "realtime"
    confidence: "high"
    source_text: "Je viens de manger 120 g de riz et 2 oeufs"
    items:
      - food_key: "rice_cooked"
        label: "Riz cuit"
        quantity: 120
        unit: "g"
        quantity_source: "exact"
      - label: "Oeufs"
        quantity: 2
        unit: "unit"
        quantity_source: "exact"
```

## Exemple partiel

```yaml
meals:
  - time: "20:15"
    meal_type: "dinner"
    capture_method: "realtime"
    confidence: "medium"
    location: "restaurant"
    context: "restaurant italien"
    source_text: "Ce soir resto italien, une grosse assiette de pates carbo"
    items:
      - label: "Pates carbonara"
        portion_text: "grosse assiette"
        quantity_source: "estimated"
```

## Ce que les rapports doivent exploiter

- frequence des prises alimentaires
- aliments les plus frequents
- distribution petit-dejeuner / dejeuner / diner / collations
- qualite de couverture des donnees: repas avec quantites structurees vs portions vagues
- tendances macro-nutritionnelles uniquement quand les donnees sont assez detaillees

## Politique de prudence

- Un conseil nutritionnel ne doit jamais s appuyer sur une precision fictive.
- Les jours ou les repas sont incomplets doivent rester exploitables pour les frequences et habitudes, mais pas surinterpreter les totaux nutritionnels.
- Une estimation conversationnelle doit etre ronde, plausible, et signalee comme estimee. Mieux vaut `200 ml` qu un faux `187 ml`.
