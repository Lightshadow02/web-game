'use strict';

const { buildShoe, shuffle, cardValue, handValue, isNatural, cardName } = require('./cards');

/**
 * Blackjack de casino, 1 à 5 joueurs, chacun contre la banque.
 *
 * Règles (choisies et documentées dans le dialogue des règles du client) :
 *  - sabot de 6 jeux mélangé, carte de coupe à 75 % : quand elle est sortie, le sabot est
 *    remélangé avant la donne suivante (annoncé) ;
 *  - mise minimale 10 jetons (ou tout ce qui reste s'il en reste moins), maximale = tes jetons ;
 *  - la banque reste sur tous les 17, y compris le 17 souple (As + 6) ;
 *  - blackjack (As + carte de valeur 10 en deux cartes) payé 3 pour 2, arrondi à l'unité
 *    inférieure (une mise de 25 rapporte 37) ;
 *  - carte cachée de la banque : elle vérifie son blackjack quand sa carte visible est un As
 *    (après avoir proposé l'assurance, payée 2 pour 1, au plus la moitié de la mise) ou une carte de valeur 10 ;
 *    blackjack de la banque : toutes les mises sont perdues, sauf un blackjack du joueur (égalité) ;
 *  - doubler sur les deux premières cartes (une seule carte, mise doublée, jetons nécessaires),
 *    y compris après une séparation ;
 *  - séparer deux cartes de même valeur (Roi + 10 compris), jusqu'à 4 mains ; les As séparés
 *    reçoivent une seule carte chacun et ne se re-séparent pas ; 21 après séparation = 21, pas un blackjack ;
 *  - pas d'abandon ; égalité = mise rendue. Un 21 se tient tout seul.
 *
 * Déroulement d'une donne : betting (mises simultanées, « Je passe » possible) -> deal ->
 * insurance (si As visible) -> playing (dans l'ordre des places, main par main) -> la banque
 * joue -> roundEnd (résumé, chacun confirme « Donne suivante ») ; gameOver après le nombre de
 * donnes choisi ou quand plus personne n'a de jetons.
 *
 * Secret : l'ordre du sabot et la carte cachée de la banque (tant qu'elle n'est pas retournée)
 * ne quittent jamais le serveur (getStateFor, events et journal compris).
 */

const DECKS = 6;
const CUT_RATIO = 0.75;
const MIN_BET = 10;
const MAX_HANDS = 4;
const LOG_SIZE = 60;
const EVENT_SIZE = 80;

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true;
  }
}

/** 1 450 -> « 1 450 » (espace fine insécable). */
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const plural = (n, word) => `${fmt(n)} ${word}${Math.abs(n) > 1 ? 's' : ''}`;
const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

/** Valeur affichée : « 17 » ou « 7 / 17 » pour une main souple. */
function valueText(cards) {
  const v = handValue(cards);
  return v.soft && v.total < 21 ? `${v.low} / ${v.total}` : String(v.total);
}

