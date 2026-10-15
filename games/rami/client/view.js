import { analyzeMeld, canReplaceJoker, isJoker, handPenalty } from './melds.js';
import { tp, jk, lab, short, asText, meldName, meldOf, deName, pl, pts, sortHand, glyphs, plain, cardName } from './cards.js';

/* =====================================================================
 * Rami : écrans construits avec les composants Tapis (table « salon »), à partir de
 * l'état envoyé par le serveur (getStateFor) et de l'état local de l'interface (ui).
 * Tout renvoie du HTML ; chaque texte venant d'un joueur passe par un composant Tapis,
 * Tapis.esc ou Tapis.rich (les pseudos viennent de Discord).
 * ===================================================================== */

const area = (name, html) => `<div class="tp-area" data-area="${name}" style="grid-area:${name}">${html}</div>`;
const ACTIVE = ['draw', 'play'];

/** Contexte de rendu : l'état, la salle (avatars, connexions), l'interface et quelques raccourcis. */
export function viewContext(T, s, { me, room, ui, shape }) {
  const i0 = Math.max(0, s.players.findIndex((p) => p.id === me));
  const others = [...s.players.slice(i0 + 1), ...s.players.slice(0, i0)]; // ordre de jeu après moi
  const names = {};
  const seen = {};
  for (const p of s.players) {
    seen[p.name] = (seen[p.name] ?? 0) + 1;
    names[p.id] = seen[p.name] > 1 ? `${p.name} (${seen[p.name]})` : p.name;
  }
  const rp = (id) => room?.players?.find((p) => p.id === id);
  // dernière action de chacun pendant cette donne (affichée sous son siège)
  const last = {};
  const start = s.events.map((e) => e.type).lastIndexOf('deal');
  for (const e of s.events.slice(Math.max(0, start))) {
    const text = lastText(e);
    if (text && e.playerId) last[e.playerId] = text;
  }
  return {
    T, s, me, ui, others, names, shape, last,
    nameOf: (id) => names[id] ?? '?',
    label: (id) => (id === me ? 'Toi' : names[id] ?? '?'),
    avatarOf: (id) => rp(id)?.avatarUrl || undefined,
    offline: (id) => rp(id)?.connected === false,
    meP: s.players.find((p) => p.id === me),
    isHost: room?.hostId === me,
  };
}

function lastText(e) {
  switch (e.type) {
    case 'draw': return e.from === 'discard' ? `A pris ${short(e.card)}` : 'A pioché';
    case 'lay': return e.opened ? `A ouvert : ${e.value} points` : `A posé ${e.melds.length > 1 ? `${e.melds.length} combinaisons` : uncap(meldName(e.melds[0]))}`;
    case 'add': return `A ajouté ${e.cards.map(short).join(' ')}`;
    case 'swap': return `A repris un Joker`;
    case 'cancel': return e.kind === 'discard' ? `A reposé ${short(e.card)}` : 'A annulé un échange';
    case 'discard': return `A défaussé ${short(e.card)}`;
    default: return null;
  }
}

// ================================================================ ce que je peux faire (mon tour)

/** Analyse la situation de mon tour : sélection, pose préparée, combinaison visée. */
export function playInfo(v) {
  const { s, ui } = v;
  const byId = new Map(s.myHand.map((c) => [c.id, c]));
  const staged = ui.staged.map((ids) => ids.map((id) => byId.get(id)).filter(Boolean)).filter((cs) => cs.length);
  const stagedRes = staged.map((cs) => analyzeMeld(cs));
  const stagedTotal = stagedRes.reduce((sum, r) => sum + (r.ok ? r.value : 0), 0);
  const sel = ui.sel.map((id) => byId.get(id)).filter(Boolean);
  const target = ui.target ? s.melds.find((m) => m.id === ui.target) ?? null : null;
  const opened = !!v.meP?.opened;
  const myPlay = s.isMyTurn && s.phase === 'play';
  const res = sel.length >= 3 && !target ? analyzeMeld(sel) : null;
  let add = null;
  let swapOk = false;
  if (target && sel.length) {
    swapOk = sel.length === 1 && canReplaceJoker(target, sel[0]);
    add = target.cards.filter(isJoker).length + sel.filter(isJoker).length > 1
      ? { ok: false, error: 'Un seul Joker par combinaison' }
      : analyzeMeld([...target.cards, ...sel], { type: target.type });
    if (swapOk && target.type === 'run') add = { ok: false, error: 'Cette carte remplace le Joker : échange-le' };
  }
  const must = s.turn.mustUse ?? [];
  return { staged, stagedRes, stagedTotal, sel, target, opened, myPlay, res, add, swapOk, must, byId };
}

