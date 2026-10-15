'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Belote, legalCards, trickWinner, findAnnounces, announceKey, compareKeys } = require('../games/belote/server/Belote');
const { buildDeck, sumPoints, cardPoints, makeCard } = require('../games/belote/server/cards');
const beloteModule = require('../games/belote/server/index');

const players = () => ['p0', 'p1', 'p2', 'p3'].map((id, i) => ({ id, name: ['Léa', 'Malo', 'Inès', 'Yanis'][i] }));
const C = (id) => makeCard(id.slice(0, -1), id.slice(-1));
const H = (ids) => ids.split(' ').map(C);
const t = (playerId, id) => ({ playerId, card: C(id) });

/** Générateur pseudo-aléatoire reproductible. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Bot : prend parfois, annonce toujours ce qu'il peut, joue une carte légale au hasard. */
function playDeal(game, rng = Math.random) {
  let steps = 0;
  while (game.phase === 'bidding' || game.phase === 'playing') {
    if (++steps > 500) throw new Error('boucle infinie');
    const p = game.players[game.currentIndex];
    const s = game.getStateFor(p.id);
    if (s.phase === 'bidding') {
      if (rng() < 0.3) {
        const suit = s.bidRound === 1 ? undefined : ['S', 'H', 'D', 'C'].find((x) => x !== s.turned.suit);
        game.handleAction(p.id, 'take', { suit });
      } else game.handleAction(p.id, 'pass');
    } else {
      if (s.canAnnounce) game.handleAction(p.id, 'announce', {});
      game.handleAction(p.id, 'play', { cardId: s.legalCardIds[Math.floor(rng() * s.legalCardIds.length)] });
    }
  }
}

/** Mène une donne jusqu'au jeu de la carte : p1 prend au premier tour. */
function takenGame(opts = {}) {
  const game = new Belote({ players: players(), rng: seeded(opts.seed ?? 7), ...opts });
  game.handleAction('p0', 'pass');
  game.handleAction('p1', 'take');
  return game;
}

/** Fixe les mains et l'atout d'une donne en cours de jeu (8 cartes chacun, premier pli). */
function setHands(game, hands, trump, takerId = 'p1') {
  game.players.forEach((p, i) => { p.hand = H(hands[i]); });
  game.trump = trump;
  game.takerId = takerId;
  const holder = game.players.find((p) => ['R', 'D'].every((r) => p.hand.some((c) => c.suit === trump && c.rank === r)));
  game.beloteHolder = holder?.id ?? null;
}

// ================================================================ cartes

test('32 cartes, 152 points de cartes + dix de der = 162', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 32);
  assert.equal(new Set(deck.map((c) => c.id)).size, 32);
  for (const trump of ['S', 'H', 'D', 'C']) assert.equal(sumPoints(deck, trump), 152);
  assert.equal(sumPoints(H('VH 9H AH 10H RH DH 8H 7H'), 'H'), 62, 'atout : 20 + 14 + 11 + 10 + 4 + 3');
  assert.equal(sumPoints(H('AS 10S RS DS VS 9S 8S 7S'), 'H'), 30, 'hors atout : 11 + 10 + 4 + 3 + 2');
  const pts = (ids, trump) => ids.split(' ').map((id) => cardPoints(C(id), trump));
  assert.deepEqual(pts('VH 9H AH 10H RH DH 8H 7H', 'H'), [20, 14, 11, 10, 4, 3, 0, 0]);
  assert.deepEqual(pts('AS 10S RS DS VS 9S 8S 7S', 'H'), [11, 10, 4, 3, 2, 0, 0, 0]);
});

test('ordre des cartes : V 9 A 10 R D 8 7 à l’atout, A 10 R D V 9 8 7 ailleurs', () => {
  const wins = (a, b, trump) => trickWinner([t('p0', b), t('p1', a)], trump).playerId === 'p1';
  const trumpOrder = 'VH 9H AH 10H RH DH 8H 7H'.split(' ');
  const plainOrder = 'AS 10S RS DS VS 9S 8S 7S'.split(' ');
  for (let i = 0; i < 7; i++) {
    assert.ok(wins(trumpOrder[i], trumpOrder[i + 1], 'H'), `${trumpOrder[i]} bat ${trumpOrder[i + 1]} à l’atout`);
    assert.ok(!wins(trumpOrder[i + 1], trumpOrder[i], 'H'));
    assert.ok(wins(plainOrder[i], plainOrder[i + 1], 'H'), `${plainOrder[i]} bat ${plainOrder[i + 1]}`);
  }
  assert.ok(wins('7H', 'AS', 'H'), 'le plus petit atout coupe l’As');
  assert.ok(!wins('AD', '7S', 'H'), 'une autre couleur ne prend pas le pli');
  assert.equal(trickWinner([t('p0', '7S'), t('p1', 'AD'), t('p2', '8H'), t('p3', 'VS')], 'H').playerId, 'p2');
});

