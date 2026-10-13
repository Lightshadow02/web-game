import {
  SUIT, SUIT_NAME, SUIT_OF_TAPIS, FIG, RANK_NAME, BID, BID_LABEL, BID_SHORT, POIGNEE_NAME,
  tp, trumpCount, cardName, calledRankName, calledArticle, calledDef, deName, num, signed,
  playHints, ecartRules, winDetail, richLog,
} from './cards.js';

/* =====================================================================
 * Tarot : écrans construits avec les composants Tapis (table « salon »),
 * à partir de l'état envoyé par le serveur (getStateFor) et de l'état local
 * de l'interface (ui). Tout renvoie du HTML ; chaque texte venant d'un joueur
 * passe par un composant Tapis, Tapis.esc ou Tapis.rich.
 * ===================================================================== */

/** Places autour de la table (moi en bas). Le Tarot tourne vers la droite : le joueur suivant est à ma droite. */
const POS = { 3: ['top-right', 'top-left'], 4: ['right', 'top', 'left'], 5: ['right', 'top-right', 'top-left', 'left'] };
const AREA = { left: 's-left', top: 's-top', right: 's-right', 'top-left': 's-tl', 'top-right': 's-tr' };
const area = (name, html) => `<div class="tp-area" data-area="${name}" style="grid-area:${name}">${html}</div>`;
const ACTIVE = ['bidding', 'calling', 'discard', 'playing'];

/** Contexte de rendu : l'état, la salle (avatars, connexions) et quelques raccourcis. */
export function viewContext(T, s, { me, room, ui }) {
  const i0 = Math.max(0, s.players.findIndex((p) => p.id === me));
  const others = [...s.players.slice(i0 + 1), ...s.players.slice(0, i0)]; // ordre de jeu après moi
  const pos = Object.fromEntries(others.map((p, i) => [p.id, POS[s.playerCount]?.[i] ?? 'top']));
  pos[me] = 'bottom';
  // pseudos en double (rare) : on les distingue pour la table et la feuille de scores
  const names = {};
  const seen = {};
  for (const p of s.players) {
    seen[p.name] = (seen[p.name] ?? 0) + 1;
    names[p.id] = seen[p.name] > 1 ? `${p.name} (${seen[p.name]})` : p.name;
  }
  const rp = (id) => room?.players?.find((p) => p.id === id);
  const v = {
    T, s, me, ui, others, pos, names,
    nameOf: (id) => names[id] ?? '?',
    label: (id) => (id === me ? 'Toi' : names[id] ?? '?'),
    avatarOf: (id) => rp(id)?.avatarUrl || undefined,
    offline: (id) => rp(id)?.connected === false,
    meP: s.players.find((p) => p.id === me),
    takerMe: s.takerId === me,
    isHost: room?.hostId === me,
  };
  return v;
}

// ================================================================ table

export function tableHtml(v) {
  const { T, s, others, pos } = v;
  const seats = others.map((p) => area(AREA[pos[p.id]], T.Seat({ ...seatProps(v, p), pos: pos[p.id], fan: true }))).join('');
  const panel = panelHtml(v);
  return `<div class="tp-table tp-table--salon" data-players="${s.playerCount}" data-phase="${s.phase}">${seats}${
    area('trick', feltTop(v) + centerHtml(v) + trickInfo(v) + (panel ? `<div class="tp-overpanel">${panel}</div>` : ''))}${
    area('me', T.Seat({ ...seatProps(v, v.meP), count: handCards(v).cards.length, me: true, compact: true }) + noteHtml(v))}${
    area('status', T.Status(statusFor(v)))}${
    area('actions', actionsHtml(v))}${
    area('hand', handHtml(v))}</div>`;
}

function seatProps(v, p) {
  const { s } = v;
  const state = v.offline(p.id) ? 'offline' : p.id === s.currentPlayerId && ACTIVE.includes(s.phase) && !v.ui.heldTrick ? 'active' : 'waiting';
  const showTricks = ['playing', 'roundEnd', 'gameOver'].includes(s.phase);
  return {
    seat: p.id,
    name: v.nameOf(p.id),
    avatar: v.avatarOf(p.id),
    state,
    count: p.cardCount,
    tricks: showTricks ? p.tricks : undefined,
    meta: p.score ? `${signed(p.score)} pts` : undefined,
    badges: badges(v, p),
    bubble: bubble(v, p),
  };
}

