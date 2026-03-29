# Privacy And Security

## Niveau de sensibilite

Ce depot peut contenir:

- habitudes alimentaires
- symptomes et digestion
- poids et autres mesures corporelles
- traitements et supplements
- bilans biologiques

Ces donnees sont considerees sensibles.

## Regles recommandees

- Garder le depot prive
- Chiffrer le disque et, si possible, le depot distant
- Limiter les partages de captures, exports CSV et rapports derives
- Eviter de stocker des documents bruts non necessaires si leur contenu a deja ete structure
- Conserver une trace de la source et de la date d import pour chaque donnee externe

## Politique pratique

- `data/raw/` contient les imports d origine intacts
- `data/normalized/` et `data/derived/` doivent pouvoir etre regeneres
- Les documents lourds comme PDF et images doivent etre references puis transcrits en donnees structurees

