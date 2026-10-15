import {
  tp, TITLE, comboName, comboTitle, cardsText, placeText, signed, makeOrder, sortForOrder, followText, cardReason,
  checkSelection, richLog,
} from './cards.js';

/* =====================================================================
 * Président : écrans construits avec les composants Tapis (table « salon »)
 * à partir de l'état du serveur (getStateFor) et de l'état local (ui).
 * Les autres joueurs sont assis autour d'une table ovale (moi en bas, ma main
 * sur toute la largeur), la pile du pli au centre. Tout renvoie du HTML ;
 * chaque texte venant d'un joueur passe par un composant Tapis, T.esc ou T.rich.
 * ===================================================================== */

// ================================================================ géométrie

/** Angles des autres joueurs (degrés, sens des aiguilles d'une montre depuis le bas = moi), selon leur nombre. */
const ANGLES = {
  1: [180], 2: [118, 242], 3: [100, 180, 260], 4: [92, 148, 212, 268], 5: [86, 133, 180, 227, 274],
  6: [82, 119, 158, 202, 241, 278], 7: [80, 112, 146, 180, 214, 248, 280],
};
/** Ellipse des sièges (en % de l'arène, la partie de la table au-dessus de ma main). */
const GEO = {
  wide: { cy: 53, rx: 41.5, ry: 41 },
  square: { cy: 54, rx: 38.5, ry: 41 },
};

function geometry(others, shape) {
  const g = GEO[shape] ?? GEO.wide;
  const angles = ANGLES[others.length] ?? ANGLES[7];
  const pos = {};
  others.forEach((p, i) => {
    const a = ((angles[i] ?? 180) * Math.PI) / 180;
    const x = 50 - Math.sin(a) * g.rx;
    const y = g.cy + Math.cos(a) * g.ry;
    pos[p.id] = {
      x, y,
      side: y < g.cy - 14 ? 'top' : 'side',
      lr: x < 36 ? 'left' : x > 64 ? 'right' : 'center',
    };
  });
  return pos;
}

// ================================================================ contexte

export function viewContext(T, s, { me, room, ui, shape }) {
  const names = {};
  const seen = {};
  for (const p of s.players) {
    seen[p.name] = (seen[p.name] ?? 0) + 1;
    names[p.id] = seen[p.name] > 1 ? `${p.name} (${seen[p.name]})` : p.name;
  }
  const i0 = Math.max(0, s.players.findIndex((p) => p.id === me));
  const others = [...s.players.slice(i0 + 1), ...s.players.slice(0, i0)]; // ordre de jeu après moi
  const rp = (id) => room?.players?.find((p) => p.id === id);
  const order = makeOrder({ revolution: s.revolution, twoCloses: s.options.twoCloses });
  return {
    T, s, me, ui, shape, others, order,
    pos: geometry(others, shape),
    meP: s.players.find((p) => p.id === me) ?? null,
    nameOf: (id) => names[id] ?? '?',
    label: (id) => (id === me ? 'Toi' : names[id] ?? '?'),
    avatarOf: (id) => rp(id)?.avatarUrl || undefined,
    offline: (id) => rp(id)?.connected === false,
    isHost: room?.hostId === me,
    hostId: room?.hostId ?? null,
    player: (id) => s.players.find((p) => p.id === id),
    top: s.pile.at(-1) ?? null,
  };
}

const style = (o) => Object.entries(o).map(([k, val]) => `${k}:${typeof val === 'number' ? val.toFixed(2) : val}`).join(';');

// ================================================================ table

export function tableHtml(v) {
  const { s, shape } = v;
  return `<div class="pr-table" data-shape="${shape}" data-players="${s.playerCount}" data-phase="${s.phase}"${s.revolution ? ' data-rev=""' : ''}>`
    + '<div class="pr-arena">'
    + '<div class="pr-felt" aria-hidden="true"><div class="pr-felt__cloth"></div></div>'
    + `<div class="pr-seats">${v.others.map((p) => spotHtml(v, p)).join('')}</div>`
    + `<div class="pr-center">${centerHtml(v)}</div>`
    + '</div>'
    + `<div class="pr-bottom">${bottomInner(v)}</div>`
    + '</div>';
}