// ================================================================ table

export function tableHtml(v) {
  const { T, s, others, shape } = v;
  const seats = others.map((p) => T.Seat({ ...seatProps(v, p), pos: 'top', fan: shape === 'wide' && others.length < 4 })).join('');
  // densité de la table : plus il y a de cartes posées, plus les combinaisons sont serrées
  const laid = s.melds.reduce((n, m) => n + m.cards.length, 0) + s.melds.length * 2;
  const density = laid <= 34 ? 'l' : laid <= 64 ? 'm' : 's';
  // sièges serrés (une ligne, badges en icônes) dès 5 joueurs ou sur écran moyen : la hauteur va aux combinaisons
  const dense = shape !== 'tall' && (others.length >= 4 || shape === 'square');
  return jk(`<div class="tp-table rm-table" data-players="${s.players.length}"${dense ? ' data-seats="dense"' : ''} data-phase="${s.phase}" data-shape="${shape}" data-density="${density}">${
    area('seats', `<div class="rm-seats">${seats}</div>`)}${
    area('piles', pilesHtml(v))}${
    area('melds', boardHtml(v) + stageHtml(v))}${
    area('me', meHtml(v))}${
    area('status', statusHtml(v))}${
    area('actions', actionsHtml(v))}${
    area('hand', handHtml(v))}</div>`);
}

function seatProps(v, p) {
  const { s } = v;
  const state = v.offline(p.id) ? 'offline' : p.id === s.currentPlayerId && ACTIVE.includes(s.phase) ? 'active' : 'waiting';
  return {
    seat: p.id,
    last: p.id !== v.me && ACTIVE.includes(s.phase) ? v.last[p.id] : undefined,
    name: v.nameOf(p.id),
    avatar: v.avatarOf(p.id),
    state,
    count: p.cardCount,
    meta: pts(p.total),
    badges: [
      p.id === s.dealerId && { label: 'Donneur', icon: 'fan', tone: 'muted', title: 'Donneur de cette donne' },
      p.opened && { label: 'Ouvert', icon: 'check', tone: 'positive', title: 'A déjà ouvert : peut compléter les combinaisons' },
    ].filter(Boolean),
  };
}

function meHtml(v) {
  const { T, s, ui } = v;
  if (!v.meP) return '';
  const sort = `<div class="rm-sort" role="group" aria-label="Trier ma main">${
    T.Button({ variant: 'secondary', icon: 'sort', label: 'Couleur', pressed: ui.sort !== 'rank', attrs: { 'data-act': 'sort-suit', title: 'Trier par couleur' } })}${
    T.Button({ variant: 'secondary', icon: 'sort', label: 'Rang', pressed: ui.sort === 'rank', attrs: { 'data-act': 'sort-rank', title: 'Trier par rang' } })}</div>`;
  // mon siège sans badges : « Ouvert » se lit dans le statut, et la colonne reste étroite
  return T.Seat({ ...seatProps(v, v.meP), badges: [], count: undefined, me: true, compact: true }) + sort;
}

// ---------------------------------------------------------------- talon et défausse