class Blackjack {
  /**
   * @param {{ players: {id: string, name: string}[], options?: { chips?: number, rounds?: number }, rng?: () => number }} p
   */
  constructor({ players, options = {}, rng = Math.random }) {
    if (!Array.isArray(players) || players.length < 1 || players.length > 5) {
      throw new GameError('Le Blackjack se joue de 1 à 5 joueurs.');
    }
    this.rng = rng;
    this.startChips = isInt(options.chips) && options.chips > 0 ? options.chips : 1000;
    this.totalRounds = isInt(options.rounds) && options.rounds > 0 ? options.rounds : 10;
    this.players = players.map((p) => ({
      id: p.id,
      name: p.name,
      chips: this.startChips,
      state: 'deciding', // deciding | bet | sitout | out
      bet: 0,
      lastBet: 0,
      hands: [],
      insurance: null, // { max, amount, status: pending | taken | declined | won | lost }
      ready: false,
      staked: 0, // jetons posés sur la table pendant la donne (mises, doubles, séparations, assurance)
      returned: 0, // jetons rendus par la banque à la fin de la donne
      net: 0,
    }));
    this.dealer = { cards: [], revealed: false };
    this.roundNumber = 0;
    this.phase = 'betting';
    this.turn = null; // { player: index, hand: index }
    this.summary = null;
    this.history = [];
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.cardSeq = 0;
    this.totalCards = DECKS * 52;
    this.cut = Math.round(this.totalCards * CUT_RATIO);
    this.shoe = shuffle(buildShoe(DECKS), rng);
    this.discards = [];
    this.dealtSinceShuffle = 0;
    this.startRound();
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload) {
    if (this.isOver()) throw new GameError('La partie est terminée.');
    const p = this.player(playerId);
    if (!p) throw new GameError('Tu ne joues pas à cette table.');
    const data = payload && typeof payload === 'object' ? payload : {};
    switch (type) {
      case 'bet':
        return this.placeBet(p, data.amount);
      case 'sitout':
        return this.sitOut(p);
      case 'unbet':
        return this.unbet(p);
      case 'insurance':
        return this.decideInsurance(p, data.take, data.amount);
      case 'hit':
        return this.hit(p);
      case 'stand':
        return this.stand(p);
      case 'double':
        return this.double(p);
      case 'split':
        return this.split(p);
      case 'next':
        return this.ready(p);
      default:
        throw new GameError(`Action inconnue : ${type}`);
    }
  }

  isOver() {
    return this.phase === 'gameOver';
  }

  getResult() {
    if (!this.isOver()) return null;
    const ranking = [...this.players].sort((a, b) => b.chips - a.chips);
    const summary = ranking.length === 1
      ? `${ranking[0].name} termine avec ${plural(ranking[0].chips, 'jeton')} (départ ${fmt(this.startChips)})`
      : `Classement : ${ranking.map((p) => `${1 + ranking.filter((o) => o.chips > p.chips).length}. ${p.name} (${fmt(p.chips)})`).join(', ')}`;
    return {
      summary,
      players: this.players.map((p) => ({
        playerId: p.id,
        result: p.chips > this.startChips ? 'win' : p.chips < this.startChips ? 'loss' : 'draw',
        score: p.chips,
      })),
    };
  }

  /** Vue d'un joueur : tout est public au Blackjack, sauf le sabot et la carte cachée de la banque. */
  getStateFor(playerId) {
    const me = this.player(playerId);
    const cur = this.currentPlayer();
    const dealerVisible = this.dealer.revealed ? this.dealer.cards : this.dealer.cards.slice(0, 1);
    const dv = handValue(dealerVisible);
    return {
      phase: this.phase,
      roundNumber: this.roundNumber,
      totalRounds: this.totalRounds,
      startChips: this.startChips,
      minBet: MIN_BET,
      maxHands: MAX_HANDS,
      players: this.players.map((p, seat) => ({
        id: p.id,
        name: p.name,
        seat,
        chips: p.chips,
        state: p.state,
        bet: p.bet,
        lastBet: p.lastBet,
        ready: p.ready,
        net: p.net,
        insurance: p.insurance ? { amount: p.insurance.amount, max: p.insurance.max, status: p.insurance.status } : null,
        hands: p.hands.map((h) => this.publicHand(h)),
      })),
      dealer: {
        // la carte cachée n'est envoyée qu'une fois retournée : avant, une place vide sans identifiant
        cards: this.dealer.cards.map((c, i) => (i === 1 && !this.dealer.revealed ? { hidden: true } : c)),
        revealed: this.dealer.revealed,
        total: dealerVisible.length ? dv.total : 0,
        low: dv.low,
        soft: dv.soft,
        // retournée, la banque a fini de jouer : son total seul (« 18 », pas « 8 / 18 »)
        text: !dealerVisible.length ? '' : this.dealer.revealed ? String(dv.total) : valueText(dealerVisible),
        blackjack: this.dealer.revealed && isNatural(this.dealer.cards),
        bust: this.dealer.revealed && dv.total > 21,
      },
      turn: this.turn && cur ? { playerId: cur.id, hand: this.turn.hand } : null,
      currentPlayerId: cur?.id ?? null,
      isMyTurn: !!cur && cur.id === playerId,
      shoe: { remaining: this.shoe.length, total: this.totalCards, decks: DECKS, cutReached: this.dealtSinceShuffle >= this.cut },
      discardCount: this.discards.length,
      my: me ? this.optionsFor(me) : null,
      summary: this.summary,
      history: this.history,
      events: this.events,
      log: this.log,
    };
  }

