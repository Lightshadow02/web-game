'use strict';

const {
  SUITS, RANKS, DIX_DE_DER, TOTAL, CAPOT, SUIT_NAME, RANK_NAME,
  buildDeck, cardPoints, sumPoints, power, shuffle, describe,
} = require('./cards');

const LOG_SIZE = 50;
const EVENT_SIZE = 60;
const TEAM_NAMES = ['Équipe A', 'Équipe B'];

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true;
  }
}

// ================================================================ règles du jeu de la carte

/** Le pli en cours (non vide) : qui le remporte pour l'instant. */
function trickWinner(trick, trump) {
  const lead = trick[0].card.suit;
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const a = t.card;
    const b = best.card;
    const wins = a.suit === b.suit ? power(a, trump) > power(b, trump) : a.suit === trump || (a.suit === lead && b.suit !== trump);
    if (wins) best = t;
  }
  return best;
}

/**
 * Cartes jouables (règles de la FFB) :
 *  - fournir à la couleur demandée ;
 *  - à l'atout demandé : monter si possible (même sur son partenaire), sinon atout quelconque ;
 *  - sans la couleur : couper, sauf si son partenaire est maître du pli (alors carte libre) ;
 *    si un atout est déjà posé, surcouper si possible ; sinon se défausser, et sous-couper
 *    seulement si l'on n'a plus que de l'atout.
 */
function legalCards(hand, trick, trump, partnerId) {
  if (!trick.length) return hand;
  const lead = trick[0].card.suit;
  const trumps = hand.filter((c) => c.suit === trump);
  const top = Math.max(-1, ...trick.filter((t) => t.card.suit === trump).map((t) => power(t.card, trump)));
  const over = trumps.filter((c) => power(c, trump) > top);
  if (lead === trump) {
    if (!trumps.length) return hand;
    return over.length ? over : trumps;
  }
  const follow = hand.filter((c) => c.suit === lead);
  if (follow.length) return follow;
  if (partnerId && trickWinner(trick, trump).playerId === partnerId) return hand;
  if (!trumps.length) return hand;
  if (over.length) return over;
  const others = hand.filter((c) => c.suit !== trump);
  return others.length ? others : trumps;
}

// ================================================================ annonces

const SEQ_NAME = (len) => (len >= 5 ? 'Cent' : len === 4 ? 'Cinquante' : 'Tierce');
const SEQ_POINTS = (len) => (len >= 5 ? 100 : len === 4 ? 50 : 20);
const CARRE_POINTS = { V: 200, 9: 150, A: 100, 10: 100, R: 100, D: 100 };
const CARRE_LABEL = { V: 'Carré de Valets', 9: 'Carré de 9', A: 'Carré d’As', 10: 'Carré de 10', R: 'Carré de Rois', D: 'Carré de Dames' };
/** Entre carrés de 100 : As, puis 10, Roi, Dame. */
const CARRE_STRENGTH = { D: 1, R: 2, 10: 3, A: 4, 9: 5, V: 6 };
const HEIGHT = { 9: 'au 9', 10: 'au 10', V: 'au Valet', D: 'à la Dame', R: 'au Roi', A: 'à l’As' };

/** Annonces possibles d'une main de 8 cartes : carrés (Valets, 9, As, 10, Rois, Dames) et séquences de 3 cartes ou plus. */
function findAnnounces(hand) {
  const list = [];
  for (const rank of ['V', '9', 'A', '10', 'R', 'D']) {
    const cards = SUITS.map((s) => hand.find((c) => c.suit === s && c.rank === rank)).filter(Boolean);
    if (cards.length === 4) {
      list.push({ key: `carre-${rank}`, type: 'carre', rank, points: CARRE_POINTS[rank], cards: cards.map((c) => c.id), label: CARRE_LABEL[rank], kind: CARRE_LABEL[rank] });
    }
  }
  for (const suit of SUITS) {
    const idx = hand.filter((c) => c.suit === suit).map((c) => RANKS.indexOf(c.rank)).sort((a, b) => a - b);
    let start = 0;
    for (let i = 1; i <= idx.length; i++) {
      if (i < idx.length && idx[i] === idx[i - 1] + 1) continue;
      const len = i - start;
      if (len >= 3) {
        const top = RANKS[idx[i - 1]];
        list.push({
          key: `seq-${suit}-${top}`, type: 'sequence', suit, rank: top, length: len, points: SEQ_POINTS(len),
          cards: idx.slice(start, i).map((k) => `${RANKS[k]}${suit}`),
          label: `${SEQ_NAME(len)} ${HEIGHT[top]} de ${SUIT_NAME[suit]}`, kind: SEQ_NAME(len),
        });
      }
      start = i;
    }
  }
  return list;
}

