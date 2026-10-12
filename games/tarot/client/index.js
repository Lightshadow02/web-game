import { el } from '/js/dom.js';
import { openRules } from './rules.js';

/* =====================================================================
 * Interface du Tarot. Module monté par le Hub : mount(root, ctx) -> { update, unmount }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 * 'bid', 'call', 'discard', 'poignee', 'play', 'next'.
 * ===================================================================== */

const SUITS = {
  S: { symbol: '♠︎', name: 'Pique', red: false },
  H: { symbol: '♥︎', name: 'Cœur', red: true },
  D: { symbol: '♦︎', name: 'Carreau', red: true },
  C: { symbol: '♣︎', name: 'Trèfle', red: false },
};
const RANK_LABEL = { 11: 'V', 12: 'C', 13: 'D', 14: 'R' };
const RANK_NAME = { 11: 'Valet', 12: 'Cavalier', 13: 'Dame', 14: 'Roi' };
const BIDS = {
  passe: { label: 'Passe', mult: null },
  petite: { label: 'Petite', mult: 1 },
  garde: { label: 'Garde', mult: 2 },
  garde_sans: { label: 'Garde sans', mult: 4 },
  garde_contre: { label: 'Garde contre', mult: 6 },
};
const POIGNEE_NAMES = { simple: 'simple', double: 'double', triple: 'triple' };

const isOudler = (c) => c.suit === 'E' || (c.suit === 'T' && (c.rank === 1 || c.rank === 21));
const isKing = (c) => SUITS[c.suit] && c.rank === 14;

export function cardName(c) {
  if (c.suit === 'E') return 'Excuse';
  if (c.suit === 'T') return c.rank === 1 ? 'Petit (1 d’atout)' : `${c.rank} d’atout`;
  return `${RANK_NAME[c.rank] ?? c.rank} de ${SUITS[c.suit].name}`;
}

/** Carte de Tarot : couleurs classiques, atouts numérotés, Excuse. */
export function renderCard(card, { size = 'md', onClick, selected, disabled, dim, hidden, tag } = {}) {
  const classes = ['trt-card', `size-${size}`];
  let body;
  if (card.suit === 'E') {
    classes.push('excuse', 'oudler');
    body = [el('span', { class: 'trt-pip' }, '★'), el('span', { class: 'trt-caption' }, 'Excuse')];
  } else if (card.suit === 'T') {
    classes.push('trump');
    if (isOudler(card)) classes.push('oudler');
    body = [
      el('span', { class: 'corner tl' }, String(card.rank)),
      el('span', { class: 'trt-pip' }, String(card.rank)),
      el('span', { class: 'trt-caption' }, card.rank === 1 ? 'Petit' : 'Atout'),
    ];
  } else {
    const suit = SUITS[card.suit];
    const label = RANK_LABEL[card.rank] ?? String(card.rank);
    classes.push(suit.red ? 'red' : 'black');
    if (card.rank > 10) classes.push('figure');
    body = [
      el('span', { class: 'corner tl' }, label, el('br'), suit.symbol),
      el('span', { class: 'trt-pip' }, card.rank > 10 || size === 'sm' || size === 'xs' ? `${label}${suit.symbol}` : suit.symbol),
      el('span', { class: 'corner br' }, label, el('br'), suit.symbol),
    ];
  }
  if (selected) classes.push('selected');
  if (dim) classes.push('dim');
  if (hidden) classes.push('trt-hidden');
  return el(
    onClick ? 'button' : 'div',
    {
      class: classes.join(' '),
      type: onClick ? 'button' : undefined,
      onclick: onClick,
      disabled: onClick ? disabled : undefined,
      title: cardName(card),
      dataset: { cardId: card.id },
    },
    body,
    tag ? el('span', { class: 'trt-tag' }, tag) : null,
  );
}

const back = (size = 'xs') => el('span', { class: `trt-card size-${size} back` });

