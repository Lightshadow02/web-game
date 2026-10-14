import { fmt } from './cards.js';

/* =====================================================================
 * Règles illustrées du Blackjack, en fenêtre Tapis (T.Dialog à onglets).
 * Reprend exactement les règles du moteur (games/blackjack/server/Blackjack.js) :
 * sabot de 6 jeux et carte de coupe, mises, banque sur tous les 17, vérification
 * du blackjack, assurance, doubler, séparer, paiements et arrondi du 3 pour 2.
 * ===================================================================== */

const card = (suit, rank, extra = {}) => ({ suit, rank, ...extra });

export function rulesDialog(T, { tab = 'but', startChips = 1000, totalRounds = 10 } = {}) {
  const cards = (list, size = 'sm') => `<div class="tp-rules__cards">${list.map((c) => T.Card({ size, ...c })).join('')}</div>`;
  const p = (...lines) => lines.map((l) => `<p class="body">${T.rich(l)}</p>`).join('');
  const h = (title) => `<h3 class="title-sm bj-rules__h">${T.rich(title)}</h3>`;
  const grid = (text, side) => `<div class="tp-rules__g"><div>${text}</div>${side ? `<div>${side}</div>` : ''}</div>`;
  const table = (head, rows) => `<table class="tp-ss bj-rt"><thead><tr>${head.map((x) => `<th scope="col">${T.rich(x)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${T.rich(x)}</td>` : `<th scope="row">${T.rich(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
  const boxes = (list) => `<div class="bj-rules__boxes">${list.map(([title, text, side]) =>
    `<article class="bj-rules__box"><b class="body-strong">${T.rich(title)}</b>${side ?? ''}<span class="caption">${T.rich(text)}</span></article>`).join('')}</div>`;

  const tabs = [
    {
      id: 'but',
      label: 'But',
      body: grid(
        p('Chacun joue contre la banque, pas contre les autres joueurs. Approche-toi de 21 sans le dépasser, et fais mieux que la banque.',
          `Tout le monde commence avec ${fmt(startChips)} jetons. La partie dure ${totalRounds} donnes, ou s’arrête quand plus personne n’a de jetons : le plus riche gagne.`),
        cards([card('pique', 'A'), card('coeur', 'R')]),
      ) + h('Valeur des cartes') + boxes([
        ['2 à 10', 'Leur chiffre', cards([card('trefle', 7), card('carreau', 4)])],
        ['Figures : 10', 'Valet, Dame et Roi', cards([card('coeur', 'V'), card('pique', 'D')])],
        ['As : 1 ou 11', 'Le plus utile pour ta main', cards([card('carreau', 'A')])],
      ]) + p('Une main dont l’As compte 11 est « souple » : elle s’affiche 7 / 17, et une carte de plus ne peut pas la faire sauter.',
        'Blackjack : un As et une carte de valeur 10 en deux cartes. C’est la meilleure main du jeu.'),
    },
    {
      id: 'mises',
      label: 'Mises',
      body: p('La banque distribue depuis un sabot de 6 jeux (312 cartes). Une carte de coupe est glissée aux trois quarts : quand elle sort, le sabot est remélangé avant la donne suivante.')
        + h('Faites vos jeux')
        + grid(p('Tout le monde mise en même temps, avec les jetons de 10, 25, 100 et 500 : au moins 10, au plus tout ce que tu as. S’il te reste moins de 10 jetons, tu peux les miser tous.',
          '« Je passe » : tu sautes la donne sans rien risquer. Tant que les cartes ne sont pas distribuées, tu peux encore changer d’avis.'),
        `<div class="bj-rules__chips">${[10, 25, 100, 500].map((d) => `<span class="bj-chip bj-chip--btn" data-v="${d}" aria-hidden="true"><span class="bj-chip__v">${fmt(d)}</span></span>`).join('')}</div>`)
        + h('La donne')
        + grid(p('Chaque joueur reçoit deux cartes visibles. La banque en a une visible et une cachée, qu’elle ne retourne qu’à la fin.',
          'Quand tu n’as plus de jetons, tu regardes la partie jusqu’au bout.'),
        cards([card('trefle', 'R'), { suit: 'pique', rank: 'A', faceDown: true }])),
    },
    {
      id: 'jouer',
      label: 'Jouer',
      body: p('On joue chacun son tour, de gauche à droite, main par main.')
        + boxes([
          ['Tirer', 'Prends une carte. Au-delà de 21, tu sautes et perds ta mise.'],
          ['Rester', 'Garde ta main. Un 21 reste tout seul.'],
          ['Doubler', 'Sur tes deux premières cartes : ta mise double et tu reçois une seule carte. Permis aussi après une séparation.'],
          ['Séparer', 'Deux cartes de même valeur (un Roi et un 10 aussi) : chacune devient une main, avec une mise égale. Jusqu’à 4 mains.'],
        ])
        + h('As séparés')
        + grid(p('Deux As séparés reçoivent une seule carte chacun et ne se séparent plus. Un 21 obtenu après une séparation compte comme 21, pas comme un blackjack.',
          'Il n’y a pas d’abandon : une main se joue jusqu’au bout.'),
        cards([card('coeur', 'A'), card('trefle', 'A')]))
        + p('Au clavier, pendant ton tour : T pour tirer, R pour rester, D pour doubler, S pour séparer.'),
    },
    {
      id: 'banque',
      label: 'Banque',
      body: grid(
        p('La banque joue après tout le monde : elle retourne sa carte cachée, tire jusqu’à 16 et reste sur tous les 17, même un 17 souple (As + 6).',
          'Si toutes les mains ont sauté ou fait blackjack, elle se contente de retourner sa carte.'),
        cards([card('carreau', 'A'), card('pique', 6)]),
      ) + h('Vérification du blackjack')
        + p('Quand sa carte visible est un As ou une carte de valeur 10, la banque regarde tout de suite sa carte cachée. Si elle a un blackjack, la donne s’arrête : toutes les mises sont perdues, sauf les blackjacks des joueurs (égalité).')
        + h('Assurance')
        + grid(p('Quand la banque montre un As, l’assurance est proposée avant qu’elle regarde : au plus la moitié de ta mise. Elle est payée 2 pour 1 si la banque a un blackjack, perdue sinon.',
          'Avec un blackjack en main, t’assurer de la moitié de ta mise te garantit un gain égal à ta mise (un jeton de moins si elle est impaire), que la banque ait un blackjack ou non.'),
        cards([card('coeur', 'A'), { suit: 'pique', rank: 'R', faceDown: true }])),
    },
    {
      id: 'gains',
      label: 'Gains',
      body: p('Ta main gagne si elle bat la banque, ou si la banque saute alors que ta main tient encore.')
        + table(['Résultat', 'Paiement', 'Exemple pour 20 misés'], [
          ['Blackjack', '3 pour 2', '+30'],
          ['Main gagnante', '1 pour 1', '+20'],
          ['Égalité', 'Mise rendue', '±0'],
          ['Main perdue ou sautée', 'Mise perdue', '−20'],
          ['Assurance (blackjack de la banque)', '2 pour 1', '10 assurés : +20'],
        ])
        + p('Le 3 pour 2 est arrondi à l’unité inférieure : une mise de 25 rapporte 37. Chaque main séparée ou doublée est payée selon sa propre mise.'),
    },
  ];
  return T.Dialog({ id: 'regles', kicker: 'Blackjack', title: 'Règles', size: 'lg', tabs, tab });
}