export function bottomInner(v) {
  const { T } = v;
  return `<div class="pr-me">${v.meP ? plateHtml(v, v.meP, { me: true }) : ''}</div>`
    + `<div class="pr-status">${T.Status(statusFor(v))}</div>`
    + `<div class="pr-actions">${actionsHtml(v)}</div>`
    + `<div class="pr-hand">${handHtml(v)}</div>`;
}

// ---------------------------------------------------------------- sièges

function seatState(v, p) {
  if (v.offline(p.id)) return 'offline';
  return v.s.currentPlayerId === p.id && !v.ui.held ? 'active' : 'waiting';
}

/** Badges : le titre gagné à la manche précédente, puis (en dernier, pour Tapis.anim.partner) la place de cette manche. */
export function badgesHtml(v, p) {
  const { T } = v;
  const list = [];
  const t = TITLE[p.title];
  if (t) list.push(T.Badge({ label: v.shape === 'tall' ? t.short : t.label, icon: t.icon ?? undefined, tone: t.tone, title: `${t.label} (manche précédente)` }));
  if (p.place) list.push(T.Badge({ label: placeText(p.place), icon: p.place === 1 ? 'trophy' : 'check', tone: p.place === 1 ? 'accent' : 'positive', title: `A fini ${placeText(p.place)}` }));
  return list.length ? `<span class="pr-plate__b">${list.join('')}</span>` : '';
}

function statusLine(v, p, state) {
  const { T, s } = v;
  if (state === 'offline') return '<span class="pr-plate__st" data-tone="off">Déconnecté</span>';
  if (p.place && s.phase !== 'exchange') return `<span class="pr-plate__st" data-tone="done">${T.icon('check')}Fini ${placeText(p.place)}</span>`;
  if (state === 'active') return `<span class="pr-plate__st tp-seat__turn">${T.icon('hourglass')}${p.id === v.me ? 'À toi' : s.pile.length ? 'Joue…' : 'Entame…'}</span>`;
  if (p.passed) return '<span class="pr-plate__st" data-tone="pass">Passe</span>';
  if (s.phase === 'exchange') {
    const pair = s.exchange?.pairs.find((x) => x.receiverId === p.id && !x.done);
    if (pair) return `<span class="pr-plate__st" data-tone="wait">${T.icon('hourglass')}Choisit ${pair.count === 1 ? 'une carte' : `${pair.count} cartes`}…</span>`;
  }
  return '';
}

export function plateHtml(v, p, { me = false } = {}) {
  const { T, s, ui } = v;
  const state = seatState(v, p);
  const count = me ? s.myHand.length : p.cardCount;
  const meta = `${cardsText(count)} · ${p.score} pt${p.score > 1 ? 's' : ''}`;
  const t = TITLE[p.title];
  const label = `${v.nameOf(p.id)}${me ? ' (toi)' : ''}${t ? `, ${t.label}` : ''}, ${meta}${p.place ? `, a fini ${placeText(p.place)}` : ''}${p.passed ? ', passe' : ''}`;
  const bubble = ui.bubbles?.[p.id] ?? (p.passed && !me && v.shape !== 'tall' ? { text: 'Passe', tone: 'pass' } : null);
  return `<section class="tp-seat pr-plate" data-seat="${T.esc(p.id)}" data-state="${state}"${me ? ' data-me=""' : ''}${p.place ? ' data-done=""' : ''}${
    p.title ? ` data-title="${p.title}"` : ''} aria-label="${T.esc(label)}">${bubble ? T.Bubble(bubble) : ''}${
    T.Avatar({ name: v.nameOf(p.id), src: v.avatarOf(p.id), state })}<span class="pr-plate__t"><b class="pr-plate__n title-sm">${T.esc(v.nameOf(p.id))}${
    me ? ' <span class="tp-seat__you caption">(toi)</span>' : ''}</b><span class="pr-plate__m caption tp-seat__meta">${T.esc(cardsText(count))}<span class="pr-plate__pts">${T.esc(meta.slice(cardsText(count).length))}</span></span>${statusLine(v, p, state)}</span>${badgesHtml(v, p)}</section>`;
}

function spotHtml(v, p) {
  const { T } = v;
  const pos = v.pos[p.id];
  const fan = p.cardCount ? `<span class="pr-fan">${T.Fan({ count: p.cardCount, max: 9 })}</span>` : '';
  return `<div class="pr-spot" data-pid="${T.esc(p.id)}" data-side="${pos?.side ?? 'top'}" data-lr="${pos?.lr ?? 'center'}" style="${
    style({ '--x': pos?.x ?? 50, '--y': pos?.y ?? 10 })}">${fan}${plateHtml(v, p)}</div>`;
}

