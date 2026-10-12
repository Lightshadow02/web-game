import { el } from '/js/dom.js';

/* =====================================================================
 * Règles illustrées de "La Chute des Rois" (fenêtre <dialog> à onglets).
 * ===================================================================== */

const card = (rank, suit) => ({ id: `rule-${rank}${suit}`, rank, suit });

export const POWERS = [
  {
    suit: 'H', name: 'Cœur', title: 'Soin', short: 'Recycle la défausse',
    text: 'Mélange la défausse et remet N cartes sous la pioche. Votre réserve de cartes ne s’épuise pas.',
    example: [card(7, 'H')], result: '7 cartes de la défausse retournent dans la pioche.',
  },
  {
    suit: 'D', name: 'Carreau', title: 'Pioche', short: 'L’équipe pioche',
    text: 'L’équipe pioche N cartes, une chacun à tour de rôle en commençant par vous. Une main pleine est sautée.',
    example: [card(4, 'D')], result: '4 cartes sont distribuées autour de la table.',
  },
  {
    suit: 'C', name: 'Trèfle', title: 'Fureur', short: 'Dégâts ×2',
    text: 'Les dégâts infligés au boss sont doublés.',
    example: [card(8, 'C')], result: '16 dégâts au lieu de 8.',
  },
  {
    suit: 'S', name: 'Pique', title: 'Bouclier', short: 'Affaiblit la riposte',
    text: 'L’attaque du boss baisse de N jusqu’à sa chute. Les boucliers s’additionnent.',
    example: [card(6, 'S')], result: 'La riposte du boss perd 6 points, pour tout le combat.',
  },
];

