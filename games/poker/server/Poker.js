'use strict';

const { buildDeck, shuffle, parseCard, cardLabel } = require('./cards');
const { evaluate, compareHands, kickerNote } = require('./evaluator');

/**
 * Texas Hold'em No Limit, en tournoi « freezeout » (2 à 8 joueurs) : tout le monde part avec le même tapis,
 * les blindes montent toutes les N mains, un joueur sans jetons quitte la table, le dernier qui en a gagne.
 *
 * Une main : blindes -> préflop -> flop -> turn -> river -> abattage (ou victoire sans abattage si tous les
 * autres se couchent). Quand plus personne ne peut miser (tapis), les mains restantes sont retournées et le
 * tableau est déroulé jusqu'à la river. Phases : 'betting' (une main en cours) -> 'handEnd' (résultat affiché,
 * n'importe quel joueur encore en jeu lance la main suivante) -> ... -> 'gameOver'.
 *
 * Mises : une relance s'exprime en montant total « relancer à ». Mise minimum = grosse blinde ; relance
 * minimum = taille de la dernière relance complète. Un tapis inférieur à une relance complète ne rouvre pas
 * les enchères pour qui a déjà parlé (sauf si, depuis, le cumul atteint une relance complète).
 */

/** Niveaux de blindes (petite, grosse), puis doublement à partir de 1 000/2 000. Pas d'ante. */
const BLIND_LEVELS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000], [1000, 2000]];
/** Nombre de mains par niveau selon l'option « Montée des blindes ». */
const SPEEDS = { rapide: 5, normale: 10, lente: 15 };
const DEFAULT_STACK = 2000;
const EVENT_SIZE = 80;
const LOG_SIZE = 200;
const STREET_NAME = { flop: 'Flop', turn: 'Turn', river: 'River' };
const NEXT_STREET = { preflop: 'flop', flop: 'turn', turn: 'river' };

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true;
  }
}
const fail = (message) => {
  throw new GameError(message);
};

/** 1500 -> « 1 500 » (espace fine insécable). */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');

function blindsAt(level) {
  if (level < BLIND_LEVELS.length) return BLIND_LEVELS[level];
  const k = level - (BLIND_LEVELS.length - 1);
  const [sb, bb] = BLIND_LEVELS.at(-1);
  return [sb * 2 ** k, bb * 2 ** k];
}

const cardsText = (cards) => cards.map(cardLabel).join(' ');

