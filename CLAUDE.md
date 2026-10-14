# Game Hub — notes pour Claude

## Objectif du projet (à respecter dans toute modification)

Ce dépôt est un **Hub multijoueur modulaire** : le propriétaire ajoutera **d'autres jeux à l'avenir**.
Toute évolution doit préserver cette extensibilité :

- **Le Core (`src/core/`) ne contient aucune règle de jeu.** Il gère sessions, salons, hôte,
  sélection du jeu et diffusion des états. Si un nouveau jeu semble exiger une modification du Core,
  la rendre générique (utile à tous les jeux), jamais spécifique à un jeu.
- **Pas de chat** (retiré à la demande du propriétaire, la voix passe par Discord) : le jeu occupe toute la
  largeur du salon ; les annonces du salon (`room:notice` : arrivée, départ, nouvel hôte) s'affichent en notification.
- **Un jeu = un dossier `games/<id>/`**, découvert automatiquement au démarrage :
  - `server/index.js` : `{ id, name, description, minPlayers, maxPlayers, createGame({ players, options }) }`
    - `options` (facultatif) : réglages génériques choisis par l'hôte dans le salon (Core : `room:setOption`),
      `[{ id, label, default, choices: [{ value, label, description? }] }]` ; `createGame` reçoit `{ [id]: value }`
      (valeurs par défaut comprises) et la vue du salon les affiche (`room.gameOptions`).
    - l'instance expose `handleAction(playerId, type, payload)` (lève une erreur avec
      `err.isGameError = true` pour un message affichable) et `getStateFor(playerId)` (vue privée).
    - pour les stats du Hub : `isOver()` et `getResult()` -> `{ summary, players: [{ playerId, result: 'win'|'loss'|'draw', score }] }`
      (+ `scoreLabel` optionnel dans le module). Le Core enregistre la partie une seule fois, rien d'autre à faire.
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
- `npm test` — tests moteur + intégration Socket.io + accès/stats
- Données persistantes : SQLite intégré à Node (`node:sqlite`, aucune dépendance) dans le volume `game-hub-data` (`/data/hub.db`).
- `docker compose up -d --build` — déploiement (voir DEPLOIEMENT.md)
- Le propriétaire héberge l'app sur ses propres Docker, derrière **son propre reverse proxy Nginx** (HTTPS géré par lui) :
  ne pas ajouter de proxy/tunnel/HTTPS dans le projet ; garder une image autonome (aucun service externe requis).

## Jeux existants

