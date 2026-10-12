import { el } from '/js/dom.js';

/* Règles illustrées du Tarot (fenêtre <dialog> à onglets). */

const C = (suit, rank) => ({ id: `rule-${suit}${rank}`, suit, rank });

export function openRules({ renderCard }) {
  const cards = (list) => el('div', { class: 'trt-r-cards' }, list.map((c) => renderCard(c, { size: 'sm' })));
  const box = (title, ...content) => el('article', { class: 'trt-r-box' }, el('strong', {}, title), ...content);

  const tabs = {
    cards: {
      label: 'Les cartes',
      render: () => [
        el('p', {}, '78 cartes : 4 couleurs de 14 cartes (1 à 10, Valet, Cavalier, Dame, Roi), 21 atouts et l’Excuse.'),
        el('h3', {}, '⭐ Les trois bouts'),
        el('div', { class: 'trt-r-row' }, cards([C('T', 1), C('T', 21), C('E', 0)]),
          el('p', {}, 'Le Petit, le 21 et l’Excuse. Plus le preneur en possède, moins il lui faut de points.')),
        el('h3', {}, '🔢 Valeur des cartes (91 points au total)'),
        el('div', { class: 'trt-r-grid' },
          box('4,5 pts', cards([C('S', 14), C('T', 21)]), el('span', {}, 'Rois et bouts')),
          box('3,5 pts', cards([C('H', 13)]), el('span', {}, 'Dames')),
          box('2,5 pts', cards([C('D', 12)]), el('span', {}, 'Cavaliers')),
          box('1,5 pt', cards([C('C', 11)]), el('span', {}, 'Valets')),
          box('0,5 pt', cards([C('S', 7), C('T', 12)]), el('span', {}, 'Toutes les autres')),
        ),
      ],
    },
    bids: {
      label: 'Enchères & chien',
      render: () => [
        el('p', {}, 'Chacun parle une fois, dans l’ordre, et doit annoncer plus haut que le précédent ou passer. Le plus fort devient le preneur ; tous les autres jouent contre lui.'),
        el('table', { class: 'trt-r-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Contrat'), el('th', {}, 'Coef.'), el('th', {}, 'Le chien'))),
          el('tbody', {},
            [['Petite', '×1', 'Retourné, le preneur le prend et fait son écart'],
              ['Garde', '×2', 'Retourné, le preneur le prend et fait son écart'],
              ['Garde sans', '×4', 'Compte pour le preneur, sans être vu'],
              ['Garde contre', '×6', 'Compte pour la défense, sans être vu']].map((r) => el('tr', {}, r.map((c) => el('td', {}, c)))))),
        el('h3', {}, '🗑️ L’écart'),
        el('p', {}, 'Le preneur remet face cachée autant de cartes qu’il en a pris. Interdit : Rois et bouts. Les atouts seulement s’il n’a pas assez d’autres cartes (ils sont alors montrés).'),
        el('h3', {}, '👑 À 5 joueurs : l’appel au Roi'),
        el('p', {}, 'Le preneur appelle un Roi. Celui qui l’a devient son partenaire secret, révélé quand la carte est jouée. Si le Roi est chez le preneur ou au chien, il joue seul contre 4.'),
        el('p', { class: 'muted' }, 'Si personne ne prend, on redistribue. Un joueur qui a le Petit comme seul atout (« Petit sec ») provoque une nouvelle donne.'),
      ],
    },
    play: {
      label: 'Le jeu',
      render: () => [
        el('div', { class: 'trt-r-grid' },
          box('1. Fournir', el('p', {}, 'Jouez la couleur demandée si vous en avez.')),
          box('2. Couper', el('p', {}, 'Sinon, vous devez jouer un atout…')),
          box('3. Monter', el('p', {}, '…plus fort que ceux déjà posés si vous le pouvez.')),
          box('4. Défausser', el('p', {}, 'Ni la couleur ni atout : jouez ce que vous voulez.')),
        ),
        el('p', {}, 'À l’atout demandé : montez si possible, sinon un atout quelconque. Le pli va au plus fort atout, sinon à la plus forte carte de la couleur demandée.'),
        el('h3', {}, '★ L’Excuse'),
        el('div', { class: 'trt-r-row' }, cards([C('E', 0)]),
          el('p', {}, 'Elle se joue à tout moment et ne remporte jamais le pli. Son camp la garde (en échange d’une demi-carte de 0,5 pt), sauf jouée au dernier pli où elle est perdue. Si elle ouvre le pli, la carte suivante donne la couleur.')),
        el('p', { class: 'muted' }, 'Dans le jeu, seules les cartes autorisées sont cliquables.'),
      ],
    },
    score: {
      label: 'Le décompte',
      render: () => [
        el('table', { class: 'trt-r-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Bouts du preneur'), el('th', {}, '0'), el('th', {}, '1'), el('th', {}, '2'), el('th', {}, '3'))),
          el('tbody', {}, el('tr', {}, el('td', {}, 'Points à faire'), ['56', '51', '41', '36'].map((v) => el('td', {}, v))))),
        el('p', {}, 'Score = (25 + écart de points) × coefficient du contrat, gagné par le preneur s’il réussit, perdu sinon. Chaque défenseur paie ou reçoit ce montant ; le preneur le multiplie par le nombre de défenseurs (à 5, le partenaire touche une part, le preneur deux).'),
        el('div', { class: 'trt-r-grid' },
          box('🐣 Petit au bout', el('p', {}, 'Le camp qui remporte le dernier pli avec le Petit dedans gagne 10 × coefficient.')),
          box('✋ Poignée', el('p', {}, 'Avant votre 1re carte, montrez beaucoup d’atouts : simple +20, double +30, triple +40, au camp gagnant. À 4 : 10/13/15 atouts ; à 5 : 8/10/13 ; à 3 : 13/15/18.')),
        ),
        el('p', { class: 'muted' }, 'Une partie = une donne par joueur. Le meilleur total gagne.'),
      ],
    },
  };

  const dialog = el('dialog', { class: 'trt-rules-dialog', 'aria-labelledby': 'trt-rules-title' });
  const body = el('div', { class: 'trt-r-body' });
  const buttons = Object.entries(tabs).map(([key, tab]) =>
    el('button', { class: 'trt-r-tab', role: 'tab', type: 'button', dataset: { tab: key }, onclick: () => show(key) }, tab.label));
  function show(key) {
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.tab === key));
    body.replaceChildren(...tabs[key].render());
    body.scrollTop = 0;
  }
  dialog.append(
    el('header', { class: 'trt-r-head' },
      el('h2', { id: 'trt-rules-title' }, '📖 Règles du Tarot'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': 'Fermer', onclick: () => dialog.close() }, '✕')),
    el('nav', { class: 'trt-r-tabs', role: 'tablist' }, buttons),
    body,
    el('footer', { class: 'trt-r-foot' }, el('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'Compris !')),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  document.body.append(dialog);
  show('cards');
  dialog.showModal();
}