export function mount(root, ctx) {
  const css = el('link', { rel: 'stylesheet', href: '/games/tarot/style.css' });
  document.head.append(css);

  let current = null;
  let busy = false;
  let selection = new Set(); // écart
  let showScores = false;
  let showLastTrick = false;

  // --- animations
  let lastEventId = null;
  let queue = Promise.resolve();
  let animating = 0;
  let heldTrick = null; // pli complet affiché un instant avant d'être ramassé
  const hiddenCards = new Set();
  const layer = el('div', { class: 'trt-fx-layer', 'aria-hidden': 'true' });
  document.body.append(layer);

  const container = el('div', { class: 'trt' });
  root.append(container);
  const q = (sel) => container.querySelector(sel);
  const rectOf = (sel) => q(sel)?.getBoundingClientRect() ?? null;

  async function send(type, payload = {}) {
    if (busy) return;
    busy = true;
    try {
      await ctx.sendAction(type, payload);
      if (type === 'discard') selection = new Set();
    } catch (err) {
      ctx.toast(err.message, 'error');
    } finally {
      busy = false;
      render();
    }
  }

  const nameOf = (id) => current?.players.find((p) => p.id === id)?.name ?? '?';
  const avatarOf = (p) => {
    const url = ctx.getRoom()?.players.find((x) => x.id === p.id)?.avatarUrl;
    return url
      ? el('img', { class: 'trt-avatar', src: url, alt: '' })
      : el('span', { class: 'trt-avatar initial', 'aria-hidden': 'true' }, p.name[0]?.toUpperCase() ?? '?');
  };

  // ---------------------------------------------------------------- rendu

  function render() {
    if (!current) {
      container.replaceChildren(el('p', { class: 'muted center' }, 'Distribution des cartes…'));
      return;
    }
    const s = current;
    const handIds = new Set(s.myHand.map((c) => c.id));
    selection = new Set([...selection].filter((id) => handIds.has(id)));
    const sections = [renderStatus(s), renderTable(s), renderActions(s), renderHand(s)];
    if (showScores) sections.push(renderScores(s));
    if ((s.phase === 'roundEnd' || s.phase === 'gameOver') && !animating) sections.push(renderSummary(s));
    container.replaceChildren(...sections);
  }

  function phaseText(s) {
    const cur = nameOf(s.currentPlayerId);
    switch (s.phase) {
      case 'bidding':
        return s.isMyTurn ? ['À vous d’annoncer !', 'act'] : [`${cur} réfléchit à son enchère…`, 'wait'];
      case 'calling':
        return s.isMyTurn ? ['Appelez un Roi pour choisir votre partenaire.', 'act'] : [`${cur} appelle un Roi…`, 'wait'];
      case 'discard':
        return s.isMyTurn ? [`Faites votre écart : choisissez ${s.discardCount} cartes.`, 'act'] : [`${cur} fait son écart…`, 'wait'];
      case 'playing':
        return s.isMyTurn ? ['À vous de jouer !', 'act'] : [`${cur} joue…`, 'wait'];
      case 'roundEnd':
        return ['Donne terminée.', 'wait'];
      default:
        return ['Partie terminée !', 'good'];
    }
  }

  function renderStatus(s) {
    const [text, tone] = phaseText(s);
    const contract = s.contract
      ? el('span', { class: 'trt-contract' },
          `${BIDS[s.contract.id].label} ×${s.contract.mult} · ${nameOf(s.takerId)}`,
          s.calledCard ? ` · appelle ${cardName(s.calledCard)}` : null)
      : null;
    return el(
      'div',
      { class: `trt-status tone-${tone}` },
      el('span', { class: 'trt-status-text' }, text),
      el('div', { class: 'trt-status-side' },
        contract,
        el('span', { class: 'muted' }, `Donne ${s.roundNumber}/${s.totalRounds}`),
        el('button', { class: 'btn btn-small', type: 'button', 'aria-pressed': String(showScores), onclick: () => { showScores = !showScores; render(); } }, '📊 Scores'),
        el('button', { class: 'btn btn-small', type: 'button', onclick: () => openRules({ renderCard }) }, '📖 Règles'),
      ),
    );
  }

  function renderSeat(s, p) {
    const active = p.id === s.currentPlayerId;
    const badges = [];
    if (p.isTaker) badges.push(el('span', { class: 'trt-badge taker' }, '👑 Preneur'));
    if (p.isPartner) badges.push(el('span', { class: 'trt-badge partner' }, '🤝 Partenaire'));
    if (p.id === s.dealerId) badges.push(el('span', { class: 'trt-badge' }, 'Donneur'));
    if (s.phase === 'bidding' && p.bid) badges.push(el('span', { class: `trt-badge bid ${p.bid}` }, BIDS[p.bid].label));
    const fan = Math.min(p.cardCount, 10);
    return el(
      'div',
      { class: `trt-seat ${active ? 'active' : ''}`, dataset: { seat: p.id } },
      el('div', { class: 'trt-seat-head' },
        avatarOf(p),
        el('div', { class: 'trt-seat-id' },
          el('strong', {}, p.name),
          el('span', { class: 'muted small' }, `${p.score} pts · ${p.tricks} pli${p.tricks > 1 ? 's' : ''}`)),
      ),
      el('div', { class: 'trt-badges' }, badges),
      el('div', { class: 'trt-fan', dataset: { fan: p.id }, title: `${p.cardCount} cartes` },
        Array.from({ length: fan }, (_, i) => el('span', { class: 'trt-fan-card', style: `--i:${i}; --n:${fan}` }, back())),
        el('span', { class: 'trt-fan-count' }, String(p.cardCount))),
    );
  }

  function renderTable(s) {
    const myIndex = s.players.findIndex((p) => p.id === ctx.me.id);
    const others = s.players.map((_, i) => s.players[(myIndex + 1 + i) % s.players.length]).filter((p) => p.id !== ctx.me.id);

    // Centre : chien (enchères / écart), pli en cours, ou dernier pli.
    let center;
    const trickCards = showLastTrick && s.lastTrick ? s.lastTrick.cards : heldTrick?.cards ?? s.trick;
    if (s.phase === 'bidding' || s.phase === 'calling') {
      center = el('div', { class: 'trt-chien' },
        el('span', { class: 'trt-label' }, `Chien (${s.chienCount} cartes)`),
        el('div', { class: 'trt-chien-cards' }, Array.from({ length: s.chienCount }, () => back('sm'))));
    } else if (s.phase === 'discard' && s.chien) {
      center = el('div', { class: 'trt-chien' },
        el('span', { class: 'trt-label' }, 'Le chien est retourné'),
        el('div', { class: 'trt-chien-cards' }, s.chien.map((c) => renderCard(c, { size: 'sm' }))));
    } else {
      const winnerId = showLastTrick ? s.lastTrick?.winnerId : heldTrick?.winnerId;
      center = el('div', { class: 'trt-trick', dataset: { fx: 'trick' } },
        el('span', { class: 'trt-label' },
          showLastTrick ? `Dernier pli (n°${s.lastTrick?.number}) — ${nameOf(s.lastTrick?.winnerId)}`
            : heldTrick ? `Pli pour ${nameOf(heldTrick.winnerId)} !`
              : s.phase === 'playing' ? `Pli ${s.trickNumber}/${s.totalTricks}` : ''),
        el('div', { class: 'trt-trick-cards' },
          trickCards.length
            ? trickCards.map(({ playerId, card }) =>
                el('div', { class: `trt-trick-slot ${playerId === winnerId ? 'winner' : ''}`, dataset: { slot: playerId } },
                  renderCard(card, { size: 'md', hidden: hiddenCards.has(card.id) }),
                  el('span', { class: 'trt-slot-name' }, playerId === ctx.me.id ? 'Vous' : nameOf(playerId))))
            : el('span', { class: 'trt-empty' }, s.phase === 'playing' ? `${nameOf(s.currentPlayerId)} entame` : '')),
        s.lastTrick && s.phase === 'playing'
          ? el('button', { class: 'btn btn-ghost btn-small trt-last-btn', type: 'button', onclick: () => { showLastTrick = !showLastTrick; render(); } },
              showLastTrick ? 'Revenir au pli en cours' : '↺ Voir le dernier pli')
          : null,
      );
    }

    const poignees = s.poignees.length
      ? el('div', { class: 'trt-poignees' }, s.poignees.map((p) =>
          el('div', { class: 'trt-poignee' },
            el('strong', {}, `${nameOf(p.playerId)} : poignée ${POIGNEE_NAMES[p.size]}`),
            el('div', { class: 'trt-mini-row' }, p.cards.map((c) => renderCard(c, { size: 'xs' }))))))
      : null;

    return el(
      'div',
      { class: 'trt-board' },
      el('div', { class: 'trt-seats', style: `--seats:${others.length}` }, others.map((p) => renderSeat(s, p))),
      center,
      poignees,
    );
  }

  /** Panneau d'action contextuel (enchères, appel, écart, poignée). */
  function renderActions(s) {
    const items = [];
    if (s.phase === 'bidding') {
      items.push(el('div', { class: 'trt-bid-history' },
        s.bids.length
          ? s.bids.map((b) => el('span', { class: `trt-badge bid ${b.bid}` }, `${nameOf(b.playerId)} : ${BIDS[b.bid].label}`))
          : el('span', { class: 'muted' }, 'Personne n’a encore parlé.')));
      if (s.isMyTurn) {
        items.push(el('div', { class: 'trt-buttons' }, Object.entries(BIDS).map(([id, b]) =>
          el('button', {
            class: `btn ${id === 'passe' ? '' : 'btn-primary'}`,
            type: 'button',
            disabled: busy || !s.availableBids.includes(id),
            onclick: () => send('bid', { bid: id }),
          }, b.label, b.mult ? el('small', {}, ` ×${b.mult}`) : null))));
      }
    } else if (s.phase === 'calling' && s.isMyTurn) {
      items.push(el('p', { class: 'muted' }, 'Le joueur qui possède cette carte sera votre partenaire secret (si elle est dans votre main ou au chien, vous jouez seul).'));
      items.push(el('div', { class: 'trt-buttons' }, s.callableCards.map((c) =>
        renderCard(c, { size: 'md', onClick: () => send('call', { cardId: c.id }) }))));
    } else if (s.phase === 'discard' && s.isMyTurn) {
      const n = selection.size;
      items.push(el('div', { class: 'trt-buttons' },
        el('span', { class: 'muted' }, 'Interdit : Rois et bouts. Atouts seulement si vous n’avez pas assez d’autres cartes.'),
        el('button', {
          class: 'btn btn-primary', type: 'button', disabled: busy || n !== s.discardCount,
          onclick: () => send('discard', { cardIds: [...selection] }),
        }, `Écarter (${n}/${s.discardCount})`)));
    } else if (s.phase === 'playing') {
      if (s.poigneeOptions.length && s.isMyTurn) {
        items.push(el('div', { class: 'trt-buttons' },
          el('span', { class: 'muted' }, 'Vous pouvez annoncer une poignée avant votre première carte :'),
          s.poigneeOptions.map((o) =>
            el('button', { class: 'btn', type: 'button', onclick: () => send('poignee', { size: o.id }) },
              `Poignée ${o.name} (${o.cards} atouts, +${o.bonus})`))));
      }
      if (s.iAmPartner) items.push(el('p', { class: 'trt-secret' }, `🤫 Vous êtes le partenaire secret du preneur (vous avez ${cardName(s.calledCard)}).`));
    }
    return items.length ? el('div', { class: 'trt-actions panel' }, items) : el('div');
  }

  function renderHand(s) {
    const legal = new Set(s.legalCardIds);
    const discarding = s.phase === 'discard' && s.isMyTurn;
    const chienIds = new Set((s.chien ?? []).map((c) => c.id));
    const plain = s.myHand.filter((c) => SUITS[c.suit] && !isKing(c)).length;
    const canDiscard = (c) => !isKing(c) && !isOudler(c) && (c.suit !== 'T' || plain < s.discardCount);

    const cards = s.myHand.map((c) => {
      if (discarding) {
        const ok = canDiscard(c);
        return renderCard(c, {
          selected: selection.has(c.id),
          dim: !ok,
          disabled: !ok,
          tag: chienIds.has(c.id) ? 'chien' : null,
          onClick: ok ? () => { selection.has(c.id) ? selection.delete(c.id) : selection.size < s.discardCount && selection.add(c.id); render(); } : () => {},
        });
      }
      if (s.phase === 'playing' && s.isMyTurn) {
        const ok = legal.has(c.id);
        return renderCard(c, {
          dim: !ok,
          disabled: !ok || busy,
          onClick: ok ? () => send('play', { cardId: c.id }) : () => {},
          hidden: hiddenCards.has(c.id),
        });
      }
      return renderCard(c, { hidden: hiddenCards.has(c.id) });
    });
    return el(
      'div',
      { class: `trt-hand-zone panel ${s.isMyTurn ? 'my-turn' : ''}`, dataset: { fx: 'hand' } },
      el('div', { class: 'trt-hand-head' },
        el('h3', {}, `Votre main (${s.myHand.length})`),
        s.phase === 'playing' && s.isMyTurn ? el('span', { class: 'trt-hint' }, 'Cliquez une carte jouable pour la poser') : null),
      el('div', { class: 'trt-hand' }, cards),
    );
  }

  function renderScores(s) {
    const rows = s.history.map((h) =>
      el('tr', {},
        el('td', {}, String(h.roundNumber)),
        el('td', {}, `${nameOf(h.takerId)} — ${BIDS[h.contract].label} ${h.made ? '✔' : '✘'}`),
        s.players.map((p) => el('td', { class: (h.changes[p.id] ?? 0) >= 0 ? 'pos' : 'neg' }, String(h.changes[p.id] ?? 0)))));
    return el('div', { class: 'trt-scores panel' },
      el('h2', {}, 'Feuille de scores'),
      el('div', { class: 'trt-table-wrap' },
        el('table', {},
          el('thead', {}, el('tr', {}, el('th', {}, 'Donne'), el('th', {}, 'Contrat'), s.players.map((p) => el('th', {}, p.name)))),
          el('tbody', {}, rows.length ? rows : el('tr', {}, el('td', { colSpan: 2 + s.players.length, class: 'muted' }, 'Aucune donne jouée.'))),
          el('tfoot', {}, el('tr', {}, el('td', {}), el('td', {}, 'Total'), s.players.map((p) => el('td', {}, el('strong', {}, String(p.score)))))))));
  }

  function renderSummary(s) {
    const sum = s.summary;
    if (!sum) return el('div');
    const over = s.phase === 'gameOver';
    const ranking = [...s.players].sort((a, b) => b.score - a.score);
    const lines = [
      ['Contrat', `${sum.contract.name} (×${sum.contract.mult}) par ${nameOf(sum.takerId)}${sum.partnerId ? ` avec ${nameOf(sum.partnerId)}` : sum.calledCard ? ' (seul)' : ''}`],
      ['Bouts', `${sum.oudlers} → ${sum.needed} points requis`],
      ['Points réalisés', `${sum.points} (${sum.diff >= 0 ? '+' : ''}${sum.diff})`],
      ['Base', `25 + ${Math.round(Math.abs(sum.diff))} = ${sum.base} × ${sum.contract.mult}`],
    ];
    if (sum.petitAuBout) lines.push(['Petit au bout', `${sum.petitAuBout > 0 ? '+' : ''}${sum.petitAuBout}`]);
    for (const p of sum.poignees) lines.push([`Poignée ${POIGNEE_NAMES[p.size]} (${nameOf(p.playerId)})`, `${sum.made ? '+' : '-'}${p.bonus}`]);
    lines.push(['Total du preneur (par défenseur)', `${sum.total > 0 ? '+' : ''}${sum.total}`]);

    return el('div', { class: 'trt-overlay' },
      el('div', { class: `trt-summary panel ${sum.made ? 'made' : 'failed'}` },
        el('h2', {}, over ? '🏁 Fin de la partie' : `Donne ${sum.roundNumber} : ${sum.made ? 'contrat réussi ✔' : 'contrat chuté ✘'}`),
        over ? el('p', { class: 'trt-result' }, `${sum.made ? 'Dernière donne réussie' : 'Dernière donne chutée'} par ${nameOf(sum.takerId)}.`) : null,
        el('dl', { class: 'trt-lines' }, lines.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
        el('table', { class: 'trt-round-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Joueur'), el('th', {}, 'Cette donne'), el('th', {}, 'Total'))),
          el('tbody', {}, ranking.map((p, i) =>
            el('tr', { class: p.id === ctx.me.id ? 'me' : '' },
              el('td', {}, over && i === 0 ? `🏆 ${p.name}` : p.name),
              el('td', { class: (sum.changes[p.id] ?? 0) >= 0 ? 'pos' : 'neg' }, `${(sum.changes[p.id] ?? 0) > 0 ? '+' : ''}${sum.changes[p.id] ?? 0}`),
              el('td', {}, el('strong', {}, String(p.score))))))),
        over
          ? el('p', { class: 'muted' }, ctx.getRoom()?.hostId === ctx.me.id ? 'Utilisez « Retour au salon » pour rejouer.' : "En attente de l'hôte pour revenir au salon.")
          : el('button', { class: 'btn btn-primary', type: 'button', disabled: busy, onclick: () => send('next') }, 'Donne suivante ▶'),
      ));
  }

  // ---------------------------------------------------------------- animations

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  async function fly(card, from, to, { duration = 420, faceDown = false } = {}) {
    if (!from || !to) return;
    const node = faceDown ? back('md') : renderCard(card, { size: 'md' });
    node.classList.add('trt-flying');
    layer.append(node);
    const { width, height } = node.getBoundingClientRect();
    const a = center(from);
    const b = center(to);
    await node.animate(
      [
        { transform: `translate(${a.x - width / 2}px, ${a.y - height / 2}px) rotate(-6deg) scale(0.9)` },
        { transform: `translate(${b.x - width / 2}px, ${b.y - height / 2}px) rotate(0deg) scale(1)` },
      ],
      { duration, easing: 'cubic-bezier(.25,.8,.3,1)', fill: 'forwards' },
    ).finished.catch(() => {});
    node.remove();
  }

  function sourceRect(playerId, cardId, before) {
    if (playerId === ctx.me.id) return before.hand.get(cardId) ?? rectOf('[data-fx="hand"]');
    return rectOf(`[data-fan="${playerId}"]`);
  }

  const handlers = {
    async play(e, batch) {
      const to = rectOf(`[data-slot="${e.playerId}"]`);
      await fly(e.card, sourceRect(e.playerId, e.card.id, batch.before), to);
      hiddenCards.delete(e.card.id);
      container.querySelectorAll(`[data-card-id="${CSS.escape(e.card.id)}"]`).forEach((n) => n.classList.remove('trt-hidden'));
      if (e.revealsPartner) ctx.toast(`${nameOf(e.playerId)} révèle ${cardName(e.card)} !`, 'success');
    },
    async trick(e) {
      heldTrick = { cards: e.cards, winnerId: e.winnerId };
      render();
      await wait(1300); // laisser le temps de voir le pli complet
      const target = e.winnerId === ctx.me.id ? rectOf('[data-fx="hand"]') : rectOf(`[data-seat="${e.winnerId}"]`);
      const slots = [...container.querySelectorAll('[data-slot]')].map((n) => n.getBoundingClientRect());
      container.querySelector('.trt-trick-cards')?.classList.add('trt-hidden');
      await Promise.all(e.cards.map((t, i) => fly(t.card, slots[i], target, { duration: 450, faceDown: true })));
      heldTrick = null;
      render();
    },
    async chien() {
      await wait(200);
    },
  };

  function captureRects() {
    const hand = new Map();
    for (const n of container.querySelectorAll('.trt-hand [data-card-id]')) hand.set(n.dataset.cardId, n.getBoundingClientRect());
    return { hand };
  }

  async function playBatch(batch) {
    try {
      for (const e of batch.events) {
        try {
          await handlers[e.type]?.(e, batch);
        } catch (err) {
          console.warn('[tarot] animation', e.type, err);
        }
      }
    } finally {
      for (const e of batch.events) if (e.type === 'play') hiddenCards.delete(e.card.id);
      heldTrick = null;
      animating--;
      render();
    }
  }

  function update(state) {
    const before = captureRects();
    const prev = current;
    current = state;
    if (state.phase !== 'playing') showLastTrick = false;
    const maxId = state.events.at(-1)?.id ?? 0;
    if (!prev || lastEventId === null) {
      lastEventId = maxId;
      render();
      return;
    }
    const events = state.events.filter((e) => e.id > lastEventId);
    lastEventId = Math.max(lastEventId, maxId);
    // Rien à animer, ou retard de plus d'un pli (reconnexion...) : on affiche directement l'état.
    if (!events.some((e) => handlers[e.type]) || events.filter((e) => e.type === 'trick').length > 1) {
      render();
      return;
    }
    for (const e of events) if (e.type === 'play') hiddenCards.add(e.card.id);
    // Le serveur vide le pli dès la dernière carte : on le garde affiché pour l'animation.
    const trickDone = events.find((e) => e.type === 'trick');
    if (trickDone) heldTrick = { cards: trickDone.cards, winnerId: null };
    animating++;
    render();
    queue = queue.then(() => playBatch({ events, before }));
  }

  render();

  return {
    update,
    unmount() {
      layer.remove();
      css.remove();
      container.remove();
      document.querySelector('.trt-rules-dialog')?.close();
    },
  };
}
