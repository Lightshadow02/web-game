import { tp, fmt, signed, chipList, CHIP_BUTTONS, richLog } from './cards.js';

/* =====================================================================
 * Blackjack : écrans construits avec les composants Tapis (table « salon »),
 * à partir de l'état envoyé par le serveur (getStateFor) et de l'état local
 * de l'interface (ui). Tout renvoie du HTML ; chaque texte venant d'un joueur
 * passe par un composant Tapis, Tapis.esc ou Tapis.rich.
 *
 * Table : la banque et son sabot en haut, le tapis imprimé au centre, les places
 * des joueurs en arc en bas (ordre du jeu, de gauche à droite), puis la barre :
 * jetons à miser, statut, actions.
 * ===================================================================== */

const area = (name, html) => `<div class="tp-area" data-area="${name}" style="grid-area:${name}">${html}</div>`;
const ENDED = ['roundEnd', 'gameOver'];

/** Contexte de rendu : l'état, la salle (avatars, connexions) et quelques raccourcis. */
export function viewContext(T, s, { me, room, ui }) {
  const names = {};
  const seen = {};
  for (const p of s.players) {
    seen[p.name] = (seen[p.name] ?? 0) + 1;
    names[p.id] = seen[p.name] > 1 ? `${p.name} (${seen[p.name]})` : p.name;
  }
  const rp = (id) => room?.players?.find((p) => p.id === id);
  return {
    T, s, me, ui, names,
    my: s.my,
    meP: s.players.find((p) => p.id === me) ?? null,
    nameOf: (id) => names[id] ?? '?',
    label: (id) => (id === me ? 'Toi' : names[id] ?? '?'),
    avatarOf: (id) => rp(id)?.avatarUrl || undefined,
    offline: (id) => rp(id)?.connected === false,
    isHost: room?.hostId === me,
  };
}

// ================================================================ table

export function tableHtml(v) {
  const { s } = v;
  return `<div class="tp-table tp-table--bj" data-players="${s.players.length}" data-phase="${s.phase}">${
    area('tray', trayHtml(v))}${
    area('dealer', `<div class="bj-dealer-row">${discardHtml(v)}${dealerHtml(v)}${shoeHtml(v)}</div>`)}${
    area('felt', `${feltHtml()}<div class="bj-center">${centerHtml(v)}</div>`)}${
    area('seats', seatsHtml(v))}${
    area('bar', barHtml(v))}</div>`;
}

/** Centre du tapis : le panneau du moment (assurance, résumé) et le statut. */
export function centerHtml(v) {
  const panel = panelHtml(v);
  return `${panel ? `<div class="bj-overpanel">${panel}</div>` : ''}<div class="bj-status">${v.T.Status(statusFor(v))}</div>`;
}

/** Barre du bas : les jetons à miser à gauche, les actions à droite. */
export function barHtml(v) {
  const tray = chipTrayHtml(v);
  const actions = actionsHtml(v);
  return tray || actions ? `<div class="bj-bar">${tray}${actions}</div>` : '';
}

function trayHtml(v) {
  const { s } = v;
  return `<div class="bj-round" data-zone="round"><span class="label">Donne</span><b class="stat tp-num">${s.roundNumber}/${s.totalRounds}</b></div>`;
}

/** Défausse, à la droite de la banque (à gauche pour les joueurs). */
function discardHtml(v) {
  const { T, s } = v;
  return `<div class="bj-discard">${T.Pile({ pile: 'defausse', label: 'Défausse', count: s.discardCount, size: 'sm', faceDown: true, empty: 'Vide' })}</div>`;
}

function shoeHtml(v) {
  const { T, s } = v;
  const hint = s.shoe.cutReached ? 'Carte de coupe sortie : mélange à la prochaine donne' : `${s.shoe.decks} jeux`;
  const pile = T.Pile({ pile: 'pioche', label: 'Sabot', count: s.shoe.remaining, size: 'sm', icon: 'deck', hint });
  return `<div class="bj-shoe"${s.shoe.cutReached ? ' data-cut' : ''}>${pile}</div>`;
}