  // ================================================================ mises

  placeBet(p, amount) {
    this.assertPhase('betting');
    if (p.state === 'out') throw new GameError('Tu n’as plus de jetons : tu regardes la partie.');
    if (p.state !== 'deciding') throw new GameError('Ta décision est déjà prise pour cette donne.');
    const min = Math.min(MIN_BET, p.chips);
    if (!isInt(amount)) throw new GameError('Mise invalide.');
    if (amount < min) throw new GameError(`Mise minimale : ${plural(min, 'jeton')}.`);
    if (amount > p.chips) throw new GameError(`Tu n’as que ${plural(p.chips, 'jeton')}.`);
    p.chips -= amount;
    p.staked += amount;
    p.bet = amount;
    p.lastBet = amount;
    p.state = 'bet';
    this.emit('bet', { playerId: p.id, amount });
    this.addLog(`${p.name} mise ${fmt(amount)}.`);
    this.maybeDeal();
  }

  sitOut(p) {
    this.assertPhase('betting');
    if (p.state === 'out') throw new GameError('Tu n’as plus de jetons : tu regardes la partie.');
    if (p.state !== 'deciding') throw new GameError('Ta décision est déjà prise pour cette donne.');
    p.state = 'sitout';
    this.emit('sitout', { playerId: p.id });
    this.addLog(`${p.name} passe cette donne.`);
    this.maybeDeal();
  }

  /** Revenir sur sa décision tant que la donne n'est pas distribuée. */
  unbet(p) {
    this.assertPhase('betting');
    if (p.state !== 'bet' && p.state !== 'sitout') throw new GameError('Tu n’as encore rien décidé.');
    if (p.state === 'bet') {
      p.chips += p.bet;
      p.staked -= p.bet;
      p.bet = 0;
    }
    p.state = 'deciding';
    this.emit('unbet', { playerId: p.id });
  }

  maybeDeal() {
    const seated = this.players.filter((p) => p.state !== 'out');
    if (seated.some((p) => p.state === 'deciding')) return;
    if (!seated.some((p) => p.state === 'bet')) {
      // tout le monde passe : la donne compte, sans cartes
      this.emit('skip', { roundNumber: this.roundNumber });
      this.addLog('Tout le monde passe : donne suivante.');
      this.history.push({ roundNumber: this.roundNumber, skipped: true, changes: {}, dealer: null });
      if (this.roundNumber >= this.totalRounds) {
        // dernière donne passée : le résumé le dit (et ne reprend pas celui de la donne précédente)
        this.summary = {
          roundNumber: this.roundNumber,
          skipped: true,
          dealer: null,
          players: this.players.map((p) => ({
            playerId: p.id, played: false, state: p.state, hands: [], insurance: null, staked: 0, returned: 0, net: 0, chips: p.chips,
          })),
          isLast: true,
        };
        this.endGame();
      } else this.startRound();
      return;
    }
    this.deal();
  }

  // ================================================================ distribution, assurance, vérification

