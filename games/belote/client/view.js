import { SUIT, SUIT_NAME, SUITS, tp, glyph, cardName, playHints, richLog } from './cards.js';

/* =====================================================================
 * Belote : écrans construits avec les composants Tapis (table « salon »),
 * à partir de l'état envoyé par le serveur (getStateFor) et de l'état local
 * de l'interface (ui). Tout renvoie du HTML ; chaque texte venant d'un joueur
 * passe par un composant Tapis, Tapis.esc ou Tapis.rich.
 * ===================================================================== */

/** Places : moi en bas, mon partenaire en face (en haut), les adversaires à gauche et à droite.
 *  On joue vers la droite : le joueur suivant est à ma droite. */
const POS = ['right', 'top', 'left'];
const AREA = { left: 's-left', top: 's-top', right: 's-right' };
const area = (name, html) => `<div class="tp-area" data-area="${name}" style="grid-area:${name}">${html}</div>`;
const ACTIVE = ['bidding', 'playing'];
const cardOf = (id) => ({ id, suit: id.slice(-1), rank: id.slice(0, -1) });

/** Contexte de rendu : l'état, la salle (avatars, connexions) et quelques raccourcis. */
export function viewContext(T, s, { me, room, ui }) {
  const i0 = Math.max(0, s.players.findIndex((p) => p.id === me));
  const others = [...s.players.slice(i0 + 1), ...s.players.slice(0, i0)]; // ordre de jeu après moi
  const pos = Object.fromEntries(others.map((p, i) => [p.id, POS[i] ?? 'top']));
  pos[me] = 'bottom';
  // pseudos en double (rare) : on les distingue
  const names = {};
  const seen = {};
  for (const p of s.players) {
    seen[p.name] = (seen[p.name] ?? 0) + 1;
    names[p.id] = seen[p.name] > 1 ? `${p.name} (${seen[p.name]})` : p.name;
  }
  const rp = (id) => room?.players?.find((p) => p.id === id);
  const myTeam = s.myTeam ?? 0;
  const teamOf = (id) => s.players.find((p) => p.id === id)?.team ?? 0;
  const v = {
    T, s, me, ui, others, pos, names, myTeam,
    nameOf: (id) => names[id] ?? '?',
    label: (id) => (id === me ? 'Toi' : names[id] ?? '?'),
    avatarOf: (id) => rp(id)?.avatarUrl || undefined,
    offline: (id) => rp(id)?.connected === false,
    meP: s.players.find((p) => p.id === me),
    isHost: room?.hostId === me,
    teamOf,
    /** « Nous » / « Eux », comme sur une feuille de belote. */
    teamName: (t) => (t === myTeam ? 'Nous' : 'Eux'),
    teamKey: (t) => (t === myTeam ? 'nous' : 'eux'),
    /** « Toi & Inès », « Malo & Yanis ». */
    teamPlayers: (t) => {
      const ids = s.teams[t].playerIds;
      const list = t === myTeam ? [me, ...ids.filter((id) => id !== me)] : ids;
      return list.map((id) => (id === me ? 'Toi' : names[id] ?? '?')).join(' & ');
    },
  };
  return v;
}

// ================================================================ table

export function tableHtml(v) {
  const { s, others, pos } = v;
  const seats = others.map((p) => area(AREA[pos[p.id]], seatHtml(v, p, { pos: pos[p.id], fan: true }))).join('');
  const panel = panelHtml(v);
  return `<div class="tp-table tp-table--salon blt-table" data-players="4" data-phase="${s.phase}">${
    area('s-tl', boardHtml(v))}${area('s-tr', cornerHtml(v))}${seats}${
    area('trick', feltTop(v) + centerHtml(v) + trickInfo(v) + (panel ? `<div class="tp-overpanel">${panel}</div>` : ''))}${
    area('me', seatHtml(v, v.meP, { me: true, compact: true }))}${
    area('status', v.T.Status(statusFor(v)))}${
    area('actions', actionsHtml(v))}${
    area('hand', handHtml(v))}</div>`;
}