function badges(v, p) {
  const { s } = v;
  const highest = s.phase === 'bidding' ? s.bids.filter((b) => b.bid !== 'passe').at(-1) : null;
  const poignee = s.poignees.find((x) => x.playerId === p.id);
  return [
    p.id === s.dealerId && { label: 'Donneur', icon: 'fan', tone: 'muted' },
    highest?.playerId === p.id && { label: BID_SHORT[highest.bid], tone: 'accent' },
    p.isTaker && { label: 'Preneur', icon: 'flag', tone: 'accent' },
    poignee && { label: 'Poignée', icon: 'fan', tone: 'accent', title: `Poignée ${POIGNEE_NAME[poignee.size]} : ${poignee.cards.length} atouts montrés` },
    p.isPartner && { label: 'Partenaire', icon: 'pair', tone: 'positive' }, // en dernier : Tapis.anim.partner vise le dernier badge
  ].filter(Boolean);
}

function bubble(v, p) {
  const { s } = v;
  if ((s.phase === 'bidding' || s.phase === 'calling') && p.bid) {
    return { text: BID_SHORT[p.bid], tone: p.bid === 'passe' ? 'pass' : undefined };
  }
  if (s.phase === 'playing' && s.trickNumber === 1 && !v.ui.heldTrick) {
    const poignee = s.poignees.find((x) => x.playerId === p.id);
    if (poignee) return { text: `Poignée ${POIGNEE_NAME[poignee.size]}` };
  }
  return undefined;
}

/** Note privée sous mon siège : partenaire secret, ou preneur qui s'est appelé lui-même. */
function noteHtml(v) {
  const { T, s, me } = v;
  if (!s.calledCard || s.partnerId || !['discard', 'playing'].includes(s.phase)) return '';
  const fig = calledRankName(s.calledCard.rank);
  const name = `${fig} de ${SUIT_NAME[s.calledCard.suit]}`;
  if (s.iAmPartner) {
    const queen = s.calledCard.rank === 13;
    return T.PartnerNote({ text: `Tu as ${calledDef(s.calledCard.rank)} ${name} ${queen ? 'appelée' : 'appelé'}. Personne ne le sait avant qu’${queen ? 'elle' : 'il'} tombe.` });
  }
  // le preneur a appelé un Roi de sa main (pas celui du chien retourné, que tout le monde a vu)
  const fromChien = v.ui.calledInChien || s.chien?.some((c) => c.id === s.calledCard.id);
  if (s.takerId === me && !fromChien && s.myHand.some((c) => c.id === s.calledCard.id)) {
    const queen = s.calledCard.rank === 13;
    return `<div class="tp-secret" data-zone="secret" role="note">${T.icon('lock')}<span><b class="body-strong">Tu joues seul</b><span class="caption">${T.esc(`Tu as appelé ${queen ? 'ta propre' : 'ton propre'} ${fig}. Personne ne le sait avant qu’${queen ? 'elle' : 'il'} tombe.`)}</span></span></div>`;
  }
  return '';
}

// ---------------------------------------------------------------- centre du tapis

function contractHtml(v) {
  const { T, s, ui, me } = v;
  if (!s.contract) return '';
  let text = `${BID_LABEL[s.contract.id]} ${deName(v.nameOf(s.takerId))}`;
  let partner = '';
  if (s.calledCard) {
    const r = s.calledCard.rank;
    text += `, ${calledRankName(r)} de {${SUIT[s.calledCard.suit]}} ${r === 13 ? 'appelée' : 'appelé'}`;
    const roundDone = s.phase === 'roundEnd' || s.phase === 'gameOver';
    if (s.partnerId && s.partnerId === s.takerId) partner = [T.icon('user'), `Sans partenaire : ${calledRankName(r)} dans sa main`];
    else if (s.partnerId) partner = [T.icon('pair'), `Partenaire : ${s.partnerId === me ? 'toi' : v.nameOf(s.partnerId)}`];
    else if (ui.calledInChien || roundDone) partner = [T.icon('user'), `Sans partenaire : ${calledRankName(r)} au chien`];
    else partner = [T.icon('lock'), 'Partenaire inconnu'];
  }
  return `<div class="tp-contract" data-zone="contract" role="status">${T.icon('flag')}<span class="tp-contract__t body-strong">${T.rich(text)}</span>${
    partner ? `<span class="tp-contract__p caption">${partner[0]}${T.rich(partner[1])}</span>` : ''}</div>`;
}