/** Le tapis imprimé : arcs dorés comme sur une vraie table (décor, les règles sont dans « Règles »). */
function feltHtml() {
  // le bas du dessin reste libre : le statut s'y pose
  return '<svg class="bj-felt" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">'
    + '<defs><path id="bj-arc-a" d="M 150 40 Q 500 172 850 40"/><path id="bj-arc-b" d="M 205 84 Q 500 212 795 84"/>'
    + '<path id="bj-arc-c" d="M 112 124 Q 500 314 888 124"/></defs>'
    + '<path class="bj-felt__band" d="M 96 104 Q 500 290 904 104"/><path class="bj-felt__band" d="M 128 138 Q 500 326 872 138"/>'
    + '<text class="bj-felt__big"><textPath href="#bj-arc-a" startOffset="50%" text-anchor="middle">Blackjack payé 3 pour 2</textPath></text>'
    + '<text class="bj-felt__small"><textPath href="#bj-arc-b" startOffset="50%" text-anchor="middle">La banque tire à 16 et reste sur tous les 17</textPath></text>'
    + '<text class="bj-felt__band-t"><textPath href="#bj-arc-c" startOffset="50%" text-anchor="middle">Assurance payée 2 pour 1</textPath></text>'
    + '</svg>';
}

// ---------------------------------------------------------------- la banque

function dealerHtml(v) {
  const { T, s, ui } = v;
  const d = s.dealer;
  let cards;
  if (!d.cards.length) {
    cards = T.Slot({ size: 'md' }) + T.Slot({ size: 'md' });
  } else {
    cards = d.cards.map((c, i) => {
      if (c.hidden) return T.Back({ size: 'md', label: 'Carte cachée de la banque', attrs: { 'data-hole': '' } });
      const down = i === 1 && ui.holeDown;
      return T.Card(tp(c, { size: 'md', faceDown: down, attrs: i === 1 ? { 'data-hole': '' } : undefined }));
    }).join('');
  }
  const tone = d.bust ? 'bust' : d.blackjack ? 'bj' : d.revealed && d.total === 21 ? 'top' : '';
  const value = d.cards.length
    ? `<span class="bj-value" data-zone="dealer-value"${tone ? ` data-tone="${tone}"` : ''}>${T.esc(d.blackjack && !ui.holeDown ? 'Blackjack' : d.text)}</span>`
    : '';
  const note = d.bust ? 'Sautée' : '';
  return `<div class="bj-dealer" data-zone="dealer">${rackHtml()}<div class="bj-dealer__id"><span class="bj-dealer__name label">La banque</span>${value}${
    note ? `<span class="bj-dealer__note caption">${note}</span>` : ''}</div><div class="bj-cards bj-cards--dealer">${cards}</div></div>`;
}

/** Le râtelier de jetons de la banque (décor ; cible des mises perdues, source des gains). */
function rackHtml() {
  const cols = [500, 100, 100, 25, 25, 10, 10, 5].map((d) => `<i class="bj-rack__c" data-v="${d}"></i>`).join('');
  return `<div class="bj-rack" data-zone="rack" aria-hidden="true">${cols}</div>`;
}

// ---------------------------------------------------------------- places des joueurs

function seatsHtml(v) {
  const { s } = v;
  const n = s.players.length;
  const half = (n - 1) / 2 || 1;
  return `<div class="bj-seats" data-n="${n}">${s.players.map((p, i) => {
    const t = (i - (n - 1) / 2) / half;
    return seatHtml(v, p, (t * t).toFixed(3));
  }).join('')}</div>`;
}

function seatHtml(v, p, lift) {
  const { s, me, ui } = v;
  const mine = p.id === me;
  let cols;
  if (p.hands.length) cols = p.hands.map((h, i) => handHtml(v, p, h, i)).join('');
  else {
    const pending = mine && s.phase === 'betting' && p.state === 'deciding' ? ui.pending : 0;
    const amount = p.state === 'bet' ? p.bet : pending;
    cols = `<div class="bj-hand bj-hand--empty" data-hand="0"><div class="bj-hand__info"></div><div class="bj-cards"></div>${spotHtml(v, amount, { pending: !!pending, label: { sitout: 'Passe', out: '' }[p.state] ?? 'Mise' })}</div>`;
  }
  // l'assurance reste posée jusqu'à la vérification de la banque
  const ins = p.insurance?.status === 'taken' && p.insurance.amount && !ENDED.includes(s.phase)
    ? `<span class="bj-ins" data-zone="insurance" title="Assurance">${v.T.icon('shield')}${stackHtml(p.insurance.amount, { small: true })}</span>` : '';
  return `<div class="bj-seat" data-seat="${v.T.esc(p.id)}" data-pstate="${p.state}"${mine ? ' data-me=""' : ''} style="--lift:${lift}">`
    + `<div class="bj-hands" data-hands="${Math.max(1, p.hands.length)}">${cols}${ins}</div>${plateHtml(v, p)}</div>`;
}

