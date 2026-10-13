/* =====================================================================
 * Règles illustrées du Tarot, en fenêtre Tapis (T.Dialog à onglets).
 * Reprend toutes les règles appliquées par le moteur (games/tarot/server/Tarot.js),
 * y compris les poignées à 3, 4 et 5 joueurs, le Petit sec et l'Excuse.
 * ===================================================================== */

const card = (suit, rank, extra = {}) => ({ suit, rank, ...extra });

export function rulesDialog(T, { tab = 'cartes' } = {}) {
  const cards = (list, size = 'sm') => `<div class="tp-rules__cards">${list.map((c) => T.Card({ size, ...c })).join('')}</div>`;
  const p = (...lines) => lines.map((l) => `<p class="body">${T.rich(l)}</p>`).join('');
  const h = (title) => `<h3 class="title-sm trt-rules__h">${T.rich(title)}</h3>`;
  const grid = (text, side) => `<div class="tp-rules__g"><div>${text}</div>${side ? `<div>${side}</div>` : ''}</div>`;
  const table = (head, rows) => `<table class="tp-ss trt-rt"><thead><tr>${head.map((x) => `<th scope="col">${T.rich(x)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${T.rich(x)}</td>` : `<th scope="row">${T.rich(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
  const boxes = (list) => `<div class="trt-rules__boxes">${list.map(([title, text, side]) =>
    `<article class="trt-rules__box"><b class="body-strong">${T.rich(title)}</b>${side ?? ''}<span class="caption">${T.rich(text)}</span></article>`).join('')}</div>`;

  const tabs = [
    {
      id: 'cartes',
      label: 'Cartes',
      body: grid(
        p('78 cartes : 4 couleurs de 14 cartes (1 à 10, Valet, Cavalier, Dame, Roi), 21 atouts et l’Excuse.',
          'Les trois bouts sont le Petit (1 d’atout), le 21 et l’Excuse. Plus le preneur en gagne, moins il lui faut de points.'),
        cards([card('atout', 1), card('atout', 21), card('excuse')]),
      ) + h('Valeur des cartes (91 points au total)') + boxes([
        ['4,5 points', 'Rois et bouts', cards([card('pique', 'R'), card('atout', 21)])],
        ['3,5 points', 'Dames', cards([card('coeur', 'D')])],
        ['2,5 points', 'Cavaliers', cards([card('carreau', 'C')])],
        ['1,5 point', 'Valets', cards([card('trefle', 'V')])],
        ['0,5 point', 'Toutes les autres cartes', cards([card('pique', 7), card('atout', 12)])],
      ]),
    },
    {
      id: 'encheres',
      label: 'Enchères',
      body: p('Chacun parle une fois, dans l’ordre : il annonce plus haut que le précédent ou il passe. Le plus fort devient le preneur ; tous les autres défendent ensemble contre lui.')
        + table(['Contrat', 'Coefficient', 'Le chien'], [
          ['Petite', '×1', 'Retourné : le preneur le prend et fait son écart'],
          ['Garde', '×2', 'Retourné : le preneur le prend et fait son écart'],
          ['Garde sans le chien', '×4', 'Compte pour le preneur, sans être vu'],
          ['Garde contre le chien', '×6', 'Compte pour la défense, sans être vu'],
        ])
        + h('L’écart')
        + grid(p('Le preneur remet face cachée autant de cartes qu’il en a pris. Interdit : les Rois et les bouts.',
          'Les atouts seulement si tu n’as pas assez d’autres cartes : ils sont alors montrés à tous.'),
        cards([card('carreau', 3, { tag: 'Chien' }), card('atout', 9, { tag: 'Chien' })]))
        + h('À 5 joueurs : l’appel au Roi')
        + grid(p('Le preneur appelle un Roi. Celui qui l’a devient son partenaire secret, révélé quand la carte est jouée.',
          'Si le Roi est dans la main du preneur ou au chien, il joue seul contre 4. S’il a les 4 Rois, il appelle une Dame.'),
        cards([card('coeur', 'R'), card('pique', 'R')]))
        + p('Si tout le monde passe, on redistribue. Un joueur qui n’a que le Petit comme atout, sans l’Excuse (« Petit sec »), provoque aussi une nouvelle donne.'),
    },
    {
      id: 'jeu',
      label: 'Jeu',
      body: boxes([
        ['1. Fournir', 'Joue la couleur demandée si tu en as.'],
        ['2. Couper', 'Sinon, tu dois jouer un atout…'],
        ['3. Monter', '…plus fort que ceux déjà posés, si tu le peux.'],
        ['4. Défausser', 'Ni la couleur ni atout : joue ce que tu veux.'],
      ])
        + p('À l’atout demandé : monte si possible, sinon joue un atout quelconque. Le pli va au plus fort atout, sinon à la plus forte carte de la couleur demandée.')
        + h('L’Excuse')
        + grid(p('Elle se joue à tout moment et ne remporte jamais le pli. Son camp la garde, en échange d’une demi-carte (0,5 point), sauf au dernier pli où elle est perdue.',
          'Si elle ouvre le pli, la carte suivante donne la couleur.'), cards([card('excuse')]))
        + p('Pendant ton tour, les cartes que tu ne peux pas jouer sont estompées : survole-les pour savoir pourquoi.'),
    },
    {
      id: 'decompte',
      label: 'Décompte',
      body: table(['Bouts du preneur', '0', '1', '2', '3'], [['Points à faire', '56', '51', '41', '36']])
        + p('Score de la donne = (25 + l’écart de points) × le coefficient du contrat, gagné par le preneur s’il réussit, perdu sinon.',
          'Chaque défenseur paie ou reçoit ce montant ; le preneur le multiplie par le nombre de défenseurs. À 5, le partenaire touche une part, le preneur deux.')
        + boxes([
          ['Petit au bout', 'Le camp qui remporte le dernier pli avec le Petit dedans gagne 10 × le coefficient.', cards([card('atout', 1)])],
          ['Poignée', 'Avant ta première carte, montre beaucoup d’atouts (l’Excuse compte) : simple +20, double +30, triple +40, au camp qui gagne la donne.'],
        ])
        + table(['Poignée', 'À 3 joueurs', 'À 4 joueurs', 'À 5 joueurs'], [
          ['Simple (+20)', '13 atouts', '10 atouts', '8 atouts'],
          ['Double (+30)', '15 atouts', '13 atouts', '10 atouts'],
          ['Triple (+40)', '18 atouts', '15 atouts', '13 atouts'],
        ])
        + p('Une partie = une donne par joueur, chacun distribue une fois. Le meilleur total gagne.'),
    },
  ];
  return T.Dialog({ id: 'regles', kicker: 'Tarot', title: 'Règles', size: 'lg', tabs, tab });
}