export function seatHtml(v, p, extra = {}) {
  const { T, s } = v;
  const state = v.offline(p.id) ? 'offline' : p.id === s.currentPlayerId && ACTIVE.includes(s.phase) && !v.ui.heldTrick ? 'active' : 'waiting';
  const showTricks = ['playing', 'dealEnd', 'gameOver'].includes(s.phase);
  const html = T.Seat({
    seat: p.id,
    name: v.nameOf(p.id),
    avatar: v.avatarOf(p.id),
    state,
    count: p.cardCount,
    tricks: showTricks ? p.tricks : undefined,
    badges: badges(v, p),
    bubble: bubble(v, p),
    ...extra,
  });
  const key = v.teamKey(p.team);
  return html.replace('<section class="tp-seat', `<section data-team="${key}" class="tp-seat`);
}

function badges(v, p) {
  const { s, me } = v;
  return [
    p.id === s.dealerId && { label: 'Donneur', icon: 'fan', tone: 'muted' },
    p.isTaker && s.trump && { label: `Preneur ${glyph(s.trump)}`, icon: 'flag', tone: 'accent', title: `A pris à ${SUIT_NAME[s.trump]}` },
    s.belote?.playerId === p.id && s.belote.step === 'rebelote' && { label: 'Belote', icon: 'crown', tone: 'accent', title: 'Belote et rebelote : 20 points' },
    p.id !== me && p.team === v.myTeam && { label: 'Partenaire', icon: 'pair', tone: 'positive' },
    // privé : seul le joueur qui a la belote le voit, jusqu'à ce qu'il dise « Belote ! »
    p.id === me && s.myBelote && !s.belote && s.phase === 'playing'
      && { label: 'Belote en main', icon: 'crown', tone: 'accent', title: `Tu as le Roi et la Dame de ${SUIT_NAME[s.trump]} : « Belote ! » sera dit quand tu joueras le premier, 20 points` },
  ].filter(Boolean);
}

function bubble(v, p) {
  const { s, ui } = v;
  if (ui.beloteBubble?.playerId === p.id) return { text: ui.beloteBubble.step === 'belote' ? 'Belote !' : 'Rebelote !' };
  if (s.phase === 'bidding') {
    const bid = s.bids.filter((b) => b.playerId === p.id && b.round === s.bidRound).at(-1);
    if (bid) return { text: 'Passe', tone: 'pass' };
    return undefined;
  }
  if (s.phase === 'playing' && s.trickNumber === 1 && !ui.heldTrick && p.announced.length) {
    return { text: p.announced.join(' + ') };
  }
  return undefined;
}

// ---------------------------------------------------------------- tableau des scores (coin haut gauche)

function boardHtml(v) {
  const { T, s } = v;
  const row = (t) => {
    const score = s.teams[t].score;
    const p = Math.min(1, score / s.target);
    return `<li class="blt-board__r" data-team="${v.teamKey(t)}"${t === v.myTeam ? ' data-me' : ''}><span class="blt-board__k label">${v.teamName(t)}</span>`
      + `<span class="blt-board__p caption">${T.esc(v.teamPlayers(t))}</span><b class="blt-board__s stat tp-num">${score}</b>`
      + `<span class="blt-board__g" style="--p:${p.toFixed(3)}" aria-hidden="true"></span></li>`;
  };
  const pending = s.pending ? `<p class="blt-board__lit caption">${T.icon('warning')}${T.esc(`Litige : ${s.pending} points en attente`)}</p>` : '';
  return `<section class="blt-board" aria-label="${T.esc(`Partie en ${s.target} points`)}"><header class="blt-board__h"><span class="label">Partie en ${s.target}</span>`
    + `<span class="caption">Donne ${s.dealNumber}</span></header><ol class="blt-board__t">${row(v.myTeam)}${row(1 - v.myTeam)}</ol>${pending}`
    + `${T.Button({ variant: 'ghost', icon: 'scores', label: 'Feuille de scores', className: 'blt-board__b', attrs: { 'data-open': 'scores' } })}</section>`;
}

// ---------------------------------------------------------------- centre du tapis

function trumpMedal(T, suit) {
  return `<span class="blt-trump" data-suit="${SUIT[suit]}" aria-hidden="true">${T.icon(SUIT[suit], { className: `tp-suit-${SUIT[suit]}` })}</span>`;
}

