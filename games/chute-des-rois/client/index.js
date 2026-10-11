import { el } from '/js/dom.js';

/* =====================================================================
 * Interface de "La Chute des Rois".
 * Module monté par le Hub dans #game-root : mount(root, ctx) -> { update, unmount }.
 * Toute la logique est côté serveur ; ce module ne fait qu'afficher l'état
 * reçu et envoyer des actions ('play', 'yield', 'defend', 'renew').
 * ===================================================================== */

const SUITS = {
  H: { symbol: '♥\uFE0E', name: 'Cœur', red: true, power: 'Soin : remet N cartes de la défausse sous la pioche.' },
  D: { symbol: '♦\uFE0E', name: 'Carreau', red: true, power: 'Pioche : les joueurs piochent N cartes à tour de rôle.' },
  C: { symbol: '♣\uFE0E', name: 'Trèfle', red: false, power: 'Double les dégâts infligés au boss.' },
  S: { symbol: '♠\uFE0E', name: 'Pique', red: false, power: 'Bouclier : réduit de N l’attaque du boss (cumulatif).' },
};
const RANK_LABEL = { 1: 'A', 11: 'V', 12: 'D', 13: 'R' };
const BOSS_TITLE = { 11: 'Valet', 12: 'Dame', 13: 'Roi' };

const rankLabel = (rank) => RANK_LABEL[rank] ?? String(rank);
const cardValue = (card) => (card.rank <= 10 ? card.rank : { 11: 10, 12: 15, 13: 20 }[card.rank]);
const sum = (cards) => cards.reduce((total, c) => total + cardValue(c), 0);

/** Miroir côté client de la règle serveur, pour activer/désactiver le bouton. */
function isValidCombo(cards) {
  if (cards.length === 1) return true;
  if (cards.length === 2 && cards.some((c) => c.rank === 1)) return true;
  return cards.length > 1 && cards.every((c) => c.rank === cards[0].rank) && sum(cards) <= 10;
}

/** Slot de carte générique : coins rang+couleur et symbole central. */
export function renderCard(card, { selected = false, onClick, size = 'md', dim = false } = {}) {
  const suit = SUITS[card.suit];
  const label = rankLabel(card.rank);
  return el(
    onClick ? 'button' : 'div',
    {
      class: `cdr-card size-${size} ${suit.red ? 'red' : 'black'} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`,
      onclick: onClick,
      title: `${label} de ${suit.name} (valeur ${cardValue(card)})`,
      type: onClick ? 'button' : undefined,
    },
    el('span', { class: 'corner tl' }, label, el('br'), suit.symbol),
    el('span', { class: 'pip' }, card.rank > 10 || size === 'sm' ? `${label}${suit.symbol}` : suit.symbol),
    el('span', { class: 'corner br' }, label, el('br'), suit.symbol),
  );
}

function renderPile(label, count, { faceDown = true } = {}) {
  return el(
    'div',
    { class: 'cdr-pile' },
    el('div', { class: `cdr-card size-md ${faceDown ? 'back' : 'empty'}` }, el('span', { class: 'pile-count' }, count)),
    el('span', { class: 'pile-label' }, label),
  );
}