  deal() {
    const bettors = this.bettors();
    for (const p of bettors) p.hands = [this.newHand(p.bet)];
    this.dealer = { cards: [], revealed: false };
    const order = [];
    for (let pass = 0; pass < 2; pass++) {
      for (const p of bettors) {
        const c = this.draw();
        p.hands[0].cards.push(c);
        order.push({ to: p.id, cardId: c.id });
      }
      const c = this.draw();
      this.dealer.cards.push(c);
      order.push(pass === 0 ? { to: 'dealer', cardId: c.id } : { to: 'dealer', hole: true });
    }
    this.emit('deal', { order });
    const up = this.dealer.cards[0];
    this.addLog(`Carte visible de la banque : ${cardName(up)}.`);
    for (const p of bettors) {
      const h = p.hands[0];
      if (isNatural(h.cards)) {
        h.blackjack = true;
        h.done = true;
        this.emit('blackjack', { playerId: p.id });
        this.addLog(`${p.name} : blackjack !`);
      }
    }

    if (up.rank === 1) {
      // As visible : l'assurance est proposée avant que la banque ne regarde sa carte cachée
      this.phase = 'insurance';
      for (const p of bettors) {
        const max = Math.min(Math.floor(p.bet / 2), p.chips);
        p.insurance = max >= 1 ? { max, amount: 0, status: 'pending' } : { max: 0, amount: 0, status: 'declined' };
      }
      this.emit('insuranceOffer', {});
      this.maybePeek();
    } else if (cardValue(up) === 10) {
      this.peek();
    } else {
      this.startPlay();
    }
  }

  decideInsurance(p, take, amount) {
    this.assertPhase('insurance');
    if (!p.insurance || p.insurance.status !== 'pending') throw new GameError('Tu as déjà répondu pour l’assurance.');
    if (take === true) {
      const value = amount === undefined || amount === null ? p.insurance.max : amount;
      if (!isInt(value) || value < 1 || value > p.insurance.max) {
        throw new GameError(`Assurance : de 1 à ${plural(p.insurance.max, 'jeton')}.`);
      }
      p.chips -= value;
      p.staked += value;
      p.insurance.amount = value;
      p.insurance.status = 'taken';
      this.emit('insurance', { playerId: p.id, take: true, amount: value });
      this.addLog(`${p.name} prend l’assurance (${fmt(value)}).`);
    } else if (take === false) {
      p.insurance.status = 'declined';
      this.emit('insurance', { playerId: p.id, take: false, amount: 0 });
      this.addLog(`${p.name} refuse l’assurance.`);
    } else {
      throw new GameError('Réponse invalide.');
    }
    this.maybePeek();
  }

  maybePeek() {
    if (this.bettors().some((p) => p.insurance?.status === 'pending')) return;
    this.peek();
  }

  /** La banque regarde sa carte cachée (As ou 10 visible). */
  peek() {
    const blackjack = isNatural(this.dealer.cards);
    this.emit('peek', { blackjack });
    for (const p of this.bettors()) {
      const ins = p.insurance;
      if (ins?.status !== 'taken') continue;
      if (blackjack) {
        ins.status = 'won';
        p.chips += ins.amount * 3;
        p.returned += ins.amount * 3;
      } else {
        ins.status = 'lost';
      }
    }
    if (blackjack) {
      this.reveal();
      this.addLog('La banque a un blackjack.');
      this.settle();
      return;
    }
    if (this.dealer.cards[0].rank === 1) {
      const lost = this.bettors().some((p) => p.insurance?.status === 'lost');
      this.addLog(`La banque n’a pas de blackjack${lost ? ' : les assurances sont perdues' : ''}.`);
    } else {
      this.addLog('La banque n’a pas de blackjack.');
    }
    this.startPlay();
  }

  // ================================================================ jeu des mains

  startPlay() {
    this.phase = 'playing';
    this.turn = { player: 0, hand: -1 };
    this.advance();
  }