// ---------------------------------------------------------------- centre : la pile du pli

const ROT = [-9, 7, -4, 11, -7, 4, -12, 8, -3, 10];
const DX = [-0.2, 0.18, -0.08, 0.24, -0.16, 0.1, -0.24, 0.14, -0.05, 0.2];
const DY = [0.06, -0.05, 0.08, -0.03, 0.07, -0.06, 0.04, -0.07, 0.05, 0.03];

/** Une combinaison posée sur la pile ; i = sa place dans le pli (sa rotation ne change pas quand d'autres arrivent). */
export function playLayer(T, play, i, depth) {
  const k = i % ROT.length;
  return `<div class="pr-play" data-i="${i}" data-depth="${Math.min(depth, 4)}" data-count="${play.count}" data-pid="${T.esc(play.playerId)}" style="${
    style({ '--r': `${ROT[k]}deg`, '--dx': DX[k], '--dy': DY[k] })}">${play.cards.map((c) => T.Card(tp(c, { size: 'md' }))).join('')}</div>`;
}

export function pileHtml(v, plays) {
  const { T } = v;
  const shown = plays.slice(-5);
  const first = plays.length - shown.length;
  const top = plays.at(-1);
  const label = top ? `Pile : ${comboName(top.rank, top.count, { article: false })} de ${v.label(top.playerId)}` : 'Pile vide';
  return `<div class="pr-pile" data-zone="pile" role="group" aria-label="${T.esc(label)}">${
    shown.length ? shown.map((p, j) => playLayer(T, p, first + j, shown.length - 1 - j)).join('') : `<div class="pr-pile__empty">${T.Slot({ size: 'md', label: 'Entame' })}</div>`}</div>`;
}

function pileCaption(v, plays) {
  const { T } = v;
  const top = plays.at(-1);
  if (!top) return '<span class="pr-cap" data-empty=""></span>';
  return `<span class="pr-cap">${T.Avatar({ name: v.nameOf(top.playerId), src: v.avatarOf(top.playerId), size: 'sm' })}<b class="body-strong">${
    T.esc(v.label(top.playerId))}</b><span class="caption">${T.esc(comboTitle(top.rank, top.count))}</span></span>`;
}

function needLine(v) {
  const { T, s } = v;
  if (s.phase !== 'playing') return '';
  const top = v.top;
  if (!top) return `<p class="pr-need caption">${T.esc('Pli libre : 1 à 4 cartes de même valeur')}</p>`;
  return `<p class="pr-need caption">${T.esc(`Pour suivre : ${followText(top, s.revolution, s.options.twoCloses)}`)}</p>`;
}

/** Cartes déjà jouées cette manche (plis terminés). */
function discardCount(s) {
  if (s.phase === 'exchange') return 0;
  const inHands = s.players.reduce((a, p) => a + p.cardCount, 0);
  const onPile = s.pile.reduce((a, x) => a + x.count, 0);
  return Math.max(0, 52 - inHands - onPile);
}

function revBanner(v) {
  const { T, s } = v;
  if (!s.revolution) return '';
  const text = s.options.twoCloses ? 'Révolution : le 3 est le plus fort, le 2 ferme toujours' : 'Révolution : le 3 est le plus fort, le 2 le plus faible';
  return `<p class="pr-rev" role="status">${T.icon('renew')}<span>${T.esc(text)}</span></p>`;
}

function centerHtml(v) {
  const { T, s, ui } = v;
  if (s.phase === 'exchange') return exchangeHtml(v);
  const ended = s.phase === 'roundEnd' || s.phase === 'gameOver';
  const plays = ui.held ? ui.held : ended && s.lastTrick?.reason === 'end' ? s.lastTrick.plays : s.pile;
  const info = ended ? `Manche ${s.round}/${s.totalRounds} terminée` : `Manche ${s.round}/${s.totalRounds} · Pli ${s.trickNumber}`;
  return `<div class="pr-info label">${T.esc(info)}</div>${revBanner(v)}`
    + `<div class="pr-stack">${pileHtml(v, plays)}<div class="pr-discard">${discardCount(s) ? T.Pile({ pile: 'defausse', count: discardCount(s), size: 'xs', label: 'Défausse' }) : ''}</div></div>`
    + pileCaption(v, plays) + (ui.held ? '' : needLine(v));
}

