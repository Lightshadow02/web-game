# Game Hub — plateforme multijoueur modulaire

Hub web temps réel (Node.js · Express · Socket.io · Vanilla JS en modules ES) pour héberger
plusieurs mini-jeux de société / cartes. Premier jeu : **La Chute des Rois** (coopératif, 1-4 joueurs).

## Démarrage

```bash
# Docker (recommandé) — reverse proxy Nginx : voir DEPLOIEMENT.md
cp .env.example .env
docker compose up -d --build                     # http://localhost:3000

# Local
npm install
npm run dev                         # redémarre à chaque modification
npm test                            # tests du moteur + test d'intégration Socket.io
```

## Structure

```
web-game/
├── src/                          ← CORE (aucune règle de jeu ici)
│   ├── index.js                  Express + Socket.io, statiques, /health
│   └── core/
│       ├── gameRegistry.js       découverte automatique des jeux dans /games
│       ├── RoomManager.js        sessions (reconnexion), création/jointure des salons
│       ├── Room.js               joueurs, hôte, choix du jeu, chat, partie en cours
│       ├── socketHandlers.js     protocole Socket.io (événements client <-> serveur)
│       └── utils.js
├── public/                       ← FRONT DU HUB
│   ├── index.html                accueil + salon (lobby) + conteneur de jeu + chat
│   ├── css/style.css             thème partagé (variables CSS)
│   └── js/
│       ├── app.js                client Socket.io, écrans, chargement dynamique des jeux
│       └── dom.js                helper el() partagé (pas d'innerHTML)
├── games/                        ← UN DOSSIER = UN JEU
│   └── chute-des-rois/
│       ├── server/index.js       manifeste (id, nom, joueurs min/max, createGame)
│       ├── server/ChuteDesRois.js moteur de règles (pur, testable, sans réseau)
│       ├── server/cards.js       paquet, valeurs, mélange
│       └── client/               servi sur /games/chute-des-rois/
│           ├── index.js          mount(root, ctx) -> { update, unmount }
│           └── style.css
├── test/
├── Dockerfile · docker-compose.yml · .env.example
└── DEPLOIEMENT.md                guide de mise en ligne
```

## Ajouter un jeu

1. Créer `games/<mon-jeu>/server/index.js` :

```js
module.exports = {
  id: 'mon-jeu', name: 'Mon Jeu', description: '...', minPlayers: 2, maxPlayers: 6,
  createGame: ({ players }) => ({
    handleAction(playerId, type, payload) { /* lever une erreur avec err.isGameError = true si invalide */ },
    getStateFor(playerId) { /* état visible par CE joueur */ },
  }),
};
```

2. Créer `games/<mon-jeu>/client/index.js` :

```js
export function mount(root, ctx) {   // ctx : { me, getRoom(), sendAction(type, payload), toast() }
  return { update(state) { /* afficher */ }, unmount() { /* nettoyer */ } };
}
```

3. Redémarrer : le jeu apparaît dans la liste du salon. Aucune modification du Core n'est nécessaire.

Le serveur fait autorité : le client n'envoie que des intentions (`game:action`), le moteur valide,
puis le Core diffuse à chaque joueur sa propre vue (`getStateFor`) — les mains adverses ne quittent jamais le serveur.

## Protocole Socket.io

| Client → serveur | Serveur → client |
| --- | --- |
| `room:create {name}` · `room:join {code, name}` · `room:leave` | `session {token, playerId, roomCode}` |
| `room:selectGame {gameId}` · `room:startGame` · `room:endGame` (hôte) | `games:list` · `room:state` · `room:left` |
| `chat:send {text}` | `chat:history` · `chat:message` |
| `game:action {type, payload}` | `game:state {gameId, state}` |

Chaque requête client reçoit un acquittement `{ ok, error? }`. La session est liée à un jeton stocké
dans `localStorage` : un rafraîchissement ou une coupure réseau (< `RECONNECT_GRACE_MS`) ramène le joueur à sa place.

## La Chute des Rois — règles implémentées

- **Château** : 12 boss, Valets (20 PV / 10 att.) au sommet, puis Dames (30/15), puis Rois (40/20).
- **Taverne** (pioche) : As à 10 × 4 couleurs. Main : 8 (solo), 7, 6, 5 cartes selon 1→4 joueurs.
- **Tour** : jouer une carte, un *As + une carte*, ou un combo de même valeur (total ≤ 10) → pouvoirs → dégâts → riposte du boss (défausser des cartes dont la somme ≥ attaque restante). On peut **passer**, sauf si tous les autres viennent de le faire.
- **Pouvoirs** (N = valeur jouée) : ♥ remet N cartes de la défausse sous la pioche · ♦ distribue N cartes aux joueurs · ♣ double les dégâts · ♠ réduit l'attaque du boss de N (cumulatif).
- **Immunité** : un boss ignore le pouvoir de sa propre couleur.
- **Pile exacte** : un boss vaincu avec exactement ses PV rejoint la pioche (Valet = 10, Dame = 15, Roi = 20).
- **Solo** : 2 « Renouveaux » (défausser sa main et repiocher).
- Victoire quand les 12 souverains sont tombés ; défaite si un joueur ne peut pas encaisser la riposte.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | 3000 | port HTTP interne |
| `MAX_PLAYERS_PER_ROOM` | 8 | limite du Hub (chaque jeu a ses propres min/max) |
| `RECONNECT_GRACE_MS` | 60000 | délai avant de retirer un joueur déconnecté |
| `CORS_ORIGIN` | — | origines autorisées si le front est servi ailleurs |

Derrière un reverse proxy (Nginx, Traefik…), pensez à transmettre les en-têtes `Upgrade`/`Connection` pour les WebSockets.
Les salons sont en mémoire : une seule instance (pour scaler horizontalement : adaptateur Redis de Socket.io + stockage partagé des salons).