- **Jeux de cartes : design system Claude Design « Tapis » du propriétaire
  (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD)**, partagé par tous les jeux de cartes, importé dans
  `public/vendor/tapis/` (servi sur `/vendor/tapis/`) par `node scripts/vendor-design.mjs tapis <dossier project>`
  (ne pas éditer à la main). Conteneur `.tp-scope` avec `data-table`/`data-theme` = `cour` (Chute des Rois) ou
  `salon` (Tarot) et `data-motion-host` ; préférence d'animation partagée `tapis.motion` (sans choix : le réglage
  « animations réduites » du système). Pas de LobbyBar Tapis : la barre du Hub reste. Chaque client : `index.js`
  (chargement, file d'états animée façon Profondeurs) + `view.js` (rendu Tapis). Bugs du bundle contournés côté
  client (à corriger dans Claude Design puis ré-importer) : « Bouclier {pique} » littéral, accords « annulé » /
  « Immunisé », KingCall « Appeler le Dame », boutons d'EndScreen sans effet, `play({ from: DOMRect })` qui plante,
  DealSummary faux sur les demi-points, pas de mise en page entre 640 et ~1100 px de large.
- `chute-des-rois` — La Chute des Rois (coopératif 1-4 joueurs, jeu de 52 cartes), table « cour » de Tapis.
- `tarot` — Tarot français FFT (3-5 joueurs ; le propriétaire joue surtout à 4, et à 5 avec appel au Roi), table
  « salon » de Tapis. Moteur : games/tarot/server/Tarot.js (enchères, chien/écart, appel au Roi, poignées, Petit au
  bout, Excuse, décompte officiel, une donne par joueur). Pas encore : chelem, misère. Limite connue : téléphone
  tenu à l'horizontale (hauteur < 560 px), la table défile.
- `profondeurs` — Les Profondeurs (coopératif 1-4 joueurs, jeu de dés façon « One Deck Dungeon », contenu original,
  boss à 3-4 joueurs). Moteur + contenu + équilibrage faits (games/profondeurs/server/, BALANCE dans Profondeurs.js).
  **Interface FAITE avec le design system Claude Design « Torche » du propriétaire :
  https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs** (tokens, composants `.t-*`, `window.Torche`, écrans, animations).
  Il est importé dans `games/profondeurs/client/torche/` par `scripts/vendor-design.mjs` (ne pas éditer à la main :
  ré-importer ; le script limite tokens/CSS à `.prof`, place l'interrupteur d'animations sur `[data-motion-host]` et
  corrige `Timeline.done()` qui ne se résolvait jamais). Le client (`client/index.js`) joue chaque nouvel état en
  animation sur l'écran affiché, puis redessine depuis l'état serveur. Garder le crédit
  « Emblèmes : game-icons.net (Lorc, Delapouite et contributeurs), CC BY 3.0 ».

## Pistes notées par le propriétaire

- **Design et animations des jeux de cartes : FAITS** avec « Tapis » (voir Jeux existants). Le brief qui a servi
  est dans `docs/design/brief-jeux-de-cartes.md`.
- Pistes Core relevées pendant la refonte (non faites, à proposer) : prévenir un jeu quand le salon change
  (aujourd'hui les clients relisent `ctx.getRoom()` toutes les 1,5 s pour les joueurs déconnectés) ; permettre à
  l'écran de fin d'un jeu de déclencher « Retour au salon » / « Rejouer ». (Options de jeu génériques : FAITES.)
- **Connexion Discord : FAITE** (`src/core/auth.js`, reprise du flux de JDR-WEB sans base de données).
  Le site est public, le propriétaire ne veut pas gérer de comptes : accès filtré par serveur/rôle Discord
  (`DISCORD_GUILD_ID`, `DISCORD_ROLE_IDS`, `DISCORD_ALLOWED_IDS`). Session = cookie signé HMAC vérifié au
  handshake Socket.io ; le pseudo et l'avatar viennent de Discord. Sans `DISCORD_CLIENT_ID/SECRET` : pseudo libre.
  Les modules de jeu n'ont rien à gérer (l'identité arrive via les joueurs du salon).
  **Demandes d'accès : FAITES** — tout nouveau compte est `pending` ; les admins (`ADMIN_DISCORD_IDS`, dont ceux de
  light-jdr) acceptent/refusent depuis la page Hub ; refus/révocation = déconnexion immédiate.
  **Page Hub : FAITE** — salons ouverts en direct, joueurs en ligne, stats par jeu, dernières parties, classement.
  JDR-WEB (même app Discord) est dans un dossier voisin : `SHARED_ENV_FILE=../light-jdr/.env` est monté en lecture
  seule et on n'y lit que DISCORD_CLIENT_ID/SECRET, SESSION_SECRET (clé dérivée) et ADMIN_DISCORD_IDS.
- **À faire (demandé par le propriétaire) : le Joker dans La Chute des Rois**, comme le Fou de Regicide :
  1 ou 2 Jokers dans la Taverne selon la difficulté (à proposer : Normal = 1, Facile = 2, et garder un mode
  sans Joker). Le Joker se joue seul (valeur 0) : il annule l'immunité du boss (pour la suite du combat), le boss
  ne riposte pas ce tour-là, **toutes les mains sont alors révélées à tout le monde**, et le joueur qui l'a posé
  **choisit qui joue ensuite** (lui compris). Les mains redeviennent secrètes après ce choix.
  À prévoir : carte Joker côté client, panneau « Qui joue ? », animation (immunité brisée, mains retournées),
  règles et tests. Le choix de la difficulté demandera sans doute des options de jeu génériques dans le salon (Core).
- Améliorations proposées au propriétaire (à discuter, non commencées) : notifications Discord (webhook) des
  demandes d'accès et des salons ; invitations/salons privés ; mode spectateur ; revanche en un clic ; succès/badges
  et profils ; nouveaux jeux (Président, Belote/Coinche, Loup-garou, Uno-like...) ; report du design Claude Design ;
  PWA mobile ; sauvegarde des parties en cours (survit aux redémarrages) ; outils admin (bannir, fermer un salon).