  /** Passe à la prochaine main à jouer (dans l'ordre des places), ou à la banque. */
  advance() {
    let { player: pi, hand: hi } = this.turn;
    hi++;
    while (pi < this.players.length) {
      const p = this.players[pi];
      if (p.state === 'bet') {
        while (hi < p.hands.length) {
          const h = p.hands[hi];
          if (h.cards.length === 1) {
            // main issue d'une séparation : elle reçoit sa deuxième carte quand vient son tour
            const c = this.draw();
            h.cards.push(c);
            this.emit('splitCard', { playerId: p.id, hand: hi, card: c });
            if (handValue(h.cards).total === 21) h.done = true;
          }
          if (!h.done) {
            this.turn = { player: pi, hand: hi };
            this.emit('turn', { playerId: p.id, hand: hi });
            return;
          }
          hi++;
        }
      }
      pi++;
      hi = 0;
    }
    this.turn = null;
    this.dealerPlay();
  }

  currentHand(p) {
    this.assertPhase('playing');
    const cur = this.currentPlayer();
    if (!cur || cur.id !== p.id) throw new GameError('Ce n’est pas ton tour.');
    return p.hands[this.turn.hand];
  }

  hit(p) {
    const h = this.currentHand(p);
    if (h.splitAces) throw new GameError('Un As séparé ne reçoit qu’une carte.');
    const c = this.draw();
    h.cards.push(c);
    const v = handValue(h.cards);
    this.emit('hit', { playerId: p.id, hand: this.turn.hand, card: c });
    if (v.total > 21) {
      h.bust = true;
      h.done = true;
      this.emit('bust', { playerId: p.id, hand: this.turn.hand, total: v.total });
      this.addLog(`${p.name} tire ${cardName(c)} et saute avec ${v.total}.`);
      this.advance();
    } else if (v.total === 21) {
      h.done = true;
      this.addLog(`${p.name} tire ${cardName(c)} : 21.`);
      this.advance();
    } else {
      this.addLog(`${p.name} tire ${cardName(c)} (${valueText(h.cards)}).`);
    }
  }

  stand(p) {
    const h = this.currentHand(p);
    h.done = true;
    this.emit('stand', { playerId: p.id, hand: this.turn.hand, total: handValue(h.cards).total });
    this.addLog(`${p.name} reste sur ${handValue(h.cards).total}.`);
    this.advance();
  }

  double(p) {
    const h = this.currentHand(p);
    const why = this.doubleReason(p, h);
    if (why) throw new GameError(why);
    p.chips -= h.bet;
    p.staked += h.bet;
    h.bet *= 2;
    h.doubled = true;
    const c = this.draw();
    h.cards.push(c);
    h.done = true;
    const v = handValue(h.cards);
    if (v.total > 21) h.bust = true;
    this.emit('double', { playerId: p.id, hand: this.turn.hand, card: c, bet: h.bet });
    this.addLog(`${p.name} double (${fmt(h.bet)}) et tire ${cardName(c)} : ${v.total}${h.bust ? ', sauté' : ''}.`);
    if (h.bust) this.emit('bust', { playerId: p.id, hand: this.turn.hand, total: v.total });
    this.advance();
  }

  split(p) {
    const h = this.currentHand(p);
    const why = this.splitReason(p, h);
    if (why) throw new GameError(why);
    const hi = this.turn.hand;
    const aces = h.cards[0].rank === 1;
    p.chips -= h.bet;
    p.staked += h.bet;
    const second = this.newHand(h.bet);
    second.cards.push(h.cards.pop());
    second.split = true;
    h.split = true;
    p.hands.splice(hi + 1, 0, second);
    this.emit('split', { playerId: p.id, hand: hi, hands: p.hands.length });
    this.addLog(`${p.name} sépare ${aces ? 'ses As' : 'sa paire'} (${p.hands.length} mains).`);
    // la main en cours reçoit tout de suite sa deuxième carte
    const c = this.draw();
    h.cards.push(c);
    this.emit('splitCard', { playerId: p.id, hand: hi, card: c });
    if (aces) {
      // As séparés : une seule carte chacun, puis la main est finie
      h.splitAces = true;
      second.splitAces = true;
      h.done = true;
      const c2 = this.draw();
      second.cards.push(c2);
      second.done = true;
      this.emit('splitCard', { playerId: p.id, hand: hi + 1, card: c2 });
      this.advance();
      return;
    }
    if (handValue(h.cards).total === 21) {
      h.done = true;
      this.advance();
    }
  }

