# Brief Claude Design — « Tapis », le système de design des jeux de cartes

> Prompt à coller tel quel dans Claude Design. Référence de format et de niveau d'exigence :
> le système « Torche » de Les Profondeurs (https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs).

---

Tu vas créer **« Tapis »**, le système de design des jeux de cartes d'un Game Hub multijoueur web
(Node.js + Socket.io, front en **JavaScript natif, sans framework ni étape de build**). Deux jeux l'utilisent
aujourd'hui : **La Chute des Rois** (coopératif) et le **Tarot français**. D'autres jeux de cartes viendront
(Président, Belote…) : tout ce qui est commun doit être générique.

Le Hub a déjà un système frère, **« Torche »** (jeu de dés Les Profondeurs :
https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs). Reprends **son format de livrable et sa rigueur**
(tokens, composants, écrans de référence, catalogue d'animations, bundle `window`), ses polices Cinzel et
Alegreya Sans (déjà en woff2), mais crée une identité propre aux cartes.

## 1. Le problème à résoudre

Les écrans actuels sont des panneaux empilés qui défilent : la table n'est pas lisible d'un coup d'œil, les cartes
sont petites, rien n'a l'air d'une vraie table de jeu. Le chat a été supprimé (la voix passe par Discord) : **le jeu
occupe désormais toute la largeur**. Je veux une **vraie table plein écran, pensée pour un PC en 16:9**, belle et
lisible, où l'on comprend en une seconde : à qui c'est le tour, ce qui est posé, ce que je peux faire.

## 2. Cadre de mise en page (priorité PC 16:9)

- Écran de référence : **1920×1080**. Au-dessus du jeu, le Hub garde une barre de salon fine (code du salon,
  « Copier le lien », « Retour au salon », « Quitter ») : dessine-la aussi, **40 px max**, dans le même style.
- Zone de jeu de référence : **~1888×900**. Elle doit **tenir sans aucun défilement** de **1280×560** (portable
  1366×768 dans un navigateur) jusqu'à **2560×1300**. Les tailles de cartes se calculent depuis la hauteur du
  conteneur (container queries, unités `cqh`/`cqw`), pas depuis la fenêtre.
- Mobile secondaire : sous 640 px de large, mise en page verticale (main sur deux rangs ou défilement
  horizontal), comme `.t-screen` dans Torche.
- Zones nommées en `grid-template-areas`, un seul bouton principal par moment, cibles de 44 px min.
- Les panneaux secondaires (journal, feuille de scores, règles) sont **escamotables** : tiroir latéral ou
  fenêtre, jamais empilés sous la table.

## 3. Deux ambiances, un système

Tokens communs + un thème par table via `data-table` :

- **`cour` — La Chute des Rois : « Cour royale de nuit ».** Encre bleu nuit, cartes parchemin, or, filets
  héraldiques ; un château qui domine, un trône au centre. Maquette de départ à reprendre et dépasser :
  https://claude.ai/artifact/D8nx4awbLzBEoZdMHUqfz3
- **`salon` — Tarot : « Salon de tarot ».** Tapis feutré (vert bouteille ou bordeaux, à toi de proposer), cartes
  ivoire, laiton, lumière de lampe au-dessus de la table ; plus calme et plus élégant que la cour.

Règles communes : couleur jamais seule (♥♦ rouges ET symbole ; option « 4 couleurs » pour daltoniens),
contrastes 4,5:1 (texte) et 3:1 (icônes, bordures utiles), focus clavier visible, tutoiement, phrases courtes,
typographie française, **pas d'emoji** (les symboles ♠♥♦♣, couronne, bouclier, épée… sont des glyphes SVG
du système, en `currentColor`).

## 4. Les cartes (tout en HTML/CSS + SVG en ligne, aucune image lourde)

Toutes les cartes sont générées par code : un composant `Tapis.Card({ suit, rank, size, state })`.