function pilesHtml(v) {
  const { T, s } = v;
  const p = s.isMyTurn && s.phase === 'draw';
  const canDiscard = p && !!s.discardTop && !s.turn.noDiscard;
  const pick = (kind, html, on, label) => `<div class="rm-pick" data-pick="${kind}" role="button" tabindex="${on ? 0 : -1}" aria-label="${T.esc(label)}"${on ? '' : ' aria-disabled="true"'}>${html}</div>`;
  const stock = T.Pile({ pile: 'pioche', label: 'Talon', count: s.stockCount, faceDown: true, size: 'sm', empty: 'Vide' });
  const discard = T.Pile({ pile: 'defausse', count: s.discardCount, top: s.discardTop ? tp(s.discardTop) : undefined, size: 'sm', empty: 'Vide' });
  return `<div class="rm-piles">${pick('stock', stock, p, `Piocher au talon, ${pl(s.stockCount, 'carte')}`)}${
    pick('discard', discard, canDiscard, s.discardTop ? `Prendre ${cardName(s.discardTop)} à la défausse` : 'Défausse vide')}</div>`
    + `<p class="rm-round"><span class="label">Donne ${s.roundNumber}/${s.totalRounds}</span><span class="caption">Ouverture ${s.opening} points</span></p>`;
}

// ---------------------------------------------------------------- combinaisons posées

/** Une combinaison posée : cartes serrées, Joker avec la carte qu'il remplace. */
export function meldHtml(v, m, { targetable = false, selected = false, extraCards = [] } = {}) {
  const { T } = v;
  const name = meldName(m);
  const cards = m.cards.map((c) => {
    const card = T.Card(tp(c, { size: 'sm' }));
    return isJoker(c) ? `<span class="rm-jk">${card}<span class="rm-as caption" aria-hidden="true">${T.rich(asText(c))}</span></span>` : card;
  }).join('') + extraCards.join('');
  const label = `${plain(name)}, ${v.label(m.owner)}`;
  const attrs = `class="rm-meld" data-meld="${T.esc(m.id)}" data-type="${m.type}" data-owner="${T.esc(m.owner)}"`;
  if (!targetable) return `<div ${attrs} role="group" aria-label="${T.esc(label)}">${cards}</div>`;
  return `<button type="button" ${attrs} aria-pressed="${selected}" aria-label="${T.esc(`${label} : ${selected ? 'choisie' : 'choisir pour y ajouter des cartes'}`)}">${cards}</button>`;
}

function boardHtml(v) {
  const { T, s, ui, me } = v;
  const info = playInfo(v);
  const targetable = info.myPlay && info.opened;
  const order = [me, ...v.others.map((p) => p.id)];
  const groups = order.map((pid) => {
    const melds = s.melds.filter((m) => m.owner === pid);
    if (!melds.length) return '';
    const total = melds.reduce((n, m) => n + m.cards.length, 0);
    return `<section class="rm-group"${pid === me ? ' data-me' : ''} data-owner="${T.esc(pid)}" aria-label="${T.esc(`Combinaisons ${pid === me ? 'à toi' : deName(v.nameOf(pid))}`)}">`
      + `<header class="rm-group__h">${T.Avatar({ name: v.nameOf(pid), src: v.avatarOf(pid), size: 'sm' })}<b class="label">${T.esc(v.label(pid))}</b><span class="caption">${pl(total, 'carte')} posée${total > 1 ? 's' : ''}</span></header>`
      + `<div class="rm-group__m">${melds.map((m) => meldHtml(v, m, { targetable, selected: ui.target === m.id })).join('')}</div></section>`;
  }).join('');
  const empty = s.melds.length ? '' : `<p class="rm-board__empty">${T.icon('deck')}<span class="body">Aucune combinaison sur la table.</span><span class="caption">${T.rich(`Pour ouvrir, pose ${s.opening} points en une fois : brelans, carrés et suites.`)}</span></p>`;
  return `<div class="rm-board" data-zone="melds"${targetable ? ' data-targetable' : ''}>${groups}${empty}</div>`;
}

