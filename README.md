# Game Hub — plateforme multijoueur modulaire

Hub web temps réel (Node.js · Express · Socket.io · Vanilla JS en modules ES) pour héberger
plusieurs mini-jeux de société / cartes : **La Chute des Rois** (coopératif, 1-4 joueurs), **Tarot** (3-5 joueurs),
**Blackjack** (1-5 joueurs contre la banque), **Poker Texas Hold'em** (2-8 joueurs, tournoi No Limit)
et **Les Profondeurs** (exploration de donjon coopérative aux dés, 1-4 joueurs).

## Démarrage

```bash
# Docker (recommandé) — reverse proxy Nginx : voir DEPLOIEMENT.md
cp .env.example .env
docker compose up -d --build                     # http://localhost:3001

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
│       ├── auth.js               connexion Discord OAuth2 (optionnelle) + demandes d'accès
│       ├── store.js              SQLite intégré à Node : comptes, statuts, parties, stats
│       ├── RoomManager.js        sessions (reconnexion), création/jointure des salons
│       ├── Room.js               joueurs, hôte, choix du jeu, annonces, partie en cours
│       ├── socketHandlers.js     protocole Socket.io (événements client <-> serveur)
│       └── utils.js
├── public/                       ← FRONT DU HUB
│   ├── index.html                accueil + salon (lobby) + conteneur de jeu (pleine largeur)
│   ├── css/style.css             thème partagé (variables CSS)
│   ├── vendor/tapis/             design system « Tapis » des jeux de cartes (importé, ne pas éditer)
│   └── js/
│       ├── app.js                client Socket.io, écrans, chargement dynamique des jeux
│       ├── dashboard.js          page Hub : salons, en ligne, stats, classement, admin
│       └── dom.js                helper el() partagé (pas d'innerHTML)
├── games/                        ← UN DOSSIER = UN JEU
│   ├── tarot/                    Tarot français (3-5 joueurs, appel au Roi à 5)
│   ├── blackjack/                Blackjack (1-5 joueurs contre la banque)
│   ├── poker/                    Poker Texas Hold'em No Limit en tournoi (2-8 joueurs)
│   ├── profondeurs/              Les Profondeurs (dés, 1-4 joueurs)
│   │   ├── server/               moteur + contenu original (héros, salles, gardiens, boss)
│   │   └── client/               écrans au design system « Torche » (client/torche/, importé de Claude Design)
│   └── chute-des-rois/
│       ├── server/index.js       manifeste (id, nom, joueurs min/max, createGame)
│       ├── server/ChuteDesRois.js moteur de règles (pur, testable, sans réseau)
│       ├── server/cards.js       paquet, valeurs, mélange
│       └── client/               servi sur /games/chute-des-rois/
│           ├── index.js          mount(root, ctx) -> { update, unmount } : file d'états et animations
│           ├── view.js           rendu avec le design system Tapis (table « cour »)
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
  createGame: ({ players, options }) => ({
    handleAction(playerId, type, payload) { /* lever une erreur avec err.isGameError = true si invalide */ },
    getStateFor(playerId) { /* état visible par CE joueur */ },
    isOver() { /* optionnel */ },
    getResult() { /* optionnel, pour les stats : { summary, players: [{ playerId, result: 'win'|'loss'|'draw', score }] } */ },
  }),
  scoreLabel: 'Points', // optionnel : libellé du score dans les stats
  // optionnel : réglages choisis par l'hôte dans le salon, reçus dans createGame({ options }) -> { difficulte: 'normal' }
  options: [{ id: 'difficulte', label: 'Difficulté', default: 'normal',
    choices: [{ value: 'facile', label: 'Facile', description: '...' }, { value: 'normal', label: 'Normal' }] }],
};
```

2. Créer `games/<mon-jeu>/client/index.js` :

```js
export function mount(root, ctx) {   // ctx : { me, getRoom(), sendAction(type, payload), toast() }
  return { update(state) { /* afficher */ }, unmount() { /* nettoyer */ } };
}
```

3. Facultatif : `games/<mon-jeu>/client/cover.svg`, vignette 320 × 180 affichée par le Hub.
4. Redémarrer : le jeu apparaît dans le catalogue de l'accueil et dans la liste du salon. Aucune modification du Core
   n'est nécessaire.

Le serveur fait autorité : le client n'envoie que des intentions (`game:action`), le moteur valide,
puis le Core diffuse à chaque joueur sa propre vue (`getStateFor`) — les mains adverses ne quittent jamais le serveur.

## Protocole Socket.io

| Client → serveur | Serveur → client |
| --- | --- |
| `room:create {name}` · `room:join {code, name}` · `room:leave` | `session {token, playerId, roomCode}` |
| `room:selectGame {gameId}` · `room:startGame` · `room:endGame` (hôte) | `games:list` · `room:state` · `room:left` |
| | `room:notice {text}` (arrivée, départ, nouvel hôte : affiché en notification) |
| `game:action {type, payload}` | `game:state {gameId, state}` |
| `hub:get` · `stats:get` · `stats:leaderboard {gameId}` | `hub:lobby {rooms, online}` · `stats:changed` |
| `admin:users` · `admin:decide {userId, status}` (admins) | `admin:changed` · `admin:request {name}` |