// ---------------------------------------------------------------- échange de cartes

function exchangeHtml(v) {
  const { T, s } = v;
  const x = s.exchange;
  if (!x) return '';
  const who = (id) => {
    const p = v.player(id);
    const t = TITLE[p?.title];
    return `<span class="pr-x__who">${T.Avatar({ name: v.nameOf(id), src: v.avatarOf(id), size: 'sm' })}<span><b class="body-strong">${T.esc(v.label(id))}</b><span class="caption">${T.esc(t?.label ?? '')}</span></span></span>`;
  };
  const pairs = x.pairs.map((pair) => `<li class="pr-x__pair"${pair.done ? ' data-done=""' : ''}>${who(pair.giverId)}<span class="pr-x__arrow">${
    T.icon('arrow')}<span class="caption">${T.esc(pair.count === 1 ? 'sa meilleure' : `ses ${pair.count} meilleures`)}</span></span>${who(pair.receiverId)}<span class="pr-x__st caption">${
    pair.done ? `${T.icon('check')}Rendu` : `${T.icon('hourglass')}${T.esc(`Choisit ${pair.count === 1 ? '1 carte' : `${pair.count} cartes`}`)}`}</span></li>`).join('');
  const me = x.me;
  let mine = '';
  const cards = (list) => `<span class="pr-x__cards">${(list ?? []).map((c) => T.Card(tp(c, { size: 'sm' }))).join('')}</span>`;
  if (me?.role === 'receiver') {
    mine = `<div class="pr-x__mine" data-zone="received">${cards(me.received)}<span class="body">${T.esc(`${v.nameOf(me.otherId)} t’a donné ${me.count === 1 ? 'sa meilleure carte' : `ses ${me.count} meilleures cartes`}.`)}<br>${
      me.gave ? T.esc('Tu lui as rendu ta part.') : `<b>${T.esc(`Choisis dans ta main ${me.count === 1 ? 'la carte' : `les ${me.count} cartes`} à lui rendre.`)}</b>`}</span></div>`;
  } else if (me?.role === 'giver') {
    mine = `<div class="pr-x__mine" data-zone="given">${cards(me.gave)}<span class="body">${T.esc(`Tu donnes ${me.count === 1 ? 'ta meilleure carte' : `tes ${me.count} meilleures cartes`} à ${v.nameOf(me.otherId)}.`)}<br>${
      T.esc(me.received ? 'Tu as reçu tes cartes en retour.' : `${me.count === 1 ? 'Une carte de son choix te reviendra' : `${me.count} cartes de son choix te reviendront`}.`)}</span></div>`;
  }
  return `<section class="pr-x" data-zone="exchange" aria-labelledby="pr-x-h"><header class="pr-x__h"><span class="label">${
    T.esc(`Manche ${s.round}/${s.totalRounds}`)}</span><h2 class="title-md" id="pr-x-h">Échange des cartes</h2></header><ul class="pr-x__pairs">${pairs}</ul>${mine}</section>`;
}

// ---------------------------------------------------------------- statut, actions, main