/** Pose en préparation (avant l'ouverture : plusieurs combinaisons posées d'un coup). */
function stageHtml(v) {
  const { T, s, ui } = v;
  const info = playInfo(v);
  if (!info.staged.length || !info.myPlay) return '';
  const rows = info.staged.map((cs, i) => {
    const r = info.stagedRes[i];
    return `<li class="rm-stage__m">${cs.map((c) => T.Card(tp(c, { size: 'xs' }))).join('')}<span class="caption">${T.rich(r.ok ? `${meldName(r)} · ${r.value}` : r.error)}</span>${
      T.Button({ variant: 'icon', icon: 'cross', label: 'Reprendre en main', attrs: { 'data-act': 'unstage', 'data-i': String(i) } })}</li>`;
  }).join('');
  const total = info.stagedTotal;
  return `<section class="tp-panel rm-stage" data-zone="stage" aria-labelledby="rm-stage-h"><header class="tp-panel__h"><h2 class="title-sm" id="rm-stage-h">Ton ouverture</h2>${
    T.Gauge({ value: total, max: s.opening, tone: 'accent', text: `${total}/${s.opening}`, label: 'Points' })}</header><ul class="rm-stage__l">${rows}</ul></section>`;
}

// ---------------------------------------------------------------- statut, aperçu, actions, main

export function statusFor(v) {
  const { s, me } = v;
  const round = `Donne ${s.roundNumber}/${s.totalRounds}`;
  const cur = s.currentPlayerId;
  const curName = v.nameOf(cur);
  if (s.phase === 'roundEnd' || s.phase === 'gameOver') {
    const m = s.summary;
    if (s.phase === 'gameOver') return { tone: 'win', text: 'Partie terminée', detail: winnerText(v) };
    if (!m?.winnerId) return { tone: 'info', text: 'Donne bloquée', detail: `Plus rien à piocher · ${round}` };
    return {
      tone: 'win',
      text: m.winnerId === me ? 'Tu remportes la donne' : `${v.nameOf(m.winnerId)} remporte la donne`,
      detail: m.rami ? `Rami : pénalités doublées · ${round}` : round,
    };
  }
  if (cur && cur !== me && v.offline(cur)) return { tone: 'alert', text: `Connexion perdue avec ${curName}`, detail: 'La partie reprend à son retour' };
  if (!s.isMyTurn) {
    return { tone: 'wait', text: s.phase === 'draw' ? `${curName} pioche…` : `${curName} joue…`, detail: `${round} · ouverture ${s.opening}` };
  }
  if (s.phase === 'draw') {
    const top = s.discardTop;
    return {
      tone: 'turn',
      text: 'À toi : pioche une carte',
      detail: s.turn.noDiscard || !top ? 'Au talon' : `Au talon, ou ${short(top)} de la défausse si tu la poses dans ce tour`,
    };
  }
  const info = playInfo(v);
  const taken = info.must.find((id) => id === s.turn.taken);
  const joker = info.must.find((id) => id !== s.turn.taken);
  if (taken) {
    const c = info.byId.get(taken);
    return {
      tone: 'turn',
      text: `Pose ${lab(c)}, prise à la défausse`,
      detail: info.opened ? 'Dans une combinaison, ou en complétant celles de la table' : `Elle doit faire partie de ton ouverture (${s.opening} points)`,
    };
  }
  if (joker) return { tone: 'turn', text: 'Repose le Joker récupéré', detail: 'Dans une combinaison, ou sur une combinaison de la table' };
  return {
    tone: 'turn',
    text: 'À toi de jouer',
    detail: info.opened ? 'Pose, complète la table, puis défausse une carte' : `Ouvre avec ${s.opening} points, ou défausse une carte`,
  };
}

