# Déploiement (Docker + votre reverse proxy Nginx)

```bash
git clone https://github.com/lightshadow02/web-game.git && cd web-game
git checkout claude/trusting-ramanujan-1jon3t     # (ou main une fois fusionné)
cp .env.example .env                               # port / bind si besoin
docker compose up -d --build
```

L'app écoute sur `http://<machine>:3001` (`docker compose ps` doit afficher `healthy`, sonde : `/health`).

## Nginx

Seul point important : **autoriser l'upgrade WebSocket** (Socket.io).

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 1h;
}
```

(Nginx Proxy Manager : cocher « Websockets Support ».)

## Connexion Discord

Sans configuration, le site fonctionne en pseudo libre. Pour réserver l'accès à vos joueurs :

1. Sur https://discord.com/developers/applications, ouvrez l'application déjà utilisée par JDR-WEB
   (ou créez-en une) → **OAuth2 → Redirects** → ajoutez `https://jeux.mondomaine.fr/auth/discord/callback`.
2. Dans `.env` : `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` (les mêmes que JDR-WEB), `PUBLIC_URL`,
   et `SESSION_SECRET` (`openssl rand -base64 48`).
3. Choisissez qui peut jouer (activez le *Mode développeur* de Discord pour copier les IDs par clic droit) :
   - `DISCORD_GUILD_ID` : seuls les membres de votre serveur ;
   - `DISCORD_ROLE_IDS` : … et seulement ceux qui ont ce(s) rôle(s) — vous donnez/retirez le rôle dans Discord ;
   - `DISCORD_ALLOWED_IDS` : comptes autorisés en plus, au cas par cas.
4. `./update.sh` (ou `docker compose up -d --build`). Les logs affichent « Connexion Discord activée ».

La session dure 7 jours. Retirer le rôle à quelqu'un l'empêche de se reconnecter ; pour couper toutes
les sessions immédiatement, changez `SESSION_SECRET` et relancez.

## Mise à jour / exploitation

| Action | Commande |
| --- | --- |
| Mettre à jour | `./update.sh` (git pull + rebuild + relance) |
| Logs | `docker compose logs -f game-hub` |
| Arrêter | `docker compose down` |

- Salons en mémoire, pas de base de données : un redémarrage coupe les parties en cours. Rien à sauvegarder.
- Une seule instance du conteneur (pas de `--scale`).
- Image non-root, healthcheck, redémarrage automatique, logs limités à 3 × 10 Mo.