function feltTop(v) {
  const c = contractHtml(v);
  return c ? `<div class="tp-felt-top">${c}</div>` : '';
}

function chienHtml(v, { faceUp, label, zone = true }) {
  const { T, s, ui } = v;
  const cards = faceUp
    ? s.chien.map((c) => T.Card(tp(c, { size: 'md', faceDown: ui.chienFaceDown }))).join('')
    : Array.from({ length: s.chienCount }, () => T.Back({ size: 'sm' })).join('');
  return `<div class="tp-chien"${zone ? ' data-zone="chien"' : ''}><div class="tp-chien__c">${cards}</div><span class="tp-chien__l label">${T.esc(label)}</span></div>`;
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
  return T.Trick({ plays, players: s.playerCount, size: 'md', label: `Pli ${s.trickNumber}/${s.totalTricks}` });
}

function centerHtml(v) {
  const { T, s, ui } = v;
  if (ui.heldTrick) return trickHtml(v, ui.heldTrick.cards, ui.heldTrick.winnerId);
  switch (s.phase) {
    case 'bidding':
    case 'calling':
      return chienHtml(v, { faceUp: false, label: `Chien · ${s.chienCount} cartes` });
    case 'discard':
      if (s.chien && (!v.takerMe || !ui.chienTaken || ui.keepChienCenter)) return chienHtml(v, { faceUp: true, label: 'Le chien, montré à tous' });
      return `<div class="tp-chien" data-zone="ecart-pile"><div class="tp-chien__c">${T.Slot({ size: 'md', label: 'Écart' })}</div></div>`;
    case 'playing':
      return trickHtml(v, s.trick);
    default:
      return '';
  }
}

function trickInfo(v) {
  const { T, s, ui } = v;
  if (s.phase !== 'playing') return '';
  const last = s.lastTrick
    ? T.Button({ variant: 'secondary', icon: 'eye', label: 'Voir le dernier pli', pressed: ui.panel === 'last', attrs: { 'data-open': 'dernier-pli', 'aria-label': 'Voir le dernier pli', title: 'Voir le dernier pli' } })
    : '';
  const shows = s.poignees.length
    ? T.Button({ variant: 'secondary', icon: 'fan', label: s.poignees.length > 1 ? 'Poignées' : 'Poignée', pressed: ui.panel === 'poignees', attrs: { 'data-act': 'toggle-poignees', 'aria-label': 'Voir les poignées annoncées', title: 'Voir les poignées annoncées' } })
    : '';
  return `<div class="tp-trickinfo"><span class="tp-trickinfo__n gauge">Pli ${s.trickNumber}/${s.totalTricks}</span>${shows}${last}</div>`;
}

// ---------------------------------------------------------------- panneaux au-dessus de la main

export function panelHtml(v) {
  const { T, s, ui } = v;
  if (ui.heldTrick) return '';
  if (s.phase === 'bidding' && s.isMyTurn) {
    const high = s.bids.filter((b) => b.bid !== 'passe').at(-1);
    return T.BidPanel({ current: high ? BID[high.bid] : undefined, by: high ? v.nameOf(high.playerId) : '', mine: true });
  }
  if (s.phase === 'calling' && s.isMyTurn && s.callableCards.length) return kingCallHtml(v);
  if (s.phase === 'discard' && s.isMyTurn && ui.chienTaken && !ui.keepChienCenter) {
    return T.EcartGuide({ done: ui.sel.length, need: s.discardCount })
      .replace('class="tp-btn tp-btn--primary"', 'class="tp-btn tp-btn--primary" data-act="ecart"');
  }
  if (s.phase !== 'playing') return '';
  if (s.isMyTurn && s.trickNumber === 1 && s.poigneeOptions.length && ui.handfulDismissed !== ui.dealKey) {
    return T.HandfulPrompt({ players: s.playerCount, trumps: trumpCount(s.myHand) })
      .replace('class="tp-btn tp-btn--ghost"', 'class="tp-btn tp-btn--ghost" data-act="no-handful"');
  }
  if (ui.panel === 'last' && s.lastTrick) return lastTrickPanel(v);
  if (ui.panel === 'poignees' && s.poignees.length) return poigneesHtml(v);
  return '';
}