function handHtml(v, p, h, i) {
  const { T, s } = v;
  const active = s.turn?.playerId === p.id && s.turn.hand === i;
  const cards = h.cards.map((c) => T.Card(tp(c, { size: 'md' }))).join('');
  const tone = h.bust ? 'bust' : h.blackjack ? 'bj' : h.total === 21 ? 'top' : '';
  const text = h.blackjack ? 'Blackjack' : h.text;
  const value = h.cards.length ? `<span class="bj-value"${tone ? ` data-tone="${tone}"` : ''}>${T.esc(text)}</span>` : '';
  const tag = p.hands.length > 1 ? `<span class="bj-hand__n caption">Main ${i + 1}</span>` : '';
  const ended = ENDED.includes(s.phase);
  const spot = ended && h.result ? resultSpot(v, h, p.hands.length > 1) : spotHtml(v, h.bet, { doubled: h.doubled });
  return `<div class="bj-hand" data-hand="${i}"${active ? ' data-active=""' : ''}${h.result ? ` data-result="${h.result}"` : ''}>`
    + `<div class="bj-hand__info">${tag}${value}</div><div class="bj-cards" data-count="${h.cards.length}">${cards}</div>${spot}</div>`;
}

/** La case de mise (cercle doré) et sa pile de jetons. */
function spotHtml(v, amount, { pending = false, doubled = false, label = 'Mise' } = {}) {
  return `<div class="bj-spot"${pending ? ' data-pending=""' : ''}${amount ? '' : ' data-empty=""'}>${
    amount ? stackHtml(amount, { doubled }) : `<span class="bj-spot__l label">${label}</span>`}</div>`;
}

const RESULT = {
  blackjack: { text: (h) => `Blackjack ${signed(h.net)}`, tone: 'accent', icon: 'crown' },
  win: { text: (h) => `Gagné ${signed(h.net)}`, tone: 'positive', icon: 'check' },
  push: { text: () => 'Égalité', tone: 'muted', icon: 'pass' },
  lose: { text: (h) => `Perdu ${signed(h.net)}`, tone: 'danger', icon: 'cross' },
  bust: { text: (h) => `Sauté ${signed(h.net)}`, tone: 'danger', icon: 'cross' },
};

function resultSpot(v, h, compact) {
  const r = RESULT[h.result];
  // plusieurs mains côte à côte : l'icône et le montant suffisent (le mot est dans le titre)
  const badge = compact
    ? `<span class="bj-net" data-tone="${r.tone}" title="${v.T.esc(r.text(h))}">${v.T.icon(r.icon)}<span>${h.net ? signed(h.net) : '±0'}</span><span class="tp-vh">${v.T.esc(r.text(h))}</span></span>`
    : v.T.Badge({ label: r.text(h), tone: r.tone, icon: r.icon });
  return `<div class="bj-spot bj-spot--result" data-result="${h.result}"><span class="bj-result">${badge}</span></div>`;
}

const DOUBLE_ICON = '<svg class="tp-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#tp-i-double"></use></svg>';

/** Pile de jetons (les plus gros en bas) et son montant. */
export function stackHtml(amount, { doubled = false, small = false, label = true } = {}) {
  const chips = chipList(amount, small ? 4 : 7);
  return `<span class="bj-stack${small ? ' bj-stack--sm' : ''}" data-amount="${amount}"><span class="bj-stack__chips" style="--n:${chips.length}">${
    chips.map((d, i) => `<i class="bj-chip" data-v="${d}" style="--i:${i}"></i>`).join('')}</span>${
    label ? `<b class="bj-stack__n tp-num">${fmt(amount)}${doubled ? `<span class="bj-stack__x" title="Mise doublée">${DOUBLE_ICON}</span>` : ''}</b>` : ''}</span>`;
}