export function statusFor(v) {
  const { s, me, ui } = v;
  const cur = s.currentPlayerId;
  const round = `Manche ${s.round}/${s.totalRounds}`;
  if (ui.held) {
    const w = ui.heldWinner;
    if (w) return { tone: 'info', text: w === me ? 'Tu remportes le pli' : `${v.nameOf(w)} remporte le pli`, detail: ui.heldReason };
    return { tone: 'info', text: 'Dernier pli', detail: round };
  }
  if (s.phase === 'exchange') {
    const x = s.exchange?.me;
    if (x?.role === 'receiver' && !x.gave) {
      return { tone: 'turn', text: `Rends ${x.count === 1 ? 'une carte' : `${x.count} cartes`} à ${v.nameOf(x.otherId)}`, detail: `${ui.sel.length}/${x.count} choisie${x.count > 1 ? 's' : ''} · celles que tu veux` };
    }
    if (x?.role === 'giver' && !x.received) return { tone: 'wait', text: `${v.nameOf(x.otherId)} choisit ${x.count === 1 ? 'la carte' : 'les cartes'} à te rendre…`, detail: round };
    return { tone: 'wait', text: 'Échange des cartes…', detail: round };
  }
  if (s.phase === 'playing') {
    if (cur && cur !== me && v.offline(cur)) return { tone: 'alert', text: `Connexion perdue avec ${v.nameOf(cur)}`, detail: 'La partie reprend à son retour' };
    if (s.isMyTurn) {
      if (!v.top) return { tone: 'turn', text: 'À toi d’entamer', detail: 'Pose 1 à 4 cartes de même valeur' };
      return { tone: 'turn', text: 'À toi de jouer', detail: `Bats ${comboName(v.top.rank, v.top.count)} ou passe` };
    }
    if (v.meP?.place) return { tone: 'win', text: `Tu as fini ${placeText(v.meP.place)}`, detail: `${v.nameOf(cur)} ${v.top ? 'joue' : 'entame'}…` };
    return { tone: 'wait', text: `${v.nameOf(cur)} ${v.top ? 'joue' : 'entame'}…`, detail: round };
  }
  const sum = s.summary;
  if (s.phase === 'roundEnd' && sum) {
    const pres = sum.order[0];
    const trou = sum.order.at(-1);
    return { tone: 'info', text: 'Manche terminée', detail: `Président : ${v.label(pres)} · Trouduc : ${v.label(trou)}` };
  }
  return { tone: 'win', text: 'Partie terminée', detail: winnerText(v) };
}

export function selectionCards(v) {
  const sel = new Set(v.ui.sel);
  return v.s.myHand.filter((c) => sel.has(c.id));
}

export function actionsHtml(v) {
  const { T, s, ui } = v;
  if (ui.held) return '';
  if (s.phase === 'playing' && s.isMyTurn) {
    const chk = checkSelection(selectionCards(v), s);
    const label = chk.ok ? `Jouer · ${comboName(chk.rank, chk.count, { article: false })}` : 'Jouer';
    return T.ActionBar({
      secondary: [{
        label: 'Passer', icon: 'pass', disabled: !s.canPass, // à l'entame, l'indication du bouton Jouer suffit
        attrs: { 'data-act': 'pass' },
      }],
      primary: { label, icon: 'arrow', disabled: !chk.ok, reason: chk.ok ? undefined : chk.reason, kbd: v.shape === 'wide' && chk.ok ? 'Entrée' : undefined, attrs: { 'data-act': 'play' } },
    });
  }
  if (s.phase === 'exchange') {
    const x = s.exchange?.me;
    if (x?.role === 'receiver' && !x.gave) {
      const left = x.count - ui.sel.length;
      return T.ActionBar({
        primary: {
          label: `Rendre ${x.count === 1 ? 'cette carte' : 'ces cartes'}`, icon: 'arrow', disabled: left !== 0,
          reason: left > 0 ? `Choisis encore ${left === 1 ? '1 carte' : `${left} cartes`}` : undefined, attrs: { 'data-act': 'give' },
        },
      });
    }
    return '';
  }
  if (s.phase === 'roundEnd' && ui.view !== 'summary') {
    return T.ActionBar({
      secondary: [{ label: 'Résultat', icon: 'scores', attrs: { 'data-act': 'summary' } }],
      primary: nextButton(v),
    });
  }
  if (s.phase === 'gameOver' && !ui.view) {
    return T.ActionBar({
      secondary: [{ label: 'Dernière manche', icon: 'scores', attrs: { 'data-act': 'summary' } }],
      primary: { label: 'Classement', icon: 'trophy', attrs: { 'data-act': 'ranking' } },
    });
  }
  return '';
}

/** Mode de la main : 'play' (mon tour), 'give' (cartes à rendre), ou null (on regarde). */
export function handMode(v) {
  const { s, ui } = v;
  if (ui.held) return null;
  if (s.phase === 'playing' && s.isMyTurn) return 'play';
  if (s.phase === 'exchange' && s.exchange?.me?.role === 'receiver' && !s.exchange.me.gave) return 'give';
  return null;
}

/**
 * Ma main : même balisage que Tapis.Hand (Tapis.interact.hand la pilote), mais groupée par valeur (un espace entre
 * deux valeurs), triée dans l'ordre du moment.
 */