Chaque requête client reçoit un acquittement `{ ok, error? }`. La session est liée à un jeton stocké
dans `localStorage` : un rafraîchissement ou une coupure réseau (< `RECONNECT_GRACE_MS`) ramène le joueur à sa place.

## Tarot — règles implémentées

Tarot français (règles FFT), 3 à 5 joueurs ; une partie = une donne par joueur.
- Distribution : 24/18/15 cartes et chien de 6/6/3 ; « Petit sec » et « tout le monde passe » = redistribution.
- Enchères : Petite ×1, Garde ×2, Garde sans ×4, Garde contre ×6. Écart sans Roi ni bout (atouts si nécessaire, montrés).
- À 5 : appel au Roi (Dame si on a les 4 Rois…), partenaire secret révélé quand la carte est jouée.
- Jeu : fournir, couper, monter ; Excuse gardée par son camp contre une demi-carte, perdue au dernier pli.
- Décompte : 56/51/41/36 points selon les bouts ; (25 + écart) × coef., Petit au bout (10 × coef.),
  poignées 20/30/40 ; répartition à somme nulle (à 5 : preneur ×2, partenaire ×1).
- Non gérés pour l'instant : chelem, misère.

## Blackjack — règles implémentées

- 1 à 5 joueurs, chacun contre la banque. Réglages de l'hôte dans le salon : jetons de départ (500, 1 000 ou 2 500)
  et nombre de donnes (5, 10 ou 20).
- Sabot de 6 jeux avec carte de coupe à 75 % : remélangé avant la donne suivante une fois la carte sortie (annoncé).
- Mises simultanées : 10 au moins (tout ce qui reste s'il y en a moins), au plus sa cave ; « Je passe » saute la donne.
- La banque a une carte cachée et vérifie son blackjack sur un As ou une carte de valeur 10 ; sur un As, l'assurance
  est proposée d'abord (au plus la moitié de la mise, payée 2 pour 1). Elle tire jusqu'à 16 et reste sur tous les 17.
- Joueur : tirer, rester, doubler sur ses deux premières cartes (aussi après une séparation), séparer deux cartes de même
  valeur jusqu'à 4 mains (As séparés : une carte chacun ; 21 après séparation payé 1 pour 1). Pas d'abandon.
- Paiements : blackjack 3 pour 2 arrondi à l'unité inférieure, gain 1 pour 1, égalité = mise rendue ; blackjack de la
  banque : toutes les mises perdues sauf les blackjacks (égalité).
- « Donne suivante » quand tous les joueurs qui ont encore des jetons ont confirmé ; sans jetons, on regarde.
- Fin après le nombre de donnes, ou quand plus personne n'a de jetons. Stats : score = jetons finaux (gagné / perdu /
  égalité par rapport au départ). Raccourcis pendant son tour : T, R, D, S.

## Poker Texas Hold'em — règles implémentées

- No Limit en tournoi (freezeout), 2 à 8 joueurs : même tapis pour tous, le dernier joueur avec des jetons gagne.
- Réglages du salon : tapis de départ 1 000 / 2 000 / 5 000 ; montée des blindes rapide (toutes les 5 mains), normale
  (10) ou lente (15). Blindes 10/20, 15/30, 25/50, 50/100, 75/150, 100/200, 150/300, 200/400, 300/600, 500/1000,
  1000/2000, puis elles doublent. Pas d'ante.
- Bouton qui avance au joueur suivant encore en jeu ; en tête-à-tête, le bouton paie la petite blinde et parle en premier
  avant le flop.
- Se coucher, parole, suivre, miser / relancer « à » un montant total, tapis. Mise minimum : la grosse blinde ; relance
  minimum : la dernière relance complète ; un tapis trop court ne rouvre pas les relances.
- Pots annexes, mise non suivie rendue, tableau déroulé quand plus personne ne peut miser. Abattage : meilleure main de 5
  cartes parmi 7 (noms français : « Full aux Dames par les 8 ») ; partage en cas d'égalité, jeton impair au premier
  gagnant à gauche du bouton. Sans abattage, les cartes restent cachées.
- Après chaque main, n'importe quel joueur encore en jeu lance la suivante. Stats : score = adversaires battus.
- Pas encore : actions anticipées, minuteur de parole, montrer ses cartes après une victoire sans abattage.

## Jeux de cartes — design