function plateHtml(v, p) {
  const { T, s, me } = v;
  const mine = p.id === me;
  const turn = s.phase === 'playing' && s.turn?.playerId === p.id;
  const waiting = (s.phase === 'betting' && p.state === 'deciding') || (s.phase === 'insurance' && p.insurance?.status === 'pending');
  const state = v.offline(p.id) ? 'offline' : turn || waiting ? 'active' : 'waiting';
  let html = T.Seat({
    seat: p.id, name: v.nameOf(p.id), avatar: v.avatarOf(p.id), state, me: mine, compact: true,
    meta: metaText(v, p), badges: badges(v, p),
  });
  if (state === 'active' && !turn) {
    // pendant les mises (et l'assurance), tout le monde décide en même temps : « Mise… » plutôt que « Joue… »
    const word = s.phase === 'betting' ? (mine ? 'À toi de miser' : 'Mise…') : (mine ? 'Assurance ?' : 'Décide…');
    html = html.replace(/(<span class="tp-seat__turn">[\s\S]*?<\/svg>)[^<]*/, `$1${T.esc(word)}`);
  }
  const bank = `<span class="bj-bank" title="Jetons"><i class="bj-chip bj-chip--mini" data-v="${bankChip(p.chips)}"></i><b class="bj-bank__n stat tp-num" data-bank="${p.chips}">${fmt(p.chips)}</b></span>`;
  return html.replace(/<\/section>\s*$/, `${bank}</section>`);
}

const bankChip = (n) => (n >= 500 ? 500 : n >= 100 ? 100 : n >= 25 ? 25 : 10);

function metaText(v, p) {
  const { s } = v;
  if (p.state === 'out') return 'Plus de jetons';
  if (s.phase === 'betting') {
    if (p.state === 'bet') return `Mise ${fmt(p.bet)}`;
    if (p.state === 'sitout') return 'Passe cette donne';
    return '';
  }
  if (p.state === 'sitout') return 'Passe cette donne';
  if (s.phase === 'roundEnd') return p.ready ? 'Prêt' : '';
  if (s.phase === 'insurance' && p.insurance) {
    return { taken: `Assuré ${fmt(p.insurance.amount)}`, declined: 'Sans assurance' }[p.insurance.status] ?? '';
  }
  return '';
}

function badges(v, p) {
  const { s } = v;
  return [
    p.state === 'out' && { label: 'Ruiné', icon: 'skull', tone: 'danger' },
    s.phase === 'roundEnd' && p.ready && { label: 'Prêt', icon: 'check', tone: 'positive' },
  ].filter(Boolean);
}

// ---------------------------------------------------------------- panneaux sur le tapis

export function panelHtml(v) {
  const { T, s, my } = v;
  if (s.phase === 'insurance') {
    const pend = s.players.filter((p) => p.insurance?.status === 'pending');
    const mine = my?.insurance;
    const bj = v.meP?.hands[0]?.blackjack;
    let text;
    if (mine && bj) text = `Avec ton blackjack, t’assurer (${fmt(mine.max)}) te garantit au moins ${fmt(mine.max * 2)} jetons de gain, quoi qu’ait la banque.`;
    else if (mine) text = `Payée 2 pour 1 si elle a un blackjack. Jusqu’à ${fmt(mine.max)} jetons, la moitié de ta mise.`;
    else text = `Payée 2 pour 1 si elle a un blackjack.${pend.length ? ` En attente ${deList(v, pend.map((p) => p.id))}.` : ''}`;
    return `<section class="tp-panel bj-panel" data-zone="insurance-panel" aria-labelledby="bj-ins-h"><header class="tp-panel__h"><h2 class="title-md" id="bj-ins-h">${T.icon('shield')}Assurance</h2><span class="caption">La banque montre un As</span></header><p class="body bj-panel__t">${T.esc(text)}</p></section>`;
  }
  if (ENDED.includes(s.phase) && s.summary && v.ui.view !== 'end') return summaryHtml(v);
  return '';
}

