import { tp, fmt, signed, actionText, chipList, chipColumns, richLog, STREET_LABEL } from './cards.js';

/* =====================================================================
 * Poker : écrans construits avec les composants Tapis (table « salon »)
 * à partir de l'état du serveur (getStateFor) et de l'état local (ui).
 * La table est ovale : les sièges sont posés autour, moi en bas au centre.
 * Tout renvoie du HTML ; chaque texte venant d'un joueur passe par un
 * composant Tapis, Tapis.esc ou Tapis.rich.
 * ===================================================================== */

// ================================================================ géométrie de la table

/** Angles des autres joueurs (degrés, sens des aiguilles d'une montre depuis le bas), selon leur nombre. */
const ANGLES = {
  1: [180], 2: [125, 235], 3: [95, 180, 265], 4: [75, 140, 220, 285],
  5: [62, 115, 180, 245, 298], 6: [55, 100, 150, 210, 260, 305], 7: [55, 95, 137, 180, 223, 265, 305],
};
/**
 * Écran en hauteur (téléphone) : places fixes, dans le sens des aiguilles d'une montre depuis ma gauche ;
 * une rangée en haut, deux de chaque côté, personne à hauteur du tableau.
 */
const TALL = {
  1: [[50, 12.5]],
  2: [[24, 14], [76, 14]],
  3: [[15, 25], [50, 12.5], [85, 25]],
  4: [[20, 51], [24, 14], [76, 14], [80, 51]],
  5: [[20, 51], [14, 26], [50, 12.5], [86, 26], [80, 51]],
  6: [[20, 51], [14, 26], [33, 12.5], [67, 12.5], [86, 26], [80, 51]],
  7: [[20, 51], [13, 27], [18, 12.5], [50, 12.5], [82, 12.5], [87, 27], [80, 51]],
};
/** Ellipse des sièges (en % de la zone) : centre vertical, rayons, place du joueur, recul des mises. */
const GEO = {
  wide: { cy: 41, rx: 40.5, ry: 31.5, me: [50, 86], betF: 0.43, meBet: 0.71 },
  square: { cy: 38, rx: 38.5, ry: 27.5, me: [50, 70], betF: 0.45, meBet: 0.72, minY: 16.5 },
  tall: { cy: 37, rx: 36, ry: 22.5, me: [50, 70], betF: 0.42, meBet: 0.7 },
};

export function geometry(s, me, shape) {
  const g = GEO[shape] ?? GEO.wide;
  const i0 = s.players.findIndex((p) => p.id === me);
  const around = i0 >= 0 ? [...s.players.slice(i0 + 1), ...s.players.slice(0, i0)] : [...s.players];
  // les joueurs éliminés quittent la table : les autres se répartissent autour (l'ordre est gardé)
  const order = around.filter((p) => !p.out || p.inHand);
  const angles = ANGLES[order.length] ?? ANGLES[7];
  const pos = {};
  const place = (id, x, y, isMe) => {
    const vx = 50 - x;
    const vy = g.cy - y;
    const f = isMe ? g.meBet : g.betF;
    let bx = isMe ? 50 : x + vx * f;
    let by = isMe ? g.cy + g.ry * (1 - g.meBet) + 3 : y + vy * f;
    let anchor = 'c';
    let row = '';
    if (shape === 'wide' && !isMe && Math.abs(bx - 50) > 15 && Math.abs(by - g.cy) < 12) {
      // PC : une mise en diagonale ne se pose pas sur un coin du tableau ; elle reste à hauteur de son siège
      by = y < g.cy ? Math.max(y, Math.min(by, g.cy - 12)) : Math.min(y, Math.max(by, g.cy + 12));
    }
    if (shape === 'square' && !isMe && (x < 38 || x > 62) && Math.abs(y - g.cy) < 14) {
      // tablette : un siège de côté a ses cartes entre lui et le tableau ; sa mise passe juste dessous
      // (à hauteur du tableau) ou au-dessus / au-dessous de ses cartes, côté extérieur
      bx = x + vx * 0.42;
      by = Math.abs(y - g.cy) < 8 || y > g.cy ? y + 7.5 : y - 7.5;
    }
    if (shape === 'tall') {
      // téléphone : la mise se pose sous la plaque (rangée du haut) ou à côté, vers le centre ; pour les côtés,
      // le CSS l'accroche au bord intérieur de la plaque (data-anchor), loin des cartes et de la plaque
      row = isMe ? '' : y < 18 ? 'top' : 'side';
      bx = x;
      by = isMe ? g.me[1] - 16 : row === 'top' ? y + 7.2 : y;
      if (row === 'side') anchor = x < 50 ? 'l' : 'r';
    }
    // le bouton du donneur : à côté de la mise, du côté de la ligne médiane de la table (loin des cartes du siège)
    const len = Math.hypot(vx, vy) || 1;
    let px = -vy / len;
    let py = vx / len;
    const off = 6;
    if (shape === 'square') {
      // tablette : du côté de la ligne médiane (les cartes des sièges de côté sont entre la plaque et le tableau)
      if (Math.abs(py) > 0.2 && py * (g.cy - by) < 0) { px = -px; py = -py; }
    } else {
      // PC : du côté le plus loin du centre (jamais sur le tableau)
      const far = (k) => ((bx + k * px * off - 50) / g.rx) ** 2 + ((by + k * py * off * 0.8 - g.cy) / g.ry) ** 2;
      if (far(-1) > far(1)) { px = -px; py = -py; }
    }
    pos[id] = {
      x, y, bx, by, anchor, row,
      dx: shape === 'tall' ? bx + (bx <= 50 ? 12 : -12) : bx + px * off,
      dy: shape === 'tall' ? by : by + py * off * 0.8,
      side: isMe ? 'me' : y < g.cy - 6 ? 'top' : 'bottom',
      lr: x < 38 ? 'left' : x > 62 ? 'right' : 'center',
    };
  };
  order.forEach((p, i) => {
    if (shape === 'tall') {
      const [x, y] = (TALL[order.length] ?? TALL[7])[i] ?? [50, 12.5];
      place(p.id, x, y, false);
      return;
    }
    const a = ((angles[i] ?? 180) * Math.PI) / 180;
    const x = 50 - Math.sin(a) * g.rx;
    let y = g.cy + Math.cos(a) * g.ry;
    // tablette : un siège du haut, hors du milieu, reste sous le niveau des blindes et les outils
    if (g.minY && Math.abs(x - 50) > 10) y = Math.max(y, g.minY);
    place(p.id, x, y, false);
  });
  if (i0 >= 0) place(me, g.me[0], g.me[1], true);
  return { pos, cy: g.cy };
}