// ================================================================ donne et enchères

test('donne : 5 cartes chacun (3 puis 2), une carte retournée, 11 au talon', () => {
  const game = new Belote({ players: players(), rng: seeded(1) });
  assert.equal(game.phase, 'bidding');
  assert.ok(game.players.every((p) => p.hand.length === 5));
  assert.ok(game.turned);
  assert.equal(game.stock.length, 11);
  const all = [...game.players.flatMap((p) => p.hand), game.turned, ...game.stock].map((c) => c.id);
  assert.equal(new Set(all).size, 32);
  const s = game.getStateFor('p2');
  assert.equal(s.turned.id, game.turned.id, 'la carte retournée est publique');
  assert.equal(s.myHand.length, 5);
  assert.equal(s.dealerId, 'p3');
  assert.equal(s.currentPlayerId, 'p0', 'le joueur après le donneur parle en premier');
  assert.equal(s.cutterId, 'p2', 'le joueur avant le donneur coupe');
});

test('premier tour : prendre la couleur retournée, puis distribution 2 + retournée / 3', () => {
  const game = new Belote({ players: players(), rng: seeded(2) });
  const turned = game.turned;
  assert.throws(() => game.handleAction('p1', 'pass'), /pas ton tour/);
  game.handleAction('p0', 'pass');
  const other = ['S', 'H', 'D', 'C'].find((x) => x !== turned.suit);
  assert.throws(() => game.handleAction('p1', 'take', { suit: other }), /premier tour/);
  game.handleAction('p1', 'take');
  assert.equal(game.trump, turned.suit);
  assert.equal(game.takerId, 'p1');
  assert.ok(game.players.every((p) => p.hand.length === 8));
  assert.ok(game.player('p1').hand.some((c) => c.id === turned.id), 'le preneur a la retournée');
  assert.equal(game.stock.length, 0);
  assert.equal(new Set(game.players.flatMap((p) => p.hand).map((c) => c.id)).size, 32);
  assert.equal(game.phase, 'playing');
  const s = game.getStateFor('p3');
  assert.equal(s.currentPlayerId, 'p0', 'le joueur après le donneur entame');
  assert.equal(s.trump, turned.suit);
  assert.ok(s.turnedTaken);
});

test('second tour : une autre couleur, sinon redistribution par le donneur suivant', () => {
  const game = new Belote({ players: players(), rng: seeded(3) });
  for (const id of ['p0', 'p1', 'p2', 'p3']) game.handleAction(id, 'pass');
  assert.equal(game.bidRound, 2);
  assert.equal(game.getStateFor('p0').currentPlayerId, 'p0');
  assert.throws(() => game.handleAction('p0', 'take', { suit: game.turned.suit }), /refusé/);
  assert.throws(() => game.handleAction('p0', 'take', {}), /couleur/);
  game.handleAction('p0', 'pass');
  const other = ['S', 'H', 'D', 'C'].find((x) => x !== game.turned.suit);
  game.handleAction('p1', 'take', { suit: other });
  assert.equal(game.trump, other);
  assert.ok(game.players.every((p) => p.hand.length === 8));

  const redeal = new Belote({ players: players(), rng: seeded(4) });
  for (let k = 0; k < 8; k++) redeal.handleAction(redeal.players[redeal.currentIndex].id, 'pass');
  assert.equal(redeal.phase, 'bidding');
  assert.equal(redeal.bidRound, 1);
  assert.equal(redeal.getStateFor('p0').dealerId, 'p0', 'le donneur suivant distribue');
  assert.equal(redeal.getStateFor('p0').currentPlayerId, 'p1');
  assert.equal(redeal.dealNumber, 1, 'une donne non jouée ne compte pas');
  assert.ok(redeal.events.some((e) => e.type === 'allPass'));
  const all = [...redeal.players.flatMap((p) => p.hand), redeal.turned, ...redeal.stock].map((c) => c.id);
  assert.equal(new Set(all).size, 32, 'les 32 cartes sont ramassées puis coupées');
});