function kingCallHtml(v) {
  const { T, s, ui } = v;
  const rank = s.callableCards[0].rank;
  let html = T.KingCall({ rank: FIG[rank], selected: ui.callSuit ?? undefined })
    .replace('class="tp-btn tp-btn--primary"', 'class="tp-btn tp-btn--primary" data-act="call"');
  // Tapis ne prévoit que le Roi et la Dame : on corrige les textes pour la Dame, le Cavalier et le Valet.
  if (rank === 13) html = html.replace('Appeler le Dame', 'Appeler la Dame');
  if (rank < 13) {
    const fig = RANK_NAME[rank];
    html = html.replace('Appelle une Dame', `Appelle un ${fig}`)
      .replace('Tu as les 4 Rois : appelle une Dame.', `Tu as les 4 Rois et les 4 Dames${rank === 11 ? ' et les 4 Cavaliers' : ''} : appelle un ${fig}.`);
  }
  return html;
}

function lastTrickPanel(v) {
  const { T, s } = v;
  const lt = s.lastTrick;
  return `<section class="tp-panel" data-zone="last-trick" aria-labelledby="trt-lt-h"><header class="tp-panel__h"><h2 class="title-md" id="trt-lt-h">Dernier pli</h2><span class="caption">${
    T.esc(`Pli ${lt.number}, gagné par ${lt.winnerId === v.me ? 'toi' : v.nameOf(lt.winnerId)}`)}</span></header><div class="tp-lt">${
    lt.cards.map(({ playerId, card }) => `<figure class="tp-lt__p">${T.Card(tp(card, { size: 'sm', state: playerId === lt.winnerId ? 'winner' : '' }))}<figcaption class="caption">${T.esc(v.label(playerId))}</figcaption></figure>`).join('')
  }</div><div class="tp-panel__f">${T.Button({ variant: 'secondary', label: 'Fermer', icon: 'cross', attrs: { 'data-act': 'close-panel' } })}</div></section>`;
}

function poigneesHtml(v) {
  const { T, s } = v;
  const shows = s.poignees.map((p) => {
    const name = v.nameOf(p.playerId);
    let html = T.HandfulShow({ name, type: POIGNEE_NAME[p.size], cards: p.cards.map((c) => tp(c)) });
    if (/^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(name)) html = html.replace(`Poignée ${POIGNEE_NAME[p.size]} de `, `Poignée ${POIGNEE_NAME[p.size]} d’`);
    return html;
  });
  // un bouton Fermer discret dans l'en-tête du premier panneau (le panneau reste aussi bas que la maquette)
  const close = T.Button({ variant: 'icon', icon: 'cross', label: 'Fermer', className: 'trt-x', attrs: { 'data-act': 'close-panel' } });
  shows[0] = shows[0].replace('</header>', `${close}</header>`);
  return `<div class="trt-shows">${shows.join('')}</div>`;
}

// ---------------------------------------------------------------- statut, actions, main

