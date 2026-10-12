# Game Hub — notes pour Claude

## Objectif du projet (à respecter dans toute modification)

Ce dépôt est un **Hub multijoueur modulaire** : le propriétaire ajoutera **d'autres jeux à l'avenir**.
Toute évolution doit préserver cette extensibilité :

- **Le Core (`src/core/`) ne contient aucune règle de jeu.** Il gère sessions, salons, hôte, chat,
  sélection du jeu et diffusion des états. Si un nouveau jeu semble exiger une modification du Core,
  la rendre générique (utile à tous les jeux), jamais spécifique à un jeu.
- **Un jeu = un dossier `games/<id>/`**, découvert automatiquement au démarrage :
  - `server/index.js` : `{ id, name, description, minPlayers, maxPlayers, createGame({ players }) }`
    - l'instance expose `handleAction(playerId, type, payload)` (lève une erreur avec
      `err.isGameError = true` pour un message affichable) et `getStateFor(playerId)` (vue privée).
  - `client/index.js` (module ES servi sur `/games/<id>/`) :
    `export function mount(root, ctx) { return { update(state), unmount() } }`
    avec `ctx = { me, getRoom(), sendAction(type, payload), toast(msg, type) }`.
  - `client/style.css` : styles préfixés par une classe propre au jeu (ex. `.cdr`) pour ne pas fuir dans le Hub.
- Le serveur fait autorité : le client n'envoie que des intentions, ne jamais exposer la main des autres joueurs.
- Réutiliser le thème partagé (variables CSS de `public/css/style.css`) et le helper `el()` de `public/js/dom.js`
  (pas d'`innerHTML` avec des données utilisateur).

## Ajouter un jeu — checklist

1. Créer `games/<id>/server/` (moteur pur, testable sans réseau) et `games/<id>/client/`.
2. Ajouter des tests `test/<id>.test.js` (node:test) pour les règles.
3. `npm test`, puis vérifier dans le navigateur (le jeu apparaît seul dans la liste du salon).
4. Mettre à jour le README (section des jeux).

## Commandes

- `npm run dev` — serveur avec rechargement (port 3001)
- `npm test` — tests moteur + intégration Socket.io
- `docker compose up -d --build` — déploiement (voir DEPLOIEMENT.md)
- Le propriétaire héberge l'app sur ses propres Docker, derrière **son propre reverse proxy Nginx** (HTTPS géré par lui) :
  ne pas ajouter de proxy/tunnel/HTTPS dans le projet ; garder une image autonome (aucun service externe requis).

## Jeux existants

- `chute-des-rois` — La Chute des Rois (coopératif 1-4 joueurs, jeu de 52 cartes).

## Pistes notées par le propriétaire

- Améliorer l'interface visuelle (piste : maquettes via Claude Design, puis report dans le code).
- **Connexion Discord : FAITE** (`src/core/auth.js`, reprise du flux de JDR-WEB sans base de données).
  Le site est public, le propriétaire ne veut pas gérer de comptes : accès filtré par serveur/rôle Discord
  (`DISCORD_GUILD_ID`, `DISCORD_ROLE_IDS`, `DISCORD_ALLOWED_IDS`). Session = cookie signé HMAC vérifié au
  handshake Socket.io ; le pseudo et l'avatar viennent de Discord. Sans `DISCORD_CLIENT_ID/SECRET` : pseudo libre.
  Les modules de jeu n'ont rien à gérer (l'identité arrive via les joueurs du salon).
  JDR-WEB (même app Discord) est dans un dossier voisin : `SHARED_ENV_FILE=../jdr-web/.env` est monté en lecture
  seule et on n'y lit que DISCORD_CLIENT_ID/SECRET, SESSION_SECRET (clé dérivée) et ADMIN_DISCORD_IDS.
