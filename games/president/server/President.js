'use strict';

const { RANKS, power, parseCard, buildDeck, shuffle, sortHand, rankName, rankArticle, describe } = require('./cards');

/**
 * Le Président (« Trouduc »), 3 à 8 joueurs, un jeu de 52 cartes.
 *
 * Une manche : distribution de tout le paquet (inégale si le compte ne tombe pas juste : les premiers servis, à
 * partir du voisin du donneur — l'hôte, puis le Trouduc —, ont une carte de plus), puis, dès la 2e manche, échange de cartes (phase 'exchange'), puis le jeu ('playing') :
 *  - l'entame pose 1 à 4 cartes de même valeur ; les suivants posent autant de cartes d'une valeur strictement
 *    plus forte, ou passent (passer n'exclut pas du pli : on peut rejouer quand son tour revient) ;
 *  - quand tous les autres ont passé à la suite, le dernier à avoir joué remporte le pli et entame ;
 *  - une combinaison que plus rien ne peut battre (les 2, ou les 3 en révolution) ferme aussitôt le pli ;
 *    option « Le 2 ferme » : un 2 se pose sur n'importe quelle combinaison (autant de 2 que de cartes) et ferme le
 *    pli, même pendant une révolution ;
 *  - option « Révolution » : un carré (4 cartes de même valeur) inverse l'ordre des valeurs jusqu'à la fin de la
 *    manche ; un autre carré le rétablit ;
 *  - celui qui vide sa main prend la place suivante ; la manche finit quand il ne reste qu'un joueur.
 * Titres pour la manche suivante : 1er Président, 2e Vice-président, dernier Trouduc, avant-dernier Vice-trouduc,
 * les autres Neutres (à 3 : Président, Neutre, Trouduc). Points : 4, 3, 2, 1, 0 (Neutre 2).
 * Échange : le Trouduc donne ses 2 meilleures cartes au Président, qui lui en rend 2 de son choix ; le
 * Vice-trouduc donne sa meilleure au Vice-président, qui lui en rend 1. Le Trouduc entame la manche.
 * La partie se joue en un nombre de manches fixé ; le plus gros total gagne.
 */

const TITLES = ['president', 'vice-president', 'neutre', 'vice-trouduc', 'trouduc'];
const TITLE_LABEL = {
  president: 'Président', 'vice-president': 'Vice-président', neutre: 'Neutre', 'vice-trouduc': 'Vice-trouduc', trouduc: 'Trouduc',
};
const POINTS = { president: 4, 'vice-president': 3, neutre: 2, 'vice-trouduc': 1, trouduc: 0 };
const LOG_SIZE = 60;
const EVENT_SIZE = 80;

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true;
  }
}

/** Titres selon la place d'arrivée (index 0 = premier sorti). */
function titlesFor(n) {
  if (n <= 3) return ['president', 'neutre', 'trouduc'].slice(0, n);
  return ['president', 'vice-president', ...Array(n - 4).fill('neutre'), 'vice-trouduc', 'trouduc'];
}

/** Règles d'ordre (pures) : utilisées par le moteur et reprises côté client pour expliquer les refus. */
function makeOrder({ revolution = false, twoCloses = true } = {}) {
  // le 2 qui ferme reste au-dessus de tout, même en révolution
  const value = (rank) => (twoCloses && rank === 2 ? 99 : revolution ? -power(rank) : power(rank));
  const canBeat = (rank, cur) => {
    if (twoCloses && cur === 2) return false;
    if (twoCloses && rank === 2) return true;
    return value(rank) > value(cur);
  };
  const unbeatable = (cur) => !RANKS.some((r) => canBeat(r, cur));
  return { value, canBeat, unbeatable };
}

