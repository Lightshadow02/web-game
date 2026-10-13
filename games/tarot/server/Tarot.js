'use strict';

const { SUITS, TRUMP, EXCUSE, buildDeck, isOudler, cardPoints, sumPoints, shuffle, describe } = require('./cards');

/** Paramètres officiels (FFT) selon le nombre de joueurs. */
const CONFIG = {
  3: { handSize: 24, chien: 6, poignees: [13, 15, 18] },
  4: { handSize: 18, chien: 6, poignees: [10, 13, 15] },
  5: { handSize: 15, chien: 3, poignees: [8, 10, 13] },
};

const CONTRACTS = [
  { id: 'petite', name: 'Petite', mult: 1 },
  { id: 'garde', name: 'Garde', mult: 2 },
  { id: 'garde_sans', name: 'Garde sans le chien', mult: 4 },
  { id: 'garde_contre', name: 'Garde contre le chien', mult: 6 },
];
const POIGNEES = [
  { id: 'simple', name: 'simple', bonus: 20 },
  { id: 'double', name: 'double', bonus: 30 },
  { id: 'triple', name: 'triple', bonus: 40 },
];
/** Points à réaliser selon le nombre de bouts du preneur (0, 1, 2, 3). */
const NEEDED = [56, 51, 41, 36];
const LOG_SIZE = 50;
const EVENT_SIZE = 60;

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true;
  }
}

const contractById = (id) => CONTRACTS.find((c) => c.id === id);
const contractRank = (id) => CONTRACTS.findIndex((c) => c.id === id);

const SUIT_ORDER = { T: 0, S: 1, H: 2, C: 3, D: 4, E: 5 }; // atouts, puis couleurs alternées
function sortHand(hand) {
  return [...hand].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || b.rank - a.rank);
}

/**
 * Cartes jouables (règles officielles) :
 *  - fournir la couleur demandée ;
 *  - sinon couper (atout) en montant si possible ;
 *  - à l'atout demandé : monter si possible, sinon atout quelconque ;
 *  - sinon n'importe quelle carte. L'Excuse se joue toujours.
 */
function legalCards(hand, trickCards) {
  const played = trickCards.filter((t) => t.card.suit !== EXCUSE);
  if (!played.length) return hand;
  const lead = played[0].card.suit;
  const excuse = hand.filter((c) => c.suit === EXCUSE);
  const maxTrump = Math.max(0, ...played.filter((t) => t.card.suit === TRUMP).map((t) => t.card.rank));

  if (lead !== TRUMP) {
    const follow = hand.filter((c) => c.suit === lead);
    if (follow.length) return [...follow, ...excuse];
  }
  const trumps = hand.filter((c) => c.suit === TRUMP);
  if (trumps.length) {
    const higher = trumps.filter((c) => c.rank > maxTrump);
    return [...(higher.length ? higher : trumps), ...excuse];
  }
  return hand;
}

/** Gagnant d'un pli : plus fort atout, sinon plus forte carte de la couleur demandée. */
function trickWinner(trickCards) {
  const played = trickCards.filter((t) => t.card.suit !== EXCUSE);
  if (!played.length) return trickCards[0];
  const trumps = played.filter((t) => t.card.suit === TRUMP);
  const pool = trumps.length ? trumps : played.filter((t) => t.card.suit === played[0].card.suit);
  return pool.reduce((best, t) => (t.card.rank > best.card.rank ? t : best));
}

/**
 * Tarot français, 3 à 5 joueurs (à 5 : appel au Roi).
 *
 * Phases d'une donne : bidding -> (calling à 5) -> (discard si Petite/Garde) -> playing -> roundEnd.
 * Une partie = une donne par joueur (chacun distribue une fois), puis gameOver.
 */