function feltTop(v) {
  const { T, s, me } = v;
  if (s.phase === 'bidding' && s.turned) {
    const t = s.turned.suit;
    const head = s.bidRound === 1 ? `Premier tour : ${glyph(t)} retourné` : `Second tour : ${glyph(t)} refusé`;
    const sub = s.bidRound === 1 ? `On prend à ${SUIT_NAME[t]} ou on passe` : 'On choisit une autre couleur ou on passe';
    return `<div class="tp-felt-top"><div class="tp-contract blt-contract" data-zone="contract" role="status">${T.icon('fan')}<span class="tp-contract__t body-strong">${T.rich(head)}</span><span class="tp-contract__p caption">${T.esc(sub)}</span></div></div>`;
  }
  if (s.trump && s.takerId) {
    const who = s.takerId === me ? 'toi' : v.nameOf(s.takerId);
    const team = v.teamName(v.teamOf(s.takerId));
    return `<div class="tp-felt-top"><div class="tp-contract blt-contract" data-zone="contract" role="status">${trumpMedal(T, s.trump)}<span class="tp-contract__t body-strong">${T.rich(`Atout ${glyph(s.trump)}`)}</span>`
      + `<span class="tp-contract__p caption">${T.icon('flag')}${T.esc(`Pris par ${who} (${team})`)}</span></div></div>`;
  }
  return '';
}

/** Le talon et la carte retournée, pendant les enchères. */
function deckHtml(v) {
  const { T, s, ui } = v;
  const pile = T.Pile({ pile: 'pioche', label: 'Talon', count: 11, size: 'md' });
  const turned = T.Card(tp(s.turned, { size: 'md', faceDown: ui.turnedDown }));
  return `<div class="tp-chien blt-deck" data-zone="talon"><div class="tp-chien__c">${pile}<div class="blt-turned">${turned}</div></div>`
    + `<span class="tp-chien__l label">${T.esc(`Retournée : ${cardName(s.turned)}`)}</span></div>`;
}

export function trickHtml(v, cards, winnerId = null) {
  const { T, s, pos } = v;
  const plays = cards.map(({ playerId, card }) => ({
    pos: pos[playerId], seat: playerId, name: v.label(playerId), card: tp(card), winner: playerId === winnerId,
  }));
  const cur = s.currentPlayerId;
  if (!winnerId && s.phase === 'playing' && cur && !cards.some((t) => t.playerId === cur)) {
    plays.push({ pos: pos[cur], seat: cur, name: v.label(cur), card: null });
  }
  return T.Trick({ plays, players: 4, size: 'md', label: `Pli ${s.trickNumber}/8` });
}

function centerHtml(v) {
  const { s, ui } = v;
  if (ui.heldTrick) return trickHtml(v, ui.heldTrick.cards, ui.heldTrick.winnerId);
  if (s.phase === 'bidding' && s.turned) return deckHtml(v);
  if (s.phase === 'playing') return trickHtml(v, s.trick);
  if ((s.phase === 'dealEnd' || s.phase === 'gameOver') && s.summary) return verdictHtml(v);
  return '';
}

/** Fin de donne : le verdict et ce que chaque équipe marque, au centre du tapis. */
function verdictHtml(v) {
  const { T, s } = v;
  const m = s.summary;
  const over = s.phase === 'gameOver';
  const text = m.result === 'made' ? 'Contrat réussi' : m.result === 'dedans' ? 'Dedans' : 'Litige';
  const icon = m.result === 'made' ? 'check' : m.result === 'dedans' ? 'cross' : 'warning';
  const team = (t) => {
    const g = m.scored[t] + (m.bonus?.[t] ?? 0);
    return `<li data-team="${v.teamKey(t)}"><span class="label">${v.teamName(t)}</span><b class="stat tp-num">+${g}</b><span class="caption">${T.esc(`${s.teams[t].score} au total`)}</span></li>`;
  };
  return `<div class="blt-verdict" data-zone="verdict" data-result="${m.result}"><span class="label">${T.esc(over ? 'Dernière donne' : `Donne ${m.dealNumber}`)}</span>`
    + `<p class="blt-verdict__t title-md">${T.icon(icon)}${T.esc(m.capot !== null ? `${text} · capot` : text)}</p>`
    + `<ul class="blt-verdict__s">${team(v.myTeam)}${team(1 - v.myTeam)}</ul></div>`;
}