- **Jeu de 52** (Chute des Rois) : ♠♥♦♣ × As, 2–10, Valet, Dame, Roi.
- **Jeu de 78** (Tarot) : ♠♥♦♣ × 1–10, Valet, Cavalier, Dame, Roi (56) ; **21 atouts** ; **l'Excuse**.
- **Figures** : portraits stylisés en SVG, **un par figure et par couleur** (Valet, Dame, Roi × 4 = 12, plus
  4 Cavaliers pour le Tarot), partagés entre les deux jeux. Ce sont aussi les **boss** de la Chute des Rois :
  ils doivent impressionner en grand format.
- **Atouts** : fond ivoire distinct, grand chiffre, ruban « Atout », petite vignette ornementale. Le **Petit (1)**,
  le **21** et l'**Excuse** (étoile ★) sont les trois « bouts » : anneau doré bien visible.
- **Index de coin** (rang + couleur) lisible à **14 px minimum même quand les cartes se chevauchent**
  (la main de Tarot en montre 24) : c'est la contrainte n° 1.
- **Dos** : un par thème (cour : blason/château bleu nuit et or ; salon : motif guilloché).
- **Tailles** : `xs` (éventail des adversaires), `sm` (zones posées, pli à 5), `md` (main, pli), `lg` (boss),
  `xl` (révélation : boss qui arrive, Roi appelé).
- **États** : repos, survol (se soulève), sélectionnée (soulevée + halo), jouable, **injouable** (estompée + raison
  au survol), étiquette (« chien »), gagnante du pli (halo or), cachée (emplacement réservé pendant un vol),
  face cachée, focus clavier.

## 5. Composants communs

Siège de joueur (avatar Discord rond ou initiale, nom, état actif / en attente / déconnecté, badges, nombre de
cartes, éventail de dos, bulle de dernière action) · indicateur de tour (halo qui passe d'un siège à l'autre) ·
main (éventail ou chevauchement, tri par couleur avec petits espaces entre groupes, sélection simple et
multiple, clavier : flèches + Entrée) · pioche / défausse / tas de plis avec compteur · barre d'actions
(principal + secondaires, état désactivé avec raison) · bandeau de statut (« À toi de jouer », « Léa encaisse
11 dégâts… ») · bulles d'annonce au-dessus des sièges · notifications (info, succès, erreur ; elles ne doivent
pas masquer la main) · jauges chiffrées (« 17/30 ») · journal escamotable · fenêtre de règles à onglets
(4 onglets par jeu, schémas de cartes dedans) · écran de fin (victoire, défaite, classement) · interrupteur
d'animations · barre du salon du Hub.

## 6. La Chute des Rois — table `cour` (coopératif, 1 à 4 joueurs, inspiré de Regicide)