// ================================================================ cartes jouables

test('fournir, couper, partenaire maître, surcouper, pas de sous-coupe', () => {
  const ids = (cards) => cards.map((c) => c.id).sort();
  const hand = H('7S AS 8H VD 9D');
  // fournir
  assert.deepEqual(ids(legalCards(hand, [t('p1', 'RS')], 'D', 'p2')), ['7S', 'AS']);
  // pas de Cœur, adversaire maître : couper (n'importe quel atout, aucun atout posé)
  assert.deepEqual(ids(legalCards(H('7S AS VD 9D'), [t('p1', 'RH')], 'D', 'p2')), ['9D', 'VD']);
  // partenaire maître : libre
  assert.deepEqual(ids(legalCards(H('7S AS VD 9D'), [t('p2', 'AH'), t('p3', '7H')], 'D', 'p2')), ['7S', '9D', 'AS', 'VD']);
  // partenaire maître par une coupe : libre aussi (sous-coupe permise)
  assert.equal(legalCards(H('7S 8D'), [t('p1', 'AH'), t('p2', 'AD'), t('p3', '7H')], 'D', 'p2').length, 2);
  // adversaire a coupé : surcouper si possible
  assert.deepEqual(ids(legalCards(H('7S 8D 9D'), [t('p2', 'AH'), t('p3', 'AD')], 'D', 'p1')), ['9D']);
  // adversaire a coupé et on ne peut pas monter : se défausser, pas de sous-coupe
  assert.deepEqual(ids(legalCards(H('7S 8D 10S'), [t('p2', 'AH'), t('p3', 'AD')], 'D', 'p1')), ['10S', '7S']);
  // que de l'atout plus faible : sous-couper
  assert.deepEqual(ids(legalCards(H('7D 8D'), [t('p2', 'AH'), t('p3', 'AD')], 'D', 'p1')), ['7D', '8D']);
  // ni couleur ni atout : libre
  assert.equal(legalCards(H('7S AC'), [t('p1', 'RH')], 'D', 'p2').length, 2);
  // atout demandé : monter, même sur son partenaire
  assert.deepEqual(ids(legalCards(H('7D AD 9D 8S'), [t('p2', '10D'), t('p3', '8D')], 'D', 'p2')), ['9D', 'AD']);
  // atout demandé, impossible de monter : atout quelconque
  assert.deepEqual(ids(legalCards(H('7D 8D 8S'), [t('p1', 'VD')], 'D', 'p2')), ['7D', '8D']);
  // atout demandé, pas d'atout : libre
  assert.equal(legalCards(H('7S 8S'), [t('p1', 'VD')], 'D', 'p2').length, 2);
  // entame : tout
  assert.equal(legalCards(hand, [], 'D', 'p2').length, 5);
});

test('le moteur refuse une carte interdite avec la raison', () => {
  const game = takenGame();
  setHands(game, ['7S AS 8H VD 9D RC DC 7C', 'RS 10S 9S 8S 7H 8C 9C 10C', 'DS VS AH RH DH VH 9H 10H', 'AC VC 7D 8D 10D AD RD DD'], 'D');
  game.handleAction('p0', 'play', { cardId: '7S' });
  assert.throws(() => game.handleAction('p1', 'play', { cardId: '7H' }), /fournir à Pique/);
  game.handleAction('p1', 'play', { cardId: 'RS' });
  assert.throws(() => game.handleAction('p2', 'play', { cardId: 'AH' }), /fournir/);

  // pas de Pique, l'adversaire est maître : couper, puis surcouper
  const cut = takenGame();
  setHands(cut, ['AS 7H 8H 9H 10H VH DH RH', '8D AD 7C 8C 9C 10C VC DC', 'VD 7D 10D 9D RD DD AC RC', '7S 8S 9S 10S VS DS RS AH'], 'D');
  cut.handleAction('p0', 'play', { cardId: 'AS' });
  assert.throws(() => cut.handleAction('p1', 'play', { cardId: '7C' }), /^Error: Tu dois couper\.$/);
  cut.handleAction('p1', 'play', { cardId: '8D' });
  assert.throws(() => cut.handleAction('p2', 'play', { cardId: 'AC' }), /^Error: Tu dois couper\.$/);
  assert.throws(() => cut.handleAction('p2', 'play', { cardId: '7D' }), /Tu dois monter à l’atout si tu le peux/);

  // atout demandé : monter
  const up = takenGame();
  setHands(up, ['AD 7S 8S 9S 10S VS DS RS', '7D 9D 7C 8C 9C 10C VC DC', 'AS AH 7H 8H 9H 10H VH DH', 'RH AC 8D 10D VD RC RD DD'], 'D');
  up.handleAction('p0', 'play', { cardId: 'AD' });
  assert.throws(() => up.handleAction('p1', 'play', { cardId: '7D' }), /^Error: Tu dois monter à l’atout\.$/);
  assert.throws(() => up.handleAction('p1', 'play', { cardId: '7C' }), /Tu dois jouer atout/);
});