class President {
  constructor({ players, options = {}, rng = Math.random, rig = null }) {
    if (players.length < 3 || players.length > 8) throw new GameError('Le Président se joue de 3 à 8 joueurs.');
    this.rng = rng;
    this.rig = rig; // tests : (manche, n) -> mains imposées (listes d'ids) ou null
    this.n = players.length;
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], score: 0, title: null, place: null }));
    this.totalRounds = Number(options.rounds) || 8;
    this.twoCloses = (options.twoCloses ?? 'ferme') !== 'normal';
    this.revolutionAllowed = options.revolution === 'oui';
    this.round = 0;
    this.history = [];
    this.summary = null;
    this.lastTrick = null;
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.startRound();
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    if (!this.player(playerId)) throw new GameError('Tu ne joues pas à cette table.');
    if (this.isOver()) throw new GameError('La partie est terminée.');
    switch (type) {
      case 'play':
        return this.play(playerId, payload.cardIds);
      case 'pass':
        return this.pass(playerId);
      case 'give':
        return this.giveBack(playerId, payload.cardIds);
      case 'next':
        return this.nextRound();
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
    const ranking = [...this.players].sort((a, b) => b.score - a.score);
    const places = ranking.map((p) => 1 + ranking.filter((o) => o.score > p.score).length);
    return {
      summary: `Classement : ${ranking.map((p, i) => `${places[i]}. ${p.name} (${p.score} pts)`).join(', ')}`,
      players: this.players.map((p) => ({ playerId: p.id, result: p.score === best ? 'win' : 'loss', score: p.score })),
    };
  }

  getStateFor(playerId) {
    const me = this.player(playerId);
    const current = this.phase === 'playing' ? this.players[this.currentIndex] : null;
    const isMyTurn = !!current && current.id === playerId;
    const top = this.pile.at(-1) ?? null;
    return {
      phase: this.phase,
      round: this.round,
      totalRounds: this.totalRounds,
      playerCount: this.n,
      options: { twoCloses: this.twoCloses, revolution: this.revolutionAllowed },
      revolution: this.revolution,
      currentPlayerId: current?.id ?? null,
      isMyTurn,
      canPass: isMyTurn && !!top,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        score: p.score,
        title: p.title,
        place: p.place,
        passed: this.passed.has(p.id),
      })),
      myHand: me ? sortHand(me.hand) : [],
      pile: this.pile.map((x) => ({ playerId: x.playerId, cards: x.cards, rank: x.rank, count: x.count })),
      trickNumber: this.trickNumber,
      lastTrick: this.lastTrick,
      finishOrder: [...this.finishOrder],
      exchange: this.exchangeFor(playerId),
      summary: this.summary,
      history: this.history,
      events: this.events.map((e) => this.eventFor(e, playerId)),
      log: this.log,
    };
  }

  // ================================================================ manche

  startRound() {
    this.round++;
    this.revolution = false;
    this.finishOrder = [];
    this.pile = [];
    this.passCount = 0;
    this.passed = new Set();
    this.trickNumber = 1;
    this.lastTrick = null;
    this.exchange = null;
    for (const p of this.players) {
      p.hand = [];
      p.place = null;
    }
    const titled = this.round > 1 && this.players.every((p) => p.title);
    const trouduc = titled ? this.players.findIndex((p) => p.title === 'trouduc') : -1;
    // le donneur (l'hôte, puis le Trouduc) sert d'abord son voisin : si le compte ne tombe pas juste,
    // les premiers servis ont une carte de plus, jamais le Trouduc (sauf s'il faut servir tout le monde)
    const start = ((trouduc >= 0 ? trouduc : 0) + 1) % this.n;
    this.deal(start);
    this.emit('deal', {
      round: this.round, startId: this.players[start].id,
      counts: Object.fromEntries(this.players.map((p) => [p.id, p.hand.length])),
    });
    this.addLog(`Manche ${this.round}/${this.totalRounds} : les cartes sont distribuées.`, 'round');

    if (titled) {
      this.startExchange();
      return;
    }
    // première manche : le joueur qui a le 3 de trèfle (sinon la plus petite carte) entame
    let leader = this.players.findIndex((p) => p.hand.some((c) => c.id === '3C'));
    if (leader < 0) leader = this.lowestHolder();
    this.startPlay(leader, true);
  }

  deal(start) {
    const rigged = this.rig?.(this.round, this.n);
    if (rigged) {
      rigged.forEach((ids, i) => { this.players[i].hand = ids.map(parseCard); });
      return;
    }
    const deck = shuffle(buildDeck(), this.rng);
    deck.forEach((card, i) => this.players[(start + i) % this.n].hand.push(card));
  }

  lowestHolder() {
    let best = 0;
    let low = Infinity;
    this.players.forEach((p, i) => {
      for (const c of p.hand) if (power(c.rank) < low) { low = power(c.rank); best = i; }
    });
    return best;
  }

  startPlay(leaderIndex, first = false) {
    this.phase = 'playing';
    this.currentIndex = leaderIndex;
    const leader = this.players[leaderIndex];
    this.emit('playStart', { leaderId: leader.id, first });
    this.addLog(first && this.round === 1 ? `${leader.name} a le 3 de trèfle et entame.` : `${leader.name} entame.`);
  }

  // ================================================================ échange de cartes

  startExchange() {
    const by = (title) => this.players.find((p) => p.title === title);
    const pairs = [[by('trouduc'), by('president'), 2]];
    if (this.n >= 4) pairs.push([by('vice-trouduc'), by('vice-president'), 1]);
    this.exchange = pairs.filter(([g, r]) => g && r).map(([giver, receiver, count]) => {
      // le donneur n'a pas le choix : ses meilleures cartes (ordre normal ; la révolution est finie)
      const best = sortHand(giver.hand).reverse().slice(0, count);
      giver.hand = giver.hand.filter((c) => !best.includes(c));
      receiver.hand.push(...best);
      this.emit('tribute', { from: giver.id, to: receiver.id, count, cards: best });
      this.addLog(`${giver.name} (${TITLE_LABEL[giver.title]}) donne ${count === 1 ? 'sa meilleure carte' : `ses ${count} meilleures cartes`} à ${receiver.name} (${TITLE_LABEL[receiver.title]}).`);
      return { giverId: giver.id, receiverId: receiver.id, count, given: best, returned: null };
    });
    if (!this.exchange.length) {
      this.startPlay(0);
      return;
    }
    this.phase = 'exchange';
    this.currentIndex = -1;
  }

  giveBack(playerId, cardIds) {
    if (this.phase !== 'exchange') throw new GameError('Ce n’est pas le moment de donner des cartes.');
    const pair = this.exchange.find((x) => x.receiverId === playerId);
    if (!pair) throw new GameError('Tu n’as pas de cartes à rendre.');
    if (pair.returned) throw new GameError('Tu as déjà rendu tes cartes.');
    const p = this.player(playerId);
    const cards = this.pickCards(p, cardIds);
    if (cards.length !== pair.count) throw new GameError(`Choisis ${pair.count === 1 ? '1 carte' : `${pair.count} cartes`} à rendre.`);
    const giver = this.player(pair.giverId);
    p.hand = p.hand.filter((c) => !cards.includes(c));
    giver.hand.push(...cards);
    pair.returned = cards;
    this.emit('return', { from: playerId, to: giver.id, count: cards.length, cards });
    this.addLog(`${p.name} rend ${cards.length === 1 ? 'une carte' : `${cards.length} cartes`} à ${giver.name}.`);
    if (this.exchange.every((x) => x.returned)) {
      this.startPlay(this.players.findIndex((x) => x.title === 'trouduc'));
    }
  }

  /** Ce que chacun voit de l'échange : qui donne à qui (public) ; les cartes, seulement les deux joueurs concernés. */
  exchangeFor(playerId) {
    if (!this.exchange) return null;
    const pairs = this.exchange.map((x) => ({ giverId: x.giverId, receiverId: x.receiverId, count: x.count, done: !!x.returned }));
    const mine = this.exchange.find((x) => x.giverId === playerId || x.receiverId === playerId);
    let me = null;
    if (mine?.receiverId === playerId) {
      me = { role: 'receiver', otherId: mine.giverId, count: mine.count, received: mine.given, gave: mine.returned };
    } else if (mine) {
      me = { role: 'giver', otherId: mine.receiverId, count: mine.count, gave: mine.given, received: mine.returned };
    }
    return { pairs, me };
  }

  // ================================================================ jeu

  order() {
    return makeOrder({ revolution: this.revolution, twoCloses: this.twoCloses });
  }

  play(playerId, cardIds) {
    this.assertTurn(playerId);
    const p = this.player(playerId);
    const cards = this.pickCards(p, cardIds);
    if (!cards.length || cards.length > 4) throw new GameError('Choisis de 1 à 4 cartes de même valeur.');
    const rank = cards[0].rank;
    if (cards.some((c) => c.rank !== rank)) throw new GameError('Les cartes posées ensemble doivent être de même valeur.');
    const top = this.pile.at(-1);
    if (top) {
      if (cards.length !== top.count) throw new GameError(`Il faut poser ${top.count === 1 ? 'une seule carte' : `${top.count} cartes`}, comme l’entame.`);
      if (!this.order().canBeat(rank, top.rank)) throw new GameError(needText(top, this.revolution, this.twoCloses));
    }

    p.hand = p.hand.filter((c) => !cards.includes(c));
    const sorted = sortHand(cards);
    this.pile.push({ playerId, cards: sorted, rank, count: sorted.length });
    this.passed.delete(playerId);
    this.passCount = 0;
    this.emit('play', { playerId, cards: sorted, rank, count: sorted.length });
    this.addLog(`${p.name} pose ${describe(sorted)}.`);

    if (this.revolutionAllowed && cards.length === 4) {
      this.revolution = !this.revolution;
      this.emit('revolution', { playerId, on: this.revolution });
      this.addLog(this.revolution ? `Révolution de ${p.name} : l’ordre des cartes s’inverse jusqu’à la fin de la manche.` : `Contre-révolution de ${p.name} : l’ordre normal revient.`, 'alert');
    }
    if (!p.hand.length) this.finish(p);

    const active = this.activePlayers();
    if (active.length <= 1) {
      this.endRound(active[0]);
      return;
    }
    if (this.twoCloses && rank === 2) {
      this.endTrick(playerId, 'two');
      return;
    }
    if (this.order().unbeatable(rank)) {
      this.endTrick(playerId, 'top');
      return;
    }
    this.currentIndex = this.nextActive(this.currentIndex);
  }

  pass(playerId) {
    this.assertTurn(playerId);
    const top = this.pile.at(-1);
    if (!top) throw new GameError('Tu entames : pose une combinaison.');
    const p = this.player(playerId);
    this.passCount++;
    this.passed.add(playerId);
    this.emit('pass', { playerId });
    this.addLog(`${p.name} passe.`);
    const lastActive = this.player(top.playerId).hand.length > 0;
    const need = this.activePlayers().length - (lastActive ? 1 : 0);
    if (this.passCount >= need) {
      this.endTrick(top.playerId, 'passes');
      return;
    }
    this.currentIndex = this.nextActive(this.currentIndex);
  }

  finish(p) {
    this.finishOrder.push(p.id);
    p.place = this.finishOrder.length;
    this.emit('finish', { playerId: p.id, place: p.place });
    this.addLog(`${p.name} n’a plus de cartes : ${p.place}${p.place === 1 ? 'er' : 'e'}.`, 'good');
  }

  endTrick(winnerId, reason) {
    const winner = this.player(winnerId);
    this.lastTrick = { number: this.trickNumber, winnerId, reason, plays: this.pile };
    this.emit('trick', { winnerId, reason, number: this.trickNumber });
    const why = reason === 'two' ? ' (le 2 ferme)' : reason === 'top' ? ' (imbattable)' : '';
    this.addLog(`${winner.name} remporte le pli${why}.`);
    this.pile = [];
    this.passCount = 0;
    this.passed = new Set();
    this.trickNumber++;
    const wi = this.indexOf(winnerId);
    this.currentIndex = winner.hand.length ? wi : this.nextActive(wi);
  }

  endRound(lastPlayer) {
    if (lastPlayer) this.finish(lastPlayer);
    if (this.pile.length) {
      this.lastTrick = { number: this.trickNumber, winnerId: this.pile.at(-1).playerId, reason: 'end', plays: this.pile };
      this.pile = [];
    }
    this.passed = new Set();
    const titles = titlesFor(this.n);
    const points = {};
    const byPlayer = {};
    this.finishOrder.forEach((id, i) => {
      const p = this.player(id);
      p.title = titles[i];
      byPlayer[id] = titles[i];
      points[id] = POINTS[titles[i]];
      p.score += points[id];
    });
    this.summary = {
      round: this.round,
      order: [...this.finishOrder],
      titles: byPlayer,
      points,
      totals: Object.fromEntries(this.players.map((p) => [p.id, p.score])),
    };
    this.history.push(this.summary);
    this.emit('roundEnd', { round: this.round, order: [...this.finishOrder] });
    const first = this.player(this.finishOrder[0]);
    const last = this.player(this.finishOrder.at(-1));
    this.addLog(`Fin de la manche ${this.round} : ${first.name} est Président, ${last.name} est Trouduc.`, 'round');
    if (this.round >= this.totalRounds) {
      this.phase = 'gameOver';
      this.currentIndex = -1;
      this.emit('gameOver', {});
      const best = Math.max(...this.players.map((p) => p.score));
      const winners = this.players.filter((p) => p.score === best).map((p) => p.name);
      this.addLog(`Partie terminée : ${winners.join(' et ')} ${winners.length > 1 ? 'gagnent' : 'gagne'} avec ${best} points.`, 'good');
    } else {
      this.phase = 'roundEnd';
      this.currentIndex = -1;
    }
  }

  nextRound() {
    if (this.phase !== 'roundEnd') throw new GameError('La manche n’est pas terminée.');
    this.startRound();
  }

  // ================================================================ utilitaires

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  indexOf(id) {
    return this.players.findIndex((p) => p.id === id);
  }

  activePlayers() {
    return this.players.filter((p) => p.hand.length > 0);
  }

  nextActive(i) {
    for (let k = 1; k <= this.n; k++) {
      const j = (i + k) % this.n;
      if (this.players[j].hand.length) return j;
    }
    return -1;
  }

  /** Cartes de la main désignées par leurs ids (sans doublon), ou erreur. */
  pickCards(p, cardIds) {
    if (!Array.isArray(cardIds) || !cardIds.length) throw new GameError('Choisis au moins une carte.');
    if (new Set(cardIds).size !== cardIds.length) throw new GameError('Une même carte choisie deux fois.');
    const cards = cardIds.map((id) => p.hand.find((c) => c.id === id));
    if (cards.some((c) => !c)) throw new GameError('Ces cartes ne sont pas dans ta main.');
    return cards;
  }

  assertTurn(playerId) {
    if (this.phase !== 'playing') throw new GameError('Ce n’est pas le moment de jouer.');
    if (this.players[this.currentIndex]?.id !== playerId) throw new GameError('Ce n’est pas ton tour.');
  }

  /** Les cartes d'un échange ne sont montrées qu'aux deux joueurs concernés. */
  eventFor(e, playerId) {
    if ((e.type === 'tribute' || e.type === 'return') && e.from !== playerId && e.to !== playerId) {
      const { cards, ...rest } = e;
      return rest;
    }
    return e;
  }

  emit(type, data) {
    this.events.push({ id: ++this.eventSeq, type, ...data });
    if (this.events.length > EVENT_SIZE) this.events.shift();
  }

  addLog(text, tone) {
    this.log.push(tone ? { text, tone } : { text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }
}

/** « Il faut 2 cartes plus fortes que les 9 » (ou plus basses, en révolution). */
function needText(top, revolution, twoCloses) {
  const what = top.count === 1 ? 'une carte' : `${top.count} cartes`;
  const adj = revolution ? (top.count === 1 ? 'plus basse' : 'plus basses') : (top.count === 1 ? 'plus forte' : 'plus fortes');
  const extra = revolution && twoCloses && top.rank !== 2 ? (top.count === 1 ? ' (ou un 2)' : ' (ou des 2)') : '';
  return `${revolution ? 'Révolution : il' : 'Il'} faut ${what} ${adj} que ${rankArticle(top.rank, top.count)}${extra}.`;
}

module.exports = { President, GameError, makeOrder, titlesFor, needText, TITLES, TITLE_LABEL, POINTS, rankName };