export function statusFor(v) {
  const { s, ui, me } = v;
  const round = `Donne ${s.roundNumber}/${s.totalRounds}`;
  const cur = s.currentPlayerId;
  const curName = v.nameOf(cur);
  const mult = s.contract ? `${BID_SHORT[s.contract.id]} ×${s.contract.mult}` : round;
  if (ui.heldTrick) {
    const w = ui.heldTrick.winnerId;
    return { tone: 'info', text: w === me ? 'Tu remportes le pli' : `${v.nameOf(w)} remporte le pli`, detail: winDetail(ui.heldTrick.cards, w) };
  }
  if (ACTIVE.includes(s.phase) && cur && cur !== me && v.offline(cur)) {
    return { tone: 'alert', text: `Connexion perdue avec ${curName}`, detail: 'La partie reprend à son retour' };
  }
  switch (s.phase) {
    case 'bidding': {
      if (s.isMyTurn) return { tone: 'turn', text: 'À toi d’annoncer', detail: round };
      const high = s.bids.filter((b) => b.bid !== 'passe').at(-1);
      return { tone: 'wait', text: `${curName} annonce…`, detail: high ? `Plus haute : ${BID_SHORT[high.bid]} (${v.label(high.playerId)}) · ${round}` : round };
    }
    case 'calling': {
      const r = s.calledCard?.rank ?? s.callableCards[0]?.rank ?? 14;
      if (!s.isMyTurn) return { tone: 'wait', text: `${curName} appelle ${calledArticle(r)} ${calledRankName(r)}…`, detail: mult };
      const fig = calledRankName(r);
      let detail = `Celui qui l’a sera ton partenaire secret`;
      if (ui.callSuit) {
        const suit = SUIT_OF_TAPIS[ui.callSuit];
        const mine = s.myHand.some((c) => c.suit === suit && c.rank === r);
        detail = mine ? `Tu as ${calledDef(r)} ${fig} de ${SUIT_NAME[suit]} : tu joueras seul` : `Tu n’as pas ${calledDef(r)} ${fig} de ${SUIT_NAME[suit]}`;
      }
      return { tone: 'turn', text: `${BID_SHORT[s.contract.id]} : appelle ${calledArticle(r)} ${fig}`, detail };
    }
    case 'discard': {
      if (!v.takerMe) return { tone: 'wait', text: `${v.nameOf(s.takerId)} fait son écart…`, detail: 'Le chien est montré à tous' };
      if (!ui.chienTaken || ui.keepChienCenter) return { tone: 'info', text: 'Le chien est retourné', detail: 'Il part dans ta main' };
      const { trumpsAllowed } = ecartRules(s.myHand, s.discardCount);
      return {
        tone: 'turn',
        text: `Écarte ${s.discardCount} cartes : ${ui.sel.length}/${s.discardCount}`,
        detail: trumpsAllowed ? 'Rois et bouts estompés · les atouts écartés seront montrés à tous' : 'Rois, bouts et atouts estompés',
      };
    }
    case 'playing': {
      if (s.isMyTurn) return { tone: 'turn', text: 'À toi de jouer', detail: playHints(s.myHand, s.trick, s.legalCardIds).detail };
      if (ui.poigneeNews && ui.panel === 'poignees') {
        const p = s.poignees.at(-1);
        if (p) {
          const bonus = { simple: 20, double: 30, triple: 40 }[p.size];
          return { tone: 'info', text: `${v.nameOf(p.playerId)} montre une poignée ${POIGNEE_NAME[p.size]}`, detail: `${p.cards.length} atouts, ${bonus} points au camp gagnant` };
        }
      }
      return { tone: 'wait', text: s.trick.length ? `${curName} joue…` : `${curName} entame…`, detail: mult };
    }
    case 'roundEnd': {
      const m = s.summary;
      return m ? { tone: m.made ? 'win' : 'alert', text: m.made ? 'Contrat réussi' : 'Contrat chuté', detail: `${m.contract.name} ${deName(v.nameOf(m.takerId))} · ${round}` } : { text: 'Donne terminée' };
    }
    default: {
      return { tone: 'win', text: 'Partie terminée', detail: winnerText(v) };
    }
  }
}