export function handHtml(v) {
  const { T, s, ui } = v;
  const mode = handMode(v);
  const cards = sortForOrder(s.myHand, v.order);
  const sel = new Set(ui.sel);
  const received = s.trickNumber === 1 && ['exchange', 'playing'].includes(s.phase) && s.exchange?.me?.received
    ? new Set(s.exchange.me.received.map((c) => c.id)) : new Set();
  const props = (c) => {
    const o = {};
    if (received.has(c.id)) o.tag = 'Reçue';
    if (mode === 'play') {
      const why = cardReason(c, s.myHand, v.top, s);
      o.state = why ? 'unplayable' : 'playable';
      if (why) o.reason = why;
    }
    if (mode && sel.has(c.id)) o.selected = true;
    return o;
  };
  const interactive = mode !== null;
  const n = cards.length;
  const tracks = [];
  const col = [];
  let prev = null;
  cards.forEach((c, i) => {
    if (prev != null && c.rank !== prev) tracks.push('minmax(0, var(--hand-gap))');
    tracks.push(i === n - 1 ? 'var(--cw)' : 'minmax(0, var(--step))');
    col.push(tracks.length);
    prev = c.rank;
  });
  const per = Math.ceil(n / 2);
  const t2 = Array.from({ length: per }, (_, k) => (k === per - 1 ? 'var(--cw)' : 'minmax(0, var(--step))'));
  const slots = cards.map((c, i) => {
    const r2 = i < per ? 1 : 2;
    const c2 = i < per ? i + 1 : i - per + 1;
    const card = T.Card({ size: 'md', interactive, attrs: { tabindex: interactive ? (i === 0 ? '0' : '-1') : null }, ...tp(c, props(c)) });
    return `<div class="tp-hand__slot" data-slot="${i}" style="--c:${col[i]};--c2:${c2};--r2:${r2};--i:${i}">${card}</div>`;
  }).join('');
  const label = `Ta main, ${cardsText(n)}`;
  if (!n) {
    const msg = v.meP?.place ? `Tu as fini ${placeText(v.meP.place)} : plus de cartes` : 'Pas de cartes';
    return `<div class="tp-hand pr-hand--empty" data-zone="hand"><p class="caption">${T.esc(msg)}</p></div>`;
  }
  return `<div class="tp-hand" data-zone="hand" data-layout="row" data-size="md"${mode ? ' data-multi=""' : ''}${n <= 7 ? ' data-few=""' : ''} role="group" aria-label="${T.esc(label)}" style="--n:${n};--tpl1:${
    tracks.join(' ')};--tpl2:${t2.join(' ')};--mid:${(n - 1) / 2}"><div class="tp-hand__grid">${slots}</div></div>`;
}

// ================================================================ fenêtres et tiroirs

/** « Malo donne ses 2 meilleures cartes à Léa, qui lui en rend 2 », à la bonne personne quand il s'agit de moi. */
function exchangeLine(v, giver, receiver, count) {
  const best = count === 1 ? 'meilleure carte' : `${count} meilleures cartes`;
  if (giver === v.me) return `Tu donnes ${count === 1 ? 'ta' : 'tes'} ${best} à ${v.nameOf(receiver)}, qui t’en rend ${count}`;
  if (receiver === v.me) return `${v.nameOf(giver)} te donne ${count === 1 ? 'sa' : 'ses'} ${best}, tu lui en rends ${count}`;
  return `${v.nameOf(giver)} donne ${count === 1 ? 'sa' : 'ses'} ${best} à ${v.nameOf(receiver)}, qui lui en rend ${count}`;
}