/** Résumé de la donne, posé sur le tapis (la table reste visible) : la banque, puis le gain de chacun. */
export function summaryHtml(v) {
  const { T, s, me } = v;
  const m = s.summary;
  const d = m.dealer;
  const dealer = dealerLine(m);
  const rows = m.players.filter((p) => p.played).map((p) => {
    const net = p.net;
    const parts = [];
    if (p.hands.length > 1) parts.push(`${p.hands.length} mains`);
    if (p.insurance) parts.push(p.insurance.status === 'won' ? `assurance +${fmt(p.insurance.amount * 2)}` : `assurance −${fmt(p.insurance.amount)}`);
    if (p.hands.some((h) => h.result === 'blackjack')) parts.unshift('blackjack');
    return `<li data-sign="${net > 0 ? '+' : net < 0 ? '-' : '0'}"${p.playerId === me ? ' data-me=""' : ''}>${T.Avatar({ name: v.nameOf(p.playerId), src: v.avatarOf(p.playerId), size: 'sm' })}<span class="bj-sum__n body">${T.esc(v.label(p.playerId))}${
      parts.length ? `<span class="caption"> · ${T.esc(parts.join(', '))}</span>` : ''}</span><b class="bj-sum__v stat tp-num">${net ? signed(net) : '±0'}</b></li>`;
  }).join('');
  // ceux qui ont passé (pas les ruinés, qui n'avaient plus le choix)
  const sat = d ? m.players.filter((p) => !p.played && p.state !== 'out').map((p) => p.playerId) : [];
  const kicker = m.isLast ? 'Dernière donne' : `Donne ${m.roundNumber}/${s.totalRounds}`;
  const caption = sat.length ? `${dealer} · ${listNames(v, sat).replace(/^toi$/, 'tu')} ${sat.length > 1 ? 'passaient' : sat[0] === me ? 'passais' : 'passait'}` : dealer;
  if (!rows) return `<section class="tp-panel bj-panel bj-summary" data-zone="summary" aria-labelledby="bj-sum-h"><header class="tp-panel__h"><h2 class="title-md" id="bj-sum-h">${T.esc(kicker)}</h2><span class="caption">${T.esc(caption)}</span></header></section>`;
  return `<section class="tp-panel bj-panel bj-summary" data-zone="summary" aria-labelledby="bj-sum-h"><header class="tp-panel__h"><h2 class="title-md" id="bj-sum-h">${T.esc(kicker)}</h2><span class="caption">${T.esc(caption)}</span></header>`
    + `<ul class="bj-sum">${rows}</ul></section>`;
}

/** Ce qu'a fait la banque (ou « Tout le monde passe » pour une donne sans cartes). */
function dealerLine(m) {
  const d = m?.dealer;
  if (!d) return 'Tout le monde passe';
  return d.blackjack ? 'La banque a un blackjack' : d.bust ? `La banque saute avec ${d.total}` : `La banque fait ${d.total}`;
}

const listNames = (v, ids) => {
  const names = ids.map((id) => (id === v.me ? 'toi' : v.nameOf(id)));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0] ?? '';
};

// ---------------------------------------------------------------- statut, jetons à miser, actions