  doubleReason(p, h) {
    if (h.splitAces) return 'Un As séparé ne reçoit qu’une carte.';
    if (h.cards.length !== 2) return 'On ne double que sur ses deux premières cartes.';
    if (p.chips < h.bet) return `Il te faut ${plural(h.bet, 'jeton')} pour doubler.`;
    return null;
  }

  splitReason(p, h) {
    if (h.cards.length !== 2) return 'On ne sépare que ses deux premières cartes.';
    if (cardValue(h.cards[0]) !== cardValue(h.cards[1])) return 'Il faut deux cartes de même valeur.';
    if (h.splitAces) return 'Des As séparés ne se séparent plus.';
    if (p.hands.length >= MAX_HANDS) return `${MAX_HANDS} mains au plus.`;
    if (p.chips < h.bet) return `Il te faut ${plural(h.bet, 'jeton')} pour séparer.`;
    return null;
  }

  // ================================================================ banque et règlement

  reveal() {
    if (this.dealer.revealed) return;
    this.dealer.revealed = true;
    const hole = this.dealer.cards[1];
    this.emit('reveal', { card: hole, total: handValue(this.dealer.cards).total });
    this.addLog(`La banque retourne ${cardName(hole)} : ${valueText(this.dealer.cards)}.`);
  }

  dealerPlay() {
    this.reveal();
    const live = this.bettors().some((p) => p.hands.some((h) => !h.bust && !h.blackjack));
    if (live) {
      while (handValue(this.dealer.cards).total < 17) {
        const c = this.draw();
        this.dealer.cards.push(c);
        const v = handValue(this.dealer.cards);
        this.emit('dealerHit', { card: c, total: v.total });
        this.addLog(`La banque tire ${cardName(c)} : ${v.total}.`);
      }
      const total = handValue(this.dealer.cards).total;
      if (total > 21) {
        this.emit('dealerBust', { total });
        this.addLog(`La banque saute avec ${total}.`);
      } else {
        this.addLog(`La banque reste sur ${total}.`);
      }
    }
    this.settle();
  }