// ================================================================ ordre de jeu, plis, dix de der

test('ordre de jeu : le gagnant du pli entame, dix de der au dernier pli, 162 au total', () => {
  const game = takenGame();
  setHands(game, ['7S AS 8H VD 9D RC DC 7C', 'RS 10S 9S 8S 7H 8C 9C 10C', 'DS VS AH RH DH VH 9H 10H', 'AC VC 7D 8D 10D AD RD DD'], 'D');
  game.handleAction('p0', 'play', { cardId: 'AS' });
  game.handleAction('p1', 'play', { cardId: 'RS' });
  game.handleAction('p2', 'play', { cardId: 'DS' });
  game.handleAction('p3', 'play', { cardId: 'AD' }); // coupe
  assert.equal(game.lastTrick.winnerId, 'p3');
  assert.equal(game.lastTrick.points, 11 + 4 + 3 + 11);
  assert.equal(game.getStateFor('p0').currentPlayerId, 'p3', 'le gagnant entame');
  playDeal(game, seeded(9));
  const m = game.summary;
  assert.equal(m.cardPoints[0] + m.cardPoints[1], 162);
  assert.equal(game.history.length, 1);
  assert.equal(m.derTeam, game.player(game.lastTrick.winnerId).team);
  assert.ok(game.lastTrick.points >= 10, 'le dernier pli compte le dix de der');
});

test('belote et rebelote : annoncées en jouant le Roi puis la Dame d’atout, 20 points', () => {
  const game = takenGame();
  setHands(game, ['RD DD 7S 8S 9S 10S VS AS', 'AH 10H RH DH VH 9H 8H 7H', '7D 8D 7C 8C 9C 10C VC DC', 'AD 10D 9D VD AC RC RS DS'], 'D', 'p1');
  assert.equal(game.beloteHolder, 'p0');
  assert.equal(game.getStateFor('p1').belote, null, 'la belote reste secrète');
  assert.equal(game.getStateFor('p1').myBelote, false);
  assert.equal(game.getStateFor('p0').myBelote, true);
  game.handleAction('p0', 'play', { cardId: 'RD' });
  assert.equal(game.events.at(-1).belote, 'belote');
  assert.deepEqual(game.getStateFor('p1').belote, { playerId: 'p0', step: 'belote' });
  // atout demandé : le partenaire, qui ne peut pas monter, joue un petit atout ; l'adversaire doit monter
  assert.throws(() => game.handleAction('p1', 'play', { cardId: 'x' }), /pas dans ta main/);
  for (const [pid, id] of [['p1', 'AH'], ['p2', '7D'], ['p3', 'VD']]) game.handleAction(pid, 'play', { cardId: id });
  assert.equal(game.lastTrick.winnerId, 'p3');
  playDeal(game, seeded(5));
  const re = game.events.find((e) => e.type === 'play' && e.belote === 'rebelote');
  assert.equal(re.playerId, 'p0');
  assert.equal(re.card.id, 'DD');
  assert.deepEqual(game.summary.belote, [20, 0]);
});

// ================================================================ annonces

test('annonces : détection des séquences et des carrés', () => {
  const a = findAnnounces(H('7H 8H 9H VS VH VD VC AS'));
  assert.deepEqual(a.map((x) => x.key).sort(), ['carre-V', 'seq-H-9'].sort());
  assert.equal(a.find((x) => x.key === 'carre-V').points, 200);
  const seq = findAnnounces(H('9S 10S VS DS RS 7H 8D 7C'));
  assert.equal(seq.length, 1);
  assert.equal(seq[0].points, 100, 'cinq cartes : cent');
  assert.equal(seq[0].label, 'Cent au Roi de Pique');
  assert.equal(findAnnounces(H('10C VC DC RC 7H 8D 7S 9H'))[0].points, 50);
  assert.equal(findAnnounces(H('7S 7H 7D 7C 9H AD 10S 8C')).length, 0, 'pas de carré de 7');
  assert.equal(findAnnounces(H('9S 9H 9D 9C VH AD 10S 8C'))[0].points, 150);
});