// ================================================================ contexte

export function viewContext(T, s, { me, room, ui, shape }) {
  const names = {};
  const seen = {};
  for (const p of s.players) {
    seen[p.name] = (seen[p.name] ?? 0) + 1;
    names[p.id] = seen[p.name] > 1 ? `${p.name} (${seen[p.name]})` : p.name;
  }
  const rp = (id) => room?.players?.find((p) => p.id === id);
  const meP = s.players.find((p) => p.id === me) ?? null;
  return {
    T, s, me, ui, shape, meP,
    geo: geometry(s, me, shape),
    nameOf: (id) => names[id] ?? '?',
    label: (id) => (id === me ? 'Toi' : names[id] ?? '?'),
    avatarOf: (id) => rp(id)?.avatarUrl || undefined,
    offline: (id) => rp(id)?.connected === false,
    isHost: room?.hostId === me,
    player: (id) => s.players.find((p) => p.id === id),
  };
}

const style = (o) => Object.entries(o).map(([k, val]) => `${k}:${typeof val === 'number' ? val.toFixed(2) : val}`).join(';');

// ================================================================ jetons

/** Une pastille : couleur selon la valeur (tokens du système). */
const chip = (d, i) => `<i class="pk-chip" data-v="${d}" style="--i:${i}"></i>`;

/** Pile de jetons pour un montant, avec son libellé. */
export function chipsHtml(amount, { label = true, size = '', max = 7, cls = '' } = {}) {
  const list = chipList(amount, max);
  return `<span class="pk-chips${size ? ` pk-chips--${size}` : ''}${cls ? ` ${cls}` : ''}" data-amount="${amount}"><span class="pk-stack" style="--n:${list.length}">${
    list.map(chip).join('')}</span>${label ? `<b class="pk-chips__v tp-num">${fmt(amount)}</b>` : ''}</span>`;
}

/** Gros tas (pot) : plusieurs colonnes. */
function potPile(amount) {
  const cols = chipColumns(amount, 7, 4);
  return `<span class="pk-pile">${cols.map((col) => `<span class="pk-stack" style="--n:${col.length}">${col.map(chip).join('')}</span>`).join('')}</span>`;
}

// ================================================================ table

export function tableHtml(v) {
  const { s, shape } = v;
  const shown = s.players.filter((p) => !p.out || p.inHand);
  return `<div class="pk-table" data-shape="${shape}" data-players="${s.players.length}" data-seats="${shown.length}" data-phase="${s.phase}" data-street="${s.street ?? ''}">`
    + '<div class="pk-felt" aria-hidden="true"><div class="pk-felt__cloth"></div></div>'
    + infoHtml(v)
    + `<div class="pk-center" style="${style({ '--y': v.geo.cy })}">${potHtml(v)}${boardHtml(v)}${resultHtml(v)}</div>`
    + s.players.map((p) => betHtml(v, p)).join('')
    + dealerHtml(v)
    + shown.filter((p) => p.id !== v.me).map((p) => seatHtml(v, p)).join('')
    + heroHtml(v)
    + `<div class="pk-act" data-zone="actions">${actionsInner(v)}</div>`
    + '</div>';
}