/** Résumé de manche : même balisage que le résumé de donne de Tapis (Tapis.anim.summary l'anime). */
function roundSummaryHtml(v, sum) {
  const { T, s, me } = v;
  const pres = sum.order[0];
  const verdict = pres === me ? 'Tu es Président' : `${v.nameOf(pres)} est Président`;
  const n = sum.order.length;
  const by = (title) => sum.order.find((id) => sum.titles[id] === title);
  const lines = [];
  const last = sum.round >= s.totalRounds;
  if (!last) {
    const tr = by('trouduc');
    lines.push(['Échange', exchangeLine(v, tr, pres, 2)]);
    const vt = by('vice-trouduc');
    const vp = by('vice-president');
    if (vt && vp) lines.push(['Échange', exchangeLine(v, vt, vp, 1)]);
    lines.push(['Entame', tr === me ? 'Toi, le Trouduc' : `${v.nameOf(tr)}, le Trouduc`]);
  } else {
    lines.push(['Dernière manche', `${n} joueurs, ${s.totalRounds} manches jouées`]);
  }
  const gains = sum.order.map((id, i) => {
    const t = TITLE[sum.titles[id]];
    return `<li data-sign="+"${id === me ? ' data-me=""' : ''}><span class="pr-deal__place stat tp-num">${placeText(i + 1)}</span>${
      T.Avatar({ name: v.nameOf(id), src: v.avatarOf(id), size: 'sm' })}<span class="body"><span class="pr-deal__name">${T.esc(v.nameOf(id))}${id === me ? ' <span class="caption">(toi)</span>' : ''}</span><span class="pr-deal__sub">${
      T.Badge({ label: t.label, icon: t.icon ?? undefined, tone: t.tone })}<span class="caption">${T.esc(`total ${sum.totals[id]}`)}</span></span></span><b class="stat tp-num">+${sum.points[id]}</b></li>`;
  }).join('');
  return `<div class="tp-deal pr-deal" data-zone="deal-summary" data-made="true"><p class="tp-deal__verdict title-md">${T.icon('crown')}${T.esc(verdict)}</p>`
    + `<dl class="tp-deal__lines">${lines.map(([k, val]) => `<div class="tp-deal__l"><dt class="caption">${T.esc(k)}</dt><dd class="body">${T.esc(val)}</dd></div>`).join('')}</dl>`
    + `<ul class="tp-deal__gains">${gains}</ul></div>`;
}

/** « Manche suivante » : seul l'hôte lance la manche, pour que chacun ait le temps de lire le résumé. */
function nextButton(v) {
  const host = v.hostId && v.player(v.hostId) ? v.nameOf(v.hostId) : null;
  const wait = !v.isHost && !!host;
  return {
    label: 'Manche suivante', icon: 'arrow', disabled: wait, reason: wait ? `${host} lance la manche suivante` : undefined, attrs: { 'data-act': 'next' },
  };
}

export function summaryDialog(v) {
  const { T, s } = v;
  const sum = s.summary;
  if (!sum) return '';
  const last = s.phase === 'gameOver';
  const actions = T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })
    + (last
      ? T.Button({ variant: 'primary', icon: 'trophy', label: 'Voir le classement', attrs: { 'data-act': 'ranking' } })
      : T.Button({ variant: 'primary', ...nextButton(v) }));
  return T.Dialog({
    id: 'resume', kicker: last ? 'Dernière manche' : `Manche ${sum.round}/${s.totalRounds}`, title: 'Fin de la manche',
    size: 'lg', body: roundSummaryHtml(v, sum), actions,
  });
}

const REASON = { two: 'Le 2 ferme le pli', top: 'Personne ne peut faire mieux', passes: 'Tous les autres ont passé', end: 'Dernières cartes de la manche' };

export function lastTrickDialog(v) {
  const { T, s } = v;
  const lt = s.lastTrick;
  let body;
  if (!lt) body = '<p class="body">Aucun pli terminé pour l’instant.</p>';
  else {
    const rows = lt.plays.map((p) => `<li${p === lt.plays.at(-1) ? ' data-win=""' : ''}>${T.Avatar({ name: v.nameOf(p.playerId), src: v.avatarOf(p.playerId), size: 'sm' })}<span class="pr-lt__n"><b class="body-strong">${
      T.esc(v.label(p.playerId))}</b><span class="caption">${T.esc(comboTitle(p.rank, p.count))}</span></span><span class="pr-lt__c">${
      p.cards.map((c) => T.Card(tp(c, { size: 'sm', state: p === lt.plays.at(-1) ? 'winner' : '' }))).join('')}</span></li>`).join('');
    body = `<p class="caption pr-lt__why">${T.esc(`${REASON[lt.reason] ?? ''}${lt.reason !== 'end' ? ` : ${v.label(lt.winnerId).replace(/^Toi$/, 'tu')} ${lt.winnerId === v.me ? 'remportes' : 'remporte'} le pli.` : '.'}`)}</p><ol class="pr-lt">${rows}</ol>`;
  }
  return T.Dialog({ id: 'dernier-pli', kicker: lt ? `Pli ${lt.number}` : 'Président', title: 'Dernier pli', body });
}