/** Aperçu en direct de la sélection (Tapis.ComboPreview), ou null. */
export function previewFor(v) {
  const { s } = v;
  if (!s.isMyTurn || !ACTIVE.includes(s.phase)) return null;
  const info = playInfo(v);
  const { sel, target } = info;
  if (target) {
    const owner = meldOf(target, v.nameOf(target.owner), target.owner === v.me);
    if (!sel.length) return { valid: true, text: `${cap(owner)} : ${meldName(target)}`, detail: 'Choisis les cartes à ajouter, ou celle que remplace le Joker' };
    const list = sel.map(short).join(' ');
    if (info.add?.ok) {
      return { valid: true, text: `${list} sur ${owner}`, detail: `${meldName(info.add)}${info.swapOk ? ' · ou échange le Joker' : ''}` };
    }
    if (info.swapOk) return { valid: true, text: `${list} remplace le Joker`, detail: `Le Joker revient dans ta main : repose-le dans ce tour` };
    return { valid: false, text: `${list} ne va pas sur ${owner}`, detail: info.add?.error };
  }
  if (sel.length >= 3) {
    const r = info.res;
    if (!r.ok) return { valid: false, text: 'Combinaison invalide', detail: r.error };
    const detail = info.opened ? undefined : `Total posé : ${info.stagedTotal + r.value} / ${s.opening} pour ouvrir`;
    return { valid: true, text: `${meldName(r)} : ${pl(r.value, 'point')}`, detail };
  }
  if (info.staged.length && !info.opened) {
    const t = info.stagedTotal;
    return { valid: true, text: `Total posé : ${t} / ${s.opening} pour ouvrir`, detail: t >= s.opening ? 'Tu peux ouvrir' : `Encore ${pl(s.opening - t, 'point')} : ajoute une combinaison` };
  }
  if (sel.length === 2) return { valid: false, text: 'Deux cartes choisies', detail: 'Une combinaison compte au moins 3 cartes ; une seule carte pour défausser' };
  if (sel.length && s.phase === 'play') {
    const c = sel[0];
    return { valid: true, text: `Défausser ${lab(c)} ?`, detail: `${penaltyText(c)} si elle te reste en main` };
  }
  return null;
}