function infoHtml(v) {
  const { T, s } = v;
  const b = s.blinds;
  const next = b.handsLeft > 0
    ? `Prochain niveau ${fmt(b.next.sb)}/${fmt(b.next.bb)} dans ${b.handsLeft} main${b.handsLeft > 1 ? 's' : ''}`
    : `Dernière main du niveau : ensuite ${fmt(b.next.sb)}/${fmt(b.next.bb)}`;
  const left = s.players.filter((p) => !p.out).length;
  return `<section class="pk-info" data-zone="level" aria-label="Blindes">`
    + `<span class="pk-info__k label">Niveau ${b.level} · main ${s.handNumber}</span>`
    + `<b class="pk-info__b tp-num">${T.icon('bolt')}${fmt(b.sb)}/${fmt(b.bb)}</b>`
    + `<span class="pk-info__n caption">${T.esc(next)}</span>`
    + `<span class="pk-info__n caption">${T.icon('user')}${left}/${s.players.length} en jeu</span></section>`;
}

function potHtml(v) {
  const { s } = v;
  if (s.phase !== 'betting') return '<div class="pk-pot" data-zone="pot" data-empty=""></div>';
  return `<div class="pk-pot" data-zone="pot"${s.pot ? '' : ' data-empty=""'}>${potGroups(v, s.pots)}</div>`;
}

/** Les pots (principal et annexes) : un tas par pot et son montant. */
export function potGroups(v, pots) {
  const { T } = v;
  if (!pots?.length) return '';
  if (v.shape === 'tall' && pots.length > 1) {
    // téléphone : un seul tas, le détail des pots en légende
    const total = pots.reduce((a, p) => a + p.amount, 0);
    return `<div class="pk-pot__g" data-pot="0">${potPile(total)}<span class="pk-pot__l"><span class="label">${pots.length} pots</span><b class="tp-num">${fmt(total)}</b></span></div>`;
  }
  return pots.map((p, i) => `<div class="pk-pot__g" data-pot="${i}">${potPile(p.amount)}<span class="pk-pot__l"><span class="label">${
    pots.length === 1 ? 'Pot' : i === 0 ? 'Principal' : `Annexe${pots.length > 2 ? ` ${i}` : ''}`}</span><b class="tp-num">${fmt(p.amount)}</b></span>${
    i > 0 ? `<span class="tp-vh">${T.esc(`entre ${p.eligible.map((id) => v.label(id)).join(', ')}`)}</span>` : ''}</div>`).join('');
}

/** Cartes qui comptent à l'abattage : celles des gagnants (meilleure combinaison). */
function showdownMarks(v) {
  const { s } = v;
  const lh = s.lastHand;
  if (s.phase === 'betting' || !lh?.showdown) return null;
  const winners = new Set(Object.keys(lh.awards ?? {}));
  const win = new Set();
  for (const h of lh.hands) if (winners.has(h.playerId)) h.best.forEach((id) => win.add(id));
  return { win, winners };
}

function boardHtml(v) {
  const { T, s } = v;
  const marks = showdownMarks(v);
  const slots = [];
  for (let i = 0; i < 5; i++) {
    const c = s.board[i];
    if (!c) {
      slots.push(`<span class="pk-board__s" data-slot="${i}">${T.Slot({ size: 'md' })}</span>`);
      continue;
    }
    const state = marks ? (marks.win.has(c.id) ? 'winner' : '') : '';
    slots.push(`<span class="pk-board__s" data-slot="${i}"${marks && !marks.win.has(c.id) ? ' data-dim=""' : ''}>${T.Card(tp(c, { size: 'md', state }))}</span>`);
  }
  const label = s.board.length ? `Tableau : ${s.board.map((c) => T.cardInfo(tp(c)).label).join(', ')}` : 'Tableau vide';
  return `<div class="pk-board" data-zone="board" role="group" aria-label="${T.esc(label)}">${slots.join('')}</div>`;
}

