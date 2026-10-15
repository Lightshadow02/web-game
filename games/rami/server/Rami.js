'use strict';

const {
  isJoker, buildDeck, shuffle, handPenalty, penalty, describe, analyzeMeld, canReplaceJoker,
} = require('./melds');

/**
 * Moteur du Rami (« Rami 51 »), pur et testable (rng injectable).
 *
 * Règles retenues (voir aussi la fenêtre de règles du client) :
 *  - 2 jeux de 52 cartes + 4 Jokers (108 cartes), 2 à 6 joueurs, 13 cartes chacun ; une carte est
 *    retournée pour commencer la défausse. Le joueur à gauche du donneur commence ; le donneur tourne.
 *  - Tour : piocher (talon ou carte du dessus de la défausse), puis poser des combinaisons, compléter
 *    celles de la table et échanger un Joker (après avoir ouvert), puis défausser une carte.
 *  - La carte prise à la défausse doit être posée (combinaison ou ajout) pendant ce tour ; tant
 *    qu'elle est en main, on ne peut pas défausser. On peut la reposer (« cancel ») puis piocher au talon.
 *  - Ouverture : la première pose doit valoir au moins 51 (ou 30) points en une fois, avec ses
 *    propres combinaisons (2-10 leur valeur, figures 10, As 1 dans A-2-3 et 11 sinon, Joker = la carte remplacée).
 *  - Après l'ouverture (dès le même tour) : ajouts sur toutes les combinaisons de la table et échange
 *    du Joker contre la carte qu'il remplace ; le Joker récupéré doit être reposé dans le tour.
 *  - Un seul Joker par combinaison ; pas de tour du coin (R-A-2).
 *  - On sort en se débarrassant de toutes ses cartes : en défaussant la dernière, ou en posant tout.
 *    Sortir en un seul tour sans avoir rien posé avant (« rami ») double les pénalités des autres.
 *  - Pénalités : cartes restées en main, Joker 20, As 11, figures 10, autres leur valeur.
 *  - Talon épuisé : la défausse (sauf sa carte du dessus) est mélangée pour former un nouveau talon.
 *  - Après le nombre de donnes choisi, le plus petit total gagne (ex aequo : tous gagnants).
 */

const HAND_SIZE = 13;
const EVENT_SIZE = 80;
const LOG_SIZE = 120;

function gameError(message) {
  const err = new Error(message);
  err.isGameError = true;
  return err;
}

const clone = (c) => JSON.parse(JSON.stringify(c));

