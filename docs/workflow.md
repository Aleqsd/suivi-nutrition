# Workflow

## Ajouter une journee

1. Creer ou modifier `data/journal/YYYY/MM/YYYY-MM-DD.yaml`
2. Saisir les informations connues avec des unites explicites
3. Laisser les champs inconnus absents plutot que d inventer une valeur
4. Executer `python scripts/validate.py`
5. Executer `python scripts/normalize_journal.py`
6. Executer `python scripts/build_derived.py`
7. Verifier que `data/profile/health-reference.md` reflete bien les changements globaux importants
8. Si tu utilises le dashboard local, verifier aussi `site/data/dashboard.json`
9. Si tu veux un mode local ponctuel toujours a jour, lancer `python scripts/dev_server.py --host 127.0.0.1 --port 43817`
10. Si le repo est pousse sur `main`, le deploiement GitHub Actions mettra a jour le code sur le VPS puis regenerera le dashboard a partir des donnees deja presentes sur le VPS

## Ajouter un repas depuis un message naturel

1. Utiliser le journal du jour concerne
2. Ajouter une entree dans `meals[]`
3. Remplir `source_text` avec la formulation utile si elle apporte du contexte
4. Si la portion est exacte, utiliser `quantity` et `unit`
5. Si la portion est floue, utiliser `portion_text` et `quantity_source`
6. Ne renseigner `estimated_nutrition` que si l estimation est defendable
7. Regenerer les sorties pour mettre a jour les tendances
8. Si le serveur local de dev tourne, le dashboard se mettra a jour automatiquement
9. Ne pas ajouter ces donnees sensibles a Git: elles restent locales ou sur le VPS

## Mettre a jour le profil

1. Modifier `data/profile/current.yaml`
2. Ajouter une date d effet quand une mesure ou une caracteristique change
3. Garder les diagnostics durables dans le profil, meme si le document source est historise ailleurs
4. Ne pas ecraser un historique date deja enregistre dans `data/journal/`
5. Regenerer `data/profile/health-reference.md` via `python scripts/build_derived.py`
6. Garder `data/profile/current.yaml` hors Git

## Ajouter un import externe

1. Copier le fichier brut dans `data/raw/<source>/...`
2. Ne pas le modifier
3. Reporter les donnees utiles dans un format structure dans `data/journal/` et/ou `data/profile/current.yaml`
4. Conserver `source_record_id`, `source_origin` et `imported_at` quand disponibles
5. Garder le fichier brut hors Git


## Regles de nommage

- Journaux: `data/journal/YYYY/MM/YYYY-MM-DD.yaml`
- CSV normalises: `data/normalized/<dataset>/YYYY-MM.csv`
- Rapports derives: `data/derived/<dataset>/YYYY-MM.csv` ou `.json`
- Cles de reference: snake_case en anglais