test('annonces : comparaison (valeur, carré, hauteur, atout, premier à parler)', () => {
  const k = (ids, trump, order) => {
    const [best] = findAnnounces(H(ids)).sort((x, y) => y.points - x.points);
    return announceKey(best, trump, order);
  };
  const better = (a, b) => compareKeys(a, b) > 0;
  assert.ok(better(k('VS VH VD VC 7S 8H 9D 7C', 'H', 3), k('9S 9H 9D 9C 7S 8H 7D 7C', 'H', 0)), 'carré de Valets > carré de 9');
  assert.ok(better(k('9S 9H 9D 9C 7S 8H 7D 7C', 'H', 3), k('9S 10S VS DS RS 7H 8D 7C', 'H', 0)), 'carré de 9 > cent');
  assert.ok(better(k('AS AH AD AC 7S 8H 7D 7C', 'H', 3), k('9S 10S VS DS RS 7H 8D 7C', 'H', 0)), 'carré de 100 > cent');
  assert.ok(better(k('AS AH AD AC 7S 8H 7D 7C', 'H', 3), k('DS DH DD DC 7S 8H 7D 7C', 'H', 0)), 'carré d’As > carré de Dames');
  assert.ok(better(k('DS RS AS 7H 8D 7C 9H 8C', 'H', 3), k('VS DS RS 7H 8D 7C 9H 8C', 'H', 0)), 'tierce à l’As > tierce au Roi');
  assert.ok(better(k('VH DH RH 7S 8D 7C 9S 8C', 'H', 3), k('VS DS RS 7H 8D 7C 9H 8C', 'H', 0)), 'à hauteur égale, la séquence à l’atout');
  assert.ok(better(k('VS DS RS 7H 8D 7C 9H 8C', 'H', 0), k('VC DC RC 7H 8D 7S 9H 8S', 'H', 2)), 'puis le premier à parler');
  assert.ok(better(k('7C 8C 9C 10C 7H 8D 7S 9H', 'H', 3), k('VS DS RS 7H 8D 7C 9H 8C', 'H', 0)), 'cinquante > tierce');
});

test('annonces : dites au premier pli, montrées au deuxième, seule la meilleure équipe marque', () => {
  const game = takenGame();
  setHands(game, [
    '7S 8S 9S AH 7D 8D 9D 10C', // p0 : deux tierces (♠ au 9, ♦ au 9)
    'VC DC RC AC 7H 8H 10H 9C', // p1 : cinquante à l'As de Trèfle
    'VS DS RS 10S 9H VH DH RH', // p2 : cinquante au Roi de Pique + tierce au Roi de Cœur
    'AS 10D VD DD RD AD 8C 7C', // p3 : cent à l'As de Carreau
  ], 'H');
  const s0 = game.getStateFor('p0');
  assert.ok(s0.canAnnounce);
  assert.equal(s0.myAnnounces.length, 2);
  assert.throws(() => game.handleAction('p1', 'announce', {}), /pas ton tour/);
  game.handleAction('p0', 'announce', {});
  assert.throws(() => game.handleAction('p0', 'announce', {}), /déjà annoncé/);
  game.handleAction('p0', 'play', { cardId: 'AH' });
  game.handleAction('p1', 'announce', {});
  const seen = game.getStateFor('p2');
  assert.deepEqual(seen.players.find((p) => p.id === 'p1').announced, ['Cinquante'], 'le genre seulement');
  assert.equal(seen.announceResult, null, 'les cartes ne sont montrées qu’au deuxième pli');
  assert.ok(!JSON.stringify(seen).includes('"AC"'), 'les cartes de l’annonce restent cachées');
  game.handleAction('p1', 'play', { cardId: '7H' });
  game.handleAction('p2', 'announce', {});
  game.handleAction('p2', 'play', { cardId: '9H' });
  // p3 ne dit rien et joue : il perd son annonce
  assert.ok(game.getStateFor('p3').canAnnounce);
  game.handleAction('p3', 'play', { cardId: '7C' });
  assert.throws(() => game.handleAction('p3', 'announce', {}));
  const r = game.getStateFor('p3').announceResult;
  // meilleure annonce : la cinquante à l'As de p1 (plus haute que la cinquante au Roi de p2) ; le cent de p3 n'a pas été dit
  assert.equal(r.team, 1);
  assert.equal(r.bestPlayerId, 'p1');
  assert.equal(r.points, 50, 'l’autre équipe ne marque aucune de ses annonces');
  assert.deepEqual(r.list.map((a) => [a.playerId, a.label]), [['p1', 'Cinquante à l’As de Trèfle']]);
  assert.deepEqual(r.list[0].cards, ['VC', 'DC', 'RC', 'AC'], 'les cartes sont montrées à tous');
  assert.throws(() => game.handleAction(game.players[game.currentIndex].id, 'announce', {}), /premier pli/);
});