export function openRules({ renderCard, SUITS, startTab = 'base' }) {
  const mini = (cards) => el('div', { class: 'cdr-r-cards' }, cards.map((c) => renderCard(c, { size: 'sm' })));
  const suitTag = (s) => el('span', { class: `cdr-r-suit ${SUITS[s].red ? 'red' : ''}` }, SUITS[s].symbol);

  const tabs = {
    base: {
      label: 'L’essentiel',
      render: () => [
        el('section', { class: 'cdr-r-hero' },
          el('h3', {}, '🎯 Le but'),
          el('p', {}, 'Vous formez ', el('strong', {}, 'une seule équipe'), '. Ensemble, renversez les ',
            el('strong', {}, '12 souverains'), ' du château : 4 Valets, puis 4 Dames, puis 4 Rois.'),
          el('p', { class: 'cdr-r-warn' }, '⚠️ Si un joueur ne peut plus encaisser une riposte, toute l’équipe perd.'),
        ),
        el('div', { class: 'cdr-r-bosses' },
          [[11, 'Valet', 20, 10], [12, 'Dame', 30, 15], [13, 'Roi', 40, 20]].map(([rank, name, hp, atk]) =>
            el('div', { class: 'cdr-r-boss' },
              renderCard(card(rank, rank === 12 ? 'H' : 'S'), { size: 'sm' }),
              el('div', {}, el('strong', {}, name), el('span', {}, `❤ ${hp} PV`), el('span', {}, `⚔ ${atk} d’attaque`)),
            )),
        ),
        el('h3', {}, '🔁 Un tour de jeu'),
        el('ol', { class: 'cdr-r-steps' },
          step('1', 'Jouez', 'Posez une carte (ou un combo). Sa valeur est votre attaque. Vous pouvez aussi passer.'),
          step('2', 'Pouvoir', 'La couleur jouée déclenche son effet : soin, pioche, dégâts doublés ou bouclier.'),
          step('3', 'Dégâts', 'Le boss perd autant de PV. À 0, il tombe et vous rejouez aussitôt contre le suivant.'),
          step('4', 'Riposte', 'Sinon il frappe : défaussez des cartes dont le total couvre son attaque.'),
        ),
      ],
    },
    powers: {
      label: 'Les pouvoirs',
      render: () => [
        el('p', { class: 'cdr-r-lead' }, 'N = la valeur de la carte jouée. Le pouvoir s’applique en plus des dégâts.'),
        el('div', { class: 'cdr-r-powers' },
          POWERS.map((p) =>
            el('article', { class: `cdr-r-power suit-${p.suit}` },
              el('header', {}, suitTag(p.suit), el('div', {}, el('strong', {}, p.title), el('span', {}, p.name))),
              el('p', {}, p.text),
              el('div', { class: 'cdr-r-example' }, mini(p.example), el('span', {}, '→ ', p.result)),
            )),
        ),
        el('section', { class: 'cdr-r-note' },
          el('h3', {}, '🛡️ L’immunité'),
          el('p', {}, 'Chaque boss ignore le pouvoir de ', el('strong', {}, 'sa propre couleur'), '. Les dégâts, eux, comptent toujours.'),
          el('div', { class: 'cdr-r-example' },
            renderCard(card(12, 'H'), { size: 'sm' }), el('span', { class: 'cdr-r-vs' }, 'contre'), mini([card(7, 'H')]),
            el('span', {}, '→ 7 dégâts, mais aucun soin.')),
        ),
      ],
    },
    combos: {
      label: 'Combos & valeurs',
      render: () => [
        el('h3', {}, '🃏 Valeur des cartes'),
        el('div', { class: 'cdr-r-values' },
          [[1, 'H', '1'], [5, 'S', '5'], [10, 'D', '10'], [11, 'C', '10'], [12, 'H', '15'], [13, 'S', '20']].map(([r, s, v]) =>
            el('div', { class: 'cdr-r-value' }, renderCard(card(r, s), { size: 'sm' }), el('strong', {}, v))),
        ),
        el('p', { class: 'cdr-r-lead' }, 'Les Valets, Dames et Rois n’arrivent dans votre main que si vous les avez recrutés (voir Astuces).'),
        el('h3', {}, '⚡ Combos autorisés'),
        el('div', { class: 'cdr-r-combos' },
          combo('L’As compagnon', 'Un As accompagne n’importe quelle carte. Les deux pouvoirs s’appliquent sur le total.',
            [card(1, 'H'), card(7, 'C')], 'Attaque 8 : 8 cartes soignées, et 16 dégâts grâce au ♣.'),
          combo('Les cartes jumelles', 'Plusieurs cartes de même valeur, si leur total ne dépasse pas 10.',
            [card(3, 'S'), card(3, 'D'), card(3, 'C')], 'Attaque 9 : bouclier 9, 9 cartes piochées, 18 dégâts.'),
        ),
        el('p', { class: 'cdr-r-warn' }, '✖ Interdit : 6 + 6 (total 12), ou 2 + 5 (valeurs différentes, sans As).'),
      ],
    },
    tips: {
      label: 'Astuces',
      render: () => [
        el('div', { class: 'cdr-r-tips' },
          tip('👑', 'Victoire « pile »', 'Si le boss tombe à exactement 0 PV, il rejoint votre camp : il est posé sur la pioche et vaudra 10, 15 ou 20 en main.'),
          tip('⏭️', 'Passer son tour', 'Vous pouvez passer sans jouer, mais vous subissez quand même la riposte. Impossible si tous les autres viennent de passer.'),
          tip('🛡️', 'Encaisser malin', 'Pour la riposte, toutes les cartes comptent pour leur valeur. Gardez vos ♠ et ♣ pour attaquer, défaussez le reste.'),
          tip('♥', 'Le soin d’abord', 'Dans un combo ♥ + ♦, le soin est résolu avant la pioche : vous piochez dans une réserve remplie.'),
          tip('👥', 'Taille de main', '1 joueur : 8 cartes · 2 joueurs : 7 · 3 joueurs : 6 · 4 joueurs : 5.'),
          tip('♻️', 'En solo', 'Deux « Renouveaux » : défaussez toute votre main et repiochez une main complète, à tout moment de votre tour.'),
        ),
      ],
    },
  };

  const dialog = el('dialog', { class: 'cdr-rules-dialog', 'aria-labelledby': 'cdr-rules-title' });
  const body = el('div', { class: 'cdr-r-body' });
  const tabButtons = Object.entries(tabs).map(([key, tab]) =>
    el('button', { class: 'cdr-r-tab', role: 'tab', type: 'button', dataset: { tab: key }, onclick: () => show(key) }, tab.label));

  function show(key) {
    for (const b of tabButtons) b.setAttribute('aria-selected', String(b.dataset.tab === key));
    body.replaceChildren(...tabs[key].render());
    body.scrollTop = 0;
  }

  dialog.append(
    el('header', { class: 'cdr-r-head' },
      el('h2', { id: 'cdr-rules-title' }, '📖 La Chute des Rois'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': 'Fermer', onclick: () => dialog.close() }, '✕'),
    ),
    el('nav', { class: 'cdr-r-tabs', role: 'tablist' }, tabButtons),
    body,
    el('footer', { class: 'cdr-r-foot' },
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => dialog.close() }, 'C’est parti !')),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close()); // clic sur le fond
  document.body.append(dialog);
  show(startTab);
  dialog.showModal();
  return dialog;

  function step(n, title, text) {
    return el('li', { class: 'cdr-r-step' }, el('span', { class: 'cdr-r-num' }, n), el('div', {}, el('strong', {}, title), el('p', {}, text)));
  }
  function combo(title, text, cards, result) {
    return el('article', { class: 'cdr-r-combo' }, el('strong', {}, title), el('p', {}, text),
      el('div', { class: 'cdr-r-example' }, mini(cards), el('span', {}, '→ ', result)));
  }
  function tip(icon, title, text) {
    return el('article', { class: 'cdr-r-tip' }, el('span', { class: 'cdr-r-icon', 'aria-hidden': 'true' }, icon),
      el('div', {}, el('strong', {}, title), el('p', {}, text)));
  }
}
