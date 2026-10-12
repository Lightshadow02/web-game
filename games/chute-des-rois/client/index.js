import { el } from '/js/dom.js';
import { createFx } from './animations.js';
import { openRules, POWERS } from './rules.js';

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
export function renderCard(card, { selected = false, onClick, size = 'md', dim = false, hidden = false } = {}) {
  const suit = SUITS[card.suit];
  const label = rankLabel(card.rank);
  return el(
    onClick ? 'button' : 'div',
    {
      class: `cdr-card size-${size} ${suit.red ? 'red' : 'black'} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''} ${hidden ? 'cdr-hidden' : ''}`,
      onclick: onClick,
      title: `${label} de ${suit.name} (valeur ${cardValue(card)})`,
      type: onClick ? 'button' : undefined,
      dataset: { cardId: card.id },
    },
    el('span', { class: 'corner tl' }, label, el('br'), suit.symbol),
    el('span', { class: 'pip' }, card.rank > 10 || size === 'sm' ? `${label}${suit.symbol}` : suit.symbol),
    el('span', { class: 'corner br' }, label, el('br'), suit.symbol),
  );
}

function renderPile(label, count, fxName, { faceDown = true } = {}) {
  return el(
    'div',
    { class: 'cdr-pile', dataset: { fx: fxName } },
    el('div', { class: `cdr-card size-md ${faceDown ? 'back' : 'empty'}` }, el('span', { class: 'pile-count' }, count)),
    el('span', { class: 'pile-label' }, label),
  );
}