class Poker {
  /**
   * @param {object} o
   * @param {{ id, name }[]} o.players     ordre des places autour de la table (sens des aiguilles d'une montre)
   * @param {{ stack?, blinds? }} o.options tapis de départ, vitesse de montée des blindes ('rapide'|'normale'|'lente')
   * @param {() => number} o.rng          hasard injectable (tests)
   * @param {number[]} o.stacks           (tests) tapis de départ par joueur
   * @param {(handNumber) => ({ hands?: { [playerId]: string[] }, board?: string[] } | null)} o.rig
   *        (tests) cartes imposées pour une main ; le reste vient du paquet mélangé
   */
  constructor({ players, options = {}, rng = Math.random, stacks = null, rig = null }) {
    if (!players || players.length < 2 || players.length > 8) fail('Le poker se joue de 2 à 8 joueurs.');
    this.rng = rng;
    this.rig = rig;
    this.n = players.length;
    this.startStack = Number.isInteger(options.stack) && options.stack > 0 ? options.stack : DEFAULT_STACK;
    this.speed = SPEEDS[options.blinds] ? options.blinds : 'normale';
    this.handsPerLevel = SPEEDS[this.speed];
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      seat: i,
      chips: stacks?.[i] ?? this.startStack,
      cards: [],
      inHand: false, // a reçu des cartes dans la main en cours (ou la dernière jouée)
      folded: false,
      allIn: false,
      bet: 0, // misé sur le tour d'enchères en cours
      total: 0, // misé sur toute la main
      acted: null, // mise en cours au moment de sa dernière parole sur ce tour (null : n'a pas encore parlé)
      lastAction: null,
      shown: false, // cartes retournées (tapis ou abattage)
      out: false, // éliminé
      place: null,
      startChips: 0,
    }));
    this.handNumber = 0;
    this.level = 0;
    this.buttonIndex = this.n - 1; // première main : le bouton est à la dernière place, la première joue la petite blinde
    this.sbIndex = -1;
    this.bbIndex = -1;
    this.board = [];
    this.boardPlan = [];
    this.deck = [];
    this.street = null;
    this.phase = 'betting';
    this.currentIndex = -1;
    this.currentBet = 0;
    this.minRaise = 0;
    this.lastHand = null;
    this.eliminated = []; // ordre d'élimination : [{ playerId, place, handNumber }]
    this.winnerId = null;
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.startHand(true);
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload = {}) {
    if (this.isOver()) fail('La partie est terminée.');
    const p = this.player(playerId);
    if (!p) fail('Tu ne joues pas à cette table.');
    if (type === 'next') return this.nextHand(p);
    if (this.phase !== 'betting') fail('La main est terminée : lance la suivante.');
    if (this.players[this.currentIndex] !== p) fail('Ce n’est pas ton tour.');
    switch (type) {
      case 'fold':
        return this.fold(p);
      case 'check':
        return this.check(p);
      case 'call':
        return this.call(p);
      case 'bet':
      case 'raise':
        return this.raise(p, payload?.amount);
      case 'allin':
        return this.allIn(p);
      default:
        return fail(`Action inconnue : ${type}`);
    }
  }

  isOver() {
    return this.phase === 'gameOver';
  }

  getResult() {
    if (!this.isOver()) return null;
    const winner = this.player(this.winnerId);
    const others = [...this.eliminated].sort((a, b) => a.place - b.place);
    const places = others.slice(0, 3).map((e) => `${e.place}e ${this.player(e.playerId).name}`);
    return {
      summary: `${winner.name} remporte le tournoi (${this.n} joueurs, ${this.handNumber} main${this.handNumber > 1 ? 's' : ''})${places.length ? ` · ${places.join(' · ')}` : ''}`,
      players: this.players.map((p) => ({
        playerId: p.id,
        result: p.id === this.winnerId ? 'win' : 'loss',
        score: this.n - p.place, // adversaires battus (classement final)
      })),
    };
  }

  getStateFor(playerId) {
    const me = this.player(playerId);
    const current = this.phase === 'betting' ? this.players[this.currentIndex] : null;
    const isMyTurn = !!me && current === me;
    const [nsb, nbb] = blindsAt(this.level + 1);
    const collected = this.phase === 'betting' ? this.computePots((p) => p.total - p.bet) : [];
    const potTotal = this.players.reduce((s, p) => s + (p.inHand && this.phase === 'betting' ? p.total : 0), 0);
    return {
      phase: this.phase,
      street: this.street,
      handNumber: this.handNumber,
      playerCount: this.n,
      startStack: this.startStack,
      speed: this.speed,
      blinds: {
        level: this.level + 1,
        sb: this.sb,
        bb: this.bb,
        next: { sb: nsb, bb: nbb },
        handsPerLevel: this.handsPerLevel,
        handsLeft: this.handsPerLevel - ((this.handNumber - 1) % this.handsPerLevel) - 1, // mains après celle-ci
      },
      buttonId: this.players[this.buttonIndex]?.id ?? null,
      sbId: this.players[this.sbIndex]?.id ?? null,
      bbId: this.players[this.bbIndex]?.id ?? null,
      currentPlayerId: current?.id ?? null,
      isMyTurn,
      board: [...this.board],
      pots: collected,
      pot: collected.reduce((s, x) => s + x.amount, 0),
      potTotal,
      currentBet: this.phase === 'betting' ? this.currentBet : 0,
      minRaise: this.minRaise,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        chips: p.chips,
        bet: p.bet,
        committed: p.total,
        inHand: p.inHand,
        folded: p.folded,
        allIn: p.allIn,
        out: p.out,
        place: p.place,
        hasCards: p.inHand && !p.folded && p.cards.length > 0,
        // les cartes d'un autre joueur ne quittent le serveur qu'une fois retournées (tapis ou abattage)
        cards: p.inHand && (p === me || p.shown) ? [...p.cards] : null,
        shown: p.shown,
        lastAction: p.lastAction,
      })),
      me: me ? this.privateView(me, isMyTurn) : null,
      lastHand: this.lastHand,
      eliminated: this.eliminated,
      winnerId: this.winnerId,
      canNext: this.phase === 'handEnd' && !!me && !me.out,
      events: this.events,
      log: this.log,
    };
  }

  // ================================================================ déroulement d'une main

  startHand(first = false) {
    this.handNumber++;
    const level = Math.floor((this.handNumber - 1) / this.handsPerLevel);
    const levelUp = level !== this.level;
    this.level = level;
    [this.sb, this.bb] = blindsAt(level);
    for (const p of this.players) {
      Object.assign(p, {
        cards: [], inHand: !p.out, folded: false, allIn: false, bet: 0, total: 0, acted: null, lastAction: null, shown: false, startChips: p.chips,
      });
    }
    if (!first) this.buttonIndex = this.nextIndex(this.buttonIndex, (p) => !p.out);
    const seated = this.players.filter((p) => p.inHand);
    if (seated.length === 2) {
      // tête-à-tête : le bouton paie la petite blinde, parle en premier avant le flop et en dernier ensuite
      this.sbIndex = this.buttonIndex;
      this.bbIndex = this.nextIndex(this.buttonIndex, (p) => p.inHand);
    } else {
      this.sbIndex = this.nextIndex(this.buttonIndex, (p) => p.inHand);
      this.bbIndex = this.nextIndex(this.sbIndex, (p) => p.inHand);
    }
    this.phase = 'betting';
    this.street = 'preflop';
    this.board = [];
    this.dealCards();

    if (levelUp) {
      this.event({ type: 'level', level: level + 1, sb: this.sb, bb: this.bb });
      this.addLog(`Les blindes passent à ${fmt(this.sb)}/${fmt(this.bb)} (niveau ${level + 1})`, 'alert');
    }
    const sbP = this.players[this.sbIndex];
    const bbP = this.players[this.bbIndex];
    const sbPut = this.commit(sbP, this.sb);
    const bbPut = this.commit(bbP, this.bb);
    sbP.lastAction = { type: sbP.allIn ? 'allin' : 'sb', amount: sbP.bet };
    bbP.lastAction = { type: bbP.allIn ? 'allin' : 'bb', amount: bbP.bet };
    // même si la grosse blinde est à tapis pour moins, il faut suivre la grosse blinde entière
    this.currentBet = this.bb;
    this.minRaise = this.bb;
    this.event({
      type: 'hand',
      handNumber: this.handNumber,
      buttonId: this.players[this.buttonIndex].id,
      sbId: sbP.id,
      bbId: bbP.id,
      sb: sbPut,
      bb: bbPut,
      players: seated.map((p) => p.id),
    });
    this.addLog(`Main ${this.handNumber} · blindes ${fmt(this.sb)}/${fmt(this.bb)} · bouton : ${this.players[this.buttonIndex].name}`, 'hand');
    this.addLog(`${sbP.name} paie la petite blinde (${fmt(sbPut)}), ${bbP.name} la grosse (${fmt(bbPut)})`);
    const first2 = seated.length === 2 ? this.sbIndex : this.nextIndex(this.bbIndex, (p) => p.inHand);
    this.advance(first2, true);
  }

  /** Mélange, cartes imposées éventuelles (tests), puis 2 cartes à chacun en commençant à gauche du bouton. */
  dealCards() {
    const rigged = this.rig?.(this.handNumber, this.players) ?? null;
    const fixed = new Set([...Object.values(rigged?.hands ?? {}).flat(), ...(rigged?.board ?? [])]);
    this.deck = shuffle(buildDeck(), this.rng).filter((c) => !fixed.has(c.id));
    this.boardPlan = (rigged?.board ?? []).map(parseCard);
    const order = [];
    for (let i = 1; i <= this.n; i++) {
      const p = this.players[(this.buttonIndex + i) % this.n];
      if (p.inHand) order.push(p);
    }
    for (const p of order) {
      const ids = rigged?.hands?.[p.id];
      if (ids) p.cards = ids.map(parseCard);
    }
    for (let round = 0; round < 2; round++) {
      for (const p of order) if (p.cards.length < 2) p.cards.push(this.deck.pop());
    }
  }

  /** Cherche le prochain joueur qui doit parler, à partir de `from` ; sinon le tour d'enchères est fini. */
  advance(from, inclusive = false) {
    if (this.live().length <= 1) return this.winUncontested();
    for (let i = inclusive ? 0 : 1; i <= this.n; i++) {
      const idx = (from + i) % this.n;
      if (this.needsAction(this.players[idx])) {
        this.currentIndex = idx;
        return undefined;
      }
    }
    return this.endStreet();
  }

  endStreet() {
    this.currentIndex = -1;
    this.returnUncalled();
    this.collectBets();
    const live = this.live();
    if (this.street === 'river') return this.showdown();
    if (live.filter((p) => !p.allIn).length <= 1) {
      // plus d'enchères possibles : on retourne les mains et on déroule le tableau
      for (const p of live) p.shown = true;
      this.event({ type: 'reveal', hands: live.map((p) => ({ playerId: p.id, cards: [...p.cards] })) });
      this.addLog(`Tapis : ${live.map((p) => `${p.name} montre ${cardsText(p.cards)}`).join(', ')}`);
      while (this.street !== 'river') this.dealStreet();
      return this.showdown();
    }
    this.dealStreet();
    this.currentBet = 0;
    this.minRaise = this.bb;
    for (const p of this.players) p.acted = null;
    return this.advance(this.buttonIndex);
  }

  dealStreet() {
    const next = NEXT_STREET[this.street];
    if (this.deck.length) this.deck.pop(); // carte brûlée
    const cards = [];
    for (let k = 0; k < (next === 'flop' ? 3 : 1); k++) cards.push(this.boardPlan.length ? this.boardPlan.shift() : this.deck.pop());
    this.board.push(...cards);
    this.street = next;
    for (const p of this.players) {
      if (p.lastAction && !['fold', 'allin'].includes(p.lastAction.type)) p.lastAction = null;
    }
    this.event({ type: 'street', street: next, cards });
    this.addLog(`${STREET_NAME[next]} : ${cardsText(cards)}`, 'street');
  }

  /** La part d'une mise que personne n'a suivie revient à son auteur. */
  returnUncalled() {
    const inHand = this.players.filter((p) => p.inHand);
    const max = Math.max(0, ...inHand.map((p) => p.bet));
    const top = inHand.filter((p) => p.bet === max);
    if (max <= 0 || top.length !== 1) return;
    const p = top[0];
    const second = Math.max(0, ...inHand.filter((o) => o !== p).map((o) => o.bet));
    const excess = max - second;
    if (excess <= 0) return;
    p.bet -= excess;
    p.total -= excess;
    p.chips += excess;
    if (p.chips > 0) p.allIn = false;
    this.event({ type: 'uncalled', playerId: p.id, amount: excess });
    this.addLog(`${p.name} récupère ${fmt(excess)} (mise non suivie)`);
  }

  /** Fin d'un tour d'enchères : les mises rejoignent le pot. */
  collectBets() {
    const bets = this.players.filter((p) => p.bet > 0).map((p) => ({ playerId: p.id, amount: p.bet }));
    for (const p of this.players) {
      p.bet = 0;
      p.acted = null;
    }
    if (bets.length) this.event({ type: 'collect', street: this.street, bets, pots: this.computePots() });
  }

  winUncontested() {
    this.currentIndex = -1;
    this.returnUncalled();
    this.collectBets();
    const winner = this.live()[0];
    const amount = this.players.reduce((s, p) => s + (p.inHand ? p.total : 0), 0);
    winner.chips += amount;
    const pot = { amount, eligible: [winner.id], winners: [winner.id], shares: { [winner.id]: amount }, description: null, kicker: null };
    this.lastHand = {
      handNumber: this.handNumber, showdown: false, board: [...this.board], hands: [], pots: [pot], awards: { [winner.id]: amount }, uncontested: winner.id, eliminated: [],
    };
    this.event({ type: 'win', uncontested: true, pots: [pot], awards: { [winner.id]: amount } });
    this.addLog(`${winner.name} remporte ${fmt(amount)} sans abattage`, 'good');
    return this.finishHand();
  }

  showdown() {
    this.currentIndex = -1;
    this.street = 'showdown';
    const live = this.live();
    for (const p of live) p.shown = true;
    const evals = new Map(live.map((p) => [p.id, evaluate([...p.cards, ...this.board])]));
    const awards = {};
    const pots = this.computePots().map((pot) => {
      const contenders = pot.eligible.map((id) => this.player(id));
      let winners = contenders;
      if (contenders.length > 1) {
        const best = contenders.reduce((b, p) => (compareHands(evals.get(p.id), evals.get(b.id)) > 0 ? p : b));
        winners = contenders.filter((p) => compareHands(evals.get(p.id), evals.get(best.id)) === 0);
      }
      const ordered = this.clockwiseFromButton(winners);
      const share = Math.floor(pot.amount / ordered.length);
      let odd = pot.amount - share * ordered.length; // jetons indivisibles : au premier gagnant à gauche du bouton
      const shares = {};
      for (const p of ordered) {
        shares[p.id] = share + (odd > 0 ? 1 : 0);
        odd--;
        awards[p.id] = (awards[p.id] ?? 0) + shares[p.id];
      }
      const winEval = evals.get(ordered[0].id);
      const losers = contenders.filter((p) => !winners.includes(p)).map((p) => evals.get(p.id));
      const runnerUp = losers.reduce((b, e) => (!b || compareHands(e, b) > 0 ? e : b), null);
      return {
        amount: pot.amount,
        eligible: pot.eligible,
        winners: ordered.map((p) => p.id),
        shares,
        description: contenders.length > 1 ? winEval.description : null,
        kicker: runnerUp ? kickerNote(winEval, runnerUp) : null,
      };
    });
    for (const [id, amount] of Object.entries(awards)) this.player(id).chips += amount;
    const hands = this.clockwiseFromButton(live).map((p) => {
      const e = evals.get(p.id);
      return { playerId: p.id, cards: [...p.cards], category: e.category, name: e.name, description: e.description, best: e.cards.map((c) => c.id) };
    });
    this.lastHand = {
      handNumber: this.handNumber, showdown: true, board: [...this.board], hands, pots, awards, uncontested: null, eliminated: [],
    };
    this.event({ type: 'showdown', hands });
    this.event({ type: 'win', uncontested: false, pots, awards });
    for (const h of hands) this.addLog(`${this.player(h.playerId).name} montre ${cardsText(h.cards)} : ${h.description}`);
    pots.forEach((pot, i) => {
      const names = pot.winners.map((id) => this.player(id).name);
      const label = pots.length > 1 ? (i === 0 ? 'le pot principal' : `le pot annexe${pots.length > 2 ? ` ${i}` : ''}`) : 'le pot';
      const how = pot.description ? ` avec ${pot.description}${pot.kicker ? ` (${pot.kicker})` : ''}` : '';
      const text = names.length > 1
        ? `${names.join(' et ')} se partagent ${label} (${fmt(pot.amount)})${how}`
        : `${names[0]} remporte ${label} (${fmt(pot.amount)})${how}`;
      this.addLog(text, 'good');
    });
    return this.finishHand();
  }

  finishHand() {
    this.phase = 'handEnd';
    this.currentIndex = -1;
    const busted = this.players.filter((p) => p.inHand && !p.out && p.chips === 0);
    if (busted.length) {
      const remaining = this.players.filter((p) => !p.out && p.chips > 0).length;
      // éliminés dans la même main : le plus gros tapis de départ finit devant ; à égalité, même place
      busted.sort((a, b) => b.startChips - a.startChips);
      busted.forEach((p, i) => {
        p.place = i > 0 && p.startChips === busted[i - 1].startChips ? busted[i - 1].place : remaining + 1 + i;
        p.out = true;
        this.eliminated.push({ playerId: p.id, place: p.place, handNumber: this.handNumber });
        this.addLog(`${p.name} quitte la table (${p.place}e place)`, 'alert');
      });
      this.lastHand.eliminated = busted.map((p) => ({ playerId: p.id, place: p.place }));
      this.event({ type: 'eliminated', players: this.lastHand.eliminated });
    }
    const left = this.players.filter((p) => !p.out);
    if (left.length === 1) {
      const w = left[0];
      w.place = 1;
      this.winnerId = w.id;
      this.phase = 'gameOver';
      this.event({ type: 'gameOver', winnerId: w.id });
      this.addLog(`${w.name} remporte le tournoi`, 'good');
    }
  }

  nextHand(p) {
    if (this.phase !== 'handEnd') fail('La main est encore en cours.');
    if (p.out) fail('Tu as quitté la table : les joueurs encore en jeu lancent la main suivante.');
    this.startHand(false);
  }

  // ================================================================ actions

  fold(p) {
    p.folded = true;
    p.lastAction = { type: 'fold' };
    this.event({ type: 'action', playerId: p.id, action: 'fold' });
    this.addLog(`${p.name} se couche`);
    this.advance(this.currentIndex);
  }

  check(p) {
    const target = this.callTarget(p);
    if (p.bet < target) fail(`Impossible de dire parole : il y a ${fmt(target - p.bet)} à suivre.`);
    p.acted = this.currentBet;
    p.lastAction = { type: 'check' };
    this.event({ type: 'action', playerId: p.id, action: 'check' });
    this.addLog(`${p.name} dit parole`);
    this.advance(this.currentIndex);
  }

  call(p) {
    const target = this.callTarget(p);
    if (p.bet >= target) fail('Rien à suivre : dis parole.');
    const put = this.commit(p, target - p.bet);
    p.acted = this.currentBet;
    p.lastAction = { type: p.allIn ? 'allin' : 'call', amount: p.bet };
    this.event({ type: 'action', playerId: p.id, action: 'call', amount: p.bet, put, allIn: p.allIn });
    this.addLog(p.allIn ? `${p.name} suit à tapis (${fmt(p.bet)})` : `${p.name} suit ${fmt(p.bet)}`);
    this.advance(this.currentIndex);
  }

  raise(p, value) {
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount <= 0) fail('Montant invalide.');
    const max = p.bet + p.chips;
    if (amount > max) fail(`Tu peux miser au plus ${fmt(max)}.`);
    if (amount <= this.currentBet) fail(`Pour relancer, mise plus de ${fmt(this.currentBet)}.`);
    const blocked = this.raiseBlock(p);
    if (blocked) fail(blocked);
    const minTo = this.currentBet + this.minRaise;
    if (amount < max && amount < minTo) fail(this.currentBet ? `Relance minimum : à ${fmt(minTo)}.` : `Mise minimum : ${fmt(minTo)}.`);
    this.applyRaise(p, amount);
  }

  allIn(p) {
    if (p.chips <= 0) fail('Tu es déjà à tapis.');
    const max = p.bet + p.chips;
    if (max <= this.callTarget(p)) return this.call(p);
    const blocked = this.raiseBlock(p);
    if (blocked) fail(blocked);
    return this.applyRaise(p, max);
  }

  applyRaise(p, amount) {
    const kind = this.currentBet === 0 ? 'bet' : 'raise';
    const increment = amount - this.currentBet;
    const full = increment >= this.minRaise;
    const put = this.commit(p, amount - p.bet);
    if (full) this.minRaise = increment; // un tapis trop court ne change pas la relance minimum
    this.currentBet = amount;
    p.acted = amount;
    p.lastAction = { type: p.allIn ? 'allin' : kind, amount };
    this.event({ type: 'action', playerId: p.id, action: kind, amount, put, allIn: p.allIn, full });
    if (p.allIn) this.addLog(`${p.name} fait tapis (${kind === 'bet' ? 'mise' : 'relance à'} ${fmt(amount)})`);
    else this.addLog(kind === 'bet' ? `${p.name} mise ${fmt(amount)}` : `${p.name} relance à ${fmt(amount)}`);
    this.advance(this.currentIndex);
  }

  // ================================================================ règles des enchères

  live() {
    return this.players.filter((p) => p.inHand && !p.folded);
  }

  /** Ce que p doit atteindre pour suivre (plafonné au plus gros tapis adverse si tous les autres sont à tapis). */
  callTarget(p) {
    const others = this.live().filter((o) => o !== p);
    if (others.length && others.every((o) => o.allIn)) return Math.min(this.currentBet, Math.max(...others.map((o) => o.bet)));
    return this.currentBet;
  }

  needsAction(p) {
    if (!p.inHand || p.folded || p.allIn) return false;
    const others = this.live().filter((o) => o !== p);
    if (!others.length) return false;
    if (others.every((o) => o.allIn)) return p.bet < this.callTarget(p);
    return p.acted === null || p.bet < this.currentBet;
  }

  /** Pourquoi p ne peut pas relancer (null s'il le peut). */
  raiseBlock(p) {
    const others = this.live().filter((o) => o !== p);
    if (others.every((o) => o.allIn)) return 'Tes adversaires sont tous à tapis : suis ou couche-toi.';
    if (p.chips + p.bet <= this.currentBet) return 'Tu n’as pas assez de jetons pour relancer.';
    if (p.acted !== null && this.currentBet - p.acted < this.minRaise) {
      return 'Relance fermée : le tapis adverse était plus petit qu’une relance complète. Suis ou couche-toi.';
    }
    return null;
  }

  /** Met des jetons devant p (pas plus que son tapis). */
  commit(p, amount) {
    const put = Math.max(0, Math.min(amount, p.chips));
    p.chips -= put;
    p.bet += put;
    p.total += put;
    if (p.chips === 0 && p.inHand) p.allIn = true;
    return put;
  }

  /**
   * Pots principal et annexes à partir des mises de chacun (contrib(p), toute la main par défaut).
   * Chaque niveau de tapis d'un joueur encore en lice ouvre un pot ; les jetons des joueurs couchés y restent.
   */
  computePots(contrib = (p) => p.total) {
    const inHand = this.players.filter((p) => p.inHand);
    const live = inHand.filter((p) => !p.folded);
    const levels = [...new Set(live.map(contrib))].filter((x) => x > 0).sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const p of inHand) amount += Math.min(contrib(p), level) - Math.min(contrib(p), prev);
      if (amount > 0) pots.push({ amount, eligible: live.filter((p) => contrib(p) >= level).map((p) => p.id) });
      prev = level;
    }
    const total = inHand.reduce((s, p) => s + contrib(p), 0);
    const counted = pots.reduce((s, x) => s + x.amount, 0);
    if (pots.length && total > counted) pots.at(-1).amount += total - counted; // jetons morts au-delà du dernier niveau
    return pots;
  }

  /** Les joueurs dans l'ordre de la table, en commençant à gauche du bouton. */
  clockwiseFromButton(list) {
    const dist = (p) => (p.seat - this.buttonIndex - 1 + this.n * 2) % this.n;
    return [...list].sort((a, b) => dist(a) - dist(b));
  }

  /** Ce que le joueur peut faire, et sa meilleure main du moment. */
  privateView(p, isMyTurn) {
    const best = p.inHand && p.cards.length ? evaluate([...p.cards, ...this.board]) : null;
    const view = {
      inGame: !p.out,
      cards: p.inHand ? [...p.cards] : [],
      best: best ? { category: best.category, name: best.name, description: best.description, cards: best.cards.map((c) => c.id) } : null,
      toCall: 0,
      canCheck: false,
      canCall: false,
      canRaise: false,
      raiseBlock: null,
      minRaiseTo: 0,
      maxRaiseTo: 0,
    };
    if (!isMyTurn) return view;
    const target = this.callTarget(p);
    const max = p.bet + p.chips;
    view.toCall = Math.max(0, Math.min(target - p.bet, p.chips));
    view.canCheck = p.bet >= target;
    view.canCall = !view.canCheck;
    view.raiseBlock = max > target ? this.raiseBlock(p) : 'Tu n’as pas assez de jetons pour relancer.';
    view.canRaise = !view.raiseBlock;
    view.maxRaiseTo = max;
    view.minRaiseTo = Math.min(this.currentBet + this.minRaise, max);
    return view;
  }

  // ================================================================ utilitaires

  player(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  nextIndex(from, pred) {
    for (let i = 1; i <= this.n; i++) {
      const idx = (from + i) % this.n;
      if (pred(this.players[idx])) return idx;
    }
    return -1;
  }

  event(e) {
    this.events.push({ id: ++this.eventSeq, hand: this.handNumber, ...e });
    if (this.events.length > EVENT_SIZE) this.events.splice(0, this.events.length - EVENT_SIZE);
  }

  addLog(text, tone) {
    this.log.push({ text, tone: tone ?? null, hand: this.handNumber });
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
  }
}

module.exports = { Poker, GameError, BLIND_LEVELS, SPEEDS, blindsAt, fmt };