/** Clé de comparaison d'une annonce : valeur, carré avant séquence, hauteur, séquence à l'atout, premier à parler. */
function announceKey(a, trump, order) {
  return [
    a.points,
    a.type === 'carre' ? 1 : 0,
    a.type === 'carre' ? CARRE_STRENGTH[a.rank] : RANKS.indexOf(a.rank),
    a.type === 'sequence' && a.suit === trump ? 1 : 0,
    -order,
  ];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// ================================================================ partie

/**
 * Belote classique (pas la coinche), 4 joueurs en 2 équipes : sièges 1 et 3 contre 2 et 4.
 *
 * Phases d'une donne : bidding (2 tours d'enchères) -> playing (8 plis) -> dealEnd, jusqu'à gameOver.
 * Le paquet n'est battu qu'au début de la partie : ensuite on ramasse les plis et on coupe, comme à la table.
 * Options : target (501 / 1001 / 1501 points), announces (true : tierce, cinquante, cent, carrés).
 */
class Belote {
  constructor({ players, rng = Math.random, target = 1001, announces = true }) {
    if (players.length !== 4) throw new GameError('La Belote se joue à 4 joueurs exactement.');
    this.rng = rng;
    this.target = target;
    this.announcesOn = announces;
    this.players = players.map((p, i) => ({ id: p.id, name: p.name, team: i % 2, hand: [] }));
    this.scores = [0, 0];
    this.dealNumber = 1;
    this.dealerIndex = 3; // le joueur 1 parle et entame en premier
    this.pending = 0; // points en litige, gagnés par l'équipe qui remporte la donne suivante
    this.history = [];
    this.summary = null;
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.deck = shuffle(buildDeck(), rng); // battu une seule fois
    this.startDeal();
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload = {}) {
    if (this.isOver()) throw new GameError('La partie est terminée.');
    switch (type) {
      case 'take':
        return this.take(playerId, payload?.suit);
      case 'pass':
        return this.pass(playerId);
      case 'announce':
        return this.announce(playerId, payload?.keys);
      case 'play':
        return this.play(playerId, payload?.cardId);
      case 'next':
        return this.nextDeal();
      default:
        throw new GameError(`Action inconnue : ${type}`);
    }
  }

  isOver() {
    return this.phase === 'gameOver';
  }

  teamLabel(t) {
    const names = this.players.filter((p) => p.team === t).map((p) => p.name);
    return `${TEAM_NAMES[t]} (${names.join(' & ')})`;
  }

  getResult() {
    if (!this.isOver()) return null;
    const w = this.scores[0] > this.scores[1] ? 0 : 1;
    return {
      summary: `${this.teamLabel(w)} gagne ${this.scores[w]} à ${this.scores[1 - w]}`,
      players: this.players.map((p) => ({ playerId: p.id, result: p.team === w ? 'win' : 'loss', score: this.scores[p.team] })),
    };
  }

  getStateFor(playerId) {
    const me = this.player(playerId);
    const current = this.players[this.currentIndex];
    const active = this.phase === 'bidding' || this.phase === 'playing';
    const isMyTurn = active && current?.id === playerId;
    const firstTrick = this.phase === 'playing' && this.trickNumber === 1;
    const playedFirst = firstTrick && this.trick.some((t) => t.playerId === playerId);
    const declared = this.declared.find((d) => d.playerId === playerId);
    const mayAnnounce = Boolean(me && this.announcesOn && firstTrick && !playedFirst && !declared);
    const myAnnounces = mayAnnounce ? findAnnounces(me.hand) : [];
    return {
      phase: this.phase,
      dealNumber: this.dealNumber,
      target: this.target,
      announcesOn: this.announcesOn,
      dealerId: this.players[this.dealerIndex].id,
      cutterId: this.players[(this.dealerIndex + 3) % 4].id,
      currentPlayerId: active ? current?.id ?? null : null,
      isMyTurn,
      myTeam: me ? me.team : null,
      partnerId: me ? this.players.find((p) => p.team === me.team && p.id !== playerId)?.id ?? null : null,
      teams: [0, 1].map((t) => ({
        id: t, name: TEAM_NAMES[t], score: this.scores[t], playerIds: this.players.filter((p) => p.team === t).map((p) => p.id),
      })),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        cardCount: p.hand.length,
        tricks: this.tricksWon[p.id] ?? 0,
        isTaker: p.id === this.takerId,
        // annonces dites pendant le premier pli : le genre seulement (« Tierce »), les cartes au deuxième pli
        announced: (this.declared.find((d) => d.playerId === p.id)?.announces ?? []).map((a) => a.kind),
      })),
      myHand: me ? this.sortHand(me.hand) : [],
      // ---- enchères
      bidRound: this.bidRound,
      bids: this.bids,
      turned: this.turned,
      turnedTaken: Boolean(this.takerId),
      trump: this.trump,
      takerId: this.takerId,
      // ---- jeu de la carte
      trick: this.trick,
      trickNumber: this.trickNumber,
      lastTrick: this.lastTrick,
      legalCardIds: isMyTurn && this.phase === 'playing' ? legalCards(me.hand, this.trick, this.trump, this.partnerOf(playerId)).map((c) => c.id) : [],
      myAnnounces,
      canAnnounce: mayAnnounce && isMyTurn && myAnnounces.length > 0,
      myDeclared: declared ? declared.announces : null,
      announceResult: this.announceResult,
      belote: this.beloteShown,
      myBelote: Boolean(this.beloteHolder && this.beloteHolder === playerId && this.phase === 'playing'),
      // ---- scores
      pending: this.pending,
      summary: this.summary,
      history: this.history,
      events: this.events,
      log: this.log,
    };
  }

  // ================================================================ donne

  /** Coupe le paquet, distribue 3 puis 2 cartes à chacun, retourne la carte suivante. */
  startDeal() {
    const cut = 3 + Math.floor(this.rng() * 27); // entre 3 et 29 cartes coupées
    this.deck = [...this.deck.slice(cut), ...this.deck.slice(0, cut)];
    for (const p of this.players) p.hand = [];
    let pos = 0;
    for (const n of [3, 2]) {
      for (const i of this.order()) {
        this.players[i].hand.push(...this.deck.slice(pos, pos + n));
        pos += n;
      }
    }
    this.turned = this.deck[pos];
    this.stock = this.deck.slice(pos + 1);
    this.deck = [];

    this.phase = 'bidding';
    this.bidRound = 1;
    this.bids = [];
    this.currentIndex = (this.dealerIndex + 1) % 4;
    this.trump = null;
    this.takerId = null;
    this.trick = [];
    this.trickNumber = 0;
    this.lastTrick = null;
    this.tricksWon = {};
    this.won = [[], []]; // plis ramassés par équipe (pour les points, puis pour reformer le paquet)
    this.trickPoints = [0, 0];
    this.declared = [];
    this.announceResult = null;
    this.beloteHolder = null;
    this.beloteShown = null;
    this.summary = null;
    const dealer = this.players[this.dealerIndex];
    this.emit('deal', { dealerId: dealer.id, dealNumber: this.dealNumber, turned: this.turned });
    this.addLog(`Donne ${this.dealNumber} : ${this.players[(this.dealerIndex + 3) % 4].name} coupe, ${dealer.name} distribue. Carte retournée : ${describe(this.turned)}.`);
  }

  /** Ordre de jeu à partir du joueur qui suit le donneur. */
  order() {
    return [1, 2, 3, 4].map((k) => (this.dealerIndex + k) % 4);
  }

  // ================================================================ enchères

  take(playerId, suit) {
    this.assertTurn(playerId, 'bidding');
    const turnedSuit = this.turned.suit;
    if (this.bidRound === 1) {
      if (suit && suit !== turnedSuit) throw new GameError(`Au premier tour, on ne prend qu’à ${SUIT_NAME[turnedSuit]}.`);
      suit = turnedSuit;
    } else {
      if (!SUITS.includes(suit)) throw new GameError('Choisis une couleur d’atout.');
      if (suit === turnedSuit) throw new GameError(`${SUIT_NAME[turnedSuit]} a été refusé au premier tour : choisis une autre couleur.`);
    }
    const taker = this.players[this.currentIndex];
    this.bids.push({ playerId, round: this.bidRound, take: true, suit });
    this.trump = suit;
    this.takerId = playerId;
    // le preneur reçoit la carte retournée et 2 cartes, les autres 3, en partant du joueur qui suit le donneur
    taker.hand.push(this.turned);
    for (const i of this.order()) {
      const n = this.players[i].id === playerId ? 2 : 3;
      this.players[i].hand.push(...this.stock.splice(0, n));
    }
    const holder = this.players.find((p) => ['R', 'D'].every((r) => p.hand.some((c) => c.suit === suit && c.rank === r)));
    this.beloteHolder = holder?.id ?? null;
    this.emit('take', { playerId, suit, round: this.bidRound, card: this.turned });
    this.addLog(`${taker.name} prend à ${SUIT_NAME[suit]}${this.bidRound === 2 ? ' (second tour)' : ''}.`);
    this.phase = 'playing';
    this.trickNumber = 1;
    this.currentIndex = (this.dealerIndex + 1) % 4;
    this.emit('playStart', { leaderId: this.players[this.currentIndex].id, trump: suit });
  }

  pass(playerId) {
    this.assertTurn(playerId, 'bidding');
    const p = this.players[this.currentIndex];
    this.bids.push({ playerId, round: this.bidRound, take: false });
    this.emit('bid', { playerId, round: this.bidRound });
    this.addLog(`${p.name} passe.`);
    if (this.bids.filter((b) => b.round === this.bidRound).length < 4) {
      this.currentIndex = (this.currentIndex + 1) % 4;
      return;
    }
    if (this.bidRound === 1) {
      this.bidRound = 2;
      this.currentIndex = (this.dealerIndex + 1) % 4;
      this.emit('secondRound', {});
      this.addLog('Personne ne prend : second tour, chacun peut choisir une autre couleur.');
      return;
    }
    // tout le monde passe deux fois : on ramasse, le donneur suivant coupe et distribue
    this.emit('allPass', {});
    this.addLog('Tout le monde passe : nouvelle donne par le joueur suivant.');
    this.deck = [...this.players.flatMap((x) => x.hand), this.turned, ...this.stock];
    this.dealerIndex = (this.dealerIndex + 1) % 4;
    this.startDeal();
  }

  // ================================================================ annonces

  announce(playerId, keys) {
    if (!this.announcesOn) throw new GameError('Les annonces ne sont pas jouées dans cette partie.');
    this.assertTurn(playerId, 'playing');
    if (this.trickNumber !== 1) throw new GameError('On annonce pendant le premier pli seulement.');
    if (this.trick.some((t) => t.playerId === playerId)) throw new GameError('Trop tard : tu as déjà joué ta première carte.');
    if (this.declared.some((d) => d.playerId === playerId)) throw new GameError('Tu as déjà annoncé.');
    const p = this.player(playerId);
    const all = findAnnounces(p.hand);
    if (!all.length) throw new GameError('Tu n’as rien à annoncer.');
    const chosen = Array.isArray(keys) ? all.filter((a) => keys.includes(a.key)) : all;
    if (!chosen.length) throw new GameError('Choisis au moins une annonce.');
    this.declared.push({ playerId, announces: chosen });
    this.emit('announce', { playerId, kinds: chosen.map((a) => a.kind) });
    this.addLog(`${p.name} annonce : ${chosen.map((a) => a.kind.toLowerCase()).join(', ')}.`);
  }

  /** À la fin du premier pli : seule l'équipe qui a la meilleure annonce marque (toutes) les siennes, montrées à tous. */
  resolveAnnounces() {
    if (!this.declared.length) return;
    const orderOf = (pid) => this.order().indexOf(this.indexOf(pid));
    let best = null;
    for (const d of this.declared) {
      for (const a of d.announces) {
        const key = announceKey(a, this.trump, orderOf(d.playerId));
        if (!best || compareKeys(key, best.key) > 0) best = { key, playerId: d.playerId, announce: a };
      }
    }
    const team = this.player(best.playerId).team;
    const list = this.declared
      .filter((d) => this.player(d.playerId).team === team)
      .flatMap((d) => d.announces.map((a) => ({ playerId: d.playerId, key: a.key, label: a.label, kind: a.kind, points: a.points, cards: a.cards })));
    const points = list.reduce((t, a) => t + a.points, 0);
    this.announceResult = { team, points, bestPlayerId: best.playerId, best: best.announce.label, list };
    this.emit('announces', { team, points, bestPlayerId: best.playerId });
    this.addLog(`Annonces : ${TEAM_NAMES[team]} marque ${points} (${list.map((a) => a.label).join(', ')}).`);
  }

  // ================================================================ jeu de la carte

  play(playerId, cardId) {
    this.assertTurn(playerId, 'playing');
    const p = this.players[this.currentIndex];
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) throw new GameError('Cette carte n’est pas dans ta main.');
    if (!legalCards(p.hand, this.trick, this.trump, this.partnerOf(playerId)).some((c) => c.id === cardId)) {
      throw new GameError(this.illegalReason(p, card));
    }
    p.hand = p.hand.filter((c) => c.id !== cardId);
    this.trick.push({ playerId, card });
    let belote = null;
    if (playerId === this.beloteHolder && card.suit === this.trump && (card.rank === 'R' || card.rank === 'D')) {
      belote = this.beloteShown ? 'rebelote' : 'belote';
      this.beloteShown = { playerId, step: belote };
      this.addLog(`${p.name} : « ${belote === 'belote' ? 'Belote' : 'Rebelote'} ! »`);
    }
    this.emit('play', { playerId, card, belote });
    if (this.trick.length < 4) {
      this.currentIndex = (this.currentIndex + 1) % 4;
      return;
    }
    this.resolveTrick();
  }

  illegalReason(p, card) {
    const lead = this.trick[0].card.suit;
    const trump = this.trump;
    if (card.suit !== lead && p.hand.some((c) => c.suit === lead)) {
      return lead === trump ? 'Tu dois jouer atout.' : `Tu dois fournir à ${SUIT_NAME[lead]}.`;
    }
    if (lead === trump) return 'Tu dois monter à l’atout.';
    if (card.suit === trump) return 'Tu dois monter à l’atout si tu le peux, sinon te défausser : pas de sous-coupe.';
    return 'Tu dois couper.';
  }

  resolveTrick() {
    const cards = this.trick;
    const winner = trickWinner(cards, this.trump);
    const wp = this.player(winner.playerId);
    const last = this.trickNumber === 8;
    const points = sumPoints(cards.map((t) => t.card), this.trump) + (last ? DIX_DE_DER : 0);
    this.trickPoints[wp.team] += points;
    this.won[wp.team].push(...cards.map((t) => t.card));
    this.tricksWon[wp.id] = (this.tricksWon[wp.id] ?? 0) + 1;
    this.lastTrick = { cards, winnerId: wp.id, number: this.trickNumber, points };
    this.emit('trick', { winnerId: wp.id, number: this.trickNumber, cards, points });
    this.addLog(`Pli ${this.trickNumber} pour ${wp.name} (${describe(winner.card)}, ${points} points${last ? ' avec le dix de der' : ''}).`);
    if (this.trickNumber === 1) this.resolveAnnounces();
    if (last) {
      this.scoreDeal();
      return;
    }
    this.trickNumber++;
    this.trick = [];
    this.currentIndex = this.indexOf(wp.id);
  }

  // ================================================================ décompte

  scoreDeal() {
    const T = this.player(this.takerId).team;
    const D = 1 - T;
    const tricksBy = [0, 1].map((t) => this.players.filter((p) => p.team === t).reduce((n, p) => n + (this.tricksWon[p.id] ?? 0), 0));
    const capot = tricksBy[0] === 8 ? 0 : tricksBy[1] === 8 ? 1 : null;
    const cards = [...this.trickPoints];
    if (capot !== null) {
      cards[capot] = CAPOT;
      cards[1 - capot] = 0;
    }
    const ann = [0, 0];
    if (this.announceResult) ann[this.announceResult.team] = this.announceResult.points;
    const bel = [0, 0];
    if (this.beloteHolder) bel[this.player(this.beloteHolder).team] = 20;
    const totals = [0, 1].map((t) => cards[t] + ann[t] + bel[t]);

    let result;
    const scored = [0, 0];
    let held = 0;
    if (totals[T] > totals[D]) {
      result = 'made';
      scored[T] = totals[T];
      scored[D] = totals[D];
    } else if (totals[T] < totals[D]) {
      // dedans : la défense marque 162 (252 si capot) et toutes les annonces ; la belote reste à son équipe
      result = 'dedans';
      scored[D] = (capot === D ? CAPOT : TOTAL) + ann[0] + ann[1] + bel[D];
      scored[T] = bel[T];
    } else {
      // litige : la défense garde ses points, ceux du preneur (hors belote) attendent la donne suivante
      result = 'litige';
      scored[D] = totals[D];
      scored[T] = bel[T];
      held = totals[T] - bel[T];
    }
    // un litige précédent revient à l'équipe qui gagne cette donne (il attend encore si celle-ci est aussi en litige)
    const bonus = [0, 0];
    let bonusTeam = null;
    if (this.pending && result !== 'litige') {
      bonusTeam = result === 'made' ? T : D;
      bonus[bonusTeam] = this.pending;
      this.pending = 0;
    }
    this.pending += held;
    for (const t of [0, 1]) this.scores[t] += scored[t] + bonus[t];

    const top = Math.max(...this.scores);
    const over = top >= this.target && this.scores[0] !== this.scores[1];
    this.summary = {
      dealNumber: this.dealNumber,
      takerId: this.takerId,
      takerTeam: T,
      trump: this.trump,
      turned: this.turned,
      tricks: tricksBy,
      cardPoints: [...this.trickPoints],
      derTeam: this.player(this.lastTrick.winnerId).team,
      capot,
      cards,
      announces: ann,
      announceResult: this.announceResult,
      belote: bel,
      beloteId: this.beloteHolder,
      totals,
      result,
      scored,
      held,
      bonus,
      bonusTeam,
      pending: this.pending,
      scores: [...this.scores],
      isLast: over,
    };
    this.history.push({
      dealNumber: this.dealNumber, takerId: this.takerId, trump: this.trump, result, capot,
      scored, bonus, held, scores: [...this.scores],
    });
    const verdict = { made: 'réussit', dedans: 'est dedans', litige: 'fait litige' }[result];
    this.addLog(`${this.teamLabel(T)} ${verdict} : ${totals[T]} contre ${totals[D]}${capot !== null ? ` (capot pour ${TEAM_NAMES[capot]})` : ''}.`);
    // le paquet se reforme avec les plis ramassés (aucun mélange : on coupera)
    this.deck = [...this.won[0], ...this.won[1]];
    this.phase = over ? 'gameOver' : 'dealEnd';
    this.emit('dealEnd', { result, capot, scored });
    if (over) {
      const w = this.scores[0] > this.scores[1] ? 0 : 1;
      this.emit('gameOver', { winnerTeam: w });
      this.addLog(`${this.teamLabel(w)} gagne la partie ${this.scores[w]} à ${this.scores[1 - w]} !`);
    } else if (top >= this.target) {
      this.addLog('Égalité au-delà du but : on joue une donne de plus.');
    }
  }

  nextDeal() {
    if (this.phase !== 'dealEnd') throw new GameError("La donne n'est pas terminée.");
    this.dealNumber++;
    this.dealerIndex = (this.dealerIndex + 1) % 4;
    this.startDeal();
  }

  // ================================================================ utilitaires

  /** Main triée : couleurs alternées noir / rouge (l'atout en dernier), de la plus faible à la plus forte. */
  sortHand(hand) {
    const ORDER = { S: ['H', 'C', 'D'], H: ['S', 'D', 'C'], D: ['S', 'H', 'C'], C: ['H', 'S', 'D'] };
    const order = this.trump ? [...ORDER[this.trump], this.trump] : ['S', 'H', 'C', 'D'];
    return [...hand].sort((a, b) => order.indexOf(a.suit) - order.indexOf(b.suit) || power(a, this.trump) - power(b, this.trump));
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  indexOf(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  partnerOf(id) {
    const i = this.indexOf(id);
    return i < 0 ? null : this.players[(i + 2) % 4].id;
  }

  assertTurn(playerId, phase) {
    if (this.phase !== phase) throw new GameError("Ce n'est pas le moment.");
    if (this.players[this.currentIndex].id !== playerId) throw new GameError('Ce n’est pas ton tour.');
  }

  emit(type, data) {
    this.events.push({ id: ++this.eventSeq, type, ...data });
    if (this.events.length > EVENT_SIZE) this.events.shift();
  }

  addLog(text) {
    this.log.push({ text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }
}

module.exports = {
  Belote, GameError, legalCards, trickWinner, findAnnounces, announceKey, compareKeys, TEAM_NAMES, RANK_NAME, cardPoints,
};