/** Fin de main : qui gagne quoi, sur le tapis sous le tableau. */
export function resultLines(v) {
  const { s } = v;
  const lh = s.lastHand;
  if (!lh) return [];
  const multi = lh.pots.length > 1;
  return lh.pots.map((pot, i) => {
    const names = pot.winners.map((id) => (id === v.me ? 'toi' : v.nameOf(id)));
    const who = pot.winners.length > 1
      ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`.replace(/^toi/, 'Toi')
      : names[0] === 'toi' ? 'Tu' : names[0];
    const verb = pot.winners.length > 1 ? (pot.winners.includes(v.me) ? 'vous partagez' : 'se partagent') : pot.winners[0] === v.me ? 'remportes' : 'remporte';
    const what = multi ? (i === 0 ? 'le pot principal' : `le pot annexe${lh.pots.length > 2 ? ` ${i}` : ''}`) : 'le pot';
    const how = lh.uncontested ? 'sans abattage' : pot.description ? `${pot.description}${pot.kicker ? `, ${pot.kicker}` : ''}` : 'seul en lice';
    return { text: `${who} ${verb} ${what} (${fmt(pot.amount)})`, detail: how, me: pot.winners.includes(v.me) };
  });
}

function resultHtml(v) {
  const { T, s } = v;
  if (s.phase === 'betting' || !s.lastHand) return '';
  if (v.shape === 'tall' && s.phase === 'handEnd') return '';
  // tablette : deux lignes au plus, dans la largeur du tableau (les cartes montrées des sièges de côté restent visibles)
  if (v.shape === 'square') return compactResult(v);
  const lines = resultLines(v);
  const out = (s.lastHand.eliminated ?? []).map((e) => `<li class="pk-result__out">${T.icon('skull')}<span class="body">${
    T.esc(`${e.playerId === v.me ? 'Tu quittes' : `${v.nameOf(e.playerId)} quitte`} la table · ${e.place}e place`)}</span></li>`).join('');
  return `<section class="pk-result" data-zone="result" aria-label="Résultat de la main"><ul>${lines.map((l) => `<li${l.me ? ' data-me=""' : ''}>${T.icon('trophy')}<span><b class="body-strong">${
    T.esc(l.text)}</b><span class="caption">${T.esc(l.detail)}</span></span></li>`).join('')}${out}</ul></section>`;
}

/**
 * Téléphone : le résultat tient en deux lignes au plus au-dessus des boutons (le détail est dans « Détails »).
 * Ligne 1 : mon pot, sinon le pot principal ; ligne 2 : les autres pots et les joueurs qui quittent la table.
 */
function compactResult(v) {
  const { T, s } = v;
  const lines = resultLines(v);
  const first = lines.find((l) => l.me) ?? lines[0];
  const extra = [];
  const out = s.lastHand.eliminated ?? [];
  const meOut = out.find((e) => e.playerId === v.me);
  const others = out.filter((e) => e.playerId !== v.me);
  if (meOut) extra.push(`Tu finis ${meOut.place}e`);
  if (lines.length > 1) extra.push(`${lines.length - 1} autre${lines.length > 2 ? 's' : ''} pot${lines.length > 2 ? 's' : ''}`);
  if (others.length === 1 && !extra.length) extra.push(`${v.nameOf(others[0].playerId)} quitte la table`);
  else if (others.length) extra.push(`${others.length} éliminé${others.length > 1 ? 's' : ''}`);
  const more = extra.join(' · ');
  const li = first ? `<li${first.me ? ' data-me=""' : ''}>${T.icon('trophy')}<span><b class="body-strong">${T.esc(first.text)}</b><span class="caption">${T.esc(first.detail)}</span></span></li>` : '';
  const li2 = more ? `<li${out.length ? ' class="pk-result__out"' : ''}>${T.icon(out.length ? 'skull' : 'trophy')}<span class="body">${T.esc(more)}</span></li>` : '';
  return `<section class="pk-result pk-result--compact" data-zone="result" aria-label="Résultat de la main"><ul>${li}${li2}</ul></section>`;
}

export function betHtml(v, p) {
  const pos = v.geo.pos[p.id];
  if (!pos) return '';
  const amount = v.s.phase === 'betting' ? p.bet : 0;
  return `<div class="pk-bet" data-bet="${v.T.esc(p.id)}" data-side="${pos.side}" data-anchor="${pos.anchor}" style="${style({ '--x': pos.bx, '--y': pos.by })}"${amount ? '' : ' data-empty=""'}>${
    amount ? chipsHtml(amount) : ''}</div>`;
}

function dealerHtml(v) {
  const { s } = v;
  const pos = v.geo.pos[s.buttonId];
  if (!pos || v.shape === 'tall') return ''; // téléphone : le bouton est un badge de la plaque (badges)
  return `<span class="pk-dealer" style="${style({ '--x': pos.dx, '--y': pos.dy })}" role="img" aria-label="${v.T.esc(`Bouton du donneur : ${v.label(s.buttonId)}`)}">D</span>`;
}

// ---------------------------------------------------------------- sièges

function seatState(v, p) {
  if (v.offline(p.id) && !p.out) return 'offline';
  return v.s.currentPlayerId === p.id ? 'active' : 'waiting';
}

/** La ligne d'état d'un siège : « Parle… », « Couché », « Tapis », « Suit 40 »… */
function statusLine(v, p, state) {
  const { T, s } = v;
  const shown = s.phase !== 'betting' && s.lastHand?.showdown ? s.lastHand.hands.find((h) => h.playerId === p.id) : null;
  if (shown) return `<span class="pk-plate__st" data-tone="${s.lastHand.awards?.[p.id] ? 'win' : 'hand'}">${T.esc(shown.description)}</span>`;
  if (p.out) return `<span class="pk-plate__st" data-tone="out">${T.esc(p.place ? `Éliminé · ${p.place}e` : 'Éliminé')}</span>`;
  if (state === 'offline') return '<span class="pk-plate__st" data-tone="off">Déconnecté</span>';
  if (state === 'active') return `<span class="pk-plate__st tp-seat__turn">${T.icon('hourglass')}${p.id === v.me ? 'À toi de parler' : 'Parle…'}</span>`;
  if (s.phase === 'betting' && p.allIn) return '<span class="pk-plate__st" data-tone="allin">Tapis</span>';
  if (s.phase === 'betting' && p.folded) return '<span class="pk-plate__st" data-tone="fold">Couché</span>';
  const txt = s.phase === 'betting' ? actionText(p.lastAction) : '';
  return txt ? `<span class="pk-plate__st">${T.esc(txt)}</span>` : '';
}

function badges(v, p) {
  const { T, s } = v;
  if (p.out || !p.inHand) return '';
  const list = [];
  if (v.shape === 'tall' && p.id === s.buttonId && v.geo.pos[p.id]) {
    list.push(`<span class="pk-dealer pk-dealer--in" role="img" aria-label="${T.esc(`Bouton du donneur : ${v.label(p.id)}`)}" title="Donneur">D</span>`);
  }
  if (p.id === s.sbId) list.push(T.Badge({ label: 'PB', tone: 'muted', title: 'Petite blinde' }));
  if (p.id === s.bbId) list.push(T.Badge({ label: 'GB', tone: 'muted', title: 'Grosse blinde' }));
  return list.length ? `<span class="pk-plate__b">${list.join('')}</span>` : '';
}

/** Plaque d'un joueur : avatar, nom, tapis, état (classe .tp-seat pour le halo du tour de Tapis). */
function plateHtml(v, p, { me = false } = {}) {
  const { T, s } = v;
  const state = seatState(v, p);
  const winner = s.phase !== 'betting' && s.lastHand?.awards?.[p.id];
  const label = `${v.nameOf(p.id)}${me ? ' (toi)' : ''}, ${fmt(p.chips)} jetons${p.folded && s.phase === 'betting' ? ', couché' : ''}${p.out ? ', éliminé' : ''}`;
  return `<section class="tp-seat pk-plate" data-seat="${T.esc(p.id)}" data-state="${state}"${p.out ? ' data-out=""' : ''}${
    p.folded && s.phase === 'betting' ? ' data-folded=""' : ''}${winner ? ' data-winner=""' : ''}${me ? ' data-me=""' : ''} aria-label="${T.esc(label)}">${
    v.ui.bubbles?.[p.id] ? T.Bubble(v.ui.bubbles[p.id]) : ''}${
    T.Avatar({ name: v.nameOf(p.id), src: v.avatarOf(p.id), state })}<span class="pk-plate__t"><b class="pk-plate__n title-sm">${T.esc(v.nameOf(p.id))}${
    me ? ' <span class="tp-seat__you caption">(toi)</span>' : ''}</b><span class="pk-plate__c"><i class="pk-chip pk-chip--mini" data-v="${miniChip(p.chips)}"></i><b class="pk-plate__v tp-num" data-chips="${p.chips}">${
    fmt(p.chips)}</b>${badges(v, p)}</span>${statusLine(v, p, state)}</span></section>`;
}
const miniChip = (n) => (n >= 5000 ? 5000 : n >= 1000 ? 1000 : n >= 500 ? 500 : n >= 100 ? 100 : 25);

/** Cartes d'un siège : de dos pour les autres (jamais leur valeur avant l'abattage), face visible si montrées. */
function holeHtml(v, p, { size } = {}) {
  const { T, s } = v;
  if (!p.inHand || !p.hasCards && !(p.cards && p.shown)) return '';
  const marks = showdownMarks(v);
  if (p.cards && (p.id === v.me || p.shown)) {
    const cards = p.cards.map((c) => {
      const win = marks?.win.has(c.id) && marks.winners.has(p.id);
      return `<span class="pk-hole__c"${marks && !win ? ' data-dim=""' : ''}>${T.Card(tp(c, { size: 'sm', state: win ? 'winner' : '', className: 'pk-card' }))}</span>`;
    }).join('');
    return `<div class="pk-hole" data-hole="${T.esc(p.id)}" data-shown=""${size ? ` data-size="${size}"` : ''}${p.folded ? ' data-folded=""' : ''}>${cards}</div>`;
  }
  return `<div class="pk-hole" data-hole="${T.esc(p.id)}" role="img" aria-label="2 cartes cachées">${
    [0, 1].map(() => `<span class="pk-hole__c">${T.Back({ size: 'sm', className: 'pk-card' })}</span>`).join('')}</div>`;
}

function seatHtml(v, p) {
  const pos = v.geo.pos[p.id];
  if (!pos) return '';
  return `<div class="pk-seat" data-side="${pos.side}" data-lr="${pos.lr}"${pos.row ? ` data-row="${pos.row}"` : ''} data-pid="${v.T.esc(p.id)}" style="${style({ '--x': pos.x, '--y': pos.y })}">${
    holeHtml(v, p)}${plateHtml(v, p)}</div>`;
}

/** Moi : ma plaque, mes deux cartes en grand, ma meilleure main. */
function heroHtml(v) {
  const { T, s, meP } = v;
  if (!meP) return '';
  const pos = v.geo.pos[v.me];
  const marks = showdownMarks(v);
  let cards = '';
  if (meP.inHand && meP.cards?.length) {
    cards = meP.cards.map((c) => {
      const win = marks?.win.has(c.id) && marks.winners.has(v.me);
      return `<span class="pk-hole__c"${(marks && !win) || meP.folded ? ' data-dim=""' : ''}>${T.Card(tp(c, { size: 'md', state: win ? 'winner' : '' }))}</span>`;
    }).join('');
  }
  const best = s.me?.best;
  let hint = '';
  if (best && meP.inHand && !meP.folded) {
    const won = marks?.winners.has(v.me);
    hint = `<span class="pk-best${won ? ' pk-best--win' : ''}" data-zone="best">${T.icon(won ? 'trophy' : 'eye')}<span>${T.rich(`Tu as : ${best.description}`)}</span></span>`;
  } else if (meP.folded && meP.inHand) {
    hint = '<span class="pk-best pk-best--muted">Tu t’es couché</span>';
  }
  return `<div class="pk-seat pk-hero" data-side="me" data-pid="${T.esc(v.me)}" style="${style({ '--x': pos.x, '--y': pos.y })}">${
    plateHtml(v, meP, { me: true })}<div class="pk-hole pk-hole--me" data-hole="${T.esc(v.me)}">${cards}</div>${hint}</div>`;
}

// ---------------------------------------------------------------- statut et actions

export function statusFor(v) {
  const { s, me, meP } = v;
  const cur = s.currentPlayerId;
  if (s.phase === 'betting') {
    if (s.isMyTurn) {
      const m = s.me;
      let detail = m.canCheck ? `${STREET_LABEL[s.street]} · personne n’a misé` : `${fmt(m.toCall)} à suivre`;
      // tablette : la raison de la relance impossible tient dans le statut (une ligne de plus cacherait mes cartes)
      const why = closedNote(v);
      if (why && v.shape === 'square') detail += ` · ${/tous à tapis/.test(why) ? 'adversaires à tapis' : 'relance fermée'}`;
      return { tone: 'turn', text: 'À toi de parler', detail };
    }
    if (cur && v.offline(cur)) return { tone: 'alert', text: `Connexion perdue avec ${v.nameOf(cur)}`, detail: 'La main reprend à son retour' };
    if (cur) {
      const detail = meP?.out ? `Tu es éliminé · ${meP.place}e place` : `${STREET_LABEL[s.street]} · pot ${fmt(s.potTotal)}`;
      return { tone: 'wait', text: `${v.nameOf(cur)} parle…`, detail };
    }
    return { tone: 'info', text: STREET_LABEL[s.street] ?? 'Main en cours', detail: `Pot ${fmt(s.potTotal)}` };
  }
  if (s.phase === 'gameOver') {
    const w = s.winnerId;
    return { tone: 'win', text: w === me ? 'Tu remportes le tournoi' : `${v.nameOf(w)} remporte le tournoi`, detail: `${s.handNumber} mains jouées` };
  }
  const lh = s.lastHand;
  if (!lh) return { tone: 'info', text: 'Main terminée' };
  const mine = lh.awards?.[me] ?? 0;
  const winners = Object.entries(lh.awards ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  // un pot partagé : plusieurs gagnants du même pot
  const shared = lh.pots.some((p) => p.winners.length > 1 && (!mine || p.winners.includes(me)));
  let detail = lh.uncontested ? 'sans abattage' : lh.pots.length > 1 ? `${lh.pots.length} pots` : lh.pots[0]?.description ?? '';
  if (mine) return { tone: 'win', text: `Tu gagnes ${fmt(mine)}`, detail: shared ? `pot partagé${detail ? ` · ${detail}` : ''}` : detail };
  if (!winners.length) return { tone: 'info', text: 'Main terminée', detail };
  if (winners.length === 1) return { tone: 'info', text: `${v.nameOf(winners[0])} gagne ${fmt(lh.awards[winners[0]])}`, detail };
  const names = winners.map((id) => v.nameOf(id));
  const who = names.length > 2 ? `${names.length} gagnants` : `${names[0]} et ${names[1]}`;
  if (shared && lh.pots.length === 1) return { tone: 'info', text: `${who} se partagent le pot`, detail };
  detail = lh.pots.length > 1 ? `${lh.pots.length} pots${shared ? ', dont un partagé' : ''}` : detail;
  return { tone: 'info', text: names.length > 2 ? who : `${who} gagnent`, detail };
}

/** Montants des tailles rapides (½ pot, ¾ pot, pot), bornés par la relance minimum et le tapis. */
export function quickSizes(s) {
  const m = s.me;
  const pot = s.potTotal + m.toCall;
  const clamp = (x) => Math.max(m.minRaiseTo, Math.min(m.maxRaiseTo, Math.round(x)));
  return [
    { id: 'half', label: '½ pot', value: clamp(s.currentBet + pot / 2) },
    { id: 'three', label: '¾ pot', value: clamp(s.currentBet + (pot * 3) / 4) },
    { id: 'pot', label: 'Pot', value: clamp(s.currentBet + pot) },
    { id: 'max', label: 'Tapis', value: m.maxRaiseTo },
  ];
}

export function raiseLabel(s, amount) {
  const m = s.me;
  if (amount >= m.maxRaiseTo) return `Tapis · ${fmt(m.maxRaiseTo)}`;
  return s.currentBet === 0 ? `Miser ${fmt(amount)}` : `Relancer à ${fmt(amount)}`;
}

export function raisePanel(v) {
  const { T, s, ui } = v;
  const m = s.me;
  if (!m.canRaise || m.minRaiseTo >= m.maxRaiseTo) return '';
  const val = ui.raiseTo;
  const step = Math.max(1, s.blinds.sb);
  const quick = quickSizes(s).map((q) => T.Button({
    variant: 'secondary', label: q.label, className: 'pk-q', pressed: val === q.value,
    attrs: { 'data-size': String(q.value), 'data-q': q.id, title: `${q.label} : ${fmt(q.value)}` },
  })).join('');
  return `<div class="pk-raise" role="group" aria-label="${s.currentBet ? 'Montant de la relance' : 'Montant de la mise'}">`
    + `<div class="pk-raise__q">${quick}</div>`
    + `<div class="pk-raise__r">${T.Button({ variant: 'icon', icon: 'minus', label: `Moins ${fmt(s.blinds.bb)}`, attrs: { 'data-step': '-1' } })}`
    + `<input class="pk-range" type="range" min="${m.minRaiseTo}" max="${m.maxRaiseTo}" step="${step}" value="${val}" aria-label="${s.currentBet ? 'Relancer à' : 'Miser'}" aria-valuetext="${fmt(val)}">`
    + `${T.Button({ variant: 'icon', icon: 'plus', label: `Plus ${fmt(s.blinds.bb)}`, attrs: { 'data-step': '1' } })}`
    + `<label class="pk-amount"><span class="tp-vh">Montant</span><input type="number" inputmode="numeric" min="${m.minRaiseTo}" max="${m.maxRaiseTo}" step="1" value="${val}"></label></div></div>`;
}

/** Pourquoi je ne peux pas relancer (sauf le manque de jetons, évident), ou rien. */
function closedNote(v) {
  const m = v.s.me;
  return m && !m.canRaise && m.raiseBlock && !/pas assez de jetons/.test(m.raiseBlock) ? m.raiseBlock : undefined;
}

export function actionBar(v) {
  const { T, s, ui } = v;
  if (s.phase === 'betting') {
    if (!s.isMyTurn) return '';
    const m = s.me;
    // parole gratuite : « Se coucher » reste possible mais passe au second plan
    const secondary = [{ label: 'Se coucher', variant: m.canCheck ? 'ghost' : 'secondary', attrs: { 'data-act': 'fold', title: m.canCheck ? 'Tu peux dire parole sans rien miser' : 'Abandonner la main' } }];
    let primary;
    const call = m.canCheck
      ? { label: 'Parole', attrs: { 'data-act': 'check' } }
      : { label: m.toCall >= v.meP.chips ? `Tapis · ${fmt(m.toCall)}` : `Suivre ${fmt(m.toCall)}`, attrs: { 'data-act': 'call' } };
    if (m.canRaise) {
      secondary.push(call);
      const amount = m.minRaiseTo >= m.maxRaiseTo ? m.maxRaiseTo : ui.raiseTo;
      primary = { label: raiseLabel(s, amount), attrs: { 'data-act': 'raise' } };
    } else primary = call;
    const note = v.shape === 'square' ? undefined : closedNote(v);
    return T.ActionBar({ secondary, primary, note });
  }
  if (s.phase === 'handEnd') {
    const details = { label: 'Détails', icon: 'eye', attrs: { 'data-open': 'derniere-main' } };
    if (s.canNext) return T.ActionBar({ secondary: [details], primary: { label: 'Main suivante', icon: 'arrow', attrs: { 'data-act': 'next' } } });
    // téléphone : pas de ligne de plus (la barre cacherait mes cartes) ; le résultat dit déjà que je quitte la table
    return T.ActionBar({ secondary: [details], note: v.shape === 'tall' ? undefined : 'Les joueurs encore en jeu lancent la main suivante.' });
  }
  if (s.phase === 'gameOver' && !ui.view) {
    return T.ActionBar({
      secondary: [{ label: 'Dernière main', icon: 'eye', attrs: { 'data-open': 'derniere-main' } }],
      primary: { label: 'Classement', icon: 'trophy', attrs: { 'data-act': 'ranking' } },
    });
  }
  return '';
}

export function actionsInner(v) {
  const { T, s } = v;
  const mine = s.phase === 'betting' && s.isMyTurn;
  // téléphone : le résultat de la main se lit au-dessus des boutons (la table est trop serrée)
  if (v.shape === 'tall' && s.phase === 'handEnd' && s.lastHand) {
    return `${compactResult(v)}${actionBar(v)}`;
  }
  // téléphone, à moi de parler : ma plaque le dit déjà, la barre garde sa place pour les montants
  const status = mine && v.shape === 'tall' ? '' : T.Status(statusFor(v));
  return `${status}${mine ? raisePanel(v) : ''}${actionBar(v)}`;
}

// ================================================================ fenêtres et tiroirs

/** La dernière main en détail : tableau, mains montrées, pots. */
export function lastHandDialog(v) {
  const { T, s } = v;
  const lh = s.lastHand;
  let body;
  if (!lh) body = '<p class="body">Aucune main terminée pour l’instant.</p>';
  else {
    const board = lh.board.length
      ? `<div class="pk-lh__board">${lh.board.map((c) => T.Card(tp(c, { size: 'sm' }))).join('')}</div>`
      : '<p class="caption">Main finie avant le flop.</p>';
    const hands = lh.hands.length
      ? `<ul class="pk-lh__hands">${lh.hands.map((h) => `<li${lh.awards[h.playerId] ? ' data-win=""' : ''}>${T.Avatar({ name: v.nameOf(h.playerId), src: v.avatarOf(h.playerId), size: 'sm' })}<span class="pk-lh__n"><b class="body-strong">${
        T.esc(v.label(h.playerId))}</b><span class="caption">${T.esc(h.description)}</span></span><span class="pk-lh__c">${
        h.cards.map((c) => T.Card(tp(c, { size: 'sm', state: lh.awards[h.playerId] && h.best.includes(c.id) ? 'winner' : '' }))).join('')}</span>${
        lh.awards[h.playerId] ? `<b class="stat tp-num pk-lh__g">${signed(lh.awards[h.playerId])}</b>` : ''}</li>`).join('')}</ul>`
      : `<p class="body">${T.esc(`${v.label(lh.uncontested)} gagne sans montrer ses cartes : tous les autres se sont couchés.`)}</p>`;
    const lines = resultLines(v).map((l) => `<li>${T.icon('trophy')}<span><b class="body-strong">${T.esc(l.text)}</b> <span class="caption">${T.esc(l.detail)}</span></span></li>`).join('');
    body = `<div class="pk-lh"><h3 class="label pk-lh__h">Tableau</h3>${board}<h3 class="label pk-lh__h">Mains</h3>${hands}<h3 class="label pk-lh__h">Pots</h3><ul class="pk-lh__pots">${lines}</ul></div>`;
  }
  return T.Dialog({ id: 'derniere-main', kicker: lh ? `Main ${lh.handNumber}` : 'Poker', title: 'Dernière main', body });
}

export function endScreen(v) {
  const { T, s, me } = v;
  const ordered = [...s.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
  const handOut = Object.fromEntries((s.eliminated ?? []).map((e) => [e.playerId, e.handNumber]));
  const iWon = s.winnerId === me;
  const note = v.isHost ? 'Utilise « Retour au salon » en haut pour relancer une partie.' : 'En attente de l’hôte pour revenir au salon.';
  const html = T.EndScreen({
    result: iWon ? 'victoire' : 'fin',
    title: iWon ? 'Tu remportes le tournoi' : `${v.nameOf(s.winnerId)} remporte le tournoi`,
    subtitle: `${s.players.length} joueurs, ${fmt(s.startStack)} jetons chacun au départ.`,
    recap: [['Mains', s.handNumber], ['Blindes finales', `${fmt(s.blinds.sb)}/${fmt(s.blinds.bb)}`], ['Jetons en jeu', fmt(s.startStack * s.players.length)]],
    ranking: ordered.map((p) => ({
      name: v.nameOf(p.id), avatar: v.avatarOf(p.id), me: p.id === me,
      score: p.id === s.winnerId ? 'Vainqueur' : `Main ${handOut[p.id] ?? '?'}`,
      note: p.id === s.winnerId ? `${fmt(p.chips)} jetons` : 'éliminé',
    })),
    actions: `${T.Button({ variant: 'secondary', icon: 'eye', label: 'Dernière main', attrs: { 'data-open': 'derniere-main' } })}${
      T.Button({ variant: 'ghost', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'close-end' } })}<p class="caption pk-end-note">${T.esc(note)}</p>`,
  });
  // places partagées (éliminés dans la même main avec le même tapis) : Tapis numérote d'après la position
  let i = 0;
  return html.replace(/<li class="tp-rank__r"([^>]*)><span class="tp-rank__pos stat">\d+<\/span>/g, (m, rest) => {
    const place = ordered[i++]?.place ?? i;
    return `<li class="tp-rank__r"${rest}><span class="tp-rank__pos stat">${place}</span>`;
  });
}

export function journalHtml(v) {
  const { T, s } = v;
  if (!s.log.length) return '<p class="caption">Rien pour l’instant.</p>';
  return T.Log({
    // tone 'hand' : Tapis en fait la classe tp-log__e--hand (début de main, en gras)
    entries: [...s.log].reverse().map((e) => ({ text: richLog(e.text), tone: ['good', 'alert', 'hand'].includes(e.tone) ? e.tone : undefined })),
  });
}