  settle() {
    this.turn = null;
    const dealerBJ = isNatural(this.dealer.cards);
    const dealerTotal = handValue(this.dealer.cards).total;
    const dealerBust = dealerTotal > 21;
    const changes = {};
    const results = [];
    for (const p of this.bettors()) {
      for (const h of p.hands) {
        const total = handValue(h.cards).total;
        let result;
        let payout = 0;
        if (h.bust) result = 'bust';
        else if (h.blackjack && !dealerBJ) {
          result = 'blackjack';
          payout = h.bet + Math.floor((h.bet * 3) / 2);
        } else if (dealerBJ) {
          result = h.blackjack ? 'push' : 'lose';
          payout = h.blackjack ? h.bet : 0;
        } else if (dealerBust || total > dealerTotal) {
          result = 'win';
          payout = h.bet * 2;
        } else if (total === dealerTotal) {
          result = 'push';
          payout = h.bet;
        } else {
          result = 'lose';
        }
        h.result = result;
        h.payout = payout;
        h.net = payout - h.bet;
        p.chips += payout;
        p.returned += payout;
      }
      p.net = p.returned - p.staked;
      changes[p.id] = p.net;
      const parts = p.hands.map((h) => RESULT_LOG[h.result](h)).join(', ');
      this.addLog(`${p.name} : ${parts}${p.insurance?.status === 'won' ? `, assurance payée ${fmt(p.insurance.amount * 2)}` : ''}.`);
      results.push({ playerId: p.id, net: p.net });
    }
    this.summary = {
      roundNumber: this.roundNumber,
      skipped: false,
      dealer: { cards: this.dealer.cards, total: dealerTotal, blackjack: dealerBJ, bust: dealerBust },
      players: this.players.map((p) => ({
        playerId: p.id,
        played: p.state === 'bet',
        state: p.state, // bet | sitout | out (ruiné avant cette donne)
        hands: p.hands.map((h) => this.publicHand(h)),
        insurance: p.insurance && p.insurance.status !== 'declined' && p.insurance.amount
          ? { amount: p.insurance.amount, status: p.insurance.status } : null,
        staked: p.staked,
        returned: p.returned,
        net: p.net,
        chips: p.chips,
      })),
      isLast: false,
    };
    this.history.push({ roundNumber: this.roundNumber, skipped: false, changes, dealer: { total: dealerTotal, blackjack: dealerBJ, bust: dealerBust } });
    this.emit('settle', { results, dealerTotal, dealerBlackjack: dealerBJ, dealerBust });
    for (const p of this.players) {
      if (p.state !== 'out' && p.chips === 0) {
        p.state = 'out';
        this.emit('broke', { playerId: p.id });
        this.addLog(`${p.name} n’a plus de jetons.`);
      }
    }
    if (this.roundNumber >= this.totalRounds || this.players.every((p) => p.chips === 0)) {
      this.summary.isLast = true;
      this.endGame();
    } else {
      this.phase = 'roundEnd';
    }
  }

  ready(p) {
    this.assertPhase('roundEnd');
    if (p.state === 'out') throw new GameError('Tu n’as plus de jetons : tu regardes la partie.');
    if (p.ready) return;
    p.ready = true;
    this.emit('ready', { playerId: p.id });
    if (this.players.every((x) => x.ready || x.state === 'out')) this.startRound();
  }

  startRound() {
    // les cartes de la donne précédente partent à la défausse
    for (const p of this.players) for (const h of p.hands) this.discards.push(...h.cards.map(strip));
    this.discards.push(...this.dealer.cards.map(strip));
    if (this.roundNumber > 0 && this.dealtSinceShuffle >= this.cut) this.reshuffle('cut');
    this.roundNumber++;
    this.phase = 'betting';
    this.turn = null;
    this.summary = null;
    this.dealer = { cards: [], revealed: false };
    for (const p of this.players) {
      Object.assign(p, {
        state: p.chips > 0 ? 'deciding' : 'out', bet: 0, hands: [], insurance: null, ready: false, staked: 0, returned: 0, net: 0,
      });
    }
    this.emit('round', { roundNumber: this.roundNumber });
    this.addLog(`Donne ${this.roundNumber}/${this.totalRounds} : faites vos jeux.`);
  }

  endGame() {
    this.phase = 'gameOver';
    this.turn = null;
    for (const p of this.players) p.ready = false;
    this.emit('gameOver', {});
    const best = Math.max(...this.players.map((p) => p.chips));
    const winners = this.players.filter((p) => p.chips === best);
    this.addLog(`Fin de la partie : ${winners.map((p) => p.name).join(' et ')} ${winners.length > 1 ? 'terminent' : 'termine'} avec ${plural(best, 'jeton')}.`);
  }

  // ================================================================ sabot

  /** Tire la carte du dessus du sabot et lui donne un identifiant public. */
  draw() {
    if (!this.shoe.length) this.reshuffle('empty');
    const c = this.shoe.pop();
    this.dealtSinceShuffle++;
    return { id: `c${++this.cardSeq}`, suit: c.suit, rank: c.rank };
  }