export function statusFor(v) {
  const { s, my, meP, ui } = v;
  const round = `Donne ${s.roundNumber}/${s.totalRounds}`;
  if (ui.dealerTurn) return { tone: 'info', text: 'La banque joue…', detail: 'Elle tire jusqu’à 16 et reste sur 17' };
  switch (s.phase) {
    case 'betting': {
      if (my?.bet) return { tone: 'turn', text: 'Faites vos jeux', detail: `Mise de ${fmt(my.minBet)} à ${fmt(my.maxBet)} · ${round}` };
      if (meP?.state === 'out') return { tone: 'info', text: 'Tu n’as plus de jetons', detail: 'Tu regardes la partie' };
      const wait = s.players.filter((p) => p.state === 'deciding');
      return { tone: 'wait', text: wait.length ? `En attente ${deList(v, wait.map((p) => p.id))}…` : 'Distribution…', detail: round };
    }
    case 'insurance': {
      if (my?.insurance) return { tone: 'turn', text: 'Assurance ?', detail: `La banque montre un As · jusqu’à ${fmt(my.insurance.max)}` };
      return { tone: 'wait', text: 'Les joueurs décident de l’assurance…', detail: 'La banque montre un As' };
    }
    case 'playing': {
      const cur = s.players.find((p) => p.id === s.currentPlayerId);
      const h = cur?.hands[s.turn?.hand ?? 0];
      const which = cur && cur.hands.length > 1 ? `Main ${s.turn.hand + 1}/${cur.hands.length} · ` : '';
      const vs = `contre ${s.dealer.text} pour la banque`;
      if (s.isMyTurn) return { tone: 'turn', text: 'À toi de jouer', detail: `${which}${h?.text ?? ''} ${vs}` };
      if (cur && v.offline(cur.id)) return { tone: 'alert', text: `Connexion perdue avec ${v.nameOf(cur.id)}`, detail: 'La partie reprend à son retour' };
      return { tone: 'wait', text: `${v.nameOf(cur?.id)} joue…`, detail: `${which}${h?.text ?? ''} ${vs}` };
    }
    case 'roundEnd':
    case 'gameOver': {
      const mine = s.summary?.players.find((p) => p.playerId === v.me);
      const dealer = s.summary ? dealerLine(s.summary) : round;
      if (s.phase === 'gameOver' && v.ui.view === 'end') return { tone: 'win', text: 'Partie terminée', detail: winnerText(v) };
      if (!mine || !mine.played) return { tone: 'info', text: meP?.state === 'out' ? 'Tu n’as plus de jetons' : 'Tu passais cette donne', detail: dealer };
      const net = mine.net;
      if (net > 0) return { tone: 'win', text: `Tu gagnes ${fmt(net)}`, detail: dealer };
      if (net < 0) return { tone: 'alert', text: `Tu perds ${fmt(-net)}`, detail: dealer };
      return { tone: 'info', text: mine.hands.every((h) => h.result === 'push') ? 'Égalité : mise rendue' : 'Ni gain ni perte', detail: dealer };
    }
    default:
      return { tone: 'info', text: round };
  }
}

export function chipTrayHtml(v) {
  const { T, s, my, ui, meP } = v;
  if (s.phase !== 'betting' || !my?.bet) return '';
  const left = my.maxBet - ui.pending;
  const chips = CHIP_BUTTONS.map((d) => {
    const off = left <= 0;
    return `<button type="button" class="bj-chip bj-chip--btn" data-v="${d}" data-chip="${d}" aria-label="Ajouter ${fmt(d)} à ta mise"${
      off ? ' aria-disabled="true" title="Tu as tout misé"' : ` title="Ajouter ${fmt(d)}"`}><span class="bj-chip__v">${fmt(d)}</span></button>`;
  }).join('');
  const again = meP.lastBet && !ui.pending && meP.lastBet <= my.maxBet && meP.lastBet >= my.minBet
    ? T.Button({ variant: 'ghost', icon: 'renew', label: `Même mise · ${fmt(meP.lastBet)}`, className: 'bj-tray__b', attrs: { 'data-act': 'rebet' } }) : '';
  const clear = ui.pending
    ? T.Button({ variant: 'ghost', icon: 'cross', label: 'Effacer', className: 'bj-tray__b', attrs: { 'data-act': 'clear' } }) : '';
  return `<div class="bj-tray" role="group" aria-label="Jetons à miser"><div class="bj-tray__chips">${chips}</div>${clear}${again}</div>`;
}