export function actionsHtml(v) {
  const { T, s, ui } = v;
  if (ui.heldTrick) return '';
  if (s.phase === 'discard' && v.takerMe && s.isMyTurn && !ui.chienTaken) {
    return T.ActionBar({ primary: { label: 'Prendre le chien', icon: 'arrow', attrs: { 'data-act': 'take-chien' } } });
  }
  if (s.phase === 'roundEnd' && ui.view !== 'summary') {
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

/** Cartes affichées dans ma main, et ce qu'on peut en faire (mode 'play' | 'ecart' | null). */
function handCards(v) {
  const { s, ui } = v;
  let cards = s.myHand;
  let mode = null;
  let props = () => ({});
  if (s.phase === 'roundEnd' || s.phase === 'gameOver') cards = [];
  else if (s.phase === 'discard' && v.takerMe && s.isMyTurn) {
    const chien = new Set((s.chien ?? []).map((c) => c.id));
    if (!ui.chienTaken) cards = cards.filter((c) => !chien.has(c.id));
    else if (!ui.keepChienCenter) {
      mode = 'ecart';
      const { reason } = ecartRules(s.myHand, s.discardCount);
      const sel = new Set(ui.sel);
      props = (c) => {
        const why = reason(c);
        return { tag: chien.has(c.id) ? 'Chien' : undefined, state: why ? 'unplayable' : undefined, reason: why ?? undefined, selected: sel.has(c.id) };
      };
    } else {
      props = (c) => ({ tag: chien.has(c.id) ? 'Chien' : undefined });
    }
  } else if (s.phase === 'playing' && s.isMyTurn && !ui.heldTrick) {
    mode = 'play';
    const { reasons } = playHints(s.myHand, s.trick, s.legalCardIds);
    props = (c) => (reasons[c.id] ? { state: 'unplayable', reason: reasons[c.id] } : { state: 'playable' });
  }
  return { cards, mode, props };
}

export function handHtml(v) {
  const { cards, mode, props } = handCards(v);
  return v.T.Hand({
    cards: cards.map((c) => tp(c, props(c))),
    size: 'md', sort: true, multi: mode === 'ecart', interactive: mode !== null, label: 'Ta main',
  });
}

// ================================================================ fenêtres et tiroirs

function dealSummaryHtml(v) {
  const { T, s, me } = v;
  const m = s.summary;
  const taker = v.nameOf(m.takerId);
  let contract = `${m.contract.name} ${deName(taker)} (×${m.contract.mult})`;
  if (m.calledCard) {
    const r = m.calledCard.rank;
    const called = `${calledDef(r)} ${calledRankName(r)} de {${SUIT[m.calledCard.suit]}}`;
    if (m.partnerId) contract += ` avec ${v.nameOf(m.partnerId)}, qui avait ${called}`;
    else if (s.partnerId === m.takerId) contract += `, sans partenaire : ${called} était dans sa main`;
    else contract += `, sans partenaire : ${called} était au chien`;
  }
  const lines = [
    ['Contrat', T.rich(contract)],
    ['Bouts', T.esc(`${m.oudlers} → ${m.needed} points requis`)],
    ['Points réalisés', `<b class="tp-num">${num(m.points)}</b> sur 91`],
    ['Écart au contrat', `<b class="tp-num">${signed(m.diff)}</b>`],
    ['Base', `25 + ${Math.round(Math.abs(m.diff))} = <b class="tp-num">${m.base}</b>`],
    ['× contrat', `${m.base} × ${m.contract.mult} = <b class="tp-num">${m.base * m.contract.mult}</b>`],
  ];
  if (m.petitAuBout) {
    const w = s.lastTrick?.winnerId;
    lines.push(['Petit au bout', T.esc(`${w ? `${v.label(w)}, ` : ''}${m.petitAuBout > 0 ? 'attaque' : 'défense'} : ${signed(m.petitAuBout)}`)]);
  }
  for (const p of m.poignees) {
    lines.push(['Poignée', T.esc(`${v.label(p.playerId)}, ${POIGNEE_NAME[p.size]} : ${p.bonus} ${m.made ? 'à l’attaque' : 'à la défense'}`)]);
  }
  lines.push(['Total', T.esc(`${signed(m.total)} par défenseur`)]);

  const order = [m.takerId, m.partnerId, ...s.players.map((p) => p.id)].filter((id, i, a) => id && a.indexOf(id) === i);
  const gains = order.map((id) => {
    const g = m.changes[id] ?? 0;
    const role = id === m.takerId ? 'preneur' : id === m.partnerId ? 'partenaire' : 'défense';
    return `<li data-sign="${g < 0 ? '-' : '+'}"${id === me ? ' data-me' : ''}>${T.Avatar({ name: v.nameOf(id), src: v.avatarOf(id), size: 'sm' })}<span class="body">${T.esc(v.nameOf(id))}${id === me ? ' <span class="caption">(toi)</span>' : ''} <span class="caption">${role}</span></span><b class="stat tp-num">${g ? signed(g) : '±0'}</b></li>`;
  }).join('');
  return `<div class="tp-deal" data-zone="deal-summary" data-made="${m.made}"><p class="tp-deal__verdict title-md">${T.icon(m.made ? 'check' : 'cross')}${m.made ? 'Contrat réussi' : 'Contrat chuté'}</p>`
    + `<dl class="tp-deal__lines">${lines.map(([k, val]) => `<div class="tp-deal__l"><dt class="caption">${T.esc(k)}</dt><dd class="body">${val}</dd></div>`).join('')}</dl>`
    + `<ul class="tp-deal__gains">${gains}</ul></div>`;
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
    id: 'resume', kicker: last ? 'Dernière donne' : `Donne ${m.roundNumber}/${s.totalRounds}`, title: 'Résumé de la donne',
    size: 'lg', body: dealSummaryHtml(v), actions,
  });
}

