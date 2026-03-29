# AGENTS.md

## Objectif du depot

Ce depot est une base de verite personnelle pour la nutrition, la sante, les symptomes, les examens et les recommandations futures.
Le code du depot est versionne, mais les donnees personnelles reelles restent hors Git et sont conservees en local ou sur le VPS.

## Regles de travail

- Ne jamais inventer de repas, symptomes, mesures, traitements ou resultats biologiques.
- Toute information donnee directement par l utilisateur est consideree comme source prioritaire, sauf si elle contredit explicitement une source datee plus fiable.
- En cas de contradiction, conserver l historique et noter la date de chaque information au lieu d ecraser silencieusement.
- Toujours distinguer:
  - fait rapporte par l utilisateur
  - fait extrait d un document
  - interpretation ou inference
- Les interpretations doivent aller dans des notes, pas remplacer les mesures source.

## Ou ranger les informations

- `data/profile/current.yaml`
  - Identite de base
  - Taille, poids courant, niveau d activite, contexte de vie
  - Conditions chroniques et diagnostics durables
  - Tendances alimentaires et habitudes stables
- `data/profile/health-reference.md`
  - Document de reference humain consolide
  - Resume vivant des informations de sante globales et principales
  - Fichier derive: ne pas modifier a la main
- `data/journal/YYYY/MM/YYYY-MM-DD.yaml`
  - Donnees datees: repas, sommeil, symptomes, digestion, activite, mesures, supplements
  - Evenements de sante ponctuels
  - Resultats biologiques rattaches a une date de prelevement
- `data/raw/...`
  - PDF, exports d apps, documents medicaux et sources originales
  - Ne jamais modifier les fichiers source
- `docs/`
  - Documentation du depot uniquement

## Hygiene Git et confidentialite

- Ne jamais ajouter a Git des donnees de sante reelles ou des artefacts derives contenant ces donnees.
- Les chemins suivants doivent rester hors Git:
  - `data/journal/`
  - `data/raw/`
  - `data/profile/current.yaml`
  - `data/profile/health-reference.md`
  - `data/normalized/`
  - `data/derived/`
  - `site/app/data/dashboard.json`
- Le depot versionne doit surtout contenir:
  - le code
  - les schemas
  - la documentation
  - les templates
  - les references non sensibles
- Si un changement touche au mecanisme de deploiement, verifier que le code pousse vers GitHub n efface jamais les donnees privees deja presentes sur le VPS.

## Procedure quand l utilisateur donne une nouvelle information

1. Si l information est durable ou descriptive du profil, mettre a jour `data/profile/current.yaml`.
2. Si l information est datee ou liee a une journee, creer ou mettre a jour le journal de la date concernee.
3. Si l information vient d un document, stocker d abord le document brut dans `data/raw/`, puis extraire les faits structures dans `data/journal/` et, si necessaire, mettre a jour le profil.
4. Garder la provenance dans `source.origin`, `source.record_id` et les notes quand c est utile.
5. Regenerer `data/normalized/` et `data/derived/` apres toute modification des donnees structurees.
6. Verifier que `data/profile/health-reference.md` a bien ete regenere.
7. Verifier que `site/app/data/dashboard.json` a bien ete regenere si le dashboard web est utilise.

## Quand mettre a jour le document de reference

Le document `data/profile/health-reference.md` doit etre considere comme la fiche de synthese principale.

Il doit etre regenere des qu une nouvelle information change la vision globale ou principale de la sante, par exemple:

- nouvelle condition chronique, nouveau diagnostic, amelioration, aggravation ou resolution
- nouvelle mesure corporelle importante ou changement de mode de vie
- nouveau bilan biologique
- changement durable des habitudes alimentaires, digestives, de sommeil ou d activite

Une entree de repas isolee n exige pas une reecriture manuelle du document, mais la regeneration standard doit le garder coherent avec les sources.

## Procedure specifique pour les repas donnes en conversation

1. Si l utilisateur dit "je viens de manger" ou formule equivalente, considerer qu il faut enregistrer un repas dans le journal de la date du message.
2. Ne pas attendre une structure parfaite: enregistrer le repas meme si seule une partie des informations est connue.
3. Pour chaque item:
   - utiliser `quantity` + `unit` si la portion est explicite
   - si la portion n est pas explicite, tenter une estimation prudente en `g` ou `ml` a partir du contexte et de `data/reference/foods.yaml`
   - conserver aussi `portion_text` quand la formulation d origine apporte un contexte utile
   - utiliser `quantity_source` pour distinguer exact / estimated / unknown