export function actionsHtml(v) {
  const { T, s, my, meP, ui } = v;
  if (!my || !meP || ui.dealerTurn) return '';
  const bar = (o) => T.ActionBar(o);
  switch (s.phase) {
    case 'betting': {
      if (my.bet) {
        const amount = ui.pending;
        const ok = amount >= my.minBet && amount <= my.maxBet;
        const reason = !amount ? 'Choisis tes jetons' : amount < my.minBet ? `Mise minimale : ${fmt(my.minBet)}` : null;
        return bar({
          secondary: [{ label: 'Je passe', icon: 'pass', attrs: { 'data-act': 'sitout' } }],
          primary: { label: amount ? `Miser · ${fmt(amount)}` : 'Miser', icon: 'check', disabled: !ok, reason, attrs: { 'data-act': 'bet' } },
        });
      }
      if (my.change) {
        return bar({
          secondary: [{ label: meP.state === 'sitout' ? 'Finalement, je joue' : 'Changer ma mise', icon: 'renew', attrs: { 'data-act': 'unbet' } }],
          primary: { label: meP.state === 'sitout' ? 'Je passe' : `Mise · ${fmt(meP.bet)}`, icon: 'check', disabled: true, reason: 'En attente des autres joueurs' },
        });
      }
      return '';
    }
    case 'insurance':
      if (!my.insurance) return '';
      return bar({
        secondary: [{ label: 'Non merci', icon: 'cross', attrs: { 'data-act': 'no-insurance' } }],
        primary: { label: `Assurer · ${fmt(my.insurance.max)}`, icon: 'shield', attrs: { 'data-act': 'insurance' } },
      });
    case 'playing': {
      if (s.isMyTurn) {
        const h = meP.hands[s.turn.hand];
        const btn = (key, label, icon, extra = {}) => ({
          label, icon, disabled: !my[key]?.ok, reason: my[key]?.ok ? null : my[key]?.reason?.replace(/\.$/, ''), attrs: { 'data-act': key }, ...extra,
        });
        return bar({
          secondary: [
            btn('split', 'Séparer', 'pair'),
            btn('double', `Doubler · ${fmt(h.bet)}`, 'double'),
            btn('stand', `Rester · ${h.total}`, 'pass', { kbd: 'R' }),
          ],
          primary: btn('hit', 'Tirer', 'draw', { kbd: 'T' }),
        });
      }
      if (meP.hands.some((h) => !h.done)) {
        return bar({ primary: { label: 'Tirer', icon: 'draw', disabled: true, reason: `C’est au tour ${deList(v, [s.currentPlayerId])}` } });
      }
      return '';
    }
    case 'roundEnd': {
      if (meP.state === 'out') return '';
      const need = s.players.filter((p) => p.state !== 'out');
      const ready = need.filter((p) => p.ready).length;
      if (my.next) return bar({ primary: { label: 'Donne suivante', icon: 'arrow', count: need.length > 1 ? `${ready}/${need.length}` : undefined, attrs: { 'data-act': 'next' } } });
      const wait = need.filter((p) => !p.ready).map((p) => p.id);
      return bar({ primary: { label: 'Donne suivante', icon: 'arrow', disabled: true, count: `${ready}/${need.length}`, reason: `En attente ${deList(v, wait)}` } });
    }
    case 'gameOver':
      if (ui.view === 'end') return '';
      return bar({
        secondary: [{ label: 'Feuille de scores', icon: 'scores', attrs: { 'data-open': 'scores' } }],
        primary: { label: 'Classement', icon: 'trophy', attrs: { 'data-act': 'ranking' } },
      });
    default:
      return '';
  }
}

/** « de Léa et Malo » / « d’Inès ». */
function deList(v, ids) {
  const names = listNames(v, ids);
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(names) ? `d’${names}` : `de ${names}`;
}

// ================================================================ fin de partie, tiroirs

function winnerText(v) {
  const { s, me } = v;
  if (s.players.length === 1) {
    const p = s.players[0];
    return `${p.id === me ? 'Tu termines' : `${v.nameOf(p.id)} termine`} avec ${fmt(p.chips)} jetons (départ ${fmt(s.startChips)})`;
  }
  const best = Math.max(...s.players.map((p) => p.chips));
  const winners = s.players.filter((p) => p.chips === best);
  if (winners.length > 1) {
    const names = winners.map((p) => (p.id === me ? 'toi' : v.nameOf(p.id)));
    return `Égalité entre ${names.slice(0, -1).join(', ')} et ${names.at(-1)} avec ${fmt(best)} jetons`;
  }
  return winners[0].id === me ? `Tu termines en tête avec ${fmt(best)} jetons` : `${v.nameOf(winners[0].id)} termine en tête avec ${fmt(best)} jetons`;
}