const pct = (boss) => (boss ? Math.max(0, (boss.hp / boss.maxHp) * 100) : 0);
const shift = (rect, dy) => rect && { left: rect.left, right: rect.right, width: rect.width, height: rect.height, top: rect.top + dy, bottom: rect.bottom + dy };
const maxEventId = (state) => state.events?.at(-1)?.id ?? 0;
const unionRect = (rects) => {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  const left = Math.min(...list.map((r) => r.left));
  const top = Math.min(...list.map((r) => r.top));
  const right = Math.max(...list.map((r) => r.right));
  const bottom = Math.max(...list.map((r) => r.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

export function mount(root, ctx) {
  // Feuille de style propre au jeu (retirée au démontage).
  const css = el('link', { rel: 'stylesheet', href: '/games/chute-des-rois/style.css' });
  document.head.append(css);

  let current = null;
  let selection = new Set();
  let busy = false;

  // --- état des animations : activées par défaut, le joueur peut les couper (bouton ✨, mémorisé)
  const ANIM_KEY = 'cdr.animations';
  let animationsOn = (() => {
    try {
      return localStorage.getItem(ANIM_KEY) !== 'off';
    } catch {
      return true;
    }
  })();
  const fx = createFx({ renderCard, isEnabled: () => animationsOn });

  function toggleAnimations() {
    animationsOn = !animationsOn;
    try {
      localStorage.setItem(ANIM_KEY, animationsOn ? 'on' : 'off');
    } catch {
      /* stockage indisponible */
    }
    ctx.toast(animationsOn ? 'Animations activées ✨' : 'Animations désactivées', 'success');
    render();
  }
  let lastEventId = null; // null = premier état reçu (pas d'animation rétroactive)
  let queue = Promise.resolve();
  let animating = 0;
  const hiddenCards = new Set(); // cartes affichées seulement quand leur animation arrive
  let bossOverride = null; // ancien boss affiché jusqu'à son explosion
  let hpOverride = null; // { cardId, pct } : barre de vie avant les dégâts

  const container = el('div', { class: 'cdr' });
  root.append(container);
  const q = (selector) => container.querySelector(selector);
  const rectOf = (selector) => q(selector)?.getBoundingClientRect() ?? null;

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
      renderHand(s),
      renderLog(s),
    ];
    // L'écran de fin attend la fin des animations.
    if ((s.phase === 'victory' || s.phase === 'defeat') && !animating) sections.push(renderEnd(s));
    container.classList.toggle('no-anim', !animationsOn);
    container.replaceChildren(...sections);
  }

  function nameOf(id) {
    return current.players.find((p) => p.id === id)?.name ?? '?';
  }

  function avatarOf(player) {
    const url = ctx.getRoom()?.players.find((p) => p.id === player.id)?.avatarUrl;
    return url
      ? el('img', { class: 'cdr-avatar', src: url, alt: '' })
      : el('span', { class: 'cdr-avatar initial', 'aria-hidden': 'true' }, player.name[0]?.toUpperCase() ?? '?');
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
      el('div', { class: 'cdr-status-side' },
        el('span', { class: 'cdr-progress' }, `Souverains vaincus : ${s.bossesDefeated}/12 · Tour ${s.turn}`),
        el('button', {
          class: `btn btn-small cdr-anim-btn ${animationsOn ? 'on' : ''}`,
          type: 'button',
          'aria-pressed': String(animationsOn),
          title: animationsOn ? 'Désactiver les animations' : 'Activer les animations',
          onclick: toggleAnimations,
        }, animationsOn ? '✨ Animations' : '✨ Animations : off'),
        el('button', { class: 'btn btn-small cdr-rules-btn', type: 'button', onclick: () => showRules() }, '📖 Règles'),
      ),
    );
  }

  /** Cartes posées par un joueur contre le boss actuel (zone devant lui). */
  function renderZone(s, playerId) {
    const cards = s.plays.filter((p) => p.playerId === playerId).flatMap((p) => p.cards);
    return el(
      'div',
      { class: 'cdr-zone', dataset: { zone: playerId } },
      cards.length
        ? cards.map((c) => renderCard(c, { size: 'sm', hidden: hiddenCards.has(c.id) }))
        : el('span', { class: 'cdr-zone-empty' }, 'Aucune carte posée'),
    );
  }

  function describeAction(s, p) {
    const active = p.id === s.currentPlayerId && s.phase !== 'victory' && s.phase !== 'defeat';
    if (active && s.phase === 'defend') return { text: `Encaisse ${s.pendingDamage} dégât(s)…`, tone: 'bad' };
    if (active) return { text: 'Prépare son attaque…', tone: 'act' };
    const a = p.lastAction;
    if (!a) return { text: 'En attente', tone: '' };
    if (a.type === 'attack') return { text: `A infligé ${a.damage} dégât(s)`, tone: '' };
    if (a.type === 'defend') return { text: `A encaissé ${a.damage}`, tone: '' };
    return { text: 'A passé son tour', tone: '' };
  }

  /** Siège d'un coéquipier, en haut de la table. */
  function renderSeat(s, p) {
    const active = p.id === s.currentPlayerId;
    const action = describeAction(s, p);
    const fanCount = Math.min(p.cardCount, 8);
    return el(
      'div',
      {
        class: `cdr-seat ${active ? 'active' : ''} ${active && s.phase === 'defend' ? 'targeted' : ''}`,
        dataset: { seat: p.id },
      },
      el('div', { class: 'cdr-seat-head' },
        avatarOf(p),
        el('div', { class: 'cdr-seat-id' },
          el('strong', {}, p.name),
          el('span', { class: `cdr-seat-action tone-${action.tone}` }, action.text),
        ),
      ),
      el('div', { class: 'cdr-fan', dataset: { fan: p.id }, title: `${p.cardCount} carte(s) en main` },
        Array.from({ length: fanCount }, (_, i) =>
          el('span', { class: 'cdr-card size-xs back', style: `--i:${i}; --n:${fanCount}` })),
        el('span', { class: 'cdr-fan-count' }, `${p.cardCount}`),
      ),
      renderZone(s, p.id),
    );
  }

  function renderBoss(s) {
    const boss = bossOverride ?? s.boss;
    if (!boss) return el('div', { class: 'cdr-boss empty-boss', dataset: { fx: 'boss' } }, '👑 Tous les souverains sont tombés');
    const suit = SUITS[boss.card.suit];
    const width = hpOverride?.cardId === boss.card.id ? hpOverride.pct : pct(boss);
    const effective = boss.effectiveAttack ?? Math.max(0, boss.attack - boss.shield);
    return el(
      'div',
      { class: 'cdr-boss', dataset: { fx: 'boss' } },
      el('div', { class: 'cdr-boss-card', dataset: { fx: 'boss-card' } }, renderCard(boss.card, { size: 'lg' })),
      el(
        'div',
        { class: 'cdr-boss-stats' },
        el('h3', {}, `${BOSS_TITLE[boss.card.rank]} de ${suit.name}`),
        el('div', { class: 'hp-bar' },
          el('div', { class: 'hp-fill', style: `width:${width}%`, dataset: { fx: 'hp' } }),
          el('span', {}, `${Math.max(0, boss.hp)} / ${boss.maxHp} PV`)),
        el('div', { class: 'stat', dataset: { fx: 'boss-attack' } }, '⚔️ Attaque ', el('strong', {}, effective),
          boss.shield ? el('span', { class: 'muted' }, ` (${boss.attack} − ${boss.shield} ♠)`) : null),
        el('div', { class: `stat immune ${suit.red ? 'red' : ''}` }, `🛡️ Immunisé : ${suit.symbol} ${suit.name}`),
      ),
    );
  }

  function renderBoard(s) {
    // Coéquipiers dans l'ordre du tour, en commençant par celui qui joue après moi.
    const myIndex = s.players.findIndex((p) => p.id === ctx.me.id);
    const others = s.players
      .map((_, i) => s.players[(myIndex + 1 + i) % s.players.length])
      .filter((p) => p.id !== ctx.me.id);
    const me = s.players[myIndex];

    return el(
      'div',
      { class: 'cdr-board' },
      others.length ? el('div', { class: 'cdr-seats', style: `--seats:${others.length}` }, others.map((p) => renderSeat(s, p))) : null,
      el(
        'div',
        { class: 'cdr-center' },
        el('div', { class: 'cdr-left' },
          el('div', { class: 'cdr-piles' }, renderPile('Château', s.castleCount, 'castle')),
          renderPowers(s)),
        renderBoss(s),
        el('div', { class: 'cdr-piles cdr-piles-right' },
          renderPile('Pioche', s.tavernCount, 'tavern'),
          renderPile('Défausse', s.discardCount, 'discard', { faceDown: false })),
      ),
      me
        ? el(
            'div',
            { class: `cdr-my-area ${s.isMyTurn ? 'active' : ''}`, dataset: { seat: me.id } },
            el('span', { class: 'pile-label' }, 'Vos cartes posées'),
            renderZone(s, me.id),
          )
        : null,
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
      { class: `cdr-hand-zone ${s.isMyTurn ? 'my-turn' : ''} ${s.isMyTurn && s.phase === 'defend' ? 'targeted' : ''}`, dataset: { fx: 'hand' } },
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
                hidden: hiddenCards.has(c.id),
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

  function showRules(tab) {
    openRules({ renderCard, SUITS, startTab: tab });
  }

  /** Aide-mémoire des 4 pouvoirs, toujours visible ; la couleur du boss est barrée. */
  function renderPowers(s) {
    const immune = s.boss?.card.suit;
    return el(
      'div',
      { class: 'cdr-powers', 'aria-label': 'Pouvoirs des couleurs' },
      POWERS.map((p) => {
        const blocked = p.suit === immune;
        return el(
          'button',
          {
            class: `cdr-power suit-${p.suit} ${blocked ? 'blocked' : ''}`,
            type: 'button',
            title: blocked ? `Ce boss est immunisé contre ${p.name} : pas de ${p.title.toLowerCase()}.` : p.text,
            onclick: () => showRules('powers'),
          },
          el('span', { class: `cdr-power-suit ${SUITS[p.suit].red ? 'red' : ''}` }, SUITS[p.suit].symbol),
          el('span', { class: 'cdr-power-text' },
            el('strong', {}, p.title),
            el('span', {}, blocked ? '⛔ Boss immunisé' : p.short)),
        );
      }),
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

  // ---------------------------------------------------------------- animations

  /** Positions utiles AVANT le nouveau rendu (cartes qui vont quitter ma main, ancien boss). */
  function captureRects() {
    const hand = new Map();
    for (const node of container.querySelectorAll('.cdr-hand [data-card-id]')) {
      hand.set(node.dataset.cardId, node.getBoundingClientRect());
    }
    return { hand, boss: rectOf('[data-fx="boss-card"]'), handZone: rectOf('[data-fx="hand"]') };
  }

  function reveal(cardIds) {
    for (const id of cardIds) {
      hiddenCards.delete(id);
      for (const node of container.querySelectorAll(`[data-card-id="${CSS.escape(id)}"]`)) {
        node.classList.remove('cdr-hidden');
        node.classList.add('cdr-landed');
      }
    }
  }

  /** Origine visuelle d'un joueur : ses cartes en main (moi) ou son éventail (coéquipier). */
  const sourceOf = (playerId, cards, before) =>
    playerId === ctx.me.id
      ? unionRect(cards.map((c) => before.hand.get(c.id))) ?? before.handZone ?? rectOf('[data-fx="hand"]')
      : rectOf(`[data-fan="${playerId}"]`);
  const targetOf = (playerId) =>
    playerId === ctx.me.id ? q('[data-fx="hand"]') : q(`[data-seat="${playerId}"]`);

  const handlers = {
    async attack(e, batch) {
      const lethal = batch.events.some((x) => x.type === 'bossDefeated' && x.id > e.id);
      const from = sourceOf(e.playerId, e.cards, batch.before);
      const to = lethal ? batch.before.boss : rectOf(`[data-zone="${e.playerId}"]`);
      await fx.flyCards({ cards: e.cards, from, to, size: 'sm', duration: 520 });
      reveal(e.cards.map((c) => c.id));
      fx.pulse(q(`[data-zone="${e.playerId}"]`), 'cdr-impact', 500);

      // Impact sur le boss
      const bossCard = q('[data-fx="boss-card"]');
      const bossRect = bossCard?.getBoundingClientRect() ?? batch.before.boss;
      fx.pulse(bossCard, 'cdr-hit', 520);
      fx.floatText(bossRect, `-${e.damage}`, 'damage', { big: true });
      if (e.doubled) fx.floatText(shift(bossRect, -60), '♣ ×2', 'club');
      if (e.blockedSuit) fx.floatText(shift(bossRect, 70), `${SUITS[e.blockedSuit].symbol} bloqué par l’immunité`, 'muted');
      await fx.drainBar(q('[data-fx="hp"]'), hpOverride?.pct ?? pct(current.boss), Math.max(0, (e.bossHp / e.bossMaxHp) * 100));
      hpOverride = null;

      if (e.shield && !lethal) {
        fx.pulse(q('[data-fx="boss-attack"]'), 'cdr-shielded', 700);
        fx.floatText(rectOf('[data-fx="boss-attack"]'), `♠ −${e.shield} attaque`, 'shield');
      }
      const effects = [];
      if (e.healed) {
        fx.floatText(rectOf('[data-fx="tavern"]'), `♥ +${e.healed}`, 'heal');
        effects.push(fx.flyCards({ count: Math.min(e.healed, 6), from: rectOf('[data-fx="discard"]'), to: rectOf('[data-fx="tavern"]'), size: 'sm', stagger: 50, duration: 420 }));
      }
      for (const [playerId, n] of Object.entries(e.drawn ?? {})) {
        effects.push(drawTo(playerId, n, batch));
      }
      await Promise.all(effects);
    },

    yield(e) {
      return fx.floatText(targetOf(e.playerId)?.getBoundingClientRect(), 'Passe son tour', 'muted');
    },

    async riposte(e) {
      const target = targetOf(e.playerId);
      const rect = target?.getBoundingClientRect();
      await fx.lunge(q('[data-fx="boss-card"]'), rect);
      fx.pulse(target, 'cdr-hurt', 800);
      await fx.floatText(rect, `⚔ −${e.damage}`, 'damage', { big: true });
    },

    async blocked(e) {
      fx.pulse(q('[data-fx="boss-card"]'), 'cdr-shielded', 700);
      await fx.floatText(targetOf(e.playerId)?.getBoundingClientRect(), '🛡 Riposte bloquée !', 'shield', { big: true });
    },

    async defend(e, batch) {
      const target = targetOf(e.playerId);
      fx.pulse(target, 'cdr-tank', 900);
      fx.floatText(target?.getBoundingClientRect(), `🛡 ${e.damage} encaissés`, 'shield');
      await fx.flyCards({ cards: e.cards, from: sourceOf(e.playerId, e.cards, batch.before), to: rectOf('[data-fx="discard"]'), size: 'sm', stagger: 60 });
    },

    async renew(e, batch) {
      await fx.flyCards({ count: 5, from: targetOf(e.playerId)?.getBoundingClientRect(), to: rectOf('[data-fx="discard"]'), size: 'sm', stagger: 40 });
      await drawTo(e.playerId, e.count, batch);
    },

    async bossDefeated(e, batch) {
      const rect = rectOf('[data-fx="boss-card"]') ?? batch.before.boss;
      bossOverride = null;
      render(); // le nouveau boss (ou la victoire) prend la place, caché jusqu'à son entrée
      // Le prochain boss (carte + stats) reste caché pendant la mort du précédent.
      const next = q('[data-fx="boss"]');
      if (next && e.type === 'bossDefeated' && batch.events.some((x) => x.type === 'newBoss')) next.style.visibility = 'hidden';
      if (e.exact) {
        fx.floatText(shift(rect, 120), 'Il rejoint votre pioche !', 'gold');
        await fx.knockOut(e.card, rect, rectOf('[data-fx="tavern"] .cdr-card'), q('[data-fx="tavern"]'));
      } else {
        fx.floatText(shift(rect, -40), 'Vaincu !', 'gold', { big: true });
        await fx.tearCard(e.card, rect);
      }
      if (next) next.style.visibility = '';
    },

    async newBoss() {
      await fx.flipIn(q('[data-fx="boss-card"]'), rectOf('[data-fx="castle"]'));
    },
  };

  /** Cartes piochées : dos qui volent de la pioche vers le joueur (mes nouvelles cartes se révèlent). */
  async function drawTo(playerId, n, batch) {
    const target = playerId === ctx.me.id ? rectOf('.cdr-hand') : rectOf(`[data-fan="${playerId}"]`);
    fx.floatText(target, `+${n} carte${n > 1 ? 's' : ''}`, 'heal');
    await fx.flyCards({ count: Math.min(n, 8), from: rectOf('[data-fx="tavern"]'), to: target, size: 'sm', stagger: 80, duration: 450 });
    if (playerId === ctx.me.id) reveal(batch.newHand);
  }

  async function playBatch(batch) {
    try {
      for (const e of batch.events) {
        try {
          await handlers[e.type]?.(e, batch);
        } catch (err) {
          console.warn('[cdr] animation', e.type, err);
        }
        await fx.wait(120);
      }
    } finally {
      // Rien ne doit rester caché, même si une animation a échoué.
      reveal([...batch.hidden]);
      hpOverride = null;
      bossOverride = null;
      animating--;
      if (!animating) render();
    }
  }

  function update(state) {
    const before = captureRects();
    const prev = current;
    current = state;

    if (!prev || lastEventId === null) {
      lastEventId = maxEventId(state); // reconnexion : on n'anime pas l'historique
      render();
      return;
    }
    const events = (state.events ?? []).filter((e) => e.id > lastEventId);
    lastEventId = Math.max(lastEventId, maxEventId(state));
    if (!events.length || !animationsOn) {
      render();
      return;
    }

    // Ce qui doit apparaître au rythme des animations est masqué dès ce rendu.
    const prevHand = new Set(prev.myHand.map((c) => c.id));
    const batch = { events, before, newHand: state.myHand.filter((c) => !prevHand.has(c.id)).map((c) => c.id), hidden: new Set() };
    for (const e of events) {
      if (e.type === 'attack') e.cards.forEach((c) => batch.hidden.add(c.id));
    }
    batch.newHand.forEach((id) => batch.hidden.add(id));
    batch.hidden.forEach((id) => hiddenCards.add(id));

    const firstAttack = events.find((e) => e.type === 'attack');
    if (firstAttack && prev.boss) hpOverride = { cardId: prev.boss.card.id, pct: pct(prev.boss) };
    if (events.some((e) => e.type === 'bossDefeated') && prev.boss) bossOverride = { ...prev.boss };

    animating++; // compté dès maintenant : l'écran de fin attend la dernière animation
    render();
    queue = queue.then(() => playBatch(batch));
  }

  render();

  // Première partie sur ce navigateur : on ouvre les règles.
  try {
    if (!localStorage.getItem('cdr.rulesSeen')) {
      localStorage.setItem('cdr.rulesSeen', '1');
      setTimeout(() => showRules(), 400);
    }
  } catch {
    /* stockage indisponible : tant pis */
  }

  return {
    update,
    unmount() {
      fx.destroy();
      document.querySelector('.cdr-rules-dialog')?.close();
      css.remove();
      container.remove();
    },
  };
}
