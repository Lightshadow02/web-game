'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Blackjack, MIN_BET, valueText } = require('../games/blackjack/server/Blackjack');
const { handValue, isNatural, buildShoe, cardValue } = require('../games/blackjack/server/cards');
const blackjackModule = require('../games/blackjack/server/index');

// ---------------------------------------------------------------- outils

const RANKS = { A: 1, T: 10, J: 11, Q: 12, K: 13 };
/** 'AS' -> As de Pique, 'TH' -> 10 de Cœur, 'KD' -> Roi de Carreau, '9C' -> 9 de Trèfle. */
const C = (spec) => ({ rank: RANKS[spec[0]] ?? Number(spec[0]), suit: spec[1] });
const cards = (list) => list.split(' ').map(C);
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` }));

/** Empile le sabot : la première carte de la liste sort en premier. */
function stack(game, list) {
  game.shoe = cards(list).reverse();
}

/**
 * Nouvelle partie, mises posées ; le sabot est empilé juste avant la dernière mise (qui distribue).
 * Ordre de la donne : J0, J1…, banque (visible), J0, J1…, banque (cachée).
 */
function dealt(n, bets, deck, options = {}) {
  const game = new Blackjack({ players: players(n), options, rng: seeded(7) });
  stack(game, deck);
  bets.forEach((amount, i) => {
    if (amount === null) game.handleAction(`p${i}`, 'sitout');
    else game.handleAction(`p${i}`, 'bet', { amount });
  });
  return game;
}

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const chips = (game, id) => game.player(id).chips;
const hand = (game, id, i = 0) => game.player(id).hands[i];
const totals = (game, id) => game.player(id).hands.map((h) => handValue(h.cards).total);

/** Joue toutes les mains jusqu'au règlement : tire en dessous de 17, sinon reste. */
function finishRound(game) {
  let guard = 0;
  while (game.phase === 'playing') {
    if (++guard > 200) throw new Error('boucle infinie');
    const p = game.currentPlayer();
    const h = p.hands[game.turn.hand];
    game.handleAction(p.id, handValue(h.cards).total < 17 && !h.splitAces ? 'hit' : 'stand');
  }
}

// ---------------------------------------------------------------- valeurs des mains

test('valeur des mains : As souples et durs, plusieurs As', () => {
  const v = (list) => handValue(cards(list));
  assert.deepEqual(v('9H 7S'), { total: 16, low: 16, soft: false });
  assert.deepEqual(v('AH 6S'), { total: 17, low: 7, soft: true }, 'As + 6 = 7 / 17 souple');
  assert.deepEqual(v('AH 6S TC'), { total: 17, low: 17, soft: false }, 'l’As redevient 1');
  assert.deepEqual(v('AH AS'), { total: 12, low: 2, soft: true }, 'deux As : 12');
  assert.deepEqual(v('AH AS 9C'), { total: 21, low: 11, soft: true });
  assert.deepEqual(v('AH AS AD AC'), { total: 14, low: 4, soft: true });
  assert.deepEqual(v('AH AS AD AC 7H'), { total: 21, low: 11, soft: true });
  assert.deepEqual(v('AH AS AD AC 8H'), { total: 12, low: 12, soft: false });
  assert.equal(v('KH QS').total, 20, 'figures = 10');
  assert.equal(v('JH TS 2C').total, 22);
  assert.equal(valueText(cards('AH 6S')), '7 / 17');
  assert.equal(valueText(cards('AH 6S TC')), '17');
  assert.equal(valueText(cards('AH KS')), '21', 'un 21 souple s’écrit 21');
  assert.ok(isNatural(cards('AS KD')));
  assert.ok(isNatural(cards('TS AD')));
  assert.ok(!isNatural(cards('7S 7D 7C')));
  assert.equal(cardValue(C('QH')), 10);
  assert.equal(buildShoe(6).length, 312);
});

// ---------------------------------------------------------------- options et mises

test('module : options Jetons de départ et Nombre de donnes', () => {
  assert.equal(blackjackModule.id, 'blackjack');
  assert.equal(blackjackModule.minPlayers, 1);
  assert.equal(blackjackModule.maxPlayers, 5);
  assert.equal(blackjackModule.scoreLabel, 'Jetons');
  const [chipsOpt, roundsOpt] = blackjackModule.options;
  assert.deepEqual([chipsOpt.id, chipsOpt.default, chipsOpt.choices.map((c) => c.value)], ['chips', 1000, [500, 1000, 2500]]);
  assert.deepEqual([roundsOpt.id, roundsOpt.default, roundsOpt.choices.map((c) => c.value)], ['rounds', 10, [5, 10, 20]]);
  const game = blackjackModule.createGame({ players: players(2), options: { chips: 2500, rounds: 5 } });
  const s = game.getStateFor('p0');
  assert.equal(s.players[0].chips, 2500);
  assert.equal(s.totalRounds, 5);
  assert.equal(s.phase, 'betting');
  assert.equal(s.roundNumber, 1);
  assert.throws(() => new Blackjack({ players: players(6) }), /1 à 5/);
});

test('mises : minimum 10, maximum = tes jetons, une seule décision, retour possible avant la donne', () => {
  const game = new Blackjack({ players: players(2), options: { chips: 500 } });
  assert.equal(MIN_BET, 10);
  assert.throws(() => game.handleAction('p0', 'bet', { amount: 5 }), /minimale/);
  assert.throws(() => game.handleAction('p0', 'bet', { amount: 501 }), /que 500/);
  assert.throws(() => game.handleAction('p0', 'bet', { amount: 12.5 }), /invalide/);
  assert.throws(() => game.handleAction('p0', 'bet', { amount: '50' }), /invalide/);
  assert.throws(() => game.handleAction('p0', 'bet', null), /invalide/);
  assert.throws(() => game.handleAction('p0', 'hit'), /pas le moment/);
  assert.throws(() => game.handleAction('p9', 'bet', { amount: 10 }), /ne joues pas/);
  game.handleAction('p0', 'bet', { amount: 500 });
  assert.equal(chips(game, 'p0'), 0, 'la mise quitte la cave');
  assert.throws(() => game.handleAction('p0', 'bet', { amount: 10 }), /déjà prise/);
  assert.equal(game.getStateFor('p0').my.change, true);
  game.handleAction('p0', 'unbet');
  assert.equal(chips(game, 'p0'), 500, 'mise rendue');
  game.handleAction('p0', 'bet', { amount: 40 });
  assert.equal(game.phase, 'betting', 'on attend toujours J1');
  assert.equal(game.getStateFor('p1').my.bet, true);
  assert.throws(() => game.handleAction('p1', 'unbet'), /rien décidé/);
});

test('mise minimale abaissée à ce qui reste (moins de 10 jetons)', () => {
  const game = new Blackjack({ players: players(1), options: { chips: 500 } });
  game.player('p0').chips = 7;
  assert.equal(game.getStateFor('p0').my.minBet, 7);
  assert.throws(() => game.handleAction('p0', 'bet', { amount: 6 }), /minimale : 7 jetons/);
  stack(game, '9H 9S TC 8D');
  game.handleAction('p0', 'bet', { amount: 7 });
  assert.equal(game.phase, 'playing');
});

// ---------------------------------------------------------------- paiements

test('blackjack payé 3 pour 2 (arrondi à l’unité inférieure)', () => {
  // J0 : As + Roi (blackjack) contre 9 + 7 ; la banque tire ensuite pour J1
  const game = dealt(2, [25, 10], 'AS 9H 9C KD 7D 7C 2S');
  assert.equal(hand(game, 'p0').blackjack, true);
  assert.equal(game.currentPlayer().id, 'p1', 'la main naturelle ne joue pas');
  game.handleAction('p1', 'stand');
  assert.equal(game.phase, 'roundEnd');
  assert.equal(hand(game, 'p0').result, 'blackjack');
  assert.equal(hand(game, 'p0').payout, 25 + 37, '25 × 1,5 = 37,5 -> 37');
  assert.equal(chips(game, 'p0'), 1000 + 37);
  assert.equal(game.summary.players[0].net, 37);
  // banque : 9 + 7 = 16, tire 2 -> 18 ; J1 : 9 + 7 = 16 perd
  assert.deepEqual(game.dealer.cards.map((c) => c.rank), [9, 7, 2]);
  assert.equal(hand(game, 'p1').result, 'lose');
  assert.equal(chips(game, 'p1'), 990);

  const even = dealt(1, [10], 'AS 9H KD 7D');
  assert.equal(even.phase, 'roundEnd', 'seul joueur avec un blackjack : la banque retourne et ne tire pas');
  assert.equal(even.dealer.cards.length, 2);
  assert.equal(chips(even, 'p0'), 1015, '10 rapporte 15');
});

test('la banque reste sur tous les 17 (17 souple compris) et tire à 16', () => {
  const soft = dealt(1, [10], 'TS 6D 8C AH');
  soft.handleAction('p0', 'stand');
  assert.equal(soft.dealer.cards.length, 2, 'As + 6 : la banque reste');
  assert.equal(hand(soft, 'p0').result, 'win', '18 contre 17');
  assert.equal(chips(soft, 'p0'), 1010);

  const hard = dealt(1, [10], 'TS 9H 8C 7D 5C 4C');
  hard.handleAction('p0', 'stand');
  assert.deepEqual(hard.dealer.cards.map((c) => c.rank), [9, 7, 5], '16 : la banque tire, 21');
  assert.equal(hand(hard, 'p0').result, 'lose');

  const bust = dealt(1, [10], 'TS 9H 8C 7D KC');
  bust.handleAction('p0', 'stand');
  assert.equal(handValue(bust.dealer.cards).total, 26);
  assert.equal(hand(bust, 'p0').result, 'win', 'banque sautée');
  assert.ok(bust.events.some((e) => e.type === 'dealerBust'));
});

test('sauter, égalité, et la banque ne tire pas si toutes les mains ont sauté', () => {
  const game = dealt(2, [10, 20], 'TS 9C 9H 6D 9D 7D KC 5S');
  // J0 : 10 + 6 = 16, tire Roi -> 26
  game.handleAction('p0', 'hit');
  assert.equal(hand(game, 'p0').bust, true);
  assert.equal(game.currentPlayer().id, 'p1', 'main sautée : au suivant');
  // J1 : 9 + 9 = 18, reste ; banque 9 + 7 = 16 tire 5 -> 21
  game.handleAction('p1', 'stand');
  assert.equal(hand(game, 'p0').result, 'bust');
  assert.equal(hand(game, 'p1').result, 'lose');
  assert.equal(chips(game, 'p0'), 990);

  const push = dealt(1, [50], 'TS 9C 8H 9D');
  push.handleAction('p0', 'stand');
  assert.equal(hand(push, 'p0').result, 'push', '18 contre 18');
  assert.equal(chips(push, 'p0'), 1000, 'mise rendue');

  const allBust = dealt(1, [10], 'TS 9C 6H 7D KC');
  allBust.handleAction('p0', 'hit');
  assert.equal(allBust.phase, 'roundEnd');
  assert.equal(allBust.dealer.cards.length, 2, 'rien à battre : la banque retourne sans tirer');
  assert.equal(allBust.dealer.revealed, true);
});

test('21 en tirant : la main se tient toute seule', () => {
  const game = dealt(1, [10], '5S 9C 6H 7D KC 2D');
  game.handleAction('p0', 'hit');
  assert.equal(handValue(hand(game, 'p0').cards).total, 21);
  assert.equal(game.phase, 'roundEnd', 'plus d’action après 21');
});

// ---------------------------------------------------------------- vérification de la banque et assurance

test('10 visible : la banque vérifie, blackjack de la banque = mises perdues sauf blackjack (égalité)', () => {
  // J0 : 9 + 9 ; J1 : As + Roi ; banque : Roi + As
  const game = dealt(2, [50, 40], '9S AH KC 9D KD AS');
  assert.equal(game.phase, 'roundEnd', 'règlement immédiat');
  assert.equal(game.dealer.revealed, true);
  assert.equal(hand(game, 'p0').result, 'lose');
  assert.equal(hand(game, 'p1').result, 'push', 'blackjack contre blackjack');
  assert.equal(chips(game, 'p0'), 950);
  assert.equal(chips(game, 'p1'), 1000);
  assert.ok(game.events.some((e) => e.type === 'peek' && e.blackjack));

  const none = dealt(1, [10], '9S TC 9D 7S');
  assert.equal(none.phase, 'playing', 'pas de blackjack : on joue');
  assert.ok(none.events.some((e) => e.type === 'peek' && !e.blackjack));
  assert.equal(none.dealer.revealed, false);
});

test('As visible : assurance d’abord (au plus la moitié de la mise), payée 2 pour 1', () => {
  // J0 : 10 + 9 ; J1 : 8 + 8 ; banque : As + Roi
  const game = dealt(2, [50, 30], 'TS 8H AC 9D 8C KS');
  assert.equal(game.phase, 'insurance');
  assert.deepEqual(game.getStateFor('p0').my.insurance, { max: 25 });
  assert.deepEqual(game.getStateFor('p1').my.insurance, { max: 15 });
  assert.equal(game.getStateFor('p0').dealer.revealed, false, 'pas encore de vérification');
  assert.throws(() => game.handleAction('p0', 'hit'), /pas le moment/);
  assert.throws(() => game.handleAction('p0', 'insurance', { take: true, amount: 26 }), /de 1 à 25/);
  assert.throws(() => game.handleAction('p0', 'insurance', { take: 'oui' }), /invalide/);
  game.handleAction('p0', 'insurance', { take: true });
  assert.equal(chips(game, 'p0'), 1000 - 50 - 25);
  assert.throws(() => game.handleAction('p0', 'insurance', { take: false }), /déjà répondu/);
  assert.equal(game.phase, 'insurance', 'on attend J1');
  game.handleAction('p1', 'insurance', { take: false });
  // la banque a un blackjack
  assert.equal(game.phase, 'roundEnd');
  assert.equal(game.player('p0').insurance.status, 'won');
  assert.equal(chips(game, 'p0'), 1000 - 50 + 50, 'mise perdue, assurance 25 × 3 rendue : à zéro');
  assert.equal(game.summary.players[0].net, 0);
  assert.equal(chips(game, 'p1'), 970);
});

test('assurance perdue quand la banque n’a pas de blackjack ; assurance d’un montant choisi', () => {
  const game = dealt(1, [40], 'TS AC 9H 8D 2C');
  assert.equal(game.phase, 'insurance');
  game.handleAction('p0', 'insurance', { take: true, amount: 10 });
  assert.equal(game.phase, 'playing', 'pas de blackjack : la donne continue');
  assert.equal(game.player('p0').insurance.status, 'lost');
  game.handleAction('p0', 'stand');
  // banque As + 8 = 19 souple : reste ; J0 19 : égalité
  assert.equal(hand(game, 'p0').result, 'push');
  assert.equal(chips(game, 'p0'), 1000 - 10, 'seule l’assurance est perdue');
  assert.equal(game.summary.players[0].net, -10);
});

test('assurance impossible sans jetons : refusée d’office', () => {
  const game = new Blackjack({ players: players(2), options: { chips: 500 } });
  stack(game, 'TS 9H AC 8D 7C 9S');
  game.handleAction('p0', 'bet', { amount: 500 }); // tapis : plus rien pour l'assurance
  game.handleAction('p1', 'bet', { amount: 10 });
  assert.equal(game.phase, 'insurance');
  assert.equal(game.player('p0').insurance.status, 'declined');
  assert.equal(game.getStateFor('p0').my.insurance, null);
  game.handleAction('p1', 'insurance', { take: false });
  assert.equal(game.phase, 'playing');
});

// ---------------------------------------------------------------- doubler et séparer

test('doubler : mise doublée, une seule carte, seulement sur deux cartes et avec assez de jetons', () => {
  const game = dealt(1, [100], '6S 9H 5C 7D TC 3D');
  game.handleAction('p0', 'double');
  assert.equal(hand(game, 'p0').bet, 200);
  assert.equal(hand(game, 'p0').doubled, true);
  assert.equal(hand(game, 'p0').cards.length, 3, 'une seule carte');
  // 6 + 5 + 10 = 21 ; banque 9 + 7 = 16 tire 3 -> 19
  assert.equal(game.phase, 'roundEnd');
  assert.equal(hand(game, 'p0').result, 'win');
  assert.equal(chips(game, 'p0'), 1200);

  const three = dealt(1, [100], '2S 9H 3C 7D 4C 8D');
  three.handleAction('p0', 'hit');
  assert.throws(() => three.handleAction('p0', 'double'), /deux premières cartes/);
  assert.equal(three.getStateFor('p0').my.double.ok, false);

  const poor = new Blackjack({ players: players(1), options: { chips: 500 } });
  stack(poor, '6S 9H 5C 7D');
  poor.handleAction('p0', 'bet', { amount: 300 });
  assert.throws(() => poor.handleAction('p0', 'double'), /300 jetons pour doubler/);
  assert.match(poor.getStateFor('p0').my.double.reason, /pour doubler/);
});

test('séparer : deux mains, la deuxième reçoit sa carte à son tour, doubler après séparation', () => {
  // J0 : 8 + 8 ; banque 9 + 7 ; cartes suivantes : 3 (main 1), puis 10 sur le double, puis 2 (main 2)…
  const game = dealt(1, [50], '8S 9H 8D 7D 3C TC 2H 9C 5D');
  assert.equal(game.getStateFor('p0').my.split.ok, true);
  game.handleAction('p0', 'split');
  assert.equal(game.player('p0').hands.length, 2);
  assert.equal(chips(game, 'p0'), 900, 'deuxième mise posée');
  assert.deepEqual(hand(game, 'p0', 0).cards.map((c) => c.rank), [8, 3]);
  assert.deepEqual(hand(game, 'p0', 1).cards.map((c) => c.rank), [8], 'carte donnée à son tour');
  game.handleAction('p0', 'double'); // 8 + 3 + 10 = 21
  assert.equal(hand(game, 'p0', 0).bet, 100);
  assert.equal(game.turn.hand, 1);
  assert.deepEqual(hand(game, 'p0', 1).cards.map((c) => c.rank), [8, 2]);
  game.handleAction('p0', 'hit'); // 8 + 2 + 9 = 19
  game.handleAction('p0', 'stand');
  // banque 16 tire 5 -> 21 : main 1 (21) égalité, main 2 (19) perd
  assert.equal(hand(game, 'p0', 0).result, 'push');
  assert.equal(hand(game, 'p0', 1).result, 'lose');
  assert.equal(chips(game, 'p0'), 850 + 100, 'main doublée rendue (égalité), la deuxième mise est perdue');
});

test('séparer : jusqu’à 4 mains, cartes de même valeur (Roi + 10), refus sinon', () => {
  const game = dealt(1, [10], 'KS 9H TD 7D TC TH TS 2C 3C 4C 5C');
  game.handleAction('p0', 'split'); // K | 10 ; main 1 reçoit 10
  game.handleAction('p0', 'split'); // K | 10 | 10 ; main 1 reçoit 10
  game.handleAction('p0', 'split'); // 4 mains
  assert.equal(game.player('p0').hands.length, 4);
  assert.throws(() => game.handleAction('p0', 'split'), /4 mains au plus/);
  assert.equal(chips(game, 'p0'), 960);

  const odd = dealt(1, [10], '8S 9H 9D 7D');
  assert.throws(() => odd.handleAction('p0', 'split'), /même valeur/);
  assert.equal(odd.getStateFor('p0').my.split.reason, 'Il faut deux cartes de même valeur.');
});

test('As séparés : une carte chacun, pas de re-séparation, 21 n’est pas un blackjack', () => {
  // J0 : As + As ; banque 9 + 8 ; As reçoit Roi (21) et As (2 As, pas de re-séparation)
  const game = dealt(1, [20], 'AS 9H AD 8D KC AC');
  game.handleAction('p0', 'split');
  const [h1, h2] = game.player('p0').hands;
  assert.deepEqual(h1.cards.map((c) => c.rank), [1, 13]);
  assert.deepEqual(h2.cards.map((c) => c.rank), [1, 1]);
  assert.ok(h1.splitAces && h2.splitAces && h1.done && h2.done);
  assert.equal(game.phase, 'roundEnd', 'les deux mains sont finies');
  assert.equal(h1.blackjack, false);
  assert.equal(h1.result, 'win', '21 contre 17, payé 1 pour 1');
  assert.equal(h1.payout, 40);
  assert.equal(h2.result, 'lose', '12 contre 17');
  assert.equal(chips(game, 'p0'), 1000);

  // As + As après une séparation d'As : pas de re-séparation (et la main est finie)
  const g2 = dealt(1, [20], 'AS 9H AD 8D AC 5C');
  g2.handleAction('p0', 'split');
  assert.equal(g2.phase, 'roundEnd');
  assert.deepEqual(hand(g2, 'p0', 0).cards.map((c) => c.rank), [1, 1]);
  assert.equal(g2.splitReason(g2.player('p0'), hand(g2, 'p0', 0)), 'Des As séparés ne se séparent plus.');
});

test('21 en deux cartes après une séparation : payé 1 pour 1', () => {
  const game = dealt(1, [10], 'KS 9H KD 8D AC 7C');
  game.handleAction('p0', 'split');
  assert.equal(handValue(hand(game, 'p0', 0).cards).total, 21);
  assert.equal(game.turn.hand, 1, 'la main de 21 se tient, au tour de la deuxième');
  game.handleAction('p0', 'stand'); // K + 7 = 17
  assert.equal(hand(game, 'p0', 0).result, 'win');
  assert.equal(hand(game, 'p0', 0).payout, 20, 'pas de 3 pour 2');
  assert.equal(hand(game, 'p0', 1).result, 'push');
});

// ---------------------------------------------------------------- ordre du jeu

test('ordre des places, actions hors tour refusées, main par main', () => {
  const game = dealt(3, [10, 10, 10], '9S 9H 9D 7C 5S 6H 6D 9C TC TH TD 2C');
  assert.equal(game.currentPlayer().id, 'p0');
  const s1 = game.getStateFor('p1');
  assert.equal(s1.isMyTurn, false);
  assert.equal(s1.my.hit, null);
  assert.throws(() => game.handleAction('p1', 'hit'), /pas ton tour/);
  assert.throws(() => game.handleAction('p2', 'stand'), /pas ton tour/);
  game.handleAction('p0', 'stand');
  assert.equal(game.currentPlayer().id, 'p1');
  assert.throws(() => game.handleAction('p0', 'hit'), /pas ton tour/);
  game.handleAction('p1', 'stand');
  game.handleAction('p2', 'stand');
  assert.equal(game.phase, 'roundEnd');
  assert.throws(() => game.handleAction('p0', 'stand'), /pas le moment/);
});

test('je passe : le joueur ne reçoit pas de cartes ; tout le monde passe = donne suivante', () => {
  const game = dealt(3, [10, null, 20], '9S 9H 7C 6D 9C 5S');
  assert.equal(game.player('p1').state, 'sitout');
  assert.equal(game.player('p1').hands.length, 0);
  assert.equal(chips(game, 'p1'), 1000);
  assert.deepEqual(game.players.map((p) => p.hands.length), [1, 0, 1]);
  assert.equal(game.currentPlayer().id, 'p0');
  game.handleAction('p0', 'stand');
  assert.equal(game.currentPlayer().id, 'p2', 'la place vide est sautée');
  assert.throws(() => game.handleAction('p1', 'sitout'), /closes/);

  const skip = new Blackjack({ players: players(2), options: { rounds: 2 } });
  skip.handleAction('p0', 'sitout');
  skip.handleAction('p1', 'sitout');
  assert.equal(skip.roundNumber, 2);
  assert.equal(skip.phase, 'betting');
  assert.ok(skip.events.some((e) => e.type === 'skip'));
  skip.handleAction('p0', 'sitout');
  skip.handleAction('p1', 'sitout');
  assert.equal(skip.phase, 'gameOver', 'la dernière donne passée termine la partie');
});

// ---------------------------------------------------------------- donnes, ruine, fin de partie

test('donne suivante quand chacun confirme ; joueur ruiné hors jeu ; fin quand tout le monde est ruiné', () => {
  const game = new Blackjack({ players: players(2), options: { chips: 500, rounds: 10 } });
  stack(game, 'TS 9H 9C 6D 9D 7D KC 5S');
  game.handleAction('p0', 'bet', { amount: 500 });
  game.handleAction('p1', 'bet', { amount: 100 });
  game.handleAction('p0', 'hit'); // 16 + Roi : sauté
  game.handleAction('p1', 'stand'); // 18 contre 16 + 5 = 21
  assert.equal(game.phase, 'roundEnd');
  assert.equal(game.player('p0').state, 'out');
  assert.ok(game.events.some((e) => e.type === 'broke' && e.playerId === 'p0'));
  assert.equal(game.getStateFor('p0').my.next, false);
  assert.throws(() => game.handleAction('p0', 'next'), /plus de jetons/);
  game.handleAction('p1', 'next');
  assert.equal(game.phase, 'betting', 'seul J1 devait confirmer');
  assert.equal(game.roundNumber, 2);
  assert.equal(game.player('p0').state, 'out');
  assert.throws(() => game.handleAction('p0', 'bet', { amount: 10 }), /plus de jetons/);
  // J1 mise tout et perd : plus personne n'a de jetons
  stack(game, 'TS 9H 6C 8D');
  game.handleAction('p1', 'bet', { amount: 400 });
  game.handleAction('p1', 'stand');
  assert.equal(game.phase, 'gameOver');
  assert.equal(game.isOver(), true);
  assert.throws(() => game.handleAction('p1', 'next'), /terminée/);
});

test('la partie s’arrête après le nombre de donnes choisi ; « Donne suivante » attend tout le monde', () => {
  const game = new Blackjack({ players: players(2), options: { rounds: 2 }, rng: seeded(3) });
  for (let r = 1; r <= 2; r++) {
    assert.equal(game.roundNumber, r);
    game.handleAction('p0', 'bet', { amount: 10 });
    game.handleAction('p1', 'bet', { amount: 10 });
    while (game.phase === 'insurance') {
      for (const p of game.players) if (p.insurance?.status === 'pending') game.handleAction(p.id, 'insurance', { take: false });
    }
    finishRound(game);
    if (r === 1) {
      assert.equal(game.phase, 'roundEnd');
      game.handleAction('p0', 'next');
      assert.equal(game.phase, 'roundEnd', 'J1 n’a pas confirmé');
      game.handleAction('p0', 'next'); // sans effet
      game.handleAction('p1', 'next');
    }
  }
  assert.equal(game.phase, 'gameOver');
  assert.equal(game.summary.isLast, true);
  assert.equal(game.history.length, 2);
});

test('getResult : jetons finaux, gagné / perdu / égalité par rapport au départ, classement', () => {
  const game = new Blackjack({ players: players(3), options: { chips: 1000, rounds: 1 } });
  assert.equal(game.getResult(), null);
  stack(game, 'AS 9C TD KD 8C 9D');
  game.handleAction('p0', 'bet', { amount: 100 }); // As + Roi : blackjack
  game.handleAction('p1', 'bet', { amount: 100 }); // 9 + 8 = 17, contre 10 + 9 = 19
  game.handleAction('p2', 'sitout');
  finishRound(game);
  assert.equal(game.isOver(), true);
  const r = game.getResult();
  const by = Object.fromEntries(r.players.map((p) => [p.playerId, p]));
  assert.equal(by.p0.result, 'win');
  assert.equal(by.p0.score, 1150);
  assert.equal(by.p2.result, 'draw');
  assert.equal(by.p2.score, 1000);
  assert.equal(by.p1.result, 'loss');
  assert.match(r.summary, /^Classement : 1\. J0 \(1 150\), 2\. J2 \(1 000\), 3\. J1/);

  const solo = new Blackjack({ players: players(1), options: { rounds: 1 } });
  solo.handleAction('p0', 'sitout');
  assert.match(solo.getResult().summary, /J0 termine avec 1 000 jetons/);
  assert.equal(solo.getResult().players[0].result, 'draw');
});

// ---------------------------------------------------------------- sabot

test('sabot : 6 jeux, carte de coupe à 75 %, remélangé (et annoncé) avant la donne suivante', () => {
  const game = new Blackjack({ players: players(1), rng: seeded(11) });
  const s = game.getStateFor('p0');
  assert.equal(s.shoe.total, 312);
  assert.equal(s.shoe.remaining, 312);
  assert.equal(s.shoe.cutReached, false);
  game.handleAction('p0', 'bet', { amount: 10 });
  while (game.phase === 'insurance') game.handleAction('p0', 'insurance', { take: false });
  finishRound(game);
  const used = 312 - game.shoe.length;
  assert.ok(used >= 4);
  // on simule un sabot entamé au-delà de la carte de coupe
  game.dealtSinceShuffle = game.cut;
  assert.equal(game.getStateFor('p0').shoe.cutReached, true, 'carte de coupe sortie : visible de tous');
  game.handleAction('p0', 'next');
  assert.ok(game.events.some((e) => e.type === 'shuffle' && e.reason === 'cut'));
  assert.ok(game.log.some((l) => /mélangé/.test(l.text)));
  assert.equal(game.shoe.length, 312, 'toutes les cartes reviennent dans le sabot');
  assert.equal(game.discards.length, 0);
  assert.equal(game.getStateFor('p0').shoe.cutReached, false);
  assert.equal(game.cut, 234);

  // sans carte de coupe atteinte : pas de mélange, la défausse garde les cartes jouées
  const keep = new Blackjack({ players: players(1), rng: seeded(5) });
  keep.handleAction('p0', 'bet', { amount: 10 });
  while (keep.phase === 'insurance') keep.handleAction('p0', 'insurance', { take: false });
  finishRound(keep);
  const left = keep.shoe.length;
  keep.handleAction('p0', 'next');
  assert.equal(keep.shoe.length, left);
  assert.equal(keep.discards.length, 312 - left);
  assert.equal(keep.getStateFor('p0').discardCount, 312 - left);
});

test('sabot vide en pleine donne : la défausse est remélangée', () => {
  const game = dealt(1, [10], '2S 9H 3C 7D');
  game.discards = cards('5C 5D 5H 5S');
  game.shoe = [];
  game.handleAction('p0', 'hit');
  assert.ok(game.events.some((e) => e.type === 'shuffle' && e.reason === 'empty'));
  assert.equal(hand(game, 'p0').cards.at(-1).rank, 5);
});

// ---------------------------------------------------------------- secret

test('getStateFor ne révèle ni la carte cachée ni l’ordre du sabot', () => {
  const game = dealt(2, [10, 10], '9S 8H 7C QD 6S KH 4C 3C');
  // la carte cachée est le Roi de Cœur, 6e carte tirée (c6)
  const hole = game.dealer.cards[1];
  assert.equal(hole.id, 'c6');
  for (const pid of ['p0', 'p1']) {
    const s = game.getStateFor(pid);
    const json = JSON.stringify(s);
    assert.deepEqual(s.dealer.cards[1], { hidden: true });
    assert.equal(s.dealer.total, 7, 'seule la carte visible compte');
    assert.equal(s.dealer.text, '7');
    assert.ok(!json.includes('"c6"'), 'pas d’identifiant de la carte cachée');
    assert.ok(!/"suit":"H","rank":13\b/.test(json), 'pas de Roi de Cœur');
    assert.ok(!Object.hasOwn(s.shoe, 'cards') && typeof s.shoe.remaining === 'number', 'le sabot n’est qu’un compte');
    assert.ok(!/"suit":"C","rank":[34]\b/.test(json), 'cartes du sabot absentes');
    const deal = s.events.find((e) => e.type === 'deal');
    assert.deepEqual(deal.order.at(-1), { to: 'dealer', hole: true });
  }
  assert.ok(!game.log.some((l) => /Roi de Cœur/.test(l.text)), 'ni dans le journal');
  game.handleAction('p0', 'stand');
  game.handleAction('p1', 'stand');
  const after = game.getStateFor('p1');
  assert.equal(after.dealer.revealed, true);
  assert.deepEqual(after.dealer.cards[1], { id: 'c6', suit: 'H', rank: 13 }, 'retournée à la fin');
  assert.ok(after.events.some((e) => e.type === 'reveal' && e.card.id === 'c6'));
});

test('partie complète aléatoire de 1 à 5 joueurs : les jetons sont conservés jusqu’au règlement', () => {
  for (let n = 1; n <= 5; n++) {
    const rng = seeded(100 + n);
    const game = new Blackjack({ players: players(n), options: { chips: 500, rounds: 20 }, rng });
    let guard = 0;
    while (!game.isOver()) {
      if (++guard > 5000) throw new Error('boucle infinie');
      if (game.phase === 'betting') {
        for (const p of game.players) {
          if (p.state !== 'deciding') continue;
          if (rng() < 0.1) game.handleAction(p.id, 'sitout');
          else game.handleAction(p.id, 'bet', { amount: Math.max(Math.min(10, p.chips), Math.min(p.chips, 10 * (1 + Math.floor(rng() * 10)))) });
          if (game.phase !== 'betting') break;
        }
      } else if (game.phase === 'insurance') {
        const p = game.players.find((x) => x.insurance?.status === 'pending');
        game.handleAction(p.id, 'insurance', { take: rng() < 0.3 });
      } else if (game.phase === 'playing') {
        const p = game.currentPlayer();
        const my = game.getStateFor(p.id).my;
        const h = p.hands[game.turn.hand];
        const t = handValue(h.cards).total;
        if (my.split.ok && rng() < 0.6) game.handleAction(p.id, 'split');
        else if (my.double.ok && t >= 9 && t <= 11) game.handleAction(p.id, 'double');
        else game.handleAction(p.id, t < 17 && my.hit.ok ? 'hit' : 'stand');
      } else if (game.phase === 'roundEnd') {
        // conservation : jetons = départ + somme des gains nets
        for (const p of game.players) {
          const sum = game.history.reduce((a, h) => a + (h.changes[p.id] ?? 0), 0);
          assert.equal(p.chips, 500 + sum, `${n} joueurs : jetons cohérents`);
        }
        for (const p of game.players) if (p.state !== 'out') game.handleAction(p.id, 'next');
      }
    }
    assert.ok(game.history.length <= 20);
    assert.ok(game.players.every((p) => p.chips >= 0));
    const r = game.getResult();
    assert.equal(r.players.length, n);
  }
});

// ---------------------------------------------------------------- cas sensibles (revue)

/** Ni l'identifiant, ni la couleur et la valeur de la carte cachée dans la vue d'un joueur. */
function assertHoleHidden(game, pid, hole) {
  const s = game.getStateFor(pid);
  const json = JSON.stringify(s);
  assert.deepEqual(s.dealer.cards[1], { hidden: true });
  assert.equal(s.dealer.revealed, false);
  assert.ok(!json.includes(`"${hole.id}"`), 'pas d’identifiant de la carte cachée');
  assert.ok(!new RegExp(`"suit":"${hole.suit}","rank":${hole.rank}\\b`).test(json), 'ni sa couleur ni sa valeur');
  assert.equal(s.dealer.total, handValue(game.dealer.cards.slice(0, 1)).total, 'seule la carte visible compte');
}

test('secret : la carte cachée ne fuit ni pendant l’assurance (As visible), ni après une vérification sans blackjack', () => {
  // As visible, Roi caché : c'est la carte qui décide de tout pendant l'assurance
  const ins = dealt(2, [100, 50], '9S 8C AH 7D 6C KH');
  assert.equal(ins.phase, 'insurance');
  const hole = ins.dealer.cards[1];
  assert.equal(hole.id, 'c6');
  for (const pid of ['p0', 'p1']) assertHoleHidden(ins, pid, hole);
  ins.handleAction('p0', 'insurance', { take: true });
  for (const pid of ['p0', 'p1']) assertHoleHidden(ins, pid, hole); // une réponse ne trahit rien
  assert.ok(!ins.log.some((l) => /Roi de Cœur/.test(l.text)));

  // 10 visible, 5 caché : la banque a vérifié, la carte reste cachée pendant le jeu
  const peek = dealt(1, [10], '9S TH 7D 5C');
  assert.equal(peek.phase, 'playing');
  assert.ok(peek.events.some((e) => e.type === 'peek' && !e.blackjack));
  assertHoleHidden(peek, 'p0', peek.dealer.cards[1]);
  peek.handleAction('p0', 'hit');
  if (peek.phase === 'playing') assertHoleHidden(peek, 'p0', peek.dealer.cards[1]);
});

test('blackjack + assurance (« même argent ») : gain égal à la mise si elle est paire, que la banque ait un blackjack ou non', () => {
  // banque As + Roi : assurance payée, blackjack contre blackjack = égalité
  const bj = dealt(1, [100], 'AS AH KD KH');
  assert.equal(bj.phase, 'insurance');
  assert.equal(hand(bj, 'p0').blackjack, true);
  bj.handleAction('p0', 'insurance', { take: true });
  assert.equal(bj.phase, 'roundEnd');
  assert.equal(hand(bj, 'p0').result, 'push');
  assert.equal(bj.player('p0').insurance.status, 'won');
  assert.equal(chips(bj, 'p0'), 1100);
  // banque As + 7 : assurance perdue, blackjack payé 3 pour 2
  const no = dealt(1, [100], 'AS AH KD 7H');
  no.handleAction('p0', 'insurance', { take: true });
  assert.equal(no.phase, 'roundEnd', 'plus aucune main à jouer');
  assert.equal(no.player('p0').insurance.status, 'lost');
  assert.equal(hand(no, 'p0').result, 'blackjack');
  assert.equal(chips(no, 'p0'), 1100);
  // mise impaire (25) : assurance 12 -> +24 ou +25
  const odd = dealt(1, [25], 'AS AH KD KH');
  odd.handleAction('p0', 'insurance', { take: true });
  assert.equal(chips(odd, 'p0'), 1024);
  const odd2 = dealt(1, [25], 'AS AH KD 7H');
  odd2.handleAction('p0', 'insurance', { take: true });
  assert.equal(chips(odd2, 'p0'), 1025);
});

test('re-séparation : la main ajoutée se joue juste après, chaque deuxième carte arrive à son tour', () => {
  // J0 : 8 + 8 ; banque 9 + 7
  const game = dealt(1, [10], '8S 9H 8D 7D 8C 3C 8H 2H TC 9S TS');
  game.handleAction('p0', 'split'); // [8S 8C] [8D]
  assert.deepEqual(game.player('p0').hands.map((h) => h.cards.map((c) => `${c.rank}${c.suit}`)), [['8S', '8C'], ['8D']]);
  game.handleAction('p0', 'split'); // [8S 3C] [8C] [8D] : la nouvelle main s'insère juste après
  assert.deepEqual(game.player('p0').hands.map((h) => h.cards.map((c) => `${c.rank}${c.suit}`)), [['8S', '3C'], ['8C'], ['8D']]);
  assert.equal(game.turn.hand, 0);
  game.handleAction('p0', 'double'); // 8 + 3 + 8 = 19, mise 20
  assert.equal(game.turn.hand, 1);
  assert.deepEqual(hand(game, 'p0', 1).cards.map((c) => `${c.rank}${c.suit}`), ['8C', '2H'], 'deuxième carte à son tour');
  assert.equal(hand(game, 'p0', 2).cards.length, 1, 'la troisième main attend');
  game.handleAction('p0', 'hit'); // 8 + 2 + 10 = 20
  game.handleAction('p0', 'stand');
  assert.equal(game.turn.hand, 2);
  assert.deepEqual(hand(game, 'p0', 2).cards.map((c) => `${c.rank}${c.suit}`), ['8D', '9S']);
  game.handleAction('p0', 'stand');
  // banque 16 tire 10 : sautée, les trois mains gagnent
  assert.equal(game.phase, 'roundEnd');
  assert.deepEqual(game.player('p0').hands.map((h) => h.result), ['win', 'win', 'win']);
  assert.equal(chips(game, 'p0'), 1000 - 40 + 80);
  assert.equal(game.summary.players[0].net, 40);
});

test('textes des mains : « 8 / 18 » en cours, le total seul une fois la main finie (banque comprise)', () => {
  const game = dealt(1, [10], 'AS 9H 7D 9D');
  assert.equal(game.getStateFor('p0').players[0].hands[0].text, '8 / 18');
  game.handleAction('p0', 'stand');
  assert.equal(game.getStateFor('p0').players[0].hands[0].text, '18');
  assert.equal(game.summary.players[0].hands[0].text, '18');
  // la banque reste sur As + 7
  const d = dealt(1, [10], 'TS AH 9D 7C');
  assert.equal(d.phase, 'insurance');
  d.handleAction('p0', 'insurance', { take: false });
  assert.equal(d.getStateFor('p0').dealer.text, '1 / 11', 'carte visible seule, en cours');
  d.handleAction('p0', 'stand');
  assert.equal(d.getStateFor('p0').dealer.text, '18');
});

test('dernière donne où tout le monde passe : résumé « passé », pas celui de la donne précédente', () => {
  const game = new Blackjack({ players: players(2), options: { rounds: 2 }, rng: seeded(9) });
  stack(game, 'TS 9C 9H 6D 9D 7D KC 5S');
  game.handleAction('p0', 'bet', { amount: 10 });
  game.handleAction('p1', 'bet', { amount: 10 });
  finishRound(game);
  assert.equal(game.summary.roundNumber, 1);
  game.handleAction('p0', 'next');
  game.handleAction('p1', 'next');
  assert.equal(game.summary, null, 'nouvelle donne : plus de résumé');
  game.handleAction('p0', 'sitout');
  game.handleAction('p1', 'sitout');
  assert.equal(game.phase, 'gameOver');
  assert.equal(game.summary.roundNumber, 2);
  assert.equal(game.summary.skipped, true);
  assert.equal(game.summary.isLast, true);
  assert.equal(game.summary.dealer, null);
  assert.ok(game.summary.players.every((p) => !p.played && p.net === 0));
  assert.ok(game.events.some((e) => e.type === 'gameOver'));
  assert.equal(game.getStateFor('p0').summary.skipped, true);
});

test('revenir sur sa mise est refusé une fois la donne distribuée', () => {
  const game = dealt(1, [10], '9S 9H 7C 6D');
  assert.equal(game.phase, 'playing');
  assert.throws(() => game.handleAction('p0', 'unbet'), /closes/);
  assert.equal(chips(game, 'p0'), 990);
});

test('getResult : les ex æquo partagent la même place', () => {
  const tie = new Blackjack({ players: players(3), options: { rounds: 1 } });
  for (const p of ['p0', 'p1', 'p2']) tie.handleAction(p, 'sitout');
  assert.equal(tie.getResult().summary.replace(/\s/g, ' '), 'Classement : 1. J0 (1 000), 1. J1 (1 000), 1. J2 (1 000)');
  assert.ok(tie.getResult().players.every((p) => p.result === 'draw'));

  const game = dealt(3, [100, null, null], 'AS 9C KD 8C', { rounds: 1 });
  assert.equal(game.isOver(), true);
  assert.equal(game.getResult().summary.replace(/\s/g, ' '), 'Classement : 1. J0 (1 150), 2. J1 (1 000), 2. J2 (1 000)');
});