/** Ouverture sans la carte prise à la défausse : raison du refus (le moteur refuse aussi), sinon null. */
function takenMissing(v, info, sel) {
  const id = v.s.turn.taken;
  if (!id || !info.must.includes(id)) return null;
  if (sel.some((c) => c.id === id) || info.staged.some((cs) => cs.some((c) => c.id === id))) return null;
  return `${short(info.byId.get(id))}, prise à la défausse, doit faire partie de l’ouverture`;
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const uncap = (t) => t.charAt(0).toLowerCase() + t.slice(1);
const penaltyText = (c) => `${handPenalty([c])} point${handPenalty([c]) > 1 ? 's' : ''} de pénalité`;

function statusHtml(v) {
  const { T } = v;
  const p = previewFor(v);
  return T.Status(statusFor(v)) + (p ? T.ComboPreview(p) : '');
}

/** Barre d'actions : { primary, secondary, note } ou null. */
export function actionsFor(v) {
  const { s, ui } = v;
  if (s.phase === 'roundEnd' && ui.view !== 'summary') {
    return {
      secondary: [{ label: 'Résumé', icon: 'scores', attrs: { 'data-act': 'summary' } }],
      primary: { label: 'Donne suivante', icon: 'arrow', attrs: { 'data-act': 'next' } },
    };
  }
  if (s.phase === 'gameOver' && !ui.view) {
    return {
      secondary: [{ label: 'Dernière donne', icon: 'scores', attrs: { 'data-act': 'summary' } }],
      primary: { label: 'Classement', icon: 'trophy', attrs: { 'data-act': 'ranking' } },
    };
  }
  if (!s.isMyTurn || !ACTIVE.includes(s.phase)) return null;
  if (s.phase === 'draw') {
    const why = !s.discardTop ? 'La défausse est vide' : s.turn.noDiscard ? 'Tu viens de la reposer' : null;
    return {
      secondary: [{ label: 'Prendre la défausse', icon: 'discard', disabled: !!why, reason: why, attrs: { 'data-act': 'draw-discard' } }],
      primary: { label: 'Piocher', icon: 'deck', attrs: { 'data-act': 'draw-stock' } },
    };
  }
  const info = playInfo(v);
  const { sel, target, opened, must } = info;
  const secondary = [];
  let primary;
  let note;
  if (target) {
    if (!sel.length) primary = { label: 'Ajouter', icon: 'plus', disabled: true, reason: 'Choisis les cartes à ajouter' };
    else if (info.add?.ok) {
      primary = { label: 'Ajouter', icon: 'plus', attrs: { 'data-act': 'add' } };
      if (info.swapOk) secondary.push({ label: 'Échanger le Joker', icon: 'renew', attrs: { 'data-act': 'swap' } });
    } else if (info.swapOk) primary = { label: 'Échanger le Joker', icon: 'renew', attrs: { 'data-act': 'swap' } };
    else primary = { label: 'Ajouter', icon: 'plus', disabled: true, reason: info.add?.error ?? 'Impossible ici' };
    secondary.unshift({ label: 'Annuler', icon: 'cross', attrs: { 'data-act': 'untarget' } });
  } else if (sel.length >= 3) {
    const r = info.res;
    if (!r.ok) primary = { label: 'Poser', icon: 'arrow', disabled: true, reason: r.error };
    else if (opened) primary = { label: `Poser · ${r.value}`, icon: 'arrow', attrs: { 'data-act': 'lay' } };
    else {
      const total = info.stagedTotal + r.value;
      const missTaken = takenMissing(v, info, sel);
      if (total >= s.opening && missTaken) {
        secondary.push({ label: 'Préparer', icon: 'plus', attrs: { 'data-act': 'stage' } });
        primary = { label: 'Ouvrir', icon: 'arrow', disabled: true, reason: missTaken };
      } else if (total >= s.opening) {
        secondary.push({ label: 'Préparer', icon: 'plus', attrs: { 'data-act': 'stage' } });
        primary = { label: `Ouvrir · ${total}`, icon: 'arrow', attrs: { 'data-act': 'open' } };
      } else {
        primary = { label: `Préparer · ${r.value}`, icon: 'plus', attrs: { 'data-act': 'stage' } };
        note = `Il manque ${pl(s.opening - total, 'point')} pour ouvrir`;
      }
    }
  } else if (!sel.length && info.staged.length && !opened) {
    const t = info.stagedTotal;
    const missTaken = takenMissing(v, info, []);
    primary = t >= s.opening && !missTaken
      ? { label: `Ouvrir · ${t}`, icon: 'arrow', attrs: { 'data-act': 'open' } }
      : { label: 'Ouvrir', icon: 'arrow', disabled: true, reason: t >= s.opening ? missTaken : `Il manque ${pl(s.opening - t, 'point')} (${t}/${s.opening})` };
  } else {
    const why = must.length
      ? (must[0] === s.turn.taken ? `Pose d’abord ${short(info.byId.get(must[0]))}, prise à la défausse` : 'Repose d’abord le Joker récupéré')
      : sel.length === 0 ? 'Choisis la carte à défausser' : sel.length > 1 ? 'Une seule carte à défausser' : null;
    primary = { label: 'Défausser', icon: 'discard', disabled: !!why, reason: why, attrs: { 'data-act': 'discard' } };
  }
  if (s.turn.taken && must.includes(s.turn.taken) && !s.turn.laid) {
    secondary.push({ label: 'Reposer la carte', icon: 'back', attrs: { 'data-act': 'cancel', 'data-card': s.turn.taken } });
  }
  for (const id of s.turn.swappedJokers ?? []) {
    if (must.includes(id)) secondary.push({ label: 'Annuler l’échange', icon: 'back', attrs: { 'data-act': 'cancel', 'data-card': id } });
  }
  return { primary, secondary, note };
}

export function actionsHtml(v) {
  const a = actionsFor(v);
  return a ? v.T.ActionBar(a) : '';
}

/** Ma main : triée, sélection multiple ; les cartes de la pose préparée n'y sont plus. */
export function handHtml(v) {
  const { T, s, ui } = v;
  const ended = s.phase === 'roundEnd' || s.phase === 'gameOver';
  const staged = new Set(ui.staged.flat());
  const sel = new Set(ui.sel);
  const must = new Set(s.turn.mustUse ?? []);
  const cards = ended ? [] : sortHand(s.myHand.filter((c) => !staged.has(c.id)), ui.sort);
  return T.Hand({
    cards: cards.map((c) => tp(c, { selected: sel.has(c.id), tag: must.has(c.id) ? (isJoker(c) ? 'Repris' : 'Défausse') : undefined })),
    size: 'md', sort: false, groups: ui.sort !== 'rank', multi: true, interactive: !ended && ACTIVE.includes(s.phase), label: 'Ta main',
  });
}

// ================================================================ fenêtres et tiroirs

function dealSummaryHtml(v) {
  const { T, s, me } = v;
  const m = s.summary;
  const winner = m.winnerId;
  const verdict = !winner ? 'Donne bloquée' : m.rami ? `Rami ${deName(v.nameOf(winner))} !` : winner === me ? 'Tu n’as plus de cartes' : `${v.nameOf(winner)} n’a plus de cartes`;
  const lines = [
    ['Fin de donne', !winner ? 'Plus aucune carte à piocher : chacun compte sa main' : m.rami ? 'Ouvert et sorti dans le même tour, sans avoir rien posé avant' : `${v.label(winner)} ${winner === me ? 'sors' : 'sort'} et ne paie rien`],
    ['Pénalités', `Cartes restées en main : Joker 20, As 11, figures 10${m.rami ? ', doublées (rami)' : ''}`],
  ];
  const order = [...s.players].sort((a, b) => (m.penalties[a.id]?.points ?? 0) - (m.penalties[b.id]?.points ?? 0));
  const gains = order.map((p) => {
    const pen = m.penalties[p.id] ?? { points: 0, cards: 0 };
    const left = m.hands?.[p.id] ?? [];
    const what = p.id === winner ? 'sorti' : pl(left.length, 'carte');
    const cards = left.length ? `<span class="rm-left" aria-label="${T.esc(`Cartes restées : ${left.length}`)}">${left.map((c) => T.Card(tp(c, { size: 'xs' }))).join('')}</span>` : '';
    return `<li data-sign="${pen.points ? '-' : '+'}"${p.id === me ? ' data-me' : ''}>${T.Avatar({ name: v.nameOf(p.id), src: v.avatarOf(p.id), size: 'sm' })}<span class="body">${T.esc(v.nameOf(p.id))}${p.id === me ? ' <span class="caption">(toi)</span>' : ''}<span class="caption">${T.esc(`${what} · total ${pts(p.total)}`)}</span></span><b class="stat tp-num">${pen.points ? `+${pen.points}` : '±0'}</b>${cards}</li>`;
  }).join('');
  return `<div class="tp-deal rm-deal" data-zone="deal-summary" data-made="${!!winner}"><p class="tp-deal__verdict title-md">${T.icon(winner ? (m.rami ? 'sparkle' : 'check') : 'info')}${T.esc(verdict)}</p>`
    + `<dl class="tp-deal__lines">${lines.map(([k, val]) => `<div class="tp-deal__l"><dt class="caption">${T.esc(k)}</dt><dd class="body">${T.esc(val)}</dd></div>`).join('')}</dl>`
    + `<ul class="tp-deal__gains rm-pen">${gains}</ul></div>`;
}

export function summaryDialog(v) {
  const { T, s } = v;
  const m = s.summary;
  if (!m) return '';
  const last = s.phase === 'gameOver';
  const actions = T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })
    + (last
      ? T.Button({ variant: 'primary', icon: 'trophy', label: 'Voir le classement', attrs: { 'data-act': 'ranking' } })
      : T.Button({ variant: 'primary', icon: 'arrow', label: 'Donne suivante', attrs: { 'data-act': 'next' } }));
  return jk(T.Dialog({
    id: 'resume', kicker: last ? 'Dernière donne' : `Donne ${m.roundNumber}/${s.totalRounds}`, title: 'Fin de la donne',
    size: 'lg', body: dealSummaryHtml(v), actions,
  }));
}