La Chute des Rois, le Tarot, le Blackjack et le Poker utilisent le design system Claude Design **« Tapis »**
(https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD) : table « cour » (velours bleu nuit, or, parchemin) et table
« salon » (feutre vert, laiton, ivoire), 130 cartes dessinées en code, PC 16:9 sans défilement et mobile en colonne,
catalogue d'animations (distribution, pose, impact, K.O., carte déchirée, nouveau boss, pli ramassé, chien…).
Pour l'importer de nouveau après une mise à jour : exporter le dossier `project/` de l'artefact puis
`node scripts/vendor-design.mjs tapis <dossier>` (sortie dans `public/vendor/tapis/`, partagé par les jeux de cartes).

## Les Profondeurs — règles et design

- Inspiré de la mécanique de *One Deck Dungeon*, avec un contenu entièrement original. 1 à 4 joueurs, un héros chacun.
- Trois étages : ouvrir des portes coûte une flamme de torche ; deux salles se révèlent (monstre ou péril), le groupe
  en choisit une ; au bout de l'étage, un gardien (au 3e, le boss du donjon), combattu en plusieurs rounds.
- Combat : chaque héros lance ses dés (Force, Agilité, Magie, Or), tout le groupe les place sur les cases de la salle
  (dé unique ≥ seuil ou total Σ), puis « Prêt » ; les cases vides infligent dégâts ou perte de torche.
- Récompenses : XP pour le groupe (niveaux : +1 dé d'Or, +2 PV max) ou objet / compétence pour un héros ; camp après
  chaque gardien. Réglages d'équilibre dans `BALANCE` (games/profondeurs/server/Profondeurs.js).
- **Design** : design system Claude Design « Torche » (https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs). Pour
  l'importer de nouveau après une mise à jour : exporter le dossier `project/` de l'artefact puis
  `node scripts/vendor-design.mjs torche <dossier>` (tokens et CSS limités au jeu, polices incluses).
  Emblèmes : game-icons.net (Lorc, Delapouite et contributeurs), CC BY 3.0. Polices Cinzel et Alegreya Sans : SIL OFL 1.1.

## La Chute des Rois — règles implémentées

- **Château** : 12 boss, Valets (20 PV / 10 att.) au sommet, puis Dames (30/15), puis Rois (40/20).
- **Taverne** (pioche) : As à 10 × 4 couleurs. Main : 8 (solo), 7, 6, 5 cartes selon 1→4 joueurs.
- **Tour** : jouer une carte, un *As + une carte*, ou un combo de même valeur (total ≤ 10) → pouvoirs → dégâts → riposte du boss (défausser des cartes dont la somme ≥ attaque restante). On peut **passer**, sauf si tous les autres viennent de le faire.
- **Pouvoirs** (N = valeur jouée) : ♥ remet N cartes de la défausse sous la pioche · ♦ distribue N cartes aux joueurs · ♣ double les dégâts · ♠ réduit l'attaque du boss de N (cumulatif).
- **Immunité** : un boss ignore le pouvoir de sa propre couleur.
- **Pile exacte** : un boss vaincu avec exactement ses PV rejoint la pioche (Valet = 10, Dame = 15, Roi = 20).
- **Solo** : 2 « Renouveaux » (défausser sa main et repiocher).
- **Joker** (option « Difficulté » du salon : Facile = 2 Jokers, Normal = 1 par défaut, Classique = sans Joker), mélangé
  dans la Taverne. Il se joue seul (valeur 0, aucun dégât) : le boss perd son immunité jusqu'à sa chute (les cartes
  jouées ensuite déclenchent le pouvoir de sa couleur ; celles déjà posées ne gagnent rien, Pique compris : seules les
  cartes jouées après le Joker comptent) et ne riposte pas ce tour-là. À plusieurs, toutes les mains sont révélées à toute la table le temps
  que le joueur du Joker choisisse qui joue ensuite (lui compris) ; en solo, il rejoue. Pour encaisser, il vaut 0.
- Victoire quand les 12 souverains sont tombés ; défaite si un joueur ne peut pas encaisser la riposte.

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | 3001 | port HTTP interne |
| `MAX_PLAYERS_PER_ROOM` | 8 | limite du Hub (chaque jeu a ses propres min/max) |
| `RECONNECT_GRACE_MS` | 60000 | délai avant de retirer un joueur déconnecté |
| `CORS_ORIGIN` | — | origines autorisées si le front est servi ailleurs |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | — | active la connexion Discord (voir DEPLOIEMENT.md) |
| `PUBLIC_URL` / `SESSION_SECRET` | — | requis avec Discord (URL publique, secret ≥ 32 caractères) |
| `DISCORD_GUILD_ID` / `DISCORD_ROLE_IDS` / `DISCORD_ALLOWED_IDS` | — | qui a le droit de jouer |

Derrière un reverse proxy (Nginx, Traefik…), pensez à transmettre les en-têtes `Upgrade`/`Connection` pour les WebSockets.
Les salons sont en mémoire : une seule instance (pour scaler horizontalement : adaptateur Redis de Socket.io + stockage partagé des salons).
