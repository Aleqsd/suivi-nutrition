# suivi-nutrition

Depot personnel pour stocker des donnees de sante et de nutrition de facon durable, relisible et exploitable par des scripts.
Le code peut etre versionne et deploye, mais les donnees personnelles reelles restent hors Git.

## Objectifs

- Garder une source de verite simple a mettre a jour a la main
- Conserver les imports externes sans les modifier
- Normaliser les donnees pour les analyses et recommandations
- Regenerer les vues derivees a partir des sources

## Structure

```text
suivi-nutrition/
|- README.md
|- docs/
|- schemas/
|- data/
|  |- profile/
|  |- journal/
|  |- raw/
|  |- normalized/
|  |- derived/
|  `- reference/
|- scripts/
|- requirements.txt
`- .gitignore
```

## Conventions

- Cles machine en anglais, notes humaines en francais
- Dates au format `YYYY-MM-DD`
- Heures au format `HH:MM`
- Timezone par defaut: `Europe/Paris`
- Unites metriques imposees pour les champs structures sensibles
- Les fichiers dans `data/raw/` ne sont jamais modifies a la main
- `docs/` contient la documentation du depot, pas les documents medicaux source

## Ou stocker quoi

- `data/profile/current.yaml`: profil courant, traits stables, conditions chroniques, mode de vie, tendances alimentaires
- `data/profile/health-reference.md`: reference sante humaine consolidee, regeneree depuis les donnees structurees
- `data/journal/YYYY/MM/YYYY-MM-DD.yaml`: faits dates, mesures, repas, symptomes, evenements, resultats biologiques
- `data/raw/`: PDF, exports d applications, bilans bruts et autres sources d origine
- `data/normalized/`: tables regenerees depuis les sources
- `data/derived/`: vues et agregats d analyse

## Git et donnees sensibles

- Les donnees de sante reelles ne doivent pas etre committees.
- Les chemins suivants sont ignores par Git:
  - `data/journal/`
  - `data/raw/`
  - `data/profile/current.yaml`
  - `data/profile/health-reference.md`
  - `data/normalized/`
  - `data/derived/`
  - `site/app/data/dashboard.json`
- Le depot suit donc surtout:
  - le code
  - les schemas
  - la documentation
  - les references non sensibles
  - les templates de saisie

## Workflow recommande

1. Ajouter ou mettre a jour un fichier journalier dans `data/journal/YYYY/MM/YYYY-MM-DD.yaml`
2. Mettre a jour `data/profile/current.yaml` quand une information durable change
2. Ajouter tout import brut dans `data/raw/` avec sa source d origine intacte
3. Valider les journaux:

```bash
python scripts/validate.py
```

4. Regenerer les tables normalisees:

```bash
python scripts/normalize_journal.py
```

5. Regenerer les vues derivees:

```bash
python scripts/build_derived.py
```

Ce script regenere aussi `data/profile/health-reference.md`.

## Logging conversationnel

- Le schema accepte des repas exacts, estimes ou partiels
- Une portion peut etre stockee comme `quantity + unit` ou comme `portion_text`
- Les macros ne doivent etre renseignees que si elles sont connues ou suffisamment estimables
- Voir [conversational-logging.md](C:/Users/aleqs/Documents/GitHub/suivi-nutrition/docs/conversational-logging.md) et [day-log.template.yaml](C:/Users/aleqs/Documents/GitHub/suivi-nutrition/data/templates/day-log.template.yaml)

## Site en local a la demande

- Le dashboard statique vit dans `site/`
- Les donnees du site sont regenerees dans `site/app/data/dashboard.json` par `python scripts/build_derived.py`
- Pour un simple serveur statique:

```bash
python -m http.server 8765
```

Puis ouvrir `http://127.0.0.1:8765/site/`

- Pour un serveur de dev local avec rebuild automatique et refresh navigateur:

```bash
python scripts/dev_server.py --host 127.0.0.1 --port 43817
```

Ce mode:

- reste local a la machine (`127.0.0.1` uniquement)
- rebuild automatiquement les donnees quand `data/`, `schemas/`, `scripts/` ou `site/` changent
- recharge automatiquement le dashboard dans le navigateur
- expose un statut local sur `http://127.0.0.1:43817/__status`

## Hebergement VPS + Netlify

- le mode cible est: code sur GitHub, donnees privees conservees sur le VPS, dashboard regenere sur le VPS puis publie vers Netlify
- le site Netlify dedie est configuré côté pipeline (`NETLIFY_SITE_ID`)
- le domaine public cible est `PUBLIC_BASE_URL`
- chaque push sur `main` declenche une synchronisation `rsync` vers `ovh`, l execution du pipeline distant commun, puis une publication Netlify
- la page publique `/` sert uniquement de porte d entree de connexion
- le dashboard et les donnees structurees sont servis sous `/app/`
- le contenu sensible doit etre protege par Netlify Identity en `Invite only`, fournisseur Google, avec un role `health`
- le workflow GitHub attend les secrets:
  - `OVH_SSH_KEY`
  - `VPS_HOST` (optionnel, fallback: `ovh`/IP historique dans la config)
  - `NETLIFY_AUTH_TOKEN`
  - `NETLIFY_SITE_ID`
  - `PUBLIC_BASE_URL`
  - `ALLOWED_EMAIL`
- la gestion d'autorisation Netlify se base sur `ALLOWED_EMAIL` (et `ALLOWED_PROVIDER=google` par défaut)
- deploiement manuel de secours depuis Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy_to_ovh.ps1
```

- le meme script accepte maintenant 2 modes explicites:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy_to_ovh.ps1 -Mode standard
powershell -ExecutionPolicy Bypass -File scripts/deploy_to_ovh.ps1 -Mode fast
```

- `standard`: reprovision complet du VPS avant rebuild, publication et smoke tests
- `fast`: saute la reprovision lourde du VPS et ne garde que sync, rebuild, publication et smoke tests; a utiliser quand le VPS est deja sain et que les dependances n ont pas change
- si `fast` echoue faute de virtualenv ou de dependances serveur, relancer une fois en `standard`

- ce deploiement manuel synchronise le code via `rsync`, puis les donnees privees utiles au dashboard sans propager les suppressions locales
- les donnees deja presentes sur le VPS sont conservees
- ce deploiement appelle le pipeline distant `scripts/run_vps_deploy_pipeline.sh`
- la publication Netlify se fait ensuite via `scripts/deploy_netlify_from_vps.sh`
- le script lance enfin un smoke test public et un smoke test du dashboard servi par le VPS

## Donnees sensibles

- Ce depot est pense pour un usage prive et mono-utilisateur
- En cas de synchronisation distante, chiffrer le depot ou au minimum les artefacts les plus sensibles
- Un site Netlify expose les donnees publiees au contenu servi. Pour ce repo, ne publier les donnees sensibles que sous `/app/` avec les redirects de role et Netlify Identity actifs.
- Les PDF, images ou comptes rendus medicaux restent des sources annexes: la source analytique doit rester structuree

## Fichiers de depart

- Template profil: `data/profile/current.template.yaml`
- Template de saisie: `data/templates/day-log.template.yaml`
- Site: `site/index.html`
- References de base: `data/reference/foods.yaml`, `data/reference/supplements.yaml`, `data/reference/biomarkers.yaml`
- Schema canonique: `schemas/day_log.schema.json`