/** « Léa gagne avec 34 points », « Égalité entre Léa et toi avec 34 points ». */
function winnerText(v) {
  const { s, me } = v;
  const best = Math.min(...s.players.map((p) => p.total));
  const winners = s.players.filter((p) => p.total === best);
  if (winners.length > 1) {
    const names = winners.map((p) => (p.id === me ? 'toi' : v.nameOf(p.id)));
    return `Égalité entre ${names.slice(0, -1).join(', ')} et ${names.at(-1)} avec ${pts(best)}`;
  }
  return winners[0].id === me ? `Tu gagnes avec ${pts(best)}` : `${v.nameOf(winners[0].id)} gagne avec ${pts(best)}`;
}

export function endScreen(v) {
  const { T, s, me } = v;
  const ranking = [...s.players].sort((a, b) => a.total - b.total);
  const places = ranking.map((p) => 1 + ranking.filter((o) => o.total < p.total).length);
  const tied = (p) => ranking.some((o) => o !== p && o.total === p.total);
  const note = v.isHost ? 'Utilise « Retour au salon » en haut pour relancer une partie.' : 'En attente de l’hôte pour revenir au salon.';
  const won = ranking[0].total === ranking.find((p) => p.id === me)?.total;
  let i = 0;
  const html = T.EndScreen({
    result: won ? 'victoire' : 'fin', title: won ? 'Victoire' : 'Fin de partie',
    subtitle: `${s.totalRounds} donnes jouées. ${winnerText(v)}. Le moins de pénalités gagne.`,
    ranking: ranking.map((p) => ({ name: v.nameOf(p.id), avatar: v.avatarOf(p.id), me: p.id === me, score: pts(p.total), note: tied(p) ? 'ex aequo' : undefined })),
    extra: `<div class="rm-end-sheet">${scoreSheet(v)}</div>`,
    actions: `${T.Button({ variant: 'secondary', icon: 'info', label: 'Dernière donne', attrs: { 'data-act': 'summary' } })}${
      T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })}${
      T.Button({ variant: 'ghost', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'close-end' } })}<p class="caption rm-end-note">${T.esc(note)}</p>`,
  });
  // place partagée par les ex aequo (1, 1, 3…) ; Tapis numérote d'après la position dans la liste
  return html.replace(/<li class="tp-rank__r"([^>]*)><span class="tp-rank__pos stat">\d+<\/span>/g, (m0, rest) => {
    const place = places[i++];
    const first = place === 1 && !rest.includes('data-first') ? `${rest} data-first=""` : rest;
    return `<li class="tp-rank__r"${first}><span class="tp-rank__pos stat">${place}</span>`;
  });
}

