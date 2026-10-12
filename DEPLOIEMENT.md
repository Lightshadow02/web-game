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

## Mise à jour / exploitation

| Action | Commande |
| --- | --- |
| Mettre à jour | `git pull && docker compose up -d --build` |
| Logs | `docker compose logs -f game-hub` |
| Arrêter | `docker compose down` |

- Salons en mémoire, pas de base de données : un redémarrage coupe les parties en cours. Rien à sauvegarder.
- Une seule instance du conteneur (pas de `--scale`).
- Image non-root, healthcheck, redémarrage automatique, logs limités à 3 × 10 Mo.