  /**
   * Remélange : entre deux donnes, tout le sabot (défausse comprise) ; en pleine donne (sabot vide,
   * presque impossible avec la carte de coupe), seulement la défausse.
   */
  reshuffle(reason) {
    const pool = [...this.shoe, ...this.discards];
    this.shoe = shuffle(pool.length ? pool : buildShoe(DECKS), this.rng);
    this.discards = [];
    this.dealtSinceShuffle = 0;
    this.emit('shuffle', { reason });
    this.addLog(reason === 'cut' ? 'La carte de coupe est sortie : le sabot est mélangé.' : 'Le sabot est vide : la défausse est mélangée.');
  }

  // ================================================================ utilitaires

  newHand(bet) {
    return {
      cards: [], bet, doubled: false, split: false, splitAces: false, done: false, bust: false, blackjack: false,
      result: null, payout: 0, net: 0,
    };
  }

  publicHand(h) {
    const v = handValue(h.cards);
    return {
      cards: h.cards.map((c) => ({ ...c })),
      total: v.total,
      low: v.low,
      soft: v.soft,
      // main finie : son total seul ; en cours, « 7 / 17 » pour une main souple
      text: !h.cards.length ? '' : h.done ? String(v.total) : valueText(h.cards),
      bet: h.bet,
      doubled: h.doubled,
      split: h.split,
      splitAces: h.splitAces,
      done: h.done,
      bust: h.bust,
      blackjack: h.blackjack,
      result: h.result,
      payout: h.payout,
      net: h.net,
    };
  }

  /** Ce que ce joueur peut faire maintenant, avec la raison quand c'est impossible. */
  optionsFor(p) {
    const ok = { ok: true };
    const no = (reason) => ({ ok: false, reason });
    const out = {
      minBet: Math.min(MIN_BET, p.chips),
      maxBet: p.chips,
      bet: this.phase === 'betting' && p.state === 'deciding',
      change: this.phase === 'betting' && (p.state === 'bet' || p.state === 'sitout'),
      insurance: this.phase === 'insurance' && p.insurance?.status === 'pending' ? { max: p.insurance.max } : null,
      next: this.phase === 'roundEnd' && p.state !== 'out' && !p.ready,
      hit: null,
      stand: null,
      double: null,
      split: null,
    };
    const cur = this.currentPlayer();
    if (this.phase === 'playing' && cur?.id === p.id) {
      const h = p.hands[this.turn.hand];
      out.hit = h.splitAces ? no('Un As séparé ne reçoit qu’une carte.') : ok;
      out.stand = ok;
      const d = this.doubleReason(p, h);
      out.double = d ? no(d) : ok;
      const s = this.splitReason(p, h);
      out.split = s ? no(s) : ok;
    }
    return out;
  }

  bettors() {
    return this.players.filter((p) => p.state === 'bet');
  }

  currentPlayer() {
    return this.phase === 'playing' && this.turn ? this.players[this.turn.player] ?? null : null;
  }

  player(id) {
    return this.players.find((p) => p.id === id);
  }

  assertPhase(phase) {
    if (this.phase !== phase) throw new GameError(PHASE_ERROR[phase] ?? 'Ce n’est pas le moment.');
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

const strip = (c) => ({ suit: c.suit, rank: c.rank });

const PHASE_ERROR = {
  betting: 'Les mises sont closes.',
  insurance: 'L’assurance n’est pas proposée maintenant.',
  playing: 'Ce n’est pas le moment de jouer.',
  roundEnd: 'La donne n’est pas terminée.',
};

const RESULT_LOG = {
  blackjack: (h) => `blackjack payé ${fmt(h.payout - h.bet)}`,
  win: (h) => `gagne ${fmt(h.bet)}`,
  push: () => 'égalité, mise rendue',
  lose: (h) => `perd ${fmt(h.bet)}`,
  bust: (h) => `saute, perd ${fmt(h.bet)}`,
};

module.exports = { Blackjack, GameError, MIN_BET, MAX_HANDS, DECKS, CUT_RATIO, valueText };