function trickInfo(v) {
  const { T, s, ui } = v;
  if (s.phase !== 'playing') return '';
  const ann = s.announceResult
    ? T.Button({ variant: 'secondary', icon: 'flag', label: 'Annonces', pressed: ui.panel === 'announces', attrs: { 'data-act': 'toggle-announces', 'aria-label': 'Voir les annonces', title: 'Voir les annonces' } })
    : '';
  const last = s.lastTrick
    ? T.Button({ variant: 'secondary', icon: 'eye', label: 'Dernier pli', pressed: ui.panel === 'last', attrs: { 'data-open': 'dernier-pli', 'aria-label': 'Voir le dernier pli', title: 'Voir le dernier pli' } })
    : '';
  return `<div class="tp-trickinfo"><span class="tp-trickinfo__n gauge">Pli ${s.trickNumber}/8</span>${ann}${last}</div>`;
}

// ---------------------------------------------------------------- panneaux au-dessus de la main

export function panelHtml(v) {
  const { s, ui } = v;
  if (ui.heldTrick) return '';
  if (s.phase === 'bidding' && s.isMyTurn) return bidPanel(v);
  if (s.phase !== 'playing') return '';
  if (s.canAnnounce && ui.announceDismissed !== ui.dealKey && !ui.announceSent) return announcePanel(v);
  if (ui.panel === 'last' && s.lastTrick) return lastTrickPanel(v);
  return '';
}

/** Coin haut droit (libre à 4 joueurs, sous les outils) : les annonces montrées au deuxième pli. */
function cornerHtml(v) {
  const { s, ui } = v;
  if (ui.heldTrick || s.phase !== 'playing' || ui.panel !== 'announces' || !s.announceResult) return '';
  return announceShow(v);
}

function bidPanel(v) {
  const { T, s } = v;
  const t = s.turned.suit;
  let caption;
  let buttons;
  if (s.bidRound === 1) {
    caption = `Premier tour : prends à ${glyph(t)} (la retournée et 2 cartes), ou passe`;
    buttons = T.Button({ variant: 'secondary', icon: 'pass', label: 'Passer', attrs: { 'data-act': 'pass' } })
      + T.Button({ variant: 'primary', label: `Prendre à ${glyph(t)}`, className: 'blt-take', attrs: { 'data-act': 'take', 'data-suit': t } });
  } else {
    caption = `Second tour : choisis l’atout (pas ${glyph(t)}) ou passe`;
    buttons = SUITS.filter((x) => x !== t).map((x) => T.Button({
      variant: 'secondary', label: `Prendre à ${glyph(x)}`, className: 'blt-take', attrs: { 'data-act': 'take', 'data-suit': x, 'aria-label': `Prendre à ${SUIT_NAME[x]}` },
    })).join('') + T.Button({ variant: 'secondary', icon: 'pass', label: 'Passer', attrs: { 'data-act': 'pass' } });
  }
  return `<section class="tp-panel tp-bids blt-bids" data-zone="bids" aria-labelledby="blt-bids-h"><div class="blt-bids__in"><header class="blt-bids__h"><h2 class="title-md" id="blt-bids-h">À toi de parler</h2>`
    + `<span class="caption">${T.rich(caption)}</span></header><div class="tp-bids__row">${buttons}</div></div></section>`;
}

function announcePanel(v) {
  const { T, s } = v;
  const items = s.myAnnounces.map((a) => `<li class="blt-ann__i"><div class="blt-annshow__c">${a.cards.map((id) => T.Card(tp(cardOf(id), { size: 'xs' }))).join('')}</div>`
    + `<span class="blt-ann__t"><span class="body-strong">${T.esc(a.label)}</span><b class="stat tp-num">${a.points}</b></span></li>`).join('');
  const label = s.myAnnounces.length > 1 ? 'Annoncer tout' : `Annoncer : ${s.myAnnounces[0].kind.toLowerCase()}`;
  return `<section class="tp-panel blt-ann" data-zone="announce" aria-labelledby="blt-ann-h"><header class="tp-panel__h"><h2 class="title-md" id="blt-ann-h">Tu peux annoncer</h2>`
    + `<span class="caption">Avant ta première carte ; seule la meilleure équipe marque, cartes montrées au deuxième pli</span></header>`
    + `<div class="blt-ann__row"><ul class="blt-ann__l">${items}</ul><div class="blt-ann__act">${T.Button({ variant: 'primary', icon: 'flag', label, attrs: { 'data-act': 'announce' } })}`
    + `${T.Button({ variant: 'ghost', label: 'Ne rien annoncer', attrs: { 'data-act': 'no-announce' } })}</div></div></section>`;
}

