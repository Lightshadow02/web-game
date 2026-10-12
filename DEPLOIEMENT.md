# Déployer Game Hub sur votre machine (Docker) et le mettre en ligne

Il faut juste **Docker** et **Docker Compose** installés sur la machine (Linux, Windows avec Docker Desktop, NAS…).

## 1. Récupérer le projet

```bash
git clone https://github.com/lightshadow02/web-game.git
cd web-game
git checkout claude/trusting-ramanujan-1jon3t   # (ou main une fois fusionné)
cp .env.example .env                              # puis éditez .env si besoin
```

## 2. Lancer en local (réseau maison)

```bash
docker compose up -d --build
```

- Sur la machine : http://localhost:3000
- Depuis un autre appareil du réseau (téléphone, PC) : `http://IP-DE-LA-MACHINE:3000`
- Vérifier l'état : `docker compose ps` (doit afficher `healthy`) ou http://localhost:3000/health

## 3. Mettre en ligne — choisir UNE option

### Option A — Domaine + HTTPS automatique (Caddy)

Pour qui : vous avez un nom de domaine et pouvez ouvrir des ports sur votre box.

1. Chez votre registrar, créez un enregistrement **DNS A** `jeux.mondomaine.fr` → votre **IP publique**
   (https://ifconfig.me pour la connaître ; si elle change, utilisez un DNS dynamique : DuckDNS, No-IP…).
2. Sur votre box, **redirigez les ports 80 et 443** (TCP) vers l'IP locale de la machine Docker.
3. Dans `.env` :
   ```env
   DOMAIN=jeux.mondomaine.fr
   HOST_BIND=127.0.0.1
   ```
4. Lancez :
   ```bash
   docker compose --profile https up -d --build
   ```
5. Ouvrez https://jeux.mondomaine.fr — le certificat Let's Encrypt est obtenu et renouvelé tout seul.

### Option B — Tunnel Cloudflare (aucun port à ouvrir)

Pour qui : vous ne pouvez pas / ne voulez pas ouvrir de ports (box opérateur, CGNAT, 4G…). Domaine géré par Cloudflare (gratuit).

1. https://one.dash.cloudflare.com → **Networks → Tunnels → Create a tunnel** (type *Cloudflared*), nommez-le.
2. Copiez le **token** affiché (la longue chaîne après `--token`).
3. Onglet **Public Hostname** : `jeux.mondomaine.fr` → Service **HTTP** → URL **`game-hub:3000`**.
4. Dans `.env` :
   ```env
   CLOUDFLARE_TUNNEL_TOKEN=eyJh...votre_token...
   HOST_BIND=127.0.0.1
   ```
5. Lancez :
   ```bash
   docker compose --profile tunnel up -d --build
   ```

Les WebSockets sont activés par défaut chez Cloudflare.

### Déjà un reverse proxy (Nginx Proxy Manager, Traefik, Portainer…) ?

Lancez seulement `docker compose up -d --build` et pointez votre proxy vers `http://IP:3000`
en **activant le support WebSocket** (case « Websockets Support » dans Nginx Proxy Manager).
Pour Nginx à la main :

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## 4. Commandes utiles

| Action | Commande |
| --- | --- |
| Voir les logs | `docker compose logs -f game-hub` |
| Mettre à jour après un `git pull` | `docker compose --profile <https\|tunnel> up -d --build` |
| Redémarrer | `docker compose restart game-hub` |
| Tout arrêter | `docker compose --profile https --profile tunnel down` |
| Nettoyer les anciennes images | `docker image prune -f` |

Le conteneur redémarre seul après un reboot de la machine (`restart: unless-stopped`).

## Bon à savoir

- **Aucune base de données** : les salons vivent en mémoire. Un redémarrage/mise à jour vide les salons en cours
  (faites-le hors partie). Rien à sauvegarder, sauf le volume `caddy_data` (certificats) en option A.
- Le conteneur tourne en utilisateur non-root, avec healthcheck et logs limités (3 × 10 Mo).
- Une seule instance du conteneur (pas de `--scale`) : les salons ne sont pas partagés entre instances.