export function mount(root, ctx) {
  // Feuille de style propre au jeu (retirée au démontage).
  const css = el('link', { rel: 'stylesheet', href: '/games/chute-des-rois/style.css' });
  document.head.append(css);

  let current = null;
  let selection = new Set();
  let busy = false;
  let showRules = false;

  const container = el('div', { class: 'cdr' });
  root.append(container);

  async function send(type, payload = {}) {
    if (busy) return;
    busy = true;
    try {
      await ctx.sendAction(type, payload);
      selection = new Set();
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  function toggle(cardId) {
    selection.has(cardId) ? selection.delete(cardId) : selection.add(cardId);
    render();
  }

  // ---------------------------------------------------------------- rendu

  function render() {
    if (!current) {
      container.replaceChildren(el('p', { class: 'muted center' }, 'Chargement de la partie...'));
      return;
    }
    const s = current;
    // On oublie les cartes sélectionnées qui ne sont plus en main.
    selection = new Set([...selection].filter((id) => s.myHand.some((c) => c.id === id)));

    const sections = [
      renderStatus(s),
      renderBoard(s),
      renderPlayers(s),
      renderHand(s),
      el('div', { class: 'cdr-bottom' }, renderLog(s), renderRules()),
    ];
    if (s.phase === 'victory' || s.phase === 'defeat') sections.push(renderEnd(s));
    container.replaceChildren(...sections);
  }

  function nameOf(id) {
    return current.players.find((p) => p.id === id)?.name ?? '?';
  }

  function renderStatus(s) {
    let text;
    let tone = 'wait';
    if (s.phase === 'victory') [text, tone] = ['Victoire ! Le royaume est libéré.', 'good'];
    else if (s.phase === 'defeat') [text, tone] = ['Défaite... Les souverains règnent toujours.', 'bad'];
    else if (!s.isMyTurn) {
      text = s.phase === 'defend'
        ? `${nameOf(s.currentPlayerId)} encaisse ${s.pendingDamage} dégât(s)...`
        : `${nameOf(s.currentPlayerId)} prépare son attaque...`;
    } else if (s.phase === 'attack') [text, tone] = ['À vous ! Jouez une carte (ou un combo) contre le boss.', 'act'];
    else [text, tone] = [`Le boss riposte ! Défaussez au moins ${s.pendingDamage} points.`, 'bad'];

    return el(
      'div',
      { class: `cdr-status tone-${tone}` },
      el('span', {}, text),
      el('span', { class: 'cdr-progress' }, `Souverains vaincus : ${s.bossesDefeated}/12 · Tour ${s.turn}`),
    );
  }

  function renderBoard(s) {
    const boss = s.boss;
    let bossArea;
    if (boss) {
      const suit = SUITS[boss.card.suit];
      const hpPct = Math.max(0, (boss.hp / boss.maxHp) * 100);
      bossArea = el(
        'div',
        { class: 'cdr-boss' },
        renderCard(boss.card, { size: 'lg' }),
        el(
          'div',
          { class: 'cdr-boss-stats' },
          el('h3', {}, `${BOSS_TITLE[boss.card.rank]} de ${suit.name}`),
          el('div', { class: 'hp-bar' }, el('div', { class: 'hp-fill', style: `width:${hpPct}%` }), el('span', {}, `${boss.hp} / ${boss.maxHp} PV`)),
          el('div', { class: 'stat' }, '⚔️ Attaque ', el('strong', {}, boss.effectiveAttack),
            boss.shield ? el('span', { class: 'muted' }, ` (${boss.attack} − ${boss.shield} ♠)`) : null),
          el('div', { class: `stat immune ${suit.red ? 'red' : ''}` }, `🛡️ Immunisé : ${suit.symbol} ${suit.name}`),
        ),
      );
    } else {
      bossArea = el('div', { class: 'cdr-boss empty-boss' }, '👑 Tous les souverains sont tombés');
    }

    const lastAttack = s.lastAttack;
    return el(
      'div',
      { class: 'cdr-board' },
      el('div', { class: 'cdr-piles' }, renderPile('Château', s.castleCount)),
      bossArea,
      el(
        'div',
        { class: 'cdr-table' },
        el('span', { class: 'pile-label' }, 'Cartes jouées contre ce boss'),
        el('div', { class: 'cdr-table-cards' },
          s.table.length ? s.table.map((c) => renderCard(c, { size: 'sm' })) : el('span', { class: 'muted' }, '—')),
        lastAttack && lastAttack.effects?.length
          ? el('div', { class: 'cdr-effects' }, lastAttack.effects.map((e) => el('span', {}, e)))
          : null,
      ),
      el('div', { class: 'cdr-piles' }, renderPile('Pioche', s.tavernCount), renderPile('Défausse', s.discardCount, { faceDown: false })),
    );
  }

  function renderPlayers(s) {
    return el(
      'div',
      { class: 'cdr-players' },
      s.players.map((p) =>
        el(
          'div',
          { class: `cdr-player ${p.id === s.currentPlayerId ? 'active' : ''} ${p.id === ctx.me.id ? 'me' : ''}` },
          el('strong', {}, p.name + (p.id === ctx.me.id ? ' (vous)' : '')),
          el('span', { class: 'muted' }, `🂠 ${p.cardCount}/${s.handSize}`),
        ),
      ),
    );
  }

  function renderHand(s) {
    const selected = s.myHand.filter((c) => selection.has(c.id));
    const total = sum(selected);
    const myTurn = s.isMyTurn && !busy;
    const actions = [];
    let info = '';

    if (myTurn && s.phase === 'attack') {
      const valid = selected.length > 0 && isValidCombo(selected);
      if (selected.length) info = valid ? `Attaque : ${total}` : 'Combo invalide';
      actions.push(
        el('button', { class: 'btn btn-primary', disabled: !valid, onclick: () => send('play', { cardIds: [...selection] }) }, '⚔️ Attaquer'),
        el('button', { class: 'btn', disabled: !s.canYield, onclick: () => send('yield'), title: s.canYield ? '' : 'Impossible de passer maintenant' }, 'Passer'),
      );
    } else if (myTurn && s.phase === 'defend') {
      info = `Défausse : ${total} / ${s.pendingDamage}`;
      actions.push(
        el('button', { class: 'btn btn-danger', disabled: total < s.pendingDamage, onclick: () => send('defend', { cardIds: [...selection] }) }, '🛡️ Encaisser'),
      );
    }
    if (myTurn && s.solo && s.renewalsLeft > 0 && (s.phase === 'attack' || s.phase === 'defend')) {
      actions.push(el('button', { class: 'btn', onclick: () => confirm('Défausser toute votre main et repiocher ?') && send('renew') }, `♻️ Renouveau (${s.renewalsLeft})`));
    }

    const canSelect = myTurn && (s.phase === 'attack' || s.phase === 'defend');
    return el(
      'div',
      { class: `cdr-hand-zone ${s.isMyTurn ? 'my-turn' : ''}` },
      el(
        'div',
        { class: 'cdr-hand-header' },
        el('h3', {}, `Votre main (${s.myHand.length}/${s.handSize})`),
        el('span', { class: 'cdr-selection-info' }, info),
        el('div', { class: 'cdr-actions' }, actions),
      ),
      el(
        'div',
        { class: 'cdr-hand' },
        s.myHand.length
          ? s.myHand.map((c) =>
              renderCard(c, {
                selected: selection.has(c.id),
                onClick: canSelect ? () => toggle(c.id) : undefined,
                dim: !canSelect,
              }),
            )
          : el('span', { class: 'muted' }, 'Aucune carte en main.'),
      ),
    );
  }

  function renderLog(s) {
    const list = el('ol', { class: 'cdr-log' }, [...s.log].reverse().map((entry) => el('li', {}, entry.text)));
    return el('div', { class: 'panel cdr-log-panel' }, el('h2', {}, 'Journal'), list);
  }

  function renderRules() {
    const body = showRules
      ? el(
          'div',
          { class: 'cdr-rules-body' },
          el('ul', {}, Object.values(SUITS).map((suit) =>
            el('li', {}, el('span', { class: `suit ${suit.red ? 'red' : ''}` }, suit.symbol), ` ${suit.name} — ${suit.power}`))),
          el('p', {}, 'N = valeur de l’attaque (As = 1, 2–10 = valeur). Le boss est immunisé contre le pouvoir de sa propre couleur.'),
          el('p', {}, 'Combos : As + une carte, ou plusieurs cartes de même valeur totalisant 10 max.'),
          el('p', {}, 'Boss : Valet 20 PV / 10 att., Dame 30 / 15, Roi 40 / 20. Un boss vaincu avec des dégâts exacts rejoint votre pioche.'),
          el('p', {}, 'Après la riposte, défaussez des cartes dont la somme couvre les dégâts. Impossible ? La partie est perdue.'),
        )
      : null;
    return el(
      'div',
      { class: 'panel cdr-rules' },
      el('button', { class: 'btn btn-ghost btn-small', onclick: () => { showRules = !showRules; render(); } },
        showRules ? '▾ Règles' : '▸ Règles & pouvoirs'),
      body,
    );
  }

  function renderEnd(s) {
    const victory = s.phase === 'victory';
    const isHost = ctx.getRoom()?.hostId === ctx.me.id;
    return el(
      'div',
      { class: 'cdr-overlay' },
      el(
        'div',
        { class: `cdr-end panel ${victory ? 'victory' : 'defeat'}` },
        el('h1', {}, victory ? '👑 Victoire !' : '💀 Défaite'),
        el('p', {}, `Souverains vaincus : ${s.bossesDefeated} / 12`),
        el('p', { class: 'muted' }, s.log.at(-1)?.text ?? ''),
        el('p', { class: 'muted' }, isHost
          ? 'Utilisez « Retour au salon » en haut pour rejouer ou changer de jeu.'
          : "En attente de l'hôte pour revenir au salon."),
      ),
    );
  }

  render();

  return {
    update(state) {
      current = state;
      render();
    },
    unmount() {
      css.remove();
      container.remove();
    },
  };
}