function announceShow(v) {
  const { T, s, ui } = v;
  const r = s.announceResult;
  const head = `${v.teamName(r.team)} ${r.team === v.myTeam ? 'marquons' : 'marquent'} ${r.points}`;
  const items = r.list.map((a) => `<figure class="blt-annshow__i"><div class="blt-annshow__c">${a.cards.map((id) => T.Card(tp(cardOf(id), { size: 'xs', faceDown: ui.annFaceDown }))).join('')}</div>`
    + `<figcaption class="caption">${T.esc(`${v.label(a.playerId)} : ${a.label} (${a.points})`)}</figcaption></figure>`).join('');
  const losers = s.players.filter((p) => p.team !== r.team && p.announced.length);
  const lost = losers.length
    ? `<p class="caption blt-annshow__lost">${T.esc(`Ne compte pas : ${losers.map((p) => `${v.label(p.id)} (${p.announced.join(', ').toLowerCase()})`).join(', ')}`)}</p>`
    : '';
  const close = T.Button({ variant: 'icon', icon: 'cross', label: 'Fermer', className: 'blt-x', attrs: { 'data-act': 'close-panel' } });
  return `<section class="tp-panel blt-annshow" data-zone="announces" aria-labelledby="blt-annshow-h"><header class="blt-annshow__h"><span class="label">Annonces</span>`
    + `<h2 class="title-sm" id="blt-annshow-h">${T.esc(head)}</h2>${close}</header><div class="blt-annshow__l">${items}</div>${lost}</section>`;
}

function lastTrickPanel(v) {
  const { T, s } = v;
  const lt = s.lastTrick;
  return `<section class="tp-panel" data-zone="last-trick" aria-labelledby="blt-lt-h"><header class="tp-panel__h"><h2 class="title-md" id="blt-lt-h">Dernier pli</h2><span class="caption">${
    T.esc(`Pli ${lt.number}, ${lt.points} points pour ${lt.winnerId === v.me ? 'toi' : v.nameOf(lt.winnerId)}`)}</span></header><div class="tp-lt">${
    lt.cards.map(({ playerId, card }) => `<figure class="tp-lt__p">${T.Card(tp(card, { size: 'sm', state: playerId === lt.winnerId ? 'winner' : '' }))}<figcaption class="caption">${T.esc(v.label(playerId))}</figcaption></figure>`).join('')
  }</div><div class="tp-panel__f">${T.Button({ variant: 'secondary', label: 'Fermer', icon: 'cross', attrs: { 'data-act': 'close-panel' } })}</div></section>`;
}

// ---------------------------------------------------------------- statut, actions, main