4. Remplir `source_text` au niveau du repas quand la formulation d origine est utile.
5. Preferer des estimations rondes et defendables plutot qu une fausse precision. Si l estimation est trop fragile, laisser `quantity_source: "unknown"` et expliciter la limite dans `notes`.
6. Ne jamais inventer les macros; si elles sont inconnues, laisser vide.
7. Apres ajout d un repas, calculer systematiquement une estimation de kcal du repas, un score heuristique sur 100, et 1 a 3 recommandations d amelioration possibles.
8. Apres ajout d un repas, regenerer les vues pour garder des tendances a jour.

## Evaluation derivee de chaque repas

- Chaque nouveau repas renseigne par l utilisateur doit declencher un calcul derive, meme si les quantites sont partiellement estimees.
- Ce calcul derive doit produire au minimum:
  - une estimation de `kcal` pour le repas
  - un score heuristique de qualite du repas sur `100`
  - une courte liste de recommandations d amelioration possibles pour ce repas
- L estimation calorique doit s appuyer d abord sur:
  - les quantites explicites donnees par l utilisateur
  - les conversions conversationnelles en `g` ou `ml`
  - les references de `data/reference/foods.yaml`
- Le score sur 100 doit rester un score heuristique, pas un jugement medical. Il peut prendre en compte:
  - l horaire du repas
  - le type de repas (`breakfast`, `lunch`, `dinner`, `snack`)
  - l equilibre global du repas
  - la densite calorique estimee
  - la presence ou l absence de proteines, fibres, fruits ou legumes
  - le contexte personnel deja connu, par exemple la sensibilite digestive le soir
- Les recommandations doivent etre courtes, concrates et actionnables. Exemples:
  - ajouter une source de proteines
  - ajouter un legume ou un fruit entier
  - alleger un diner trop lourd ou trop tardif
  - remplacer une boisson sucree ou reduire son volume
- Si les donnees sont trop partielles, il faut quand meme produire une sortie prudente, en signalant que l estimation est moins fiable.

## Heuristique d estimation des portions conversationnelles

- Utiliser les portions de reference dans `data/reference/foods.yaml` quand un aliment connu s en approche.
- Si l utilisateur donne un compte (`1 verre`, `2 petits bouts`, `1 tartine`), convertir en `g` ou `ml` si une estimation raisonnable existe, et garder la formulation d origine dans `portion_text`.
- Pour les aliments simples du quotidien, viser une estimation exploitable pour les tendances, pas une verite analytique parfaite.
- Pour les plats complexes, repas restaurant, ou portions tres ambigues, rester prudent: quantite estimee large ou `unknown`.
- Les quantites estimees doivent rester tracables comme telles dans `quantity_source` et idealement dans `notes`.

## Visibilite web des repas

- Les derniers repas doivent etre visibles haut dans le dashboard web.
- Chaque aliment doit avoir si possible une icone ou un emoji stable via `data/reference/foods.yaml`, avec fallback par categorie.
- Si un nouvel aliment est ajoute dans `data/reference/foods.yaml`, il faut aussi renseigner systematiquement une icone ou un emoji qui correspond explicitement a cet aliment.
- Les icones alimentaires affichees dans le dashboard doivent etre coherentes partout: `Repas` et `Nutrition` doivent reutiliser la meme icone resolue depuis la reference alimentaire, pas deux logiques de fallback differentes.
- Les categories nutritionnelles affichees dans le dashboard doivent aussi etre coherentes partout: `Repas` et `Nutrition` doivent reutiliser la meme categorie resolue depuis `data/reference/foods.yaml`, avec fallback unique si la reference est absente.
- Dans `Repas`, ne pas utiliser un badge generique `Estime` comme information principale par aliment si une categorie nutritionnelle exploitable existe; preferer un label du type `Feculent`, `Legume`, `Proteine`, `Produit laitier`, `Boisson`, `Matiere grasse` ou `Plat compose`.
- Les labels de categorie alimentaire doivent avoir une couleur stable par categorie dans l UI pour accelerer le scan visuel.
- Quand une icone d aliment change, verifier a la fois les cartes de repas recentes et la table `Nutrition` apres regeneration de `site/app/data/dashboard.json`.
- Quand une categorie ou un label alimentaire change, verifier a la fois les cartes de repas recentes et la table `Nutrition` apres regeneration de `site/app/data/dashboard.json`.
- Sous `Signaux`, la carte `Repartition nutritionnelle recente` doit reutiliser exactement les memes categories et la meme palette que `Repas` et `Nutrition`.
- Cette carte doit etre calculee sur les `30 derniers jours` a partir de `data/normalized/meal_items/*.csv`, avec une repartition principale en `kcal` par categorie.
- Elle doit proposer les vues `Global`, `Petit dejeuner`, `Dejeuner` et `Diner`.
- La comparaison OMS doit rester formulee comme `reperes inspires OMS`, avec un langage prudent et non medical.
- La vue web doit permettre de scanner rapidement:
  - date et heure
  - type de repas
  - derniers aliments consommes
  - quantites estimees ou exactes
  - distinction entre donnees mesurees et estimees