test('annonces : sans l’option, seule la belote compte', () => {
  const game = takenGame({ announces: false });
  setHands(game, ['7S 8S 9S AH 7D 8D 9D 10C', 'VC DC RC AC 7H 8H 10H 9C', 'VS DS RS 10S 9H VH DH RH', 'AS 10D VD DD RD AD 8C 7C'], 'H');
  const s = game.getStateFor('p0');
  assert.equal(s.canAnnounce, false);
  assert.deepEqual(s.myAnnounces, []);
  assert.throws(() => game.handleAction('p0', 'announce', {}), /annonces/);
});

// ================================================================ décompte

/** Termine une donne avec des points imposés : plis par joueur, points des cartes, annonces, belote. */
function finish(game, { taker = 'p0', points, tricks = { p0: 4, p1: 4 }, ann = null, belote = null }) {
  game.takerId = taker;
  game.trump = 'H';
  game.trickPoints = [...points];
  game.tricksWon = { ...tricks };
  game.lastTrick = { cards: [], winnerId: Object.keys(tricks).find((id) => tricks[id] > 0), number: 8, points: 10 };
  game.announceResult = ann ? { team: ann[0], points: ann[1], list: [] } : null;
  game.beloteHolder = belote;
  game.won = [buildDeck(), []];
  game.scoreDeal();
  return game.summary;
}

test('décompte : contrat réussi, dedans, belote gardée, capot', () => {
  const g = () => new Belote({ players: players(), rng: seeded(11) });
  let m = finish(g(), { points: [100, 62] });
  assert.equal(m.result, 'made');
  assert.deepEqual(m.scored, [100, 62]);

  m = finish(g(), { points: [70, 92] });
  assert.equal(m.result, 'dedans');
  assert.deepEqual(m.scored, [0, 162]);

  m = finish(g(), { points: [72, 90], ann: [0, 20] });
  assert.equal(m.result, 'made', '72 + 20 = 92 contre 90');
  assert.deepEqual(m.scored, [92, 90]);

  m = finish(g(), { points: [70, 92], ann: [0, 20] });
  assert.equal(m.result, 'dedans', '90 contre 92 : dedans');
  assert.deepEqual(m.scored, [0, 182], 'la défense marque 162 et toutes les annonces');

  m = finish(g(), { points: [60, 102], belote: 'p2' });
  assert.equal(m.result, 'dedans');
  assert.deepEqual(m.scored, [20, 162], 'la belote reste au preneur même dedans');

  m = finish(g(), { points: [81, 81], belote: 'p1' });
  assert.equal(m.result, 'dedans', 'la belote de la défense compte dans la comparaison');
  assert.deepEqual(m.scored, [0, 182]);

  m = finish(g(), { points: [162, 0], tricks: { p0: 5, p2: 3 } });
  assert.equal(m.capot, 0);
  assert.deepEqual(m.scored, [252, 0], 'capot : 252');

  m = finish(g(), { points: [0, 162], tricks: { p1: 5, p3: 3 } });
  assert.equal(m.result, 'dedans');
  assert.deepEqual(m.scored, [0, 252], 'capot de la défense');

  m = finish(g(), { points: [162, 0], tricks: { p0: 8 }, ann: [0, 50], belote: 'p0' });
  assert.deepEqual(m.scored, [252 + 50 + 20, 0]);
});