**Règles utiles au design.** L'équipe doit renverser 12 souverains tirés du **Château** : 4 Valets (20 PV,
attaque 10), puis 4 Dames (30 PV, 15), puis 4 Rois (40 PV, 20). Main de 8/7/6/5 cartes selon 1/2/3/4 joueurs.
À ton tour : joue une carte ou un **combo** (un As + une carte, ou plusieurs cartes de même rang dont le total
fait 10 max), ou passe. Pouvoir de la couleur jouée : **♥ Soin** (N cartes de la défausse repassent sous la
Taverne), **♦ Pioche** (l'équipe pioche N cartes à tour de rôle), **♣ Double** les dégâts, **♠ Bouclier**
(réduit l'attaque du boss de N, cumulatif). Le boss est **immunisé** au pouvoir de sa propre couleur.
Boss à 0 PV pile = **K.O.** : il rejoint la Taverne (on pourra le jouer, valeur 10/15/20) ; au-delà, il part à la
défausse. Sinon le boss **riposte** : le joueur doit défausser des cartes dont le total couvre l'attaque, sinon
défaite. En solo : 2 **Renouveaux** (jeter sa main et repiocher).

**À afficher.** Coéquipiers en haut (0 à 3 sièges, avec les cartes qu'ils ont posées contre ce boss) ;
au centre le **boss en grand** : PV « 17/30 », attaque « 15 − 4 = 11 » avec le bouclier, badge d'immunité
(« Immunisé à ♣ : pouvoir annulé »), progression des 12 souverains (12 pastilles de figures) ; le **Château**
(pile + nombre restant) avec la **légende des 4 pouvoirs sur le tapis** (le pouvoir immunisé barré) ; la
**Taverne** (pioche) et la **Défausse** ; ma zone « Mes cartes posées » ; ma main ; actions **Attaquer**,
**Passer**, **Encaisser**, **Renouveau (2)** en solo.

**Aperçus indispensables** : en sélectionnant des cartes, prévisualiser l'effet avant de valider
(« 7 ♣ + As ♥ : 16 dégâts, soigne 8 ») et signaler un combo invalide ; pendant une riposte, jauge
« 6/11 points défaussés » qui se remplit.

**Écrans de référence (1920×1080, plus 1366×768 et 390 px)** :
1. Partie à 4, mon tour, combo sélectionné avec son aperçu.
2. Riposte : c'est moi qui encaisse.
3. Tour d'un coéquipier (j'attends, je vois ce qu'il fait).
4. Solo (aucun siège en haut : la place se réorganise), avec Renouveau.
5. Boss immunisé et bouclier cumulé.
6. Victoire (12 souverains tombés) · 7. Défaite · 8. Règles.

## 7. Tarot — table `salon` (3 à 5 joueurs, appel au Roi à 5)

**Déroulé.** Donne (24/18/15 cartes à 3/4/5 joueurs, chien de 6/6/3) → **enchères** (Passe, Petite ×1,
Garde ×2, Garde sans le chien ×4, Garde contre le chien ×6 ; seules les enchères supérieures sont jouables)
→ à 5 : **appel au Roi** (le preneur nomme un Roi, ou une Dame s'il a les 4 Rois ; le partenaire reste
**secret** jusqu'à ce que la carte tombe) → **chien** retourné pour tous (Petite, Garde) puis pris en main
par le preneur, qui fait son **écart** (ni Rois ni bouts ; cartes du chien marquées) ; Garde sans : chien face
cachée au preneur ; Garde contre : à la défense → **poignées** (simple/double/triple : 10/13/15 atouts à 4,
8/10/13 à 5, 13/15/18 à 3), annoncées avant la 1re carte et montrées à tous → **plis** (couleur demandée,
obligation de couper et de monter ; l'Excuse ne gagne jamais et revient à son camp) → **décompte**
(bouts 0/1/2/3 → 56/51/41/36 points requis, base 25 + écart, × contrat, Petit au bout, poignées) → une donne
par joueur, puis classement final.

**À afficher.** Table vue de dessus, **moi en bas**, les autres répartis autour (3 : deux en haut ; 4 : gauche,
haut, droite ; 5 : gauche, haut-gauche, haut-droite, droite) ; chaque siège : badges Donneur, Preneur,
Partenaire (une fois révélé), enchère, nombre de plis ; **pli au centre**, chaque carte posée devant son
joueur, avec son nom, la gagnante en évidence, « Pli 7/18 » et « Voir le dernier pli » ; bandeau du contrat
(« Garde de Léa, Roi de ♥ appelé ») ; chien au centre (face cachée, puis retourné) ; ma main de 15 à 24
cartes **sur une seule rangée lisible** à 1920 px ; panneau d'enchères et d'appel au Roi juste au-dessus
de la main ; écart guidé (« Écarte 6 cartes : 2/6 », cartes interdites estompées) ; annonce de poignée ;
note privée « Tu es le partenaire secret » (visible par lui seul) ; feuille de scores escamotable (donne,
contrat réussi ou chuté, gains par joueur, totaux).

**Écrans de référence (1920×1080, plus 1366×768 et 390 px)** :
1. Enchères à 4 (bulles d'enchères au-dessus des sièges).
2. Appel au Roi à 5.
3. Chien retourné, puis écart guidé.
4. Annonce de poignée et poignée montrée.
5. Pli en cours à 5, mon tour, cartes jouables / injouables.
6. Pli complet avec la gagnante · 7. Dernier pli.
8. Résumé de donne (contrat, bouts, points requis/réalisés, base, Petit au bout, poignées, gains de chacun).
9. Fin de partie + feuille de scores · 10. Variante à 3 joueurs · 11. Règles.

## 8. Catalogue d'animations (storyboards + durées + courbes, comme « Mouvement » de Torche)

Communes : **distribution** (paquets qui volent vers chaque siège, puis ma main s'ouvre et se trie) ·
**pose** d'une carte (main → table ; pour un adversaire : depuis son éventail, avec retournement) ·
**pioche** (pile → main, retournement chez moi) · **passage de tour** (halo qui glisse d'un siège à l'autre) ·
**refus** (la carte tremble, raison affichée) · **fins** de partie.

La Chute des Rois : pose et **impact** (chiffre « −14 » qui jaillit, jauge de PV qui se vide, éclat) ·
**♣ Double** (le chiffre se dédouble) · **♠ Bouclier** (le bouclier se forme, l'attaque baisse) ·
**♥ Soin** (cartes de la défausse qui filent sous la Taverne) · **♦ Pioche** (cartes distribuées à tour de rôle) ·
**immunité** (pouvoir barré « Immunisé ») · **riposte** (le boss charge vers le siège visé, alerte
« Encaisse 11 ») · **encaissement** (cartes vers la défausse, jauge qui se remplit) · **K.O.** (tampon
« K.O. » puis la carte vole sur la Taverne) · **mort au-delà de 0** (la carte se déchire en deux, les moitiés
tombent dans la défausse) · **nouveau boss** (retourné depuis le Château, arrivée lourde en `xl`, PV qui se
remplissent) · **victoire** (12 couronnes) · **défaite**.

Tarot : **donne** par paquets de 3 + chien · **bulle d'enchère** · **chien retourné** en éventail puis glissé dans
la main du preneur · **écart** (cartes vers le tas du preneur, face cachée) · **Roi appelé** (apparaît en grand
au centre puis se réduit en badge) · **poignée** (éventail montré puis replié) · **pli** : cartes posées, pli
complet gardé ~1,2 s, gagnante qui s'illumine, ramassage vers le gagnant (son compteur de plis +1) ·
**Excuse** qui revient à son camp · **révélation du partenaire** (badge qui éclot quand le Roi appelé tombe) ·
**Petit au bout** (étincelle) · **résumé de donne** (lignes qui s'écrivent, compteur de points qui défile) ·
**classement final**.

Contraintes : `ease-out` par défaut, gestes de 160 à 700 ms, séquences de 1,5 à 2,5 s max. Chaque animation
doit pouvoir **finir instantanément** (`.finish()`), car le serveur peut envoyer plusieurs états d'affilée.
Interrupteur d'animations + `prefers-reduced-motion` : sans animation, l'état final s'affiche directement et
tout reste lisible.

## 9. Livrable attendu (même format que Torche)

Un artefact **Design System « Tapis »** contenant :

- `tokens.json` + `tokens.css` (communs + thèmes `cour` et `salon`), polices woff2 fournies (l'application
  est auto-hébergée, **aucun service externe** au chargement) ;
- `components/bundle.css` (classes `.tp-*`) et `components/bundle.js` qui expose **`window.Tapis`** :
  composants (`Tapis.Card`, `Tapis.Hand`, `Tapis.Seat`, `Tapis.Pile`, `Tapis.Trick`…), `Tapis.icon(nom)`,
  `Tapis.anim.*` (timelines avec `.done()`, `.seek(t)`, `.finish()`), `Tapis.motion.set()`,
  `Tapis.screens.*` (écrans de référence) et `Tapis.data` (exemples) ;
- les composants **échappent tout texte** (les pseudos viennent de Discord) ou renvoient des nœuds DOM ;
  ils posent des attributs stables pour les animations : `data-card-id`, `data-seat`, `data-pile`,
  `data-slot`, `data-zone` ;
- les pages **README** (principes), **Cartes** (les 52 + 78 cartes, dos, états, tailles), **Écrans** (sections
  6 et 7, aux trois tailles) et **Mouvement** (section 8, avec storyboards image par image) ;
- poids raisonnable : bundle JS + CSS < 300 Ko hors polices, tout en SVG en ligne.