export function endScreen(v) {
  const { T, s, me } = v;
  const ranking = [...s.players].sort((a, b) => b.chips - a.chips);
  const places = ranking.map((p) => 1 + ranking.filter((o) => o.chips > p.chips).length);
  const played = s.history.filter((h) => !h.skipped).length;
  const note = v.isHost ? 'Utilise « Retour au salon » en haut pour relancer une partie.' : 'En attente de l’hôte pour revenir au salon.';
  const solo = s.players.length === 1;
  const mine = s.players.find((p) => p.id === me);
  const title = solo ? (mine.chips > s.startChips ? 'Tu bats la banque' : mine.chips < s.startChips ? 'La banque gagne' : 'Match nul') : 'Fin de partie';
  let i = 0;
  const html = T.EndScreen({
    result: solo && mine.chips < s.startChips ? 'defaite' : 'fin',
    title,
    subtitle: `${played} donne${played > 1 ? 's' : ''} jouée${played > 1 ? 's' : ''}. ${winnerText(v)}.`,
    recap: [['Départ', fmt(s.startChips)], ['Donnes', `${s.roundNumber}/${s.totalRounds}`]],
    ranking: ranking.map((p) => ({
      name: v.nameOf(p.id), avatar: v.avatarOf(p.id), me: p.id === me, score: fmt(p.chips),
      note: p.chips === s.startChips ? '±0' : signed(p.chips - s.startChips),
    })),
    actions: `${T.Button({ variant: 'secondary', icon: 'scores', label: 'Feuille de scores', attrs: { 'data-open': 'scores' } })}${
      T.Button({ variant: 'ghost', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'close-end' } })}<p class="caption bj-end-note">${T.esc(note)}</p>`,
  });
  // place partagée par les ex aequo (1, 1, 3…)
  return html.replace(/<li class="tp-rank__r"([^>]*)><span class="tp-rank__pos stat">\d+<\/span>/g, (m0, rest) => {
    const place = places[i++];
    const first = place === 1 && !rest.includes('data-first') ? `${rest} data-first=""` : rest;
    return `<li class="tp-rank__r"${first}><span class="tp-rank__pos stat">${place}</span>`;
  });
}

/** Feuille de scores : gain net de chaque donne, puis les jetons de chacun. */
export function scoresHtml(v) {
  const { T, s, me } = v;
  const order = [me, ...s.players.map((p) => p.id).filter((id) => id !== me)].filter((id) => s.players.some((p) => p.id === id));
  const head = order.map((id) => `<th scope="col"${id === me ? ' data-me="true"' : ''}>${T.esc(v.nameOf(id))}</th>`).join('');
  const rows = s.history.map((h) => {
    const d = h.dealer;
    const bank = h.skipped ? 'Tout le monde passe' : d.blackjack ? 'Blackjack' : d.bust ? `${d.total}, sautée` : String(d.total);
    return `<tr><th scope="row" class="tp-num">${h.roundNumber}</th><td>${T.esc(bank)}</td>${order.map((id) => {
      const g = h.changes[id];
      return `<td class="tp-num" data-me="${id === me}" data-sign="${g > 0 ? '+' : g < 0 ? '-' : '0'}">${g === undefined ? '<span class="caption">—</span>' : g ? signed(g) : '±0'}</td>`;
    }).join('')}</tr>`;
  }).join('');
  const foot = order.map((id) => {
    const p = s.players.find((x) => x.id === id);
    return `<td class="tp-num stat" data-me="${id === me}">${fmt(p.chips)}</td>`;
  }).join('');
  const table = `<table class="tp-ss bj-ss"><caption class="tp-vh">Feuille de scores</caption><thead><tr><th scope="col">Donne</th><th scope="col">Banque</th>${head}</tr></thead><tbody>${rows}</tbody>`
    + `<tfoot><tr><th scope="row" colspan="2">Jetons</th>${foot}</tr></tfoot></table>`;
  return s.history.length ? table : `${table}<p class="caption bj-empty">Aucune donne terminée pour l’instant.</p>`;
}

export function journalHtml(v) {
  const { T, s } = v;
  if (!s.log.length) return '<p class="caption">Rien pour l’instant.</p>';
  return T.Log({
    entries: [...s.log].reverse().map((e) => ({ text: richLog(e.text), tone: logTone(e.text) })),
  });
}

const logTone = (t) => (/La banque saute|blackjack !|gagne|payé/.test(t) && !/perd/.test(t) ? 'good'
  : /perd|saute|sauté|plus de jetons/.test(t) ? 'alert' : undefined);