export function statusFor(v) {
  const { s, ui, me } = v;
  const cur = s.currentPlayerId;
  const curName = v.nameOf(cur);
  const trump = s.trump ? `Atout ${glyph(s.trump)}` : `Donne ${s.dealNumber}`;
  if (ui.heldTrick) {
    const w = ui.heldTrick.winnerId;
    const pts = `${ui.heldTrick.points} points${ui.heldTrick.number === 8 ? ', dix de der compris' : ''}`;
    return { tone: 'info', text: w === me ? 'Tu remportes le pli' : `${v.nameOf(w)} remporte le pli`, detail: `${pts} pour ${v.teamName(v.teamOf(w))}` };
  }
  if (ACTIVE.includes(s.phase) && cur && cur !== me && v.offline(cur)) {
    return { tone: 'alert', text: `Connexion perdue avec ${curName}`, detail: 'La partie reprend à son retour' };
  }
  switch (s.phase) {
    case 'bidding': {
      const round = s.bidRound === 1 ? 'premier tour' : 'second tour';
      if (s.isMyTurn) return { tone: 'turn', text: 'À toi de parler', detail: `Donne ${s.dealNumber}, ${round}` };
      return { tone: 'wait', text: `${curName} parle…`, detail: `Donne ${s.dealNumber}, ${round}` };
    }
    case 'playing': {
      if (s.isMyTurn) {
        if (s.canAnnounce && ui.announceDismissed !== ui.dealKey && !ui.announceSent) return { tone: 'turn', text: 'À toi de jouer', detail: 'Annonce d’abord si tu veux' };
        return { tone: 'turn', text: 'À toi de jouer', detail: playHints(s.myHand, s.trick, s.legalCardIds, s.trump, s.partnerId).detail };
      }
      return { tone: 'wait', text: s.trick.length ? `${curName} joue…` : `${curName} entame…`, detail: trump };
    }
    case 'dealEnd': {
      const m = s.summary;
      if (!m) return { text: 'Donne terminée' };
      const t = v.teamName(m.takerTeam);
      const text = m.result === 'made' ? `Contrat réussi (${t})` : m.result === 'dedans' ? `Dedans (${t})` : 'Litige';
      const gain = (t) => m.scored[t] + (m.bonus?.[t] ?? 0);
      const diff = gain(v.myTeam) - gain(1 - v.myTeam);
      // le ton suit le camp de celui qui regarde : vert si la donne lui profite
      return { tone: diff > 0 ? 'win' : diff < 0 ? 'alert' : undefined, text: m.capot !== null ? `${text}, capot` : text, detail: `Nous ${s.teams[v.myTeam].score} · Eux ${s.teams[1 - v.myTeam].score}` };
    }
    default:
      return { tone: 'win', text: 'Partie terminée', detail: winnerText(v) };
  }
}

export function actionsHtml(v) {
  const { T, s, ui } = v;
  if (ui.heldTrick) return '';
  if (s.phase === 'dealEnd' && ui.view !== 'summary') {
    return T.ActionBar({
      secondary: [{ label: 'Résumé', icon: 'scores', attrs: { 'data-act': 'summary' } }],
      primary: { label: 'Donne suivante', icon: 'arrow', attrs: { 'data-act': 'next' } },
    });
  }
  if (s.phase === 'gameOver' && !ui.view) {
    return T.ActionBar({
      secondary: [{ label: 'Dernière donne', icon: 'scores', attrs: { 'data-act': 'summary' } }],
      primary: { label: 'Classement', icon: 'trophy', attrs: { 'data-act': 'ranking' } },
    });
  }
  return '';
}

export function handHtml(v) {
  const { T, s, ui } = v;
  let cards = s.myHand;
  let props = () => ({});
  let interactive = false;
  if (s.phase === 'dealEnd' || s.phase === 'gameOver') cards = [];
  else if (s.phase === 'playing' && s.isMyTurn && !ui.heldTrick) {
    interactive = true;
    const { reasons } = playHints(s.myHand, s.trick, s.legalCardIds, s.trump, s.partnerId);
    props = (c) => (reasons[c.id] ? { state: 'unplayable', reason: reasons[c.id] } : { state: 'playable' });
  }
  return T.Hand({ cards: cards.map((c) => tp(c, props(c))), size: 'md', sort: false, interactive, label: 'Ta main' });
}

// ================================================================ fenêtres et tiroirs

const teamSpan = (v, t, text) => `<span class="blt-n" data-team="${v.teamKey(t)}">${v.T.esc(text)}</span>`;
const pair = (v, arr, unit = '') => `${teamSpan(v, v.myTeam, `Nous ${arr[v.myTeam]}${unit}`)} · ${teamSpan(v, 1 - v.myTeam, `Eux ${arr[1 - v.myTeam]}${unit}`)}`;