class Tarot {
  constructor({ players, rng = Math.random, rounds }) {
    if (players.length < 3 || players.length > 5) throw new GameError('Le Tarot se joue de 3 à 5 joueurs.');
    this.rng = rng;
    this.n = players.length;
    this.cfg = CONFIG[this.n];
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], won: [], score: 0 }));
    this.totalRounds = rounds ?? this.n;
    this.roundNumber = 1;
    this.dealerIndex = this.n - 1; // le premier joueur parle et entame en premier
    this.history = [];
    this.summary = null;
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.startDeal();
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload) {
    if (this.isOver()) throw new GameError('La partie est terminée.');
    switch (type) {
      case 'bid':
        return this.bid(playerId, payload.bid);
      case 'call':
        return this.call(playerId, payload.cardId);
      case 'discard':
        return this.discard(playerId, payload.cardIds);
      case 'poignee':
        return this.declarePoignee(playerId, payload.size);
      case 'play':
        return this.play(playerId, payload.cardId);
      case 'next':
        return this.nextRound(playerId);
      default:
        throw new GameError(`Action inconnue : ${type}`);
    }
  }

  isOver() {
    return this.phase === 'gameOver';
  }

  getResult() {
    if (!this.isOver()) return null;
    const best = Math.max(...this.players.map((p) => p.score));
    const winners = this.players.filter((p) => p.score === best);
    return {
      summary: `${winners.map((p) => p.name).join(' & ')} ${winners.length > 1 ? 'gagnent' : 'gagne'} avec ${best} pts`,
      players: this.players.map((p) => ({
        playerId: p.id,
        result: p.score !== best ? 'loss' : winners.length > 1 ? 'draw' : 'win',
        score: p.score,
      })),
    };
  }

  getStateFor(playerId) {
    const me = this.player(playerId);
    const current = this.players[this.currentIndex];
    const isMyTurn = current?.id === playerId && ['bidding', 'calling', 'discard', 'playing'].includes(this.phase);
    const roundDone = this.phase === 'roundEnd' || this.phase === 'gameOver';
    const partnerKnown = this.partnerRevealed || roundDone;
    const highest = this.highestBid();

    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      playerCount: this.n,
      dealerId: this.players[this.dealerIndex].id,
      currentPlayerId: isMyTurn || ['bidding', 'calling', 'discard', 'playing'].includes(this.phase) ? current?.id : null,
      isMyTurn,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        score: p.score,
        bid: this.bids.filter((b) => b.playerId === p.id).at(-1)?.bid ?? null,
        isTaker: p.id === this.takerId,
        isPartner: partnerKnown && this.partnerId === p.id && p.id !== this.takerId,
        tricks: this.tricksWon[p.id] ?? 0,
      })),
      myHand: me ? sortHand(me.hand) : [],
      // ---- enchères / appel / chien
      bids: this.bids,
      highestBid: highest?.bid ?? null,
      availableBids: isMyTurn && this.phase === 'bidding' ? this.availableBids() : [],
      contract: this.contract ? contractById(this.contract) : null,
      takerId: this.takerId,
      calledCard: this.calledCard,
      callableCards: isMyTurn && this.phase === 'calling' ? this.callableCards() : [],
      partnerId: partnerKnown ? this.partnerId : null,
      iAmPartner: Boolean(this.partnerId && this.partnerId === playerId && playerId !== this.takerId),
      chien: this.chienVisible ? this.chien : null,
      chienCount: this.chien.length,
      discardCount: isMyTurn && this.phase === 'discard' ? this.cfg.chien : 0,
      // ---- jeu de la carte
      trick: this.trick?.cards ?? [],
      trickNumber: this.trickNumber,
      totalTricks: this.cfg.handSize,
      lastTrick: this.lastTrick,
      legalCardIds: isMyTurn && this.phase === 'playing' ? legalCards(me.hand, this.trick.cards).map((c) => c.id) : [],
      poigneeOptions: this.poigneeOptions(playerId),
      poignees: this.poignees.map(({ playerId: pid, size, cards }) => ({ playerId: pid, size, cards })),
      // ---- scores
      summary: this.summary,
      history: this.history,
      events: this.events,
      log: this.log,
    };
  }

  // ================================================================ donne

  startDeal() {
    let attempts = 0;
    do {
      const deck = shuffle(buildDeck(), this.rng);
      for (const p of this.players) {
        p.hand = deck.splice(0, this.cfg.handSize);
        p.won = [];
      }
      this.chien = deck;
      attempts++;
    } while (this.petitSec() && attempts < 50);

    this.phase = 'bidding';
    this.bids = [];
    this.currentIndex = (this.dealerIndex + 1) % this.n;
    this.takerId = null;
    this.contract = null;
    this.calledCard = null;
    this.partnerId = null;
    this.partnerRevealed = false;
    this.chienVisible = false;
    this.defenseExtra = [];
    this.trick = null;
    this.trickNumber = 0;
    this.lastTrick = null;
    this.tricksWon = {};
    this.poignees = [];
    this.excuseTransfer = null;
    this.petitAuBout = null;
    this.summary = null;
    this.emit('deal', { dealerId: this.players[this.dealerIndex].id, roundNumber: this.roundNumber });
    this.addLog(`Donne ${this.roundNumber}/${this.totalRounds} : ${this.players[this.dealerIndex].name} distribue.`);
  }

  /** Petit sec : un joueur n'a que le Petit comme atout (et pas l'Excuse) -> on redistribue. */
  petitSec() {
    return this.players.some((p) => {
      const trumps = p.hand.filter((c) => c.suit === TRUMP);
      return trumps.length === 1 && trumps[0].rank === 1 && !p.hand.some((c) => c.suit === EXCUSE);
    });
  }

  // ================================================================ enchères

  highestBid() {
    return this.bids.filter((b) => b.bid !== 'passe').at(-1) ?? null;
  }

  availableBids() {
    const highest = this.highestBid();
    const min = highest ? contractRank(highest.bid) + 1 : 0;
    return ['passe', ...CONTRACTS.slice(min).map((c) => c.id)];
  }

  bid(playerId, bid) {
    this.assertTurn(playerId, 'bidding');
    if (!this.availableBids().includes(bid)) throw new GameError('Enchère impossible : il faut annoncer plus haut ou passer.');
    const player = this.players[this.currentIndex];
    this.bids.push({ playerId, bid });
    this.emit('bid', { playerId, bid });
    this.addLog(`${player.name} : ${bid === 'passe' ? 'passe' : contractById(bid).name}.`);

    if (this.bids.length < this.n) {
      this.currentIndex = (this.currentIndex + 1) % this.n;
      return;
    }
    const highest = this.highestBid();
    if (!highest) {
      this.addLog('Tout le monde passe : on redistribue.');
      this.emit('allPass', {});
      this.dealerIndex = (this.dealerIndex + 1) % this.n;
      this.startDeal();
      return;
    }
    this.takerId = highest.playerId;
    this.contract = highest.bid;
    this.currentIndex = this.indexOf(this.takerId);
    this.addLog(`${this.player(this.takerId).name} prend : ${contractById(this.contract).name}.`);
    if (this.n === 5) {
      this.phase = 'calling';
      return;
    }
    this.afterCall();
  }

  // ================================================================ appel (5 joueurs)

  /** Rois appelables ; si le preneur les a tous, les Dames, etc. */
  callableCards() {
    const taker = this.player(this.takerId);
    for (const rank of [14, 13, 12, 11]) {
      const owned = SUITS.filter((s) => taker.hand.some((c) => c.suit === s && c.rank === rank));
      if (owned.length < 4) return SUITS.map((s) => ({ id: `${s}${rank}`, suit: s, rank }));
    }
    return [];
  }

  call(playerId, cardId) {
    this.assertTurn(playerId, 'calling');
    const card = this.callableCards().find((c) => c.id === cardId);
    if (!card) throw new GameError('Carte impossible à appeler.');
    this.calledCard = card;
    // Le partenaire est celui qui détient la carte (personne si elle est au chien ou chez le preneur).
    const holder = this.players.find((p) => p.hand.some((c) => c.id === cardId));
    this.partnerId = holder?.id ?? null;
    this.emit('call', { playerId, card });
    this.addLog(`${this.player(playerId).name} appelle ${describe(card)}.`);
    this.afterCall();
  }

  afterCall() {
    const taker = this.player(this.takerId);
    if (this.contract === 'petite' || this.contract === 'garde') {
      this.phase = 'discard';
      this.chienVisible = true;
      taker.hand.push(...this.chien);
      this.currentIndex = this.indexOf(this.takerId);
      this.emit('chien', { cards: this.chien });
      this.addLog(`Le chien est retourné : ${this.chien.map(describe).join(', ')}.`);
      return;
    }
    if (this.contract === 'garde_sans') {
      taker.won.push(...this.chien); // compte pour le preneur, sans être vu
      this.addLog('Garde sans : le chien va au preneur sans être retourné.');
    } else {
      this.defenseExtra = [...this.chien]; // garde contre : le chien compte pour la défense
      this.addLog('Garde contre : le chien va à la défense sans être retourné.');
    }
    this.startPlay();
  }

  // ================================================================ écart

  discard(playerId, cardIds) {
    this.assertTurn(playerId, 'discard');
    const taker = this.player(playerId);
    const count = this.cfg.chien;
    if (!Array.isArray(cardIds) || cardIds.length !== count || new Set(cardIds).size !== count) {
      throw new GameError(`Choisis exactement ${count} cartes à écarter.`);
    }
    const cards = cardIds.map((id) => {
      const card = taker.hand.find((c) => c.id === id);
      if (!card) throw new GameError('Cette carte n’est pas dans ta main.');
      return card;
    });
    if (cards.some((c) => c.suit !== TRUMP && c.suit !== EXCUSE && c.rank === 14)) throw new GameError('On ne peut pas écarter de Roi.');
    if (cards.some(isOudler)) throw new GameError('On ne peut pas écarter de bout (Petit, 21, Excuse).');
    const trumps = cards.filter((c) => c.suit === TRUMP);
    if (trumps.length) {
      const plain = taker.hand.filter((c) => SUITS.includes(c.suit) && c.rank !== 14).length;
      if (plain >= count) throw new GameError("On n'écarte des atouts que si l'on n'a pas assez d'autres cartes.");
    }
    taker.hand = taker.hand.filter((c) => !cardIds.includes(c.id));
    taker.won.push(...cards);
    this.chienVisible = false;
    this.emit('ecart', { playerId, count, shownTrumps: trumps });
    this.addLog(
      `${taker.name} fait son écart${trumps.length ? ` (atouts montrés : ${trumps.map(describe).join(', ')})` : ''}.`,
    );
    this.startPlay();
  }

  // ================================================================ poignées

  poigneeOptions(playerId) {
    const p = this.player(playerId);
    if (!p || this.phase !== 'playing' || this.trickNumber !== 1) return [];
    if (this.trick.cards.some((t) => t.playerId === playerId)) return [];
    if (this.poignees.some((x) => x.playerId === playerId)) return [];
    const count = p.hand.filter((c) => c.suit === TRUMP || c.suit === EXCUSE).length;
    return POIGNEES.filter((_, i) => count >= this.cfg.poignees[i]).map((x, i) => ({ ...x, cards: this.cfg.poignees[i] }));
  }

  declarePoignee(playerId, size) {
    const option = this.poigneeOptions(playerId).find((o) => o.id === size);
    if (!option) throw new GameError('Poignée impossible (avant ta première carte, avec assez d’atouts).');
    const p = this.player(playerId);
    // On montre exactement le nombre requis d'atouts (l'Excuse seulement en dernier recours).
    const trumps = p.hand.filter((c) => c.suit === TRUMP).sort((a, b) => a.rank - b.rank);
    const shown = trumps.slice(0, option.cards);
    if (shown.length < option.cards) shown.push(...p.hand.filter((c) => c.suit === EXCUSE));
    this.poignees.push({ playerId, size, bonus: option.bonus, cards: shown });
    this.emit('poignee', { playerId, size, cards: shown });
    this.addLog(`${p.name} annonce une poignée ${option.name} (${option.cards} atouts).`);
  }

  // ================================================================ jeu de la carte

  startPlay() {
    this.phase = 'playing';
    this.trickNumber = 1;
    this.currentIndex = (this.dealerIndex + 1) % this.n;
    this.trick = { cards: [] };
    this.emit('playStart', { leaderId: this.players[this.currentIndex].id });
  }

  play(playerId, cardId) {
    this.assertTurn(playerId, 'playing');
    const p = this.players[this.currentIndex];
    const card = p.hand.find((c) => c.id === cardId);
    if (!card) throw new GameError('Cette carte n’est pas dans ta main.');
    if (!legalCards(p.hand, this.trick.cards).some((c) => c.id === cardId)) {
      throw new GameError(this.illegalReason(p.hand));
    }
    p.hand = p.hand.filter((c) => c.id !== cardId);
    this.trick.cards.push({ playerId, card });
    const revealsPartner = Boolean(this.calledCard && card.id === this.calledCard.id);
    if (revealsPartner) {
      this.partnerRevealed = true;
      this.addLog(`${p.name} joue ${describe(card)} : ${p.id === this.takerId ? 'le preneur joue seul !' : `partenaire du preneur !`}`);
    }
    this.emit('play', { playerId, card, revealsPartner });

    if (this.trick.cards.length < this.n) {
      this.currentIndex = (this.currentIndex + 1) % this.n;
      return;
    }
    this.resolveTrick();
  }

  illegalReason(hand) {
    const played = this.trick.cards.filter((t) => t.card.suit !== EXCUSE);
    const lead = played[0]?.card.suit;
    if (lead && lead !== TRUMP && hand.some((c) => c.suit === lead)) return 'Tu dois fournir la couleur demandée.';
    if (hand.some((c) => c.suit === TRUMP)) return 'Tu dois couper, et monter à l’atout si tu le peux.';
    return 'Carte non autorisée.';
  }

  resolveTrick() {
    const cards = this.trick.cards;
    const winner = trickWinner(cards);
    const winnerPlayer = this.player(winner.playerId);
    const last = this.trickNumber === this.cfg.handSize;

    for (const { playerId, card } of cards) {
      if (card.suit === EXCUSE && !last) {
        // L'Excuse reste à son propriétaire, qui donnera une demi-carte (0,5 pt) en échange.
        this.player(playerId).won.push(card);
        if (playerId !== winner.playerId) this.excuseTransfer = { ownerId: playerId, winnerId: winner.playerId };
      } else {
        winnerPlayer.won.push(card); // au dernier pli, l'Excuse est perdue
      }
    }
    if (last && cards.some((t) => t.card.suit === TRUMP && t.card.rank === 1)) {
      this.petitAuBout = { winnerId: winner.playerId };
      this.addLog(`Petit au bout pour ${winnerPlayer.name} !`);
    }
    this.tricksWon[winner.playerId] = (this.tricksWon[winner.playerId] ?? 0) + 1;
    this.lastTrick = { cards, winnerId: winner.playerId, number: this.trickNumber };
    this.emit('trick', { winnerId: winner.playerId, number: this.trickNumber, cards });
    this.addLog(`Pli ${this.trickNumber} pour ${winnerPlayer.name} (${describe(winner.card)}).`);

    if (last) {
      this.scoreRound();
      return;
    }
    this.trickNumber++;
    this.trick = { cards: [] };
    this.currentIndex = this.indexOf(winner.playerId);
  }

  // ================================================================ décompte

  campOf(playerId) {
    return playerId === this.takerId || (this.partnerId && playerId === this.partnerId) ? 'attack' : 'defense';
  }

  scoreRound() {
    const attackers = this.players.filter((p) => this.campOf(p.id) === 'attack');
    const attackCards = attackers.flatMap((p) => p.won);
    let points = sumPoints(attackCards);
    if (this.excuseTransfer && this.campOf(this.excuseTransfer.ownerId) !== this.campOf(this.excuseTransfer.winnerId)) {
      points += this.campOf(this.excuseTransfer.ownerId) === 'attack' ? -0.5 : 0.5;
    }
    const oudlers = attackCards.filter(isOudler).length;
    const needed = NEEDED[oudlers];
    const diff = points - needed;
    const made = diff >= 0;
    const contract = contractById(this.contract);
    const sign = made ? 1 : -1;

    const base = 25 + Math.round(Math.abs(diff));
    const contractScore = sign * base * contract.mult;
    const petitAuBout = this.petitAuBout
      ? (this.campOf(this.petitAuBout.winnerId) === 'attack' ? 1 : -1) * 10 * contract.mult
      : 0;
    const poigneeBonus = this.poignees.reduce((total, p) => total + p.bonus, 0);
    const total = contractScore + petitAuBout + sign * poigneeBonus; // pour le camp du preneur

    // Répartition : la somme des scores d'une donne est toujours nulle.
    const changes = {};
    const defenders = this.players.filter((p) => this.campOf(p.id) === 'defense');
    for (const d of defenders) changes[d.id] = -total;
    const partner = this.partnerId && this.partnerId !== this.takerId ? this.partnerId : null;
    if (partner) {
      changes[partner] = total;
      changes[this.takerId] = total * (defenders.length - 1);
    } else {
      changes[this.takerId] = total * defenders.length;
    }
    for (const p of this.players) p.score += changes[p.id] ?? 0;

    this.summary = {
      roundNumber: this.roundNumber,
      takerId: this.takerId,
      partnerId: partner,
      contract,
      calledCard: this.calledCard,
      points,
      oudlers,
      needed,
      diff,
      made,
      base,
      petitAuBout,
      poignees: this.poignees.map(({ playerId, size, bonus }) => ({ playerId, size, bonus })),
      total,
      changes,
      scores: Object.fromEntries(this.players.map((p) => [p.id, p.score])),
      isLast: this.roundNumber >= this.totalRounds,
    };
    this.history.push({ roundNumber: this.roundNumber, takerId: this.takerId, contract: contract.id, made, points, diff, changes });
    this.addLog(
      `${this.player(this.takerId).name} ${made ? 'réussit' : 'chute'} sa ${contract.name} : ${points} pts pour ${needed} requis (${oudlers} bout${oudlers > 1 ? 's' : ''}).`,
    );
    this.phase = this.summary.isLast ? 'gameOver' : 'roundEnd';
    this.emit('roundEnd', { made, total });
    if (this.phase === 'gameOver') this.addLog('Fin de la partie !');
  }

  nextRound() {
    if (this.phase !== 'roundEnd') throw new GameError("La donne n'est pas terminée.");
    this.roundNumber++;
    this.dealerIndex = (this.dealerIndex + 1) % this.n;
    this.startDeal();
  }

  // ================================================================ utilitaires

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  indexOf(id) {
    return this.players.findIndex((p) => p.id === id);
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

module.exports = { Tarot, GameError, legalCards, trickWinner, CONTRACTS, NEEDED, CONFIG, cardPoints };