export function endScreen(v) {
  const { T, s, me } = v;
  const ranking = [...s.players].sort((a, b) => b.score - a.score);
  const who = `${winnerText(v)}.`;
  const note = v.isHost ? 'Utilise « Retour au salon » en haut pour relancer une partie.' : 'En attente de l’hôte pour revenir au salon.';
  return T.EndScreen({
    result: 'fin', title: 'Fin de partie', subtitle: `${s.totalRounds} donnes jouées. ${who}`,
    ranking: ranking.map((p) => ({ name: v.nameOf(p.id), avatar: v.avatarOf(p.id), me: p.id === me, score: signed(p.score) })),
    extra: `<div class="trt-end-sheet">${scoreSheet(v)}</div>`,
    actions: `${T.Button({ variant: 'secondary', icon: 'info', label: 'Dernière donne', attrs: { 'data-act': 'summary' } })}${
      T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })}${
      T.Button({ variant: 'ghost', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'close-end' } })}<p class="caption trt-end-note">${T.esc(note)}</p>`,
  });
}

/** Écart au contrat pour Tapis.ScoreSheet, qui ajoute lui-même le « + » d'un nombre positif. */
function diffArg(d) {
  if (d == null) return undefined;
  if (d > 0) return Number.isInteger(d) ? d : `+${num(d)}`;
  return d < 0 ? `−${num(-d)}` : 0;
}

/** « Léa gagne avec +337 », « Tu gagnes avec +40 », « Égalité entre Léa et toi avec +12 ». */
function winnerText(v) {
  const { s, me } = v;
  const best = Math.max(...s.players.map((p) => p.score));
  const winners = s.players.filter((p) => p.score === best);
  if (winners.length > 1) return `Égalité entre ${winners.map((p) => (p.id === me ? 'toi' : v.nameOf(p.id))).join(' et ')} avec ${signed(best)}`;
  return winners[0].id === me ? `Tu gagnes avec ${signed(best)}` : `${v.nameOf(winners[0].id)} gagne avec ${signed(best)}`;
}

export function scoreSheet(v) {
  const { T, s, me } = v;
  const order = [me, ...v.others.map((p) => p.id)].filter((id) => s.players.some((p) => p.id === id));
  const sheet = T.ScoreSheet({
    players: order.map((id) => v.nameOf(id)),
    me: v.nameOf(me),
    rows: s.history.map((h) => ({
      deal: h.roundNumber, taker: v.nameOf(h.takerId), bid: BID[h.contract], made: h.made,
      diff: diffArg(h.diff),
      gains: order.map((id) => h.changes[id] ?? 0),
    })),
  });
  return s.history.length ? sheet : `${sheet}<p class="caption trt-empty">Aucune donne terminée pour l’instant.</p>`;
}

export function journalHtml(v) {
  const { T, s } = v;
  if (!s.log.length) return '<p class="caption">Rien pour l’instant.</p>';
  return T.Log({
    entries: [...s.log].reverse().map((e) => ({
      text: richLog(e.text),
      tone: /réussit|Petit au bout/.test(e.text) ? 'good' : /chute/.test(e.text) ? 'alert' : undefined,
    })),
  });
}

export { cardName };