/** « Léa gagne avec 30 points », « Tu gagnes… », « Égalité entre Léa et toi… ». */
export function winnerText(v) {
  const { s, me } = v;
  const best = Math.max(...s.players.map((p) => p.score));
  const winners = s.players.filter((p) => p.score === best);
  if (winners.length > 1) {
    const names = winners.map((p) => (p.id === me ? 'toi' : v.nameOf(p.id)));
    return `Égalité entre ${names.slice(0, -1).join(', ')} et ${names.at(-1)} avec ${best} points`;
  }
  return winners[0].id === me ? `Tu gagnes avec ${best} points` : `${v.nameOf(winners[0].id)} gagne avec ${best} points`;
}

export function scoreSheet(v) {
  const { T, s, me } = v;
  const order = [me, ...v.others.map((p) => p.id)].filter((id) => s.players.some((p) => p.id === id));
  if (!s.history.length) return '<p class="caption pr-empty">Aucune manche terminée pour l’instant.</p>';
  const head = order.map((id) => `<th scope="col"${id === me ? ' data-me="true"' : ''}>${T.esc(v.nameOf(id))}</th>`).join('');
  const rows = s.history.map((h) => `<tr><th scope="row" class="tp-num">${h.round}</th>${order.map((id) => {
    const t = TITLE[h.titles[id]];
    return `<td${id === me ? ' data-me="true"' : ''}><b class="tp-num">+${h.points[id]}</b> <span class="caption" data-title="${h.titles[id]}">${T.esc(t?.short ?? '')}</span></td>`;
  }).join('')}</tr>`).join('');
  const totals = order.map((id) => `<td${id === me ? ' data-me="true"' : ''}><b class="tp-num">${v.player(id).score}</b></td>`).join('');
  return `<div class="pr-ss-wrap"><table class="tp-ss pr-ss"><thead><tr><th scope="col">Manche</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th>${totals}</tr></tfoot></table></div>`;
}

export function endScreen(v) {
  const { T, s, me } = v;
  const ranking = [...s.players].sort((a, b) => b.score - a.score);
  const places = ranking.map((p) => 1 + ranking.filter((o) => o.score > p.score).length);
  const best = ranking[0].score;
  const iWon = v.meP?.score === best;
  const pres = (id) => s.history.filter((h) => h.titles[id] === 'president').length;
  const tied = (p) => ranking.some((o) => o !== p && o.score === p.score);
  const note = v.isHost ? 'Utilise « Retour au salon » en haut pour relancer une partie.' : 'En attente de l’hôte pour revenir au salon.';
  let i = 0;
  const html = T.EndScreen({
    result: iWon ? 'victoire' : 'fin',
    title: iWon ? (ranking.filter((p) => p.score === best).length > 1 ? 'Victoire partagée' : 'Tu remportes la partie') : 'Fin de partie',
    subtitle: `${s.totalRounds} manches jouées. ${winnerText(v)}.`,
    ranking: ranking.map((p) => ({
      name: v.nameOf(p.id), avatar: v.avatarOf(p.id), me: p.id === me, score: `${p.score} pts`,
      note: tied(p) ? 'ex aequo' : pres(p.id) ? `${pres(p.id)} fois Président` : undefined,
    })),
    extra: `<div class="pr-end-sheet">${scoreSheet(v)}</div>`,
    actions: `${T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })}${
      T.Button({ variant: 'ghost', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'close-end' } })}<p class="caption pr-end-note">${T.esc(note)}</p>`,
  });
  // places partagées par les ex aequo (1, 1, 3…) : Tapis numérote d'après la position dans la liste
  return html.replace(/<li class="tp-rank__r"([^>]*)><span class="tp-rank__pos stat">\d+<\/span>/g, (m, rest) => {
    const place = places[i++];
    return `<li class="tp-rank__r"${rest}><span class="tp-rank__pos stat">${place}</span>`;
  });
}

export function journalHtml(v) {
  const { T, s } = v;
  if (!s.log.length) return '<p class="caption">Rien pour l’instant.</p>';
  return T.Log({
    entries: [...s.log].reverse().map((e) => ({ text: richLog(e.text), tone: e.tone === 'round' ? 'hand' : ['good', 'alert'].includes(e.tone) ? e.tone : undefined })),
  });
}

export { signed };
