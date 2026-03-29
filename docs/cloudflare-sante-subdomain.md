# Delegation `sante.zqsdev.com` vers Cloudflare

Ce depot peut etre heberge sur un VPS en gardant `zqsdev.com` chez Netlify DNS.

## Ce qui est deja prevu

- le dashboard est servi localement sur `127.0.0.1:43817`
- un service systemd `suivi-nutrition-dashboard.service` peut maintenir ce dashboard sur le VPS
- `cloudflared` peut etre installe via `scripts/install_cloudflared_ubuntu.sh`
- un service systemd `cloudflared-sante.service` peut etre configure via `scripts/configure_cloudflared_service.sh <token>`

## Ce qui reste a faire dans les consoles web

### Netlify DNS

Ajouter une delegation `NS` pour `sante.zqsdev.com` vers les nameservers fournis par Cloudflare pour la sous-zone `sante.zqsdev.com`.

Ne rien changer d autre dans `zqsdev.com`.

### Cloudflare

1. Creer une nouvelle zone `sante.zqsdev.com`
2. Recuperer les nameservers fournis pour cette sous-zone
3. Creer un tunnel dans Zero Trust / Tunnels
4. Configurer le hostname public `sante.zqsdev.com`
5. Le faire pointer vers `http://127.0.0.1:43817`
6. Recuperer le `tunnel token`
7. Creer une application Access pour `https://sante.zqsdev.com`
8. Autoriser uniquement l adresse Google personnelle retenue
9. Regler la duree de session a `30 jours`

## Mise en service sur le VPS

Une fois le token du tunnel obtenu:

```bash
ssh ovh
cd /home/ubuntu/GitHub/suivi-nutrition
bash scripts/install_cloudflared_ubuntu.sh
bash scripts/configure_cloudflared_service.sh '<tunnel-token>'
```

## Verification

```bash
ssh ovh "systemctl --no-pager status suivi-nutrition-dashboard.service"
ssh ovh "curl -I http://127.0.0.1:43817/site/"
ssh ovh "systemctl --no-pager status cloudflared-sante.service"
```

Attendus:

- `suivi-nutrition-dashboard.service` est `active (running)`
- le dashboard repond en local sur le VPS
- `cloudflared-sante.service` est `active (running)` apres injection du token
- `https://sante.zqsdev.com` demande un login Cloudflare Access