## Dashboard et deploiement

- Le serveur principal du dashboard reste `scripts/dev_server.py`.
- En local, il peut etre lance ponctuellement sur `127.0.0.1:43817` pour du debug ou de la verification.
- Le dashboard statique lit ses donnees depuis `site/app/data/dashboard.json`.
- Le site public doit desactiver le cache pour le HTML, le CSS, le JS et les donnees JSON du dashboard via `site/_headers`.
- Les chemins suivants doivent rester en `Cache-Control: private, no-store, max-age=0`:
  - `/`
  - `/index.html`
  - `/app`
  - `/app/`
  - `/app/index.html`
  - `/app.js`
  - `/styles.css`
  - `/auth.js`
  - `/app/data/*`
- Si un navigateur continue a servir un ancien front, ajouter temporairement un suffixe de version aux URLs de `styles.css`, `auth.js` et `app.js` dans `site/index.html` et `site/app/index.html` pour casser le cache.
- Le mode d hebergement cible n est plus le demarrage automatique sur ce PC Windows.
- Le mode d hebergement cible est le VPS `ovh` sous Ubuntu:
  - code deploye depuis GitHub
  - donnees privees conservees uniquement sur le VPS
  - service `systemd` sur le VPS pour maintenir le dashboard
  - publication distante du site statique vers Netlify
- Chaque push sur `main` doit declencher un deploiement du code vers `/home/ubuntu/GitHub/suivi-nutrition` sur le VPS, puis une regeneration du site a partir des donnees du VPS, puis un `netlify deploy --prod` du dossier `site/`.
- Le workflow GitHub de reference est `.github/workflows/deploy-vps.yml`:
  - il synchronise le code par `rsync` avec `scripts/deploy_rsync.rules`
  - il appelle le pipeline distant commun `scripts/run_vps_deploy_pipeline.sh` en `DEPLOY_MODE=standard`
  - il publie ensuite le dossier `site/` via `scripts/deploy_netlify_from_vps.sh`
- En deploiement manuel sans commit Git, preferer reproduire exactement ce flux avec une synchronisation `rsync` de l arbre de travail courant.
- Le deploiement manuel fiable depuis Windows est `scripts/deploy_to_ovh.ps1`.
- Ce script doit etre considere comme le chemin manuel de reference pour publier l etat local courant.
- Apres chaque changement termine dans ce depot, lancer un deploiement manuel via `scripts/deploy_to_ovh.ps1` pour publier l etat courant.
- Par defaut, utiliser `scripts/deploy_to_ovh.ps1 -Mode fast`; revenir a `-Mode standard` apres un changement de dependances, d environnement serveur, ou si `fast` echoue.
- `scripts/deploy_to_ovh.ps1` expose 2 modes explicites:
  - `-Mode standard`: reprovision complete du VPS avant rebuild, publication et smoke tests
  - `-Mode fast`: saute la reprovision lourde du VPS et garde sync, rebuild, publication et smoke tests
- `fast` est le mode a preferer pour les deploiements courants si le VPS est deja sain; revenir a `standard` apres un changement de dependances, d environnement serveur ou si `fast` echoue faute de virtualenv/dependances.
- Le mode `fast` doit rester rapide, efficace et complet: sync code, sync donnees privees utiles, rebuild VPS, publication Netlify, smoke test public, smoke test VPS.
- `scripts/deploy_to_ovh.ps1` doit:
  - synchroniser le code courant par `rsync` avec les memes exclusions que le workflow GitHub
  - synchroniser aussi les donnees privees locales utiles au dashboard, au minimum `data/journal/` et `data/profile/current.yaml`
  - appeler le pipeline distant commun `scripts/run_vps_deploy_pipeline.sh` avec `DEPLOY_MODE`
  - lancer ensuite un smoke test public et un smoke test VPS