test('décompte : litige, les points du preneur vont au gagnant de la donne suivante', () => {
  const game = new Belote({ players: players(), rng: seeded(12) });
  let m = finish(game, { points: [81, 81] });
  assert.equal(m.result, 'litige');
  assert.deepEqual(m.scored, [0, 81]);
  assert.equal(game.pending, 81);
  assert.deepEqual(game.scores, [0, 81]);
  assert.equal(game.getStateFor('p0').pending, 81);
  game.phase = 'dealEnd';
  game.handleAction('p0', 'next');
  m = finish(game, { taker: 'p1', points: [50, 112] });
  assert.equal(m.result, 'made');
  assert.deepEqual(m.bonus, [0, 81], 'l’équipe qui gagne la donne suivante prend le litige');
  assert.equal(game.pending, 0);
  assert.deepEqual(game.scores, [50, 81 + 112 + 81]);
});

test('donnes jouées au hasard : 162 (+ annonces, belote) par donne, partie jusqu’au but', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const game = new Belote({ players: players(), rng, target: 501, announces: seed % 2 === 0 });
    let guard = 0;
    while (!game.isOver()) {
      if (++guard > 80) throw new Error('partie sans fin');
      playDeal(game, rng);
      const m = game.summary;
      const base = m.capot !== null ? 252 : 162;
      assert.equal(m.cards[0] + m.cards[1], base);
      const extra = m.announces[0] + m.announces[1] + m.belote[0] + m.belote[1];
      assert.equal(m.scored[0] + m.scored[1] + m.held, base + extra, `donne ${m.dealNumber} (${m.result})`);
      assert.ok(m.announces[0] === 0 || m.announces[1] === 0, 'une seule équipe marque ses annonces');
      if (!game.isOver()) game.handleAction('p2', 'next');
    }
    const res = game.getResult();
    const w = game.scores[0] > game.scores[1] ? 0 : 1;
    assert.ok(game.scores[w] >= 501);
    assert.deepEqual(res.players.map((p) => p.result), w === 0 ? ['win', 'loss', 'win', 'loss'] : ['loss', 'win', 'loss', 'win']);
    assert.ok(res.players.every((p) => p.score === game.scores[game.player(p.playerId).team]));
  }
});

test('fin de partie : au but en fin de donne, égalité = une donne de plus, résumé des stats', () => {
  const game = new Belote({ players: players(), rng: seeded(13), target: 501 });
  game.scores = [480, 300];
  finish(game, { points: [100, 62] });
  assert.ok(game.isOver());
  assert.equal(game.phase, 'gameOver');
  assert.throws(() => game.handleAction('p0', 'next'), /terminée/);
  const r = game.getResult();
  assert.equal(r.summary, 'Équipe A (Léa & Inès) gagne 580 à 362');
  assert.deepEqual(r.players.map((p) => [p.playerId, p.result, p.score]), [['p0', 'win', 580], ['p1', 'loss', 362], ['p2', 'win', 580], ['p3', 'loss', 362]]);

  const tie = new Belote({ players: players(), rng: seeded(14), target: 501 });
  tie.scores = [500, 520];
  finish(tie, { points: [100, 80] });
  assert.deepEqual(tie.scores, [600, 600]);
  assert.equal(tie.phase, 'dealEnd', 'égalité au-delà du but : on continue');
  assert.equal(tie.getResult(), null);
});

test('donne suivante : le donneur tourne, le paquet est reformé avec les plis puis coupé', () => {
  const game = new Belote({ players: players(), rng: seeded(15) });
  while (game.phase !== 'dealEnd') {
    playDeal(game, seeded(16));
    if (game.phase === 'gameOver') return;
  }
  assert.equal(game.deck.length, 32, 'les plis forment le paquet');
  assert.throws(() => game.handleAction('p0', 'play', { cardId: 'x' }), /moment/);
  game.handleAction('p3', 'next');
  assert.equal(game.dealNumber, 2);
  assert.equal(game.getStateFor('p0').dealerId, 'p0');
  assert.equal(game.getStateFor('p0').currentPlayerId, 'p1');
  assert.ok(game.players.every((p) => p.hand.length === 5));
});

// ================================================================ secret

test('getStateFor ne montre jamais la main des autres', () => {
  const game = new Belote({ players: players(), rng: seeded(17) });
  const leak = (s, pid) => game.players.filter((p) => p.id !== pid).some((p) => p.hand.some((c) => JSON.stringify(s).includes(`"id":"${c.id}"`)));
  for (const p of game.players) {
    const s = game.getStateFor(p.id);
    assert.ok(!leak(s, p.id), `enchères : ${p.id}`);
    assert.ok(!JSON.stringify(s).includes(game.stock[0].id + '"'), 'le talon reste caché');
  }
  game.handleAction('p0', 'pass');
  game.handleAction('p1', 'take');
  const turned = game.turned.id;
  for (const p of game.players) {
    const s = game.getStateFor(p.id);
    const others = game.players.filter((o) => o.id !== p.id).flatMap((o) => o.hand).filter((c) => c.id !== turned);
    assert.ok(others.every((c) => !JSON.stringify(s).includes(`"id":"${c.id}"`)), `jeu : ${p.id}`);
    assert.ok(!('hand' in s.players[0]));
  }
});

