/* =====================================================================
 * Règles illustrées du poker (Texas Hold'em No Limit, tournoi), en fenêtre
 * Tapis (T.Dialog à onglets). Elles reprennent exactement ce que le moteur
 * applique (games/poker/server/Poker.js).
 * ===================================================================== */

const C = (spec) => spec.split(' ').map((x) => {
  const suit = { s: 'pique', h: 'coeur', d: 'carreau', c: 'trefle' }[x.slice(-1)];
  const r = x.slice(0, -1);
  return { suit, rank: /^\d+$/.test(r) ? Number(r) : r };
});

/** Classement des combinaisons, de la plus forte à la plus faible (exemples). */
const HANDS = [
  ['Quinte flush royale', 'Quinte flush à l’As', '10s Vs Ds Rs As'],
  ['Quinte flush', 'Cinq cartes à la suite de la même couleur', '5h 6h 7h 8h 9h'],
  ['Carré', 'Quatre cartes de même rang', '7s 7h 7d 7c Rs'],
  ['Full', 'Un brelan et une paire : « Full aux Dames par les 8 »', 'Ds Dh Dd 8c 8s'],
  ['Couleur', 'Cinq cartes de la même couleur', 'Ad Vd 9d 6d 3d'],
  ['Quinte', 'Cinq cartes à la suite (A-2-3-4-5 compte, au 5)', '5c 6d 7h 8s 9c'],
  ['Brelan', 'Trois cartes de même rang', 'Vc Vd Vs 4h 2s'],
  ['Double paire', 'Deux paires', 'Rh Rc 8d 8s Ac'],
  ['Paire', 'Deux cartes de même rang', 'As Ad Rc 9h 4d'],
  ['Carte haute', 'Rien de tout ça : la plus haute carte', 'Ac Dd 9s 6h 3c'],
];