class Rami {
  /**
   * @param {{ players: {id: string, name: string}[], options?: { opening?: number, rounds?: number }, rng?: () => number }} o
   */
  constructor({ players, options = {}, rng = Math.random }) {
    if (!Array.isArray(players) || players.length < 2 || players.length > 6) {
      throw gameError('Le Rami se joue de 2 à 6 joueurs.');
    }
    this.rng = rng;
    this.opening = [30, 51].includes(Number(options.opening)) ? Number(options.opening) : 51;
    this.totalRounds = [3, 5, 7].includes(Number(options.rounds)) ? Number(options.rounds) : 5;
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], opened: false, total: 0 }));
    this.roundNumber = 0;
    this.history = [];
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.summary = null;
    this.meldSeq = 0;
    this.startRound();
  }

  // ================================================================ donne

  startRound() {
    this.roundNumber += 1;
    const n = this.players.length;
    this.dealerIndex = (this.roundNumber - 1) % n;
    const deck = shuffle(buildDeck(), this.rng);
    for (const p of this.players) {
      p.hand = [];
      p.opened = false;
    }
    for (let k = 0; k < HAND_SIZE; k++) {
      for (let i = 1; i <= n; i++) this.players[(this.dealerIndex + i) % n].hand.push(deck.pop());
    }
    this.discard = [deck.pop()];
    this.stock = deck;
    this.melds = [];
    this.summary = null;
    this.phase = 'draw';
    this.currentIndex = (this.dealerIndex + 1) % n;
    this.resetTurn();
    this.event('deal', { roundNumber: this.roundNumber, dealerId: this.players[this.dealerIndex].id, firstId: this.current.id });
    this.addLog(`Donne ${this.roundNumber}/${this.totalRounds} : ${this.players[this.dealerIndex].name} distribue, ${describe(this.discard[0])} ouvre la défausse.`);
  }

  resetTurn() {
    this.turn = { drawn: false, from: null, taken: null, swaps: [], laid: false, openedNow: false, openedBefore: this.current.opened };
  }

  get current() {
    return this.players[this.currentIndex];
  }

  // ================================================================ actions

  handleAction(playerId, type, payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    const player = this.players.find((p) => p.id === playerId);
    if (!player) throw gameError('Tu ne joues pas à cette table.');
    if (type === 'next') return this.nextRound();
    if (this.phase === 'roundEnd' || this.phase === 'gameOver') throw gameError('La donne est terminée.');
    if (this.current.id !== playerId) throw gameError('Ce n’est pas ton tour.');
    switch (type) {
      case 'draw': return this.draw(player, payload.from);
      case 'lay': return this.lay(player, payload.melds);
      case 'add': return this.add(player, payload.meldId, payload.cardIds, payload.end);
      case 'swap': return this.swap(player, payload.meldId, payload.cardId);
      case 'cancel': return this.cancel(player, payload.cardId);
      case 'discard': return this.discardCard(player, payload.cardId);
      default: throw gameError('Action inconnue.');
    }
  }

  requirePlay() {
    if (this.phase === 'draw') throw gameError('Pioche d’abord une carte.');
  }

  draw(player, from) {
    if (this.phase !== 'draw') throw gameError('Tu as déjà pioché.');
    if (from === 'discard') {
      if (this.turn.noDiscard) throw gameError('Tu as reposé cette carte : pioche au talon.');
      const card = this.discard.pop();
      if (!card) throw gameError('La défausse est vide.');
      player.hand.push(card);
      this.turn.taken = card.id;
      this.turn.from = 'discard';
      this.event('draw', { playerId: player.id, from: 'discard', card: clone(card) });
      this.addLog(`${player.name} prend ${describe(card)} à la défausse.`);
    } else if (from === 'stock' || from === undefined) {
      if (!this.stock.length) this.replenish();
      const card = this.stock.pop();
      if (!card) return this.endRound(null);
      player.hand.push(card);
      this.turn.from = 'stock';
      this.event('draw', { playerId: player.id, from: 'stock' });
      this.addLog(`${player.name} pioche au talon.`);
    } else {
      throw gameError('Pioche au talon ou à la défausse.');
    }
    this.turn.drawn = true;
    this.phase = 'play';
    return undefined;
  }

  /** Talon vide : la défausse, sauf sa carte du dessus, est mélangée pour former un nouveau talon. */
  replenish() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.stock = shuffle(this.discard, this.rng);
    this.discard = [top];
    this.event('reshuffle', { count: this.stock.length });
    this.addLog(`Talon épuisé : la défausse est mélangée (${this.stock.length} cartes).`);
  }

  takeFromHand(player, ids) {
    if (!Array.isArray(ids) || !ids.length) throw gameError('Choisis des cartes.');
    if (new Set(ids).size !== ids.length) throw gameError('Une même carte choisie deux fois.');
    const cards = ids.map((id) => player.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw gameError('Cette carte n’est pas dans ta main.');
    return cards;
  }

  lay(player, melds) {
    this.requirePlay();
    if (!Array.isArray(melds) || !melds.length
      || melds.some((m) => !Array.isArray(m) || !m.length || m.some((id) => typeof id !== 'string'))) {
      throw gameError('Choisis au moins une combinaison.');
    }
    const all = melds.flat();
    const cards = this.takeFromHand(player, all);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const results = melds.map((ids, i) => {
      const r = analyzeMeld(ids.map((id) => byId.get(id)));
      if (!r.ok) throw gameError(melds.length > 1 ? `Combinaison ${i + 1} : ${r.error}.` : `${r.error}.`);
      return r;
    });
    const value = results.reduce((s, r) => s + r.value, 0);
    const opening = !player.opened;
    if (opening && this.turn.taken && player.hand.some((c) => c.id === this.turn.taken) && !all.includes(this.turn.taken)) {
      throw gameError('La carte prise à la défausse doit faire partie de ton ouverture.');
    }
    if (opening && value < this.opening) {
      throw gameError(`Pour ouvrir, il faut ${this.opening} points en une fois (ici ${value}).`);
    }
    const ids = new Set(all);
    player.hand = player.hand.filter((c) => !ids.has(c.id));
    const laid = results.map((r) => {
      const meld = { id: `m${++this.meldSeq}`, owner: player.id, type: r.type, cards: r.cards };
      if (r.type === 'set') meld.rank = r.rank;
      this.melds.push(meld);
      return meld;
    });
    if (opening) {
      player.opened = true;
      this.turn.openedNow = true;
    }
    this.turn.laid = true;
    this.event('lay', { playerId: player.id, melds: laid.map(clone), opened: opening, value });
    this.addLog(`${player.name} ${opening ? `ouvre avec ${value} points` : 'pose'} : ${laid.map(meldText).join(' · ')}.`);
    return this.checkOut(player);
  }

  add(player, meldId, cardIds, end) {
    this.requirePlay();
    if (!player.opened) throw gameError('Ouvre d’abord avant de compléter les combinaisons.');
    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld) throw gameError('Combinaison introuvable.');
    const list = Array.isArray(cardIds) ? cardIds : [cardIds];
    if (list.some((id) => typeof id !== 'string')) throw gameError('Choisis des cartes.');
    const cards = this.takeFromHand(player, list);
    const jokers = cards.filter(isJoker).length + meld.cards.filter(isJoker).length;
    if (jokers > 1) throw gameError('Un seul Joker par combinaison.');
    if (meld.type === 'run' && cards.length === 1 && canReplaceJoker(meld, cards[0])) {
      throw gameError('Cette carte remplace le Joker : utilise « Échanger le Joker ».');
    }
    const r = analyzeMeld([...meld.cards, ...cards], { type: meld.type, jokerEnd: end === 'low' ? 'low' : 'high' });
    if (!r.ok) throw gameError(`${r.error}.`);
    const ids = new Set(cards.map((c) => c.id));
    player.hand = player.hand.filter((c) => !ids.has(c.id));
    meld.cards = r.cards;
    const owner = this.players.find((p) => p.id === meld.owner);
    this.event('add', { playerId: player.id, meldId, cards: cards.map(clone) });
    this.addLog(`${player.name} ajoute ${cards.map(describe).join(', ')} ${owner.id === player.id ? 'à sa combinaison' : `à la combinaison de ${owner.name}`}.`);
    return this.checkOut(player);
  }

  swap(player, meldId, cardId) {
    this.requirePlay();
    if (!player.opened) throw gameError('Ouvre d’abord avant d’échanger un Joker.');
    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld) throw gameError('Combinaison introuvable.');
    const ji = meld.cards.findIndex(isJoker);
    if (ji < 0) throw gameError('Il n’y a pas de Joker dans cette combinaison.');
    const [card] = this.takeFromHand(player, [cardId]);
    if (!canReplaceJoker(meld, card)) {
      const j = meld.cards[ji];
      throw gameError(`Ce Joker remplace ${jokerText(meld, j)} : il faut cette carte pour l’échanger.`);
    }
    const joker = meld.cards[ji];
    const replaced = meld.type === 'run' ? { ...card, pos: joker.pos } : { ...card };
    const naturals = meld.cards.filter((c) => !isJoker(c)).concat(replaced);
    const r = analyzeMeld(naturals, { type: meld.type });
    if (!r.ok) throw gameError(`${r.error}.`);
    const before = clone(meld.cards);
    meld.cards = r.cards;
    player.hand = player.hand.filter((c) => c.id !== card.id);
    const { as, pos, ...free } = joker;
    player.hand.push(free);
    this.turn.swaps.push({ jokerId: free.id, meldId, cardId: card.id, before, after: meld.cards.map((c) => c.id).join() });
    this.event('swap', { playerId: player.id, meldId, card: clone(card), joker: clone(free) });
    this.addLog(`${player.name} échange le Joker contre ${describe(card)}.`);
    return undefined;
  }

  /** Remet la carte prise à la défausse (puis pioche au talon), ou annule un échange de Joker. */
  cancel(player, cardId) {
    this.requirePlay();
    const swap = this.turn.swaps.find((s) => s.jokerId === cardId);
    if (swap) {
      if (!player.hand.some((c) => c.id === cardId)) throw gameError('Le Joker est déjà reposé.');
      const meld = this.melds.find((m) => m.id === swap.meldId);
      const card = meld.cards.find((c) => c.id === swap.cardId);
      if (!card || meld.cards.map((c) => c.id).join() !== swap.after) {
        throw gameError('Échange impossible à annuler : la combinaison a changé depuis.');
      }
      meld.cards = swap.before;
      player.hand = player.hand.filter((c) => c.id !== cardId);
      const { pos, as, ...back } = card;
      player.hand.push(back);
      this.turn.swaps = this.turn.swaps.filter((s) => s !== swap);
      this.event('cancel', { playerId: player.id, kind: 'swap', meldId: meld.id, card: clone(back) });
      this.addLog(`${player.name} annule l’échange du Joker.`);
      return undefined;
    }
    if (this.turn.taken && this.turn.taken === cardId) {
      if (this.turn.laid) throw gameError('Tu as déjà posé ce tour-ci : la carte de la défausse doit être jouée.');
      const card = player.hand.find((c) => c.id === cardId);
      if (!card) throw gameError('La carte de la défausse est déjà posée.');
      player.hand = player.hand.filter((c) => c.id !== cardId);
      this.discard.push(card);
      this.turn.taken = null;
      this.turn.drawn = false;
      this.turn.from = null;
      this.turn.noDiscard = true;
      this.phase = 'draw';
      this.event('cancel', { playerId: player.id, kind: 'discard', card: clone(card) });
      this.addLog(`${player.name} repose ${describe(card)} sur la défausse.`);
      return undefined;
    }
    throw gameError('Rien à annuler.');
  }

  /** Cartes à jouer avant de pouvoir défausser : la carte prise à la défausse, les Jokers récupérés. */
  mustUse(player) {
    const ids = [];
    if (this.turn.taken && player.hand.some((c) => c.id === this.turn.taken)) ids.push(this.turn.taken);
    for (const s of this.turn.swaps) if (player.hand.some((c) => c.id === s.jokerId)) ids.push(s.jokerId);
    return ids;
  }

  discardCard(player, cardId) {
    this.requirePlay();
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) throw gameError('Cette carte n’est pas dans ta main.');
    const must = this.mustUse(player);
    if (must.length) {
      const c = player.hand.find((x) => x.id === must[0]);
      throw gameError(isJoker(c) && this.turn.swaps.some((s) => s.jokerId === c.id)
        ? 'Repose d’abord le Joker récupéré dans une combinaison.'
        : `Pose d’abord ${describe(c)}, prise à la défausse.`);
    }
    player.hand = player.hand.filter((c) => c.id !== cardId);
    this.discard.push(card);
    this.event('discard', { playerId: player.id, card: clone(card) });
    this.addLog(`${player.name} défausse ${describe(card)}.`);
    if (!player.hand.length) return this.endRound(player);
    if (!this.stock.length) this.replenish();
    this.currentIndex = (this.currentIndex + 1) % this.players.length;
    this.phase = 'draw';
    this.resetTurn();
    return undefined;
  }

  checkOut(player) {
    if (player.hand.length) return undefined;
    return this.endRound(player);
  }

  // ================================================================ fin de donne

  endRound(winner) {
    const rami = !!winner && !this.turn.openedBefore && this.turn.openedNow;
    const penalties = {};
    const hands = {};
    for (const p of this.players) {
      hands[p.id] = p.hand.map(clone);
      const base = p === winner ? 0 : handPenalty(p.hand);
      const points = rami ? base * 2 : base;
      penalties[p.id] = { base, points, cards: p.hand.length };
      p.total += points;
    }
    const totals = Object.fromEntries(this.players.map((p) => [p.id, p.total]));
    this.summary = {
      roundNumber: this.roundNumber, winnerId: winner ? winner.id : null, rami, blocked: !winner, penalties, hands, totals,
    };
    this.history.push({
      roundNumber: this.roundNumber, winnerId: winner ? winner.id : null, rami,
      penalties: Object.fromEntries(Object.entries(penalties).map(([id, x]) => [id, x.points])), totals,
    });
    if (winner) {
      this.event('out', { playerId: winner.id, rami });
      this.addLog(rami ? `Rami ! ${winner.name} pose tout d’un coup : pénalités doublées.` : `${winner.name} n’a plus de cartes et remporte la donne.`);
    } else {
      this.addLog('Plus aucune carte à piocher : la donne s’arrête.');
    }
    this.phase = this.roundNumber >= this.totalRounds ? 'gameOver' : 'roundEnd';
    this.event('roundEnd', { roundNumber: this.roundNumber, winnerId: winner ? winner.id : null, rami });
    if (this.phase === 'gameOver') {
      const best = Math.min(...this.players.map((p) => p.total));
      this.event('gameOver', { winnerIds: this.players.filter((p) => p.total === best).map((p) => p.id) });
      this.addLog(`Partie terminée : ${ranking(this.players).map((p) => `${p.name} ${p.total}`).join(', ')}.`);
    }
    return undefined;
  }

  nextRound() {
    if (this.phase === 'gameOver') throw gameError('La partie est terminée.');
    if (this.phase !== 'roundEnd') throw gameError('La donne est en cours.');
    this.startRound();
    return undefined;
  }

  // ================================================================ vues

  event(type, data) {
    this.events.push({ id: ++this.eventSeq, type, ...data });
    if (this.events.length > EVENT_SIZE) this.events.shift();
  }

  addLog(text) {
    this.log.push({ id: this.eventSeq, text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }

  getStateFor(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    const myTurn = !!me && this.current.id === playerId && (this.phase === 'draw' || this.phase === 'play');
    const ended = this.phase === 'roundEnd' || this.phase === 'gameOver';
    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      opening: this.opening,
      dealerId: this.players[this.dealerIndex].id,
      currentPlayerId: ended ? null : this.current.id,
      isMyTurn: myTurn,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, cardCount: p.hand.length, opened: p.opened, total: p.total,
      })),
      myHand: me ? me.hand.map(clone) : [],
      stockCount: this.stock.length,
      discardTop: this.discard.length ? clone(this.discard[this.discard.length - 1]) : null,
      discardCount: this.discard.length,
      melds: this.melds.map(clone),
      turn: {
        playerId: ended ? null : this.current.id,
        drawn: this.turn.drawn,
        from: this.turn.from,
        laid: this.turn.laid,
        openedNow: this.turn.openedNow,
        noDiscard: !!this.turn.noDiscard,
        // ce qui reste à poser avant de défausser : seulement pour le joueur concerné
        mustUse: myTurn ? this.mustUse(me) : [],
        taken: myTurn ? this.turn.taken : null,
        swappedJokers: myTurn ? this.turn.swaps.map((s) => s.jokerId) : [],
      },
      summary: ended ? clone(this.summary) : null,
      history: this.history.map(clone),
      events: this.events.map(clone),
      log: this.log.map(clone),
    };
  }

  isOver() {
    return this.phase === 'gameOver';
  }

  /** Le plus petit total gagne (ex aequo : tous gagnants). Score = points d'avance sur le dernier (plus c'est haut, mieux c'est). */
  getResult() {
    const best = Math.min(...this.players.map((p) => p.total));
    const worst = Math.max(...this.players.map((p) => p.total));
    const order = ranking(this.players);
    return {
      summary: `Rami en ${this.totalRounds} donnes (ouverture ${this.opening}) : ${order.map((p, i) => `${i + 1}. ${p.name} ${p.total} pts`).join(', ')}`,
      players: this.players.map((p) => ({
        playerId: p.id, result: p.total === best ? 'win' : 'loss', score: worst - p.total,
      })),
    };
  }
}

function ranking(players) {
  return [...players].sort((a, b) => a.total - b.total);
}

function meldText(m) {
  return m.cards.map((c) => (isJoker(c) ? 'Joker' : describe(c))).join(' ');
}

function jokerText(meld, j) {
  if (meld.type === 'run') return describe({ suit: j.as.suit, rank: j.as.rank });
  const r = { 1: 'un As', 11: 'un Valet', 12: 'une Dame', 13: 'un Roi' }[j.as.rank] ?? `un ${j.as.rank}`;
  return j.as.suit ? describe({ suit: j.as.suit, rank: j.as.rank }) : `${r} d’une couleur absente`;
}

module.exports = { Rami, HAND_SIZE, penalty };