/** Feuille de scores : pénalités par donne, total cumulé (le plus petit gagne). */
export function scoreSheet(v) {
  const { T, s, me } = v;
  const order = [me, ...v.others.map((p) => p.id)].filter((id) => s.players.some((p) => p.id === id));
  const head = order.map((id) => `<th scope="col"${id === me ? ' data-me="true"' : ''}>${T.esc(v.nameOf(id))}</th>`).join('');
  const rows = s.history.map((h) => `<tr><th scope="row" class="tp-num">${h.roundNumber}</th>${order.map((id) => {
    const n = h.penalties[id] ?? 0;
    const out = h.winnerId === id;
    return `<td class="tp-num" data-me="${id === me}"${out ? ' data-out' : ''}>${out ? `${T.icon(h.rami ? 'sparkle' : 'check')}<span>${h.rami ? 'Rami' : 'Sorti'}</span>` : `+${n}`}</td>`;
  }).join('')}</tr>`).join('');
  const totals = order.map((id) => {
    const p = s.players.find((x) => x.id === id);
    return `<td class="tp-num stat" data-me="${id === me}">${p.total}</td>`;
  }).join('');
  const table = `<table class="tp-ss rm-ss"><caption class="tp-vh">Feuille de scores</caption><thead><tr><th scope="col">Donne</th>${head}</tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">Total</th>${totals}</tr></tfoot></table>`;
  const foot = `<p class="caption rm-ss__note">${T.esc(`Pénalités cumulées : le plus petit total gagne après ${s.totalRounds} donnes.`)}</p>`;
  return s.history.length ? table + foot : `${table}<p class="caption rm-empty">Aucune donne terminée pour l’instant.</p>`;
}

export function journalHtml(v) {
  const { T, s } = v;
  if (!s.log.length) return '<p class="caption">Rien pour l’instant.</p>';
  return T.Log({
    entries: [...s.log].reverse().map((e) => ({
      text: glyphs(e.text),
      tone: /Rami|remporte|plus de cartes/.test(e.text) ? 'good' : /épuisé|s’arrête/.test(e.text) ? 'alert' : undefined,
    })),
  });
}