function dealSummaryHtml(v) {
  const { T, s } = v;
  const m = s.summary;
  const Tm = m.takerTeam;
  const Dm = 1 - Tm;
  const taker = m.takerId === v.me ? 'Tu prends' : `${v.nameOf(m.takerId)} prend`;
  const lines = [
    ['Contrat', T.rich(`${taker} à ${glyph(m.trump)} (${v.teamName(Tm)})`)],
    ['Plis', pair(v, m.tricks)],
    ['Points des cartes', pair(v, m.cards) + (m.capot !== null ? ' <span class="caption">(capot)</span>' : '')],
    ['Dix de der', T.esc(m.capot !== null ? 'Compris dans le capot' : v.teamName(m.derTeam))],
  ];
  if (s.announcesOn) {
    const r = m.announceResult;
    lines.push(['Annonces', r ? T.esc(`${v.teamName(r.team)} : ${r.points} (${r.list.map((a) => a.label).join(', ')})`) : 'Aucune']);
  }
  lines.push(['Belote', m.beloteId ? T.esc(`${v.teamName(v.teamOf(m.beloteId))} : 20 (${v.label(m.beloteId)})`) : 'Aucune']);
  lines.push(['Total de la donne', pair(v, m.totals)]);
  if (m.result === 'dedans') {
    lines.push(['Dedans', T.esc(`${v.teamName(Dm)} ${Dm === v.myTeam ? 'marquons' : 'marquent'} ${m.capot === Dm ? 252 : 162}${m.announces[0] + m.announces[1] ? ' et les annonces' : ''}${m.belote[Tm] ? `, ${Tm === v.myTeam ? 'nous gardons' : 'eux gardent'} la belote` : ''}`)]);
  } else if (m.result === 'litige') {
    lines.push(['Litige', T.esc(`${m.held} points en attente : ils iront à l’équipe qui gagnera la donne suivante`)]);
  }
  if (m.bonusTeam !== null && m.bonusTeam !== undefined) {
    lines.push(['Litige précédent', T.esc(`+${m.bonus[m.bonusTeam]} pour ${v.teamName(m.bonusTeam)}`)]);
  }
  const verdict = m.result === 'made' ? 'Contrat réussi' : m.result === 'dedans' ? 'Dedans' : 'Litige';
  const head = `${m.capot !== null ? 'Capot · ' : ''}${verdict}`;
  const gains = [v.myTeam, 1 - v.myTeam].map((t) => {
    const g = m.scored[t] + (m.bonus?.[t] ?? 0);
    return `<li data-sign="+" data-team="${v.teamKey(t)}"${t === v.myTeam ? ' data-me' : ''}><span class="blt-dot" aria-hidden="true"></span><span class="body">${v.teamName(t)} <span class="caption">${T.esc(v.teamPlayers(t))}</span></span><b class="stat tp-num">+${g}</b></li>`;
  }).join('');
  return `<div class="tp-deal blt-deal" data-zone="deal-summary" data-made="${m.result === 'made'}"><p class="tp-deal__verdict title-md">${T.icon(m.result === 'made' ? 'check' : m.result === 'dedans' ? 'cross' : 'warning')}${T.esc(head)}</p>`
    + `<dl class="tp-deal__lines">${lines.map(([k, val]) => `<div class="tp-deal__l"><dt class="caption">${T.esc(k)}</dt><dd class="body">${val}</dd></div>`).join('')}</dl>`
    + `<ul class="tp-deal__gains">${gains}</ul>`
    + `<p class="caption blt-deal__tot">${T.esc(`Total : Nous ${m.scores[v.myTeam]}, Eux ${m.scores[1 - v.myTeam]} · partie en ${s.target}`)}</p></div>`;
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
  return T.Dialog({
    id: 'resume', kicker: last ? 'Dernière donne' : `Donne ${m.dealNumber}`, title: 'Résumé de la donne',
    size: 'lg', body: dealSummaryHtml(v), actions,
  });
}