- Sur ce poste Windows, `scripts/deploy_to_ovh.ps1` s appuie sur `WSL` pour executer `rsync` localement avec la cle SSH `~/.ssh/ovh`. Si `WSL` ou cette cle ne sont pas disponibles, corriger l environnement avant de modifier encore le script.
- Le deploiement manuel fiable depuis Windows suit donc les etapes suivantes:
  - synchroniser le code via `rsync --delete` avec le fichier partage `scripts/deploy_rsync.rules`
  - synchroniser les donnees privees utiles sans propager les suppressions locales
  - executer `APP_DIR=/home/ubuntu/GitHub/suivi-nutrition bash scripts/run_vps_deploy_pipeline.sh` avec `NETLIFY_SITE_ID` et `NETLIFY_AUTH_TOKEN`
  - executer ensuite `python scripts/smoke_test_site.py public --base-url https://sante.zqsdev.com`
  - verifier enfin `python3 scripts/smoke_test_site.py vps --base-url http://127.0.0.1:43817/site` sur le VPS
- Les changements de `data/reference/foods.yaml` y compris les icones et emojis sont deja inclus dans la synchro code et doivent donc etre republies a chaque execution de `scripts/deploy_to_ovh.ps1`.
- Toute mecanique de deploiement doit preserver les donnees deja presentes sur le VPS. Ne pas remplacer ni supprimer les journaux, PDF, profils prives ou artefacts derives distants par un checkout Git vide.

## Variante VPS via Netlify

- Si l utilisateur veut exposer le dashboard sur `sante.zqsdev.com`, utiliser Netlify DNS et un site Netlify dedie plutot qu un tunnel Cloudflare.
- La publication doit partir du VPS apres regeneration des donnees pour eviter de pousser les donnees privees vers GitHub.
- Le site Netlify cible peut etre mis a jour via `scripts/deploy_netlify_from_vps.sh`.
- Le site Netlify de production utilise actuellement le nom `sante-zqsdev` pour le domaine `https://sante.zqsdev.com`.
- La racine publique du site doit rester une porte d entree de connexion.
- Le dashboard et les donnees derivees doivent vivre sous `/app/`.
- Les redirects Netlify doivent reserver `/app/*` au role `health`.
- L acces cible doit etre configure en Netlify Identity:
  - registration `Invite only`
  - fournisseur externe `Google`
  - seul `aleqsd@gmail.com` doit etre invite
  - l utilisateur Identity invite doit recevoir le role `health`
- La page publique `/` doit rester une page de connexion Netlify Identity.
- Le dashboard authentifie doit vivre sous `/app/`.
- Si le deploiement Netlify est lance manuellement depuis un shell qui n a pas deja les secrets exportes, injecter explicitement `NETLIFY_SITE_ID` et `NETLIFY_AUTH_TOKEN` dans la commande distante.
- Si l authentification Netlify n est pas disponible dans l environnement courant, preparer le VPS et le pipeline GitHub, puis laisser seulement la configuration des secrets Netlify comme etape restante.

## Regles de modelisation

- Cles machine en anglais, notes humaines en francais.
- Le francais est la norme par defaut pour le dashboard web, les libelles visibles, les recommandations derivees, la fiche `health-reference.md` et tout texte de synthese destine a l utilisateur.
- Dates en `YYYY-MM-DD`, heures en `HH:MM`, timezone par defaut `Europe/Paris`.
- Pour les mesures sensibles, toujours utiliser des unites explicites et stables.
- Les informations approximatives ou qualitatives doivent rester qualitatives; ne pas les transformer en chiffres arbitraires.
- Les repas partiels restent valides s ils sont traces proprement.
- Les diagnostics durables doivent apparaitre dans le profil courant, meme s ils sont aussi traces dans un journal date.
- Les documents lourds ne sont jamais la source analytique principale: il faut les transcrire en donnees structurees.
- `data/profile/health-reference.md` doit toujours refleter `data/profile/current.yaml` et les journaux structures majeurs.

## Regles pour les recommandations futures

- Toujours raisonner a partir des donnees structurees disponibles.
- Citer les dates exactes des mesures et bilans utilises.
- Signaler clairement les angles morts: donnees manquantes, informations anciennes, contradiction entre sources, ou mesures non comparables.
- Ne pas presenter un conseil medical comme un diagnostic.
