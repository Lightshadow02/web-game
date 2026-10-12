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
   → **OAuth2 → Redirects** → ajoutez `https://jeux.mondomaine.fr/auth/discord/callback`
   (seule étape manuelle : Discord exige chaque adresse de retour).
2. Dans `.env` : `PUBLIC_URL`, et `SHARED_ENV_FILE=../light-jdr/.env` (chemin vers le `.env` de JDR-WEB,
   relatif à ce dossier). Le Hub y lit **seulement** l'ID/secret Discord, en dérive son propre secret de
   session, et autorise toujours les `ADMIN_DISCORD_IDS` de JDR-WEB. Rien d'autre n'est lu
   (ni base de données, ni port). Si vous changez le secret dans JDR-WEB : `./update.sh` et c'est repris.
   *(Sans JDR-WEB : remplissez plutôt `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` et `SESSION_SECRET`.)*
3. Choisissez qui peut jouer (activez le *Mode développeur* de Discord pour copier les IDs par clic droit) :
   - `DISCORD_GUILD_ID` : seuls les membres de votre serveur ;
   - `DISCORD_ROLE_IDS` : … et seulement ceux qui ont ce(s) rôle(s) — vous donnez/retirez le rôle dans Discord ;
   - `DISCORD_ALLOWED_IDS` : comptes autorisés en plus, au cas par cas.
4. `./update.sh` (ou `docker compose up -d --build`). Les logs affichent « Connexion Discord activée ».

Si les logs disent « Impossible de lire … (EACCES) », le `.env` de JDR-WEB n'est pas lisible par le
conteneur (utilisateur 1000) : `chmod 644 ../light-jdr/.env` ou `chown 1000 ../light-jdr/.env`.

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