test('getStateFor : aucune fuite sur deux donnes complètes avec annonces (plis, annonces, belote, fin de donne)', () => {
  const game = new Belote({ players: players(), rng: seeded(2), announces: true }); // graine : annonces aux deux donnes, belote jouée
  let checked = 0;
  const seen = { announces: 0, belote: 0 };
  const check = () => {
    if (game.announceResult) seen.announces++;
    if (game.beloteShown) seen.belote++;
    const dealEvent = [...game.events].reverse().find((e) => e.type === 'deal');
    for (const p of game.players) {
      const s = game.getStateFor(p.id);
      // ce qui concerne la donne en cours (les événements des donnes précédentes portent des cartes déjà jouées)
      const view = { ...s, events: s.events.filter((e) => e.id >= dealEvent.id), history: [], log: [], announceResult: null };
      const json = JSON.stringify(view);
      const allowed = new Set(game.turned && !s.turnedTaken ? [] : [game.turned?.id]);
      for (const o of game.players) {
        if (o.id === p.id) continue;
        for (const c of o.hand) {
          if (allowed.has(c.id)) continue;
          assert.ok(!json.includes(`"${c.id}"`), `donne ${game.dealNumber}, ${game.phase} : ${p.id} voit ${c.id} de ${o.id}`);
        }
      }
      // les cartes des autres n'apparaissent que dans les annonces montrées au deuxième pli
      if (s.announceResult) {
        assert.ok(game.trickNumber > 1 || game.phase !== 'playing', 'annonces montrées après le premier pli');
        for (const a of s.announceResult.list) assert.ok(Array.isArray(a.cards));
      }
      for (const pl of s.players) {
        assert.ok(!('hand' in pl));
        assert.ok(pl.announced.every((k) => typeof k === 'string'), 'le genre seulement');
      }
      if (p.id !== game.beloteHolder) {
        assert.equal(s.myBelote, false, `${p.id} ne sait pas qui a la belote`);
        assert.ok(!('beloteHolder' in s));
      }
      if (!game.beloteShown) assert.equal(s.belote, null);
      checked++;
    }
  };
  for (let deal = 1; deal <= 2; deal++) {
    let steps = 0;
    check();
    while (game.phase === 'bidding' || game.phase === 'playing') {
      if (++steps > 500) throw new Error('boucle infinie');
      const p = game.players[game.currentIndex];
      const s = game.getStateFor(p.id);
      if (s.phase === 'bidding') game.handleAction(p.id, s.bidRound === 1 && steps > 2 ? 'take' : 'pass');
      else {
        if (s.canAnnounce) { game.handleAction(p.id, 'announce', {}); check(); }
        game.handleAction(p.id, 'play', { cardId: s.legalCardIds[0] });
      }
      check();
    }
    assert.ok(game.phase === 'dealEnd' || game.phase === 'gameOver');
    if (game.phase === 'dealEnd') { game.handleAction('p0', 'next'); assert.equal(game.dealNumber, deal + 1); }
  }
  assert.ok(checked > 200);
  assert.ok(seen.announces > 0 && seen.belote > 0, 'la graine couvre annonces et belote');
});

test('module : options du salon (but, annonces) et 4 joueurs exactement', () => {
  assert.equal(beloteModule.minPlayers, 4);
  assert.equal(beloteModule.maxPlayers, 4);
  assert.deepEqual(beloteModule.options.map((o) => [o.id, o.default]), [['target', 1001], ['announces', 'oui']]);
  const g = beloteModule.createGame({ players: players(), options: { target: 501, announces: 'non' } });
  assert.equal(g.target, 501);
  assert.equal(g.announcesOn, false);
  const d = beloteModule.createGame({ players: players() });
  assert.equal(d.target, 1001);
  assert.equal(d.announcesOn, true);
  assert.throws(() => beloteModule.createGame({ players: players().slice(0, 3) }), /4 joueurs/);
  assert.throws(() => g.handleAction('p0', 'danse'), /inconnue/);
});