export function endScreen(v) {
  const { T, s } = v;
  const sc = s.teams.map((t) => t.score);
  const w = sc[0] > sc[1] ? 0 : 1;
  const won = w === v.myTeam;
  const note = v.isHost ? 'Utilise « Retour au salon » en haut pour relancer une partie.' : 'En attente de l’hôte pour revenir au salon.';
  const deals = s.history.length;
  return T.EndScreen({
    result: won ? 'victoire' : 'defaite',
    title: won ? 'Victoire' : 'Défaite',
    subtitle: `${won ? 'Nous gagnons' : 'Eux gagnent'} ${sc[w]} à ${sc[1 - w]}, en ${deals} donne${deals > 1 ? 's' : ''}.`,
    ranking: [w, 1 - w].map((t) => ({
      name: s.teams[t].playerIds.map((id) => v.nameOf(id)).join(' & '), avatar: v.avatarOf(s.teams[t].playerIds.find((id) => id !== v.me) ?? s.teams[t].playerIds[0]),
      me: t === v.myTeam, score: String(sc[t]), note: v.teamName(t),
    })),
    extra: `<div class="blt-end-sheet">${scoreSheet(v)}</div>`,
    actions: `${T.Button({ variant: 'secondary', icon: 'info', label: 'Dernière donne', attrs: { 'data-act': 'summary' } })}${
      T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })}${
      T.Button({ variant: 'ghost', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'close-end' } })}<p class="caption blt-end-note">${T.esc(note)}</p>`,
  });
}

/** « Nous gagnons 1023 à 870 ». */
function winnerText(v) {
  const sc = v.s.teams.map((t) => t.score);
  const w = sc[0] > sc[1] ? 0 : 1;
  return `${w === v.myTeam ? 'Nous gagnons' : 'Eux gagnent'} ${sc[w]} à ${sc[1 - w]}`;
}

/** La feuille de belote : une colonne « Nous », une colonne « Eux », le total qui court. */
export function scoreSheet(v) {
  const { T, s } = v;
  const cols = [v.myTeam, 1 - v.myTeam];
  const res = { made: ['check', 'Réussi', 'true'], dedans: ['cross', 'Dedans', 'false'], litige: ['warning', 'Litige', 'false'] };
  const rows = s.history.map((h) => {
    const [icon, text, ok] = res[h.result];
    const cells = cols.map((t) => {
      const g = h.scored[t] + (h.bonus?.[t] ?? 0);
      return `<td class="tp-num" data-team="${v.teamKey(t)}"${t === v.myTeam ? ' data-me="true"' : ''}>${g ? `+${g}` : '0'}<span class="caption blt-ss__run">${h.scores[t]}</span></td>`;
    }).join('');
    return `<tr><th scope="row" class="tp-num">${h.dealNumber}</th><td>${T.esc(v.label(h.takerId))} <span class="caption">${T.rich(glyph(h.trump))}</span></td>`
      + `<td><span class="tp-ss__res" data-made="${ok}">${T.icon(icon)}${text}${h.capot !== null ? ' <span class="caption">· capot</span>' : ''}</span></td>${cells}</tr>`;
  }).join('');
  const head = cols.map((t) => `<th scope="col" data-team="${v.teamKey(t)}"${t === v.myTeam ? ' data-me="true"' : ''}>${v.teamName(t)}</th>`).join('');
  const foot = cols.map((t) => `<td class="tp-num stat" data-team="${v.teamKey(t)}"${t === v.myTeam ? ' data-me="true"' : ''}>${s.teams[t].score}</td>`).join('');
  const table = `<table class="tp-ss blt-ss"><caption class="tp-vh">Feuille de scores</caption><thead><tr><th scope="col">Donne</th><th scope="col">Preneur</th><th scope="col">Résultat</th>${head}</tr></thead>`
    + `<tbody>${rows}</tbody><tfoot><tr><th scope="row" colspan="3">Total · partie en ${s.target}</th>${foot}</tr></tfoot></table>`;
  const who = `<p class="caption blt-ss__who">${T.esc(`Nous : ${v.teamPlayers(v.myTeam)} · Eux : ${v.teamPlayers(1 - v.myTeam)}`)}</p>`;
  return `${who}${table}${s.history.length ? '' : '<p class="caption blt-empty">Aucune donne terminée pour l’instant.</p>'}`;
}

export function journalHtml(v) {
  const { T, s } = v;
  if (!s.log.length) return '<p class="caption">Rien pour l’instant.</p>';
  return T.Log({
    entries: [...s.log].reverse().map((e) => ({
      text: richLog(e.text),
      tone: /réussit|gagne la partie|Belote|Rebelote/.test(e.text) ? 'good' : /dedans|litige/.test(e.text) ? 'alert' : undefined,
    })),
  });
}