export function rulesDialog(T, { tab = 'tournoi' } = {}) {
  const cards = (spec, size = 'sm', extra = {}) => `<div class="tp-rules__cards pk-rules__cards">${C(spec).map((c) => T.Card({ size, ...c, ...extra })).join('')}</div>`;
  const p = (...lines) => lines.map((l) => `<p class="body">${T.rich(l)}</p>`).join('');
  const h = (title) => `<h3 class="title-sm pk-rules__h">${T.rich(title)}</h3>`;
  const grid = (text, side) => `<div class="tp-rules__g"><div>${text}</div>${side ? `<div>${side}</div>` : ''}</div>`;
  const boxes = (list) => `<div class="pk-rules__boxes">${list.map(([title, text]) =>
    `<article class="pk-rules__box"><b class="body-strong">${T.rich(title)}</b><span class="caption">${T.rich(text)}</span></article>`).join('')}</div>`;
  const table = (head, rows) => `<table class="tp-ss pk-rules__t"><thead><tr>${head.map((x) => `<th scope="col">${T.rich(x)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${T.rich(x)}</td>` : `<th scope="row">${T.rich(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;

  const tabs = [
    {
      id: 'tournoi',
      label: 'Tournoi',
      body: grid(
        p('Texas Hold’em No Limit, en tournoi : chacun part avec le même tapis de jetons. Le dernier joueur qui a encore des jetons gagne.',
          'Un joueur qui n’a plus de jetons quitte la table. À chaque main, le bouton du donneur (D) passe au joueur suivant encore en jeu.'),
        `<span class="pk-rules__d" aria-hidden="true">D</span>`,
      )
        + h('Les blindes montent')
        + p('Toutes les 5, 10 ou 15 mains selon le réglage du salon, sans ante :')
        + table(['Niveau', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'], [
          ['Blindes', '10/20', '15/30', '25/50', '50/100', '75/150', '100/200', '150/300', '200/400', '300/600', '500/1000', '1000/2000'],
        ])
        + p('Ensuite, elles doublent à chaque niveau.')
        + h('Entre deux mains')
        + p('Le résultat reste affiché ; n’importe quel joueur encore en jeu lance la main suivante. Les joueurs éliminés dans la même main sont classés selon leur tapis au début de cette main.'),
    },
    {
      id: 'main',
      label: 'Une main',
      body: boxes([
        ['1. Les blindes', 'Les deux joueurs à gauche du bouton paient la petite (PB) et la grosse blinde (GB). À deux, le bouton paie la petite.'],
        ['2. Préflop', 'Chacun reçoit 2 cartes cachées. La parole part de la gauche de la grosse blinde (à deux : du bouton).'],
        ['3. Flop, turn, river', '3 cartes communes, puis 1, puis 1, chaque fois suivies d’un tour de mises. La parole part de la gauche du bouton.'],
        ['4. Abattage', 'Les mains encore en jeu se montrent. La meilleure combinaison de 5 cartes, parmi tes 2 cartes et les 5 du tableau, gagne.'],
      ])
        + grid(p('Ici, la main de gauche (Paire de Dames) bat celle de droite (Paire de 10) : le tableau sert aux deux.'),
          `<div class="pk-rules__ex">${cards('Dh 4c')}<span class="caption">contre</span>${cards('10s 9s')}</div>`)
        + cards('Ds 10h 7c 3d 2s', 'sm')
        + p('Si tous les autres se couchent, le dernier joueur gagne le pot sans montrer ses cartes.',
          'Quand plus personne ne peut miser (tapis), les mains en jeu sont retournées et le tableau sort jusqu’à la river.'),
    },
    {
      id: 'mises',
      label: 'Mises',
      body: table(['Action', 'Ce qu’elle fait'], [
        ['Se coucher', 'Tu abandonnes la main et ce que tu y as déjà misé.'],
        ['Parole', 'Tu passes sans miser, si personne n’a misé avant toi.'],
        ['Suivre', 'Tu mets autant que la plus grosse mise du tour.'],
        ['Miser · relancer à', 'Tu fixes le total de ta mise sur ce tour. Mise minimum : la grosse blinde. Relance minimum : la taille de la dernière relance.'],
        ['Tapis', 'Tu mises tous tes jetons, même pour moins que le minimum.'],
      ])
        + boxes([
          ['No Limit', 'Tu peux miser tout ton tapis à tout moment. Les tailles rapides (½ pot, ¾ pot, Pot) calculent le montant pour toi.'],
          ['Tapis trop court', 'Un tapis plus petit qu’une relance complète ne rouvre pas les relances : ceux qui ont déjà parlé peuvent seulement suivre ou se coucher.'],
          ['Pots annexes', 'Un joueur à tapis ne gagne que ce qu’il a pu couvrir chez chacun ; le reste forme un pot annexe entre les autres.'],
          ['Mise non suivie', 'La part d’une mise que personne ne suit revient à son auteur.'],
          ['Égalité', 'Le pot est partagé. Le jeton qui ne se divise pas va au premier gagnant à gauche du bouton.'],
          ['Blinde à tapis', 'Un joueur qui n’a pas de quoi payer sa blinde est à tapis ; les autres suivent quand même la grosse blinde entière.'],
        ]),
    },
    {
      id: 'combinaisons',
      label: 'Combinaisons',
      body: `<ol class="pk-rules__hands">${HANDS.map(([name, text, spec], i) => `<li><span class="pk-rules__rank stat">${i + 1}</span><span class="pk-rules__hn"><b class="body-strong">${
        T.esc(name)}</b><span class="caption">${T.rich(text)}</span></span>${cards(spec, 'xs')}</li>`).join('')}</ol>`
        + p('À combinaison égale, la plus haute gagne (paire de Rois contre paire de 8), puis les cartes restantes une à une : c’est le kicker. Les couleurs ne se départagent pas entre elles : à égalité parfaite, on partage.'),
    },
  ];
  return T.Dialog({ id: 'regles', kicker: 'Poker Texas Hold’em', title: 'Règles', size: 'lg', tabs, tab });
}
