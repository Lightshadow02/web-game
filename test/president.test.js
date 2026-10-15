'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { President, makeOrder, titlesFor, needText, POINTS } = require('../games/president/server/President');
const { buildDeck, parseCard, sortHand, power, shuffle } = require('../games/president/server/cards');
const manifest = require('../games/president/server/index');

// ---------------------------------------------------------------- utilitaires

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` }));
const ids = (s) => s.trim().split(/\s+/);

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partie aux mains imposées : hands = { [manche]: ['3C 4H', '5S …', …] } (ou une liste pour la 1re manche). */
function rigged(n, hands, options = {}) {
  const byRound = Array.isArray(hands) ? { 1: hands } : hands;
  return new President({ players: players(n), options, rng: seeded(7), rig: (round) => byRound[round]?.map(ids) ?? null });
}
const cur = (g) => g.getStateFor('p0').currentPlayerId;
const play = (g, pid, s) => g.handleAction(pid, 'play', { cardIds: ids(s) });
const pass = (g, pid) => g.handleAction(pid, 'pass');
const hand = (g, pid) => g.players.find((p) => p.id === pid).hand.map((c) => c.id);
const eventsOf = (g, type) => g.events.filter((e) => e.type === type);
const err = (fn, re) => assert.throws(fn, (e) => e.isGameError && re.test(e.message));

/** Robot simple : entame avec sa plus petite valeur (toutes ses cartes de cette valeur), suit au plus juste, sinon passe. */
function botMove(g) {
  const pid = g.getStateFor('p0').currentPlayerId;
  const s = g.getStateFor(pid);
  const groups = new Map();
  for (const c of s.myHand) groups.set(c.rank, [...(groups.get(c.rank) ?? []), c.id]);
  const order = makeOrder({ revolution: s.revolution, twoCloses: s.options.twoCloses });
  const ranks = [...groups.keys()].sort((a, b) => order.value(a) - order.value(b));
  const top = s.pile.at(-1);
  if (!top) {
    g.handleAction(pid, 'play', { cardIds: groups.get(ranks[0]).slice(0, 4) });
    return;
  }
  const r = ranks.find((x) => groups.get(x).length >= top.count && order.canBeat(x, top.rank));
  if (r == null) g.handleAction(pid, 'pass');
  else g.handleAction(pid, 'play', { cardIds: groups.get(r).slice(0, top.count) });
}
/** Échange par les robots : chaque receveur rend ses plus petites cartes. */
function botExchange(g) {
  for (const pair of g.getStateFor('p0').exchange.pairs) {
    if (pair.done) continue;
    const s = g.getStateFor(pair.receiverId);
    g.handleAction(pair.receiverId, 'give', { cardIds: s.myHand.slice(0, pair.count).map((c) => c.id) });
  }
}
function playRound(g) {
  let guard = 0;
  if (g.phase === 'exchange') botExchange(g);
  while (g.phase === 'playing') {
    if (++guard > 2000) throw new Error('boucle');
    botMove(g);
  }
}

// ================================================================ cartes et ordre

test('paquet de 52 cartes, ordre 3 < 4 < … < R < As < 2', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  assert.deepEqual(parseCard('10H'), { id: '10H', rank: 10, suit: 'H' });
  assert.deepEqual(parseCard('AS'), { id: 'AS', rank: 14, suit: 'S' });
  assert.deepEqual(parseCard('2C'), { id: '2C', rank: 2, suit: 'C' });
  const order = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];
  for (let i = 1; i < order.length; i++) assert.ok(power(order[i]) > power(order[i - 1]));
  assert.deepEqual(sortHand(['2C', 'AS', '3D', 'KH', '3S'].map(parseCard)).map((c) => c.id), ['3S', '3D', 'KH', 'AS', '2C']);

  const normal = makeOrder({ twoCloses: false });
  assert.ok(normal.canBeat(4, 3));
  assert.ok(normal.canBeat(14, 13));
  assert.ok(normal.canBeat(2, 14));
  assert.ok(!normal.canBeat(9, 9), 'valeur égale refusée');
  assert.ok(!normal.canBeat(3, 2));
  assert.ok(normal.unbeatable(2));
  assert.ok(!normal.unbeatable(14));

  const rev = makeOrder({ revolution: true, twoCloses: false });
  assert.ok(rev.canBeat(3, 4), 'révolution : plus bas = plus fort');
  assert.ok(!rev.canBeat(2, 5), 'sans « le 2 ferme », le 2 devient le plus faible');
  assert.ok(rev.unbeatable(3));
  assert.ok(!rev.unbeatable(2));

  const revTwo = makeOrder({ revolution: true, twoCloses: true });
  assert.ok(revTwo.canBeat(2, 3), 'le 2 qui ferme garde son pouvoir en révolution');
  assert.ok(!revTwo.unbeatable(3));
  assert.ok(revTwo.unbeatable(2));
});

test('distribution : tout le paquet, inégale à 5-8 joueurs (les premiers servis, après l’hôte, ont une carte de plus)', () => {
  for (let n = 3; n <= 8; n++) {
    const g = new President({ players: players(n), rng: seeded(n) });
    const counts = g.players.map((p) => p.hand.length);
    assert.equal(counts.reduce((a, b) => a + b, 0), 52, `${n} joueurs`);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    const big = Math.ceil(52 / n);
    const extra = 52 % n;
    // l'hôte (siège 0) distribue : son voisin est servi le premier, lui le dernier
    if (extra) counts.forEach((c, i) => assert.equal(c, (i - 1 + n) % n < extra ? big : big - 1, `${n} joueurs, siège ${i}`));
    const all = g.players.flatMap((p) => p.hand.map((c) => c.id));
    assert.equal(new Set(all).size, 52);
  }
});

test('distribution des manches suivantes : le Trouduc sert d’abord son voisin, il n’a pas la carte de plus', () => {
  for (let n = 5; n <= 8; n++) {
    if (52 % n === 0) continue;
    const g = new President({ players: players(n), rng: seeded(n * 3) });
    playRound(g);
    g.handleAction('p0', 'next');
    assert.equal(g.round, 2);
    const t = g.players.findIndex((p) => p.title === 'trouduc');
    const counts = g.events.filter((e) => e.type === 'deal').at(-1).counts;
    const big = Math.ceil(52 / n);
    const extra = 52 % n;
    g.players.forEach((p, i) => {
      assert.equal(counts[p.id], (i - t - 1 + n) % n < extra ? big : big - 1, `${n} joueurs, siège ${i}, Trouduc ${t}`);
    });
    assert.equal(counts[g.players[t].id], big - 1, 'le Trouduc n’a pas de carte de plus');
    // l'échange garde les nombres de cartes
    botExchange(g);
    g.players.forEach((p) => assert.equal(p.hand.length, counts[p.id]));
  }
});

test('action mal formée (charge vide ou nulle) : erreur de jeu, pas de plantage', () => {
  const g = rigged(4, ['3C 5D', '4C 9S', 'AC 7C', '6D 10D']);
  err(() => g.handleAction('p0', 'play', null), /au moins une carte/);
  err(() => g.handleAction('p0', 'play'), /au moins une carte/);
  err(() => g.handleAction('p0', 'play', { cardIds: 'C3' }), /au moins une carte/);
  const x = exchangeGame();
  err(() => x.handleAction('p0', 'give', null), /au moins une carte/);
});

test('première manche : le joueur qui a le 3 de trèfle entame', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const g = new President({ players: players(5), rng: seeded(seed) });
    const holder = g.players.find((p) => p.hand.some((c) => c.id === '3C'));
    assert.equal(g.phase, 'playing');
    assert.equal(cur(g), holder.id);
    assert.equal(g.getStateFor(holder.id).isMyTurn, true);
    assert.equal(g.getStateFor(holder.id).canPass, false, 'on ne passe pas sur une entame');
  }
});

// ================================================================ coups valides

test('coups : même nombre de cartes, de même valeur, strictement plus fortes', () => {
  const g = rigged(4, ['3C 9S 9H 5D', '9D 10S 10H JD', 'QS QH 7C 4C', 'KS KH KD 6C']);
  assert.equal(cur(g), 'p0');
  err(() => play(g, 'p1', '9D'), /pas ton tour/);
  err(() => pass(g, 'p0'), /entames/);
  err(() => play(g, 'p0', '3C 9S'), /même valeur/);
  err(() => play(g, 'p0', 'AS'), /pas dans ta main/);
  err(() => play(g, 'p0', '9S 9S'), /deux fois/);
  err(() => g.handleAction('p0', 'play', { cardIds: [] }), /au moins une/);
  play(g, 'p0', '9S 9H');
  assert.equal(cur(g), 'p1');
  err(() => play(g, 'p1', '10S'), /2 cartes/);
  err(() => play(g, 'p1', '9D 10S'), /même valeur/);
  play(g, 'p1', '10S 10H');
  err(() => play(g, 'p2', '7C 4C'), /même valeur/);
  play(g, 'p2', 'QS QH');
  // valeur égale refusée, avec un message qui dit quoi jouer
  const g2 = rigged(4, ['3C 9S 9H 5D', '9D 9C JS JD', 'QS QH 7C 4C', 'KS KH KD 6C']);
  play(g2, 'p0', '9S 9H');
  err(() => play(g2, 'p1', '9D 9C'), /^Il faut 2 cartes plus fortes que les 9\.$/);
  assert.equal(needText({ count: 1, rank: 12 }, false, true), 'Il faut une carte plus forte que la Dame.');
  assert.equal(needText({ count: 1, rank: 14 }, false, true), 'Il faut une carte plus forte que l’As.');
  assert.equal(needText({ count: 3, rank: 13 }, true, true), 'Révolution : il faut 3 cartes plus basses que les Rois (ou des 2).');
  // plus de 4 cartes : impossible
  const g3 = rigged(3, ['3C 3S 3H 3D 4C', '5C', '6C']);
  err(() => play(g3, 'p0', '3C 3S 3H 3D 4C'), /1 à 4/);
});

test('passer : le pli va au dernier qui a joué quand tous les autres passent ; passer n’exclut pas du pli', () => {
  const g = rigged(4, ['3C 5D 8S', '4C 9S JH', '6C 7C KD', '6D 10D QS']);
  play(g, 'p0', '3C');
  pass(g, 'p1');
  assert.equal(g.getStateFor('p2').players[1].passed, true);
  play(g, 'p2', '6C');
  play(g, 'p3', '10D');
  pass(g, 'p0');
  play(g, 'p1', 'JH'); // p1 avait passé : il rejoue
  assert.equal(g.getStateFor('p0').players[1].passed, false);
  pass(g, 'p2');
  pass(g, 'p3');
  assert.equal(g.pile.length, 4);
  pass(g, 'p0');
  const tr = eventsOf(g, 'trick').at(-1);
  assert.equal(tr.winnerId, 'p1');
  assert.equal(tr.reason, 'passes');
  assert.equal(g.pile.length, 0);
  assert.equal(cur(g), 'p1', 'le gagnant du pli entame');
  assert.ok(g.getStateFor('p0').players.every((p) => !p.passed), 'les « Passe » s’effacent avec le pli');
  assert.equal(g.getStateFor('p0').lastTrick.plays.length, 4);
  assert.equal(g.getStateFor('p0').trickNumber, 2);
});

test('le joueur qui sort sur un pli : la main passe au suivant encore en jeu', () => {
  const g = rigged(4, ['3C', '4C 9S', '6C 7C', '6D 10D']);
  play(g, 'p0', '3C'); // p0 n'a plus de cartes : 1er
  assert.equal(g.getStateFor('p1').players[0].place, 1);
  assert.equal(eventsOf(g, 'finish')[0].playerId, 'p0');
  pass(g, 'p1');
  pass(g, 'p2');
  assert.equal(g.pile.length, 1, 'il faut que les 3 joueurs encore en jeu passent');
  pass(g, 'p3');
  assert.equal(eventsOf(g, 'trick').at(-1).winnerId, 'p0');
  assert.equal(cur(g), 'p1', 'le gagnant est sorti : son voisin entame');
});


test('option « le 2 ferme » : un 2 ferme le pli et son joueur rejoue', () => {
  const g = rigged(4, ['3C 2S 5D', '4C 9S', 'AC 7C', '6D 10D']);
  play(g, 'p0', '3C');
  play(g, 'p1', '4C');
  play(g, 'p2', 'AC');
  pass(g, 'p3');
  play(g, 'p0', '2S');
  const tr = eventsOf(g, 'trick').at(-1);
  assert.equal(tr.winnerId, 'p0');
  assert.equal(tr.reason, 'two');
  assert.equal(cur(g), 'p0', 'le joueur du 2 entame le pli suivant');
  assert.equal(g.pile.length, 0);
  // option « normal » : le 2 reste imbattable (plus forte carte), le pli se ferme aussi, faute d'adversaire possible
  const n = rigged(4, ['3C 2S 5D', '4C 9S', 'AC 7C', '6D 10D'], { twoCloses: 'normal' });
  play(n, 'p0', '3C');
  play(n, 'p1', '4C');
  play(n, 'p2', 'AC');
  pass(n, 'p3');
  play(n, 'p0', '2S');
  assert.equal(eventsOf(n, 'trick').at(-1).reason, 'top');
  assert.equal(cur(n), 'p0');
});

test('« le 2 ferme » : il faut autant de 2 que de cartes dans l’entame', () => {
  const g = rigged(4, ['3C 6C 6H 9D', '2S 2H 2D 5C', '7C 7D 3S', 'KS KH 4D']);
  play(g, 'p0', '3C');
  pass(g, 'p1');
  pass(g, 'p2');
  pass(g, 'p3');
  play(g, 'p0', '6C 6H');
  err(() => play(g, 'p1', '2S'), /Il faut poser 2 cartes, comme l’entame\.$/);
  play(g, 'p1', '2S 2H');
  const tr = eventsOf(g, 'trick').at(-1);
  assert.equal(tr.reason, 'two');
  assert.equal(tr.winnerId, 'p1');
  assert.equal(cur(g), 'p1');
  assert.equal(g.pile.length, 0);
});

test('révolution avec quatre 2 : l’ordre s’inverse et le pli se ferme', () => {
  const hands = ['3C 2S 2H 2D 2C 9D', 'KS 4C', '5C 6C', '7S 8S'];
  const g = rigged(4, hands, { revolution: 'oui' });
  play(g, 'p0', '3C');
  pass(g, 'p1');
  pass(g, 'p2');
  pass(g, 'p3');
  play(g, 'p0', '2S 2H 2D 2C');
  assert.equal(g.revolution, true);
  assert.equal(eventsOf(g, 'revolution').at(-1).on, true);
  assert.equal(eventsOf(g, 'trick').at(-1).reason, 'two');
  assert.equal(cur(g), 'p0');
  play(g, 'p0', '9D');
  err(() => play(g, 'p1', 'KS'), /plus basse que le 9/);
  play(g, 'p1', '4C');
});

test('révolution : un carré inverse l’ordre ; avec « le 2 ferme », le 2 garde son pouvoir', () => {
  const hands = ['3C 8S 8H 8D 8C 5D', '9S 4C 2H', '7C 6H', 'KS QS'];
  const g = rigged(4, hands, { revolution: 'oui' });
  play(g, 'p0', '8S 8H 8D 8C');
  assert.equal(g.revolution, true);
  assert.equal(g.getStateFor('p2').revolution, true);
  assert.deepEqual(eventsOf(g, 'revolution').map((e) => [e.playerId, e.on]), [['p0', true]]);
  pass(g, 'p1');
  pass(g, 'p2');
  pass(g, 'p3');
  assert.equal(cur(g), 'p0');
  play(g, 'p0', '5D');
  err(() => play(g, 'p1', '9S'), /^Révolution : il faut une carte plus basse que le 5 \(ou un 2\)\.$/);
  play(g, 'p1', '2H');
  assert.equal(eventsOf(g, 'trick').at(-1).reason, 'two');
  assert.equal(cur(g), 'p1');

  // option « normal » : en révolution le 2 devient la plus faible, le 3 est imbattable
  const n = rigged(4, hands, { revolution: 'oui', twoCloses: 'normal' });
  play(n, 'p0', '8S 8H 8D 8C');
  pass(n, 'p1');
  pass(n, 'p2');
  pass(n, 'p3');
  play(n, 'p0', '5D');
  err(() => play(n, 'p1', '2H'), /plus basse que le 5\.$/);
  play(n, 'p1', '4C');
  pass(n, 'p2');
  pass(n, 'p3');
  play(n, 'p0', '3C');
  assert.equal(eventsOf(n, 'trick').at(-1).reason, 'top', 'en révolution, le 3 ferme le pli');

  // sans l'option : un carré est une combinaison ordinaire
  const off = rigged(4, hands);
  play(off, 'p0', '8S 8H 8D 8C');
  assert.equal(off.revolution, false);
  assert.equal(eventsOf(off, 'revolution').length, 0);
});

test('contre-révolution, et la révolution s’arrête avec la manche', () => {
  const g = rigged(3, ['3C 8S 8H 8D 8C', '4S 4H 4D 4C 9S', 'KS KH KD KC 5H'], { revolution: 'oui' });
  play(g, 'p0', '8S 8H 8D 8C');
  assert.equal(g.revolution, true);
  play(g, 'p1', '4S 4H 4D 4C'); // plus bas : valable en révolution, et l'ordre normal revient
  assert.equal(g.revolution, false);
  play(g, 'p2', 'KS KH KD KC');
  assert.equal(g.revolution, true);
  assert.deepEqual(eventsOf(g, 'revolution').map((e) => e.on), [true, false, true]);

  const r = rigged(3, { 1: ['3C 8S 8H 8D 8C', '4S', '5S'] }, { revolution: 'oui' });
  play(r, 'p0', '8S 8H 8D 8C');
  pass(r, 'p1');
  pass(r, 'p2');
  play(r, 'p0', '3C'); // p0 sort ; en révolution, seul un 2 battrait le 3
  assert.equal(r.revolution, true);
  pass(r, 'p1');
  pass(r, 'p2');
  assert.equal(cur(r), 'p1', 'le gagnant du pli est sorti : son voisin entame');
  play(r, 'p1', '4S');
  assert.equal(r.phase, 'roundEnd');
  r.handleAction('p2', 'next');
  assert.equal(r.revolution, false);
});

test('places et titres à 3, 4, 6 et 8 joueurs ; points de la manche', () => {
  assert.deepEqual(titlesFor(3), ['president', 'neutre', 'trouduc']);
  assert.deepEqual(titlesFor(4), ['president', 'vice-president', 'vice-trouduc', 'trouduc']);
  assert.deepEqual(titlesFor(6), ['president', 'vice-president', 'neutre', 'neutre', 'vice-trouduc', 'trouduc']);
  assert.deepEqual(titlesFor(8), ['president', 'vice-president', 'neutre', 'neutre', 'neutre', 'neutre', 'vice-trouduc', 'trouduc']);
  assert.deepEqual(POINTS, { president: 4, 'vice-president': 3, neutre: 2, 'vice-trouduc': 1, trouduc: 0 });
  for (const n of [3, 4, 6, 8]) {
    for (const seed of [1, 2, 3]) {
      const g = new President({ players: players(n), rng: seeded(seed * 10 + n) });
      playRound(g);
      assert.equal(g.phase, 'roundEnd', `${n} joueurs`);
      const s = g.getStateFor('p0');
      assert.equal(s.summary.order.length, n);
      assert.equal(new Set(s.summary.order).size, n);
      s.summary.order.forEach((id, i) => {
        assert.equal(s.summary.titles[id], titlesFor(n)[i]);
        assert.equal(s.summary.points[id], POINTS[titlesFor(n)[i]]);
        assert.equal(s.players.find((p) => p.id === id).place, i + 1);
        assert.equal(s.players.find((p) => p.id === id).title, titlesFor(n)[i]);
      });
      assert.equal(s.players.reduce((a, p) => a + p.score, 0), s.summary.order.reduce((a, id) => a + s.summary.points[id], 0));
      assert.ok(s.players.every((p) => p.cardCount === 0 || p.id === s.summary.order.at(-1)), 'seul le dernier garde des cartes');
      assert.equal(s.currentPlayerId, null);
      assert.equal(s.history.length, 1);
    }
  }
});

test('la manche finit quand il ne reste qu’un joueur : il est Trouduc', () => {
  const g = rigged(3, ['3C', '4C', '5C 6C']);
  play(g, 'p0', '3C');
  play(g, 'p1', '4C');
  assert.equal(g.phase, 'roundEnd');
  assert.deepEqual(g.summary.order, ['p0', 'p1', 'p2']);
  assert.deepEqual(g.summary.titles, { p0: 'president', p1: 'neutre', p2: 'trouduc' });
  assert.equal(g.getStateFor('p2').lastTrick.plays.length, 2, 'le dernier pli reste visible');
  assert.deepEqual(eventsOf(g, 'finish').map((e) => [e.playerId, e.place]), [['p0', 1], ['p1', 2], ['p2', 3]]);
  err(() => play(g, 'p2', '5C'), /pas le moment/);
});

/** Manche 1 courte : p0 Président, p1 Vice-président, p2 Vice-trouduc, p3 Trouduc ; manche 2 imposée. */
function exchangeGame() {
  const g = rigged(4, {
    1: ['3C', '4C', '5C', '6C 7C'],
    2: ['3S 4S 5S', '3H 4H 5H', '6D 7D AD', '2C KC 9C 8C'],
  });
  play(g, 'p0', '3C');
  play(g, 'p1', '4C');
  play(g, 'p2', '5C');
  assert.equal(g.phase, 'roundEnd');
  g.handleAction('p3', 'next');
  return g;
}

test('échange : le Trouduc et le Vice-trouduc donnent leurs meilleures cartes, les autres rendent celles de leur choix', () => {
  const g = exchangeGame();
  assert.equal(g.phase, 'exchange');
  assert.equal(g.round, 2);
  assert.deepEqual(hand(g, 'p0').sort(), ['2C', '3S', '4S', '5S', 'KC'].sort(), 'le Président reçoit le 2 et le Roi');
  assert.deepEqual(hand(g, 'p3').sort(), ['8C', '9C'].sort());
  assert.deepEqual(hand(g, 'p1').sort(), ['3H', '4H', '5H', 'AD'].sort(), 'le Vice-président reçoit l’As');
  assert.deepEqual(hand(g, 'p2').sort(), ['6D', '7D'].sort());
  const s0 = g.getStateFor('p0');
  assert.equal(s0.currentPlayerId, null);
  assert.deepEqual(s0.exchange.pairs, [
    { giverId: 'p3', receiverId: 'p0', count: 2, done: false },
    { giverId: 'p2', receiverId: 'p1', count: 1, done: false },
  ]);
  assert.equal(s0.exchange.me.role, 'receiver');
  assert.deepEqual(s0.exchange.me.received.map((c) => c.id).sort(), ['2C', 'KC']);
  assert.equal(s0.players.find((p) => p.id === 'p3').title, 'trouduc');

  // validations
  err(() => g.handleAction('p3', 'give', { cardIds: ['8C'] }), /pas de cartes à rendre/);
  err(() => g.handleAction('p2', 'give', { cardIds: ['6D'] }), /pas de cartes à rendre/);
  err(() => g.handleAction('p0', 'give', { cardIds: ['3S'] }), /Choisis 2 cartes/);
  err(() => g.handleAction('p0', 'give', { cardIds: ['3S', 'AD'] }), /pas dans ta main/);
  err(() => g.handleAction('p1', 'give', { cardIds: ['3H', '4H'] }), /Choisis 1 carte/);
  err(() => play(g, 'p3', '8C'), /pas le moment/);
  err(() => pass(g, 'p3'), /pas le moment/);

  g.handleAction('p0', 'give', { cardIds: ['3S', '4S'] });
  err(() => g.handleAction('p0', 'give', { cardIds: ['5S', 'KC'] }), /déjà rendu/);
  assert.equal(g.phase, 'exchange', 'on attend encore le Vice-président');
  assert.equal(g.getStateFor('p1').exchange.pairs[0].done, true);
  g.handleAction('p1', 'give', { cardIds: ['3H'] });
  assert.equal(g.phase, 'playing');
  assert.equal(cur(g), 'p3', 'le Trouduc entame');
  assert.deepEqual(hand(g, 'p3').sort(), ['3S', '4S', '8C', '9C'].sort());
  assert.deepEqual(hand(g, 'p2').sort(), ['3H', '6D', '7D'].sort());
  assert.deepEqual(g.players.map((p) => p.hand.length), [3, 3, 3, 4], 'chacun garde son nombre de cartes');
  const s3 = g.getStateFor('p3');
  assert.equal(s3.exchange.me.role, 'giver');
  assert.deepEqual(s3.exchange.me.gave.map((c) => c.id).sort(), ['2C', 'KC']);
  assert.deepEqual(s3.exchange.me.received.map((c) => c.id).sort(), ['3S', '4S']);
});

test('échange : les cartes échangées ne sont vues que par les deux joueurs concernés', () => {
  const g = exchangeGame();
  g.handleAction('p0', 'give', { cardIds: ['3S', '4S'] });
  const tribute = (pid) => g.getStateFor(pid).events.filter((e) => e.type === 'tribute' && e.from === 'p3')[0];
  const ret = (pid) => g.getStateFor(pid).events.filter((e) => e.type === 'return' && e.from === 'p0')[0];
  assert.deepEqual(tribute('p0').cards.map((c) => c.id).sort(), ['2C', 'KC']);
  assert.deepEqual(tribute('p3').cards.map((c) => c.id).sort(), ['2C', 'KC']);
  assert.equal(tribute('p1').cards, undefined);
  assert.equal(tribute('p2').cards, undefined);
  assert.equal(tribute('p1').count, 2, 'le nombre de cartes reste public');
  assert.deepEqual(ret('p3').cards.map((c) => c.id).sort(), ['3S', '4S']);
  assert.equal(ret('p1').cards, undefined);
  assert.equal(ret('p2').cards, undefined);
  const s2 = g.getStateFor('p2');
  assert.equal(s2.exchange.me.role, 'giver');
  assert.equal(s2.exchange.me.otherId, 'p1');
  for (const id of ['2C', 'KC', '3S', '4S']) assert.ok(!JSON.stringify(s2).includes(`"${id}"`), `p2 ne voit pas ${id}`);
  // à 3 joueurs : un seul échange, de 2 cartes
  const t = rigged(3, { 1: ['3C', '4C', '5C 6C'] });
  play(t, 'p0', '3C');
  play(t, 'p1', '4C');
  t.handleAction('p0', 'next');
  assert.equal(t.phase, 'exchange');
  assert.deepEqual(t.getStateFor('p1').exchange.pairs.map((x) => [x.giverId, x.receiverId, x.count]), [['p2', 'p0', 2]]);
  assert.equal(t.getStateFor('p1').exchange.me, null, 'le Neutre n’échange rien');
});

test('getStateFor ne montre jamais la main des autres (seulement leur nombre de cartes)', () => {
  for (const n of [3, 5, 8]) {
    const g = new President({ players: players(n), options: { revolution: 'oui' }, rng: seeded(100 + n) });
    let checks = 0;
    const check = () => {
      for (const viewer of g.players) {
        const s = g.getStateFor(viewer.id);
        // les événements des manches passées citent des cartes jouées alors (publiques) : on ne lit que la manche en cours
        const { events, ...rest } = s;
        const start = events.findLast((e) => e.type === 'deal')?.id ?? 0;
        const json = JSON.stringify(rest) + JSON.stringify(events.filter((e) => e.id >= start));
        const me = s.exchange?.me;
        const known = new Set([...(me?.gave ?? []), ...(me?.received ?? [])].map((c) => c.id));
        for (const other of g.players) {
          if (other.id === viewer.id) continue;
          assert.equal(s.players.find((p) => p.id === other.id).cardCount, other.hand.length);
          assert.equal(s.players.find((p) => p.id === other.id).hand, undefined);
          for (const c of other.hand) {
            if (!known.has(c.id)) assert.ok(!json.includes(`"id":"${c.id}"`), `${viewer.id} voit ${c.id} de ${other.id}`);
          }
        }
        assert.deepEqual(s.myHand.map((c) => c.id).sort(), viewer.hand.map((c) => c.id).sort());
        checks++;
      }
    };
    for (let round = 0; round < 3; round++) {
      check();
      if (g.phase === 'exchange') {
        botExchange(g);
        check();
      }
      let guard = 0;
      while (g.phase === 'playing' && ++guard < 2000) {
        botMove(g);
        if (guard % 7 === 0) check();
      }
      check();
      if (g.phase === 'roundEnd') g.handleAction('p0', 'next');
    }
    assert.ok(checks > 10);
  }
});

test('ordre de jeu : chacun à son tour, les joueurs sortis sont sautés ; actions hors tour refusées', () => {
  const g = rigged(5, ['3C 9D', '4C', '5C 6S', '7C 8S', 'JC 10S']);
  play(g, 'p0', '3C');
  for (const pid of ['p0', 'p2', 'p3', 'p4']) err(() => pass(g, pid), /pas ton tour/);
  play(g, 'p1', '4C'); // p1 sort
  assert.equal(cur(g), 'p2');
  play(g, 'p2', '5C');
  play(g, 'p3', '7C');
  play(g, 'p4', 'JC');
  pass(g, 'p0');
  assert.equal(cur(g), 'p2', 'p1 est sorti : on passe directement à p2');
  pass(g, 'p2');
  pass(g, 'p3');
  assert.equal(cur(g), 'p4', 'p4 remporte le pli');
  err(() => g.handleAction('p4', 'jouer'), /Action inconnue/);
  err(() => g.handleAction('intrus', 'pass'), /ne joues pas/);
  err(() => g.handleAction('p4', 'next'), /pas terminée/);
});

test('fin de partie après le nombre de manches ; getResult (ex aequo tous gagnants)', () => {
  const g = new President({ players: players(4), options: { rounds: 5 }, rng: seeded(3) });
  for (let r = 1; r <= 5; r++) {
    assert.equal(g.round, r);
    playRound(g);
    if (r < 5) {
      assert.equal(g.phase, 'roundEnd');
      assert.equal(g.isOver(), false);
      assert.equal(g.getResult(), null);
      g.handleAction(`p${r % 4}`, 'next');
      assert.equal(g.phase, 'exchange', 'dès la 2e manche, on échange');
    }
  }
  assert.equal(g.phase, 'gameOver');
  assert.equal(g.isOver(), true);
  assert.equal(g.history.length, 5);
  assert.equal(eventsOf(g, 'gameOver').length, 1);
  err(() => g.handleAction('p0', 'next'), /terminée/);
  const res = g.getResult();
  const best = Math.max(...g.players.map((p) => p.score));
  for (const p of g.players) {
    const r = res.players.find((x) => x.playerId === p.id);
    assert.equal(r.score, p.score);
    assert.equal(r.result, p.score === best ? 'win' : 'loss');
  }
  assert.match(res.summary, /^Classement : 1\. /);
  assert.equal(g.players.reduce((a, p) => a + p.score, 0), 5 * (4 + 3 + 1 + 0));

  // ex aequo : tous gagnent, places partagées dans le résumé
  g.players.forEach((p, i) => { p.score = [10, 10, 7, 3][i]; });
  const tie = g.getResult();
  assert.deepEqual(tie.players.map((p) => p.result), ['win', 'win', 'loss', 'loss']);
  assert.equal(tie.summary, 'Classement : 1. J0 (10 pts), 1. J1 (10 pts), 3. J2 (7 pts), 4. J3 (3 pts)');
});

test('parties complètes au hasard, de 3 à 8 joueurs, avec toutes les options', () => {
  for (let n = 3; n <= 8; n++) {
    for (const [twoCloses, revolution] of [['ferme', 'oui'], ['normal', 'oui'], ['normal', 'non']]) {
      const g = new President({ players: players(n), options: { rounds: 5, twoCloses, revolution }, rng: seeded(n * 31 + twoCloses.length) });
      let guard = 0;
      while (!g.isOver() && ++guard < 20) {
        playRound(g);
        if (g.phase === 'roundEnd') g.handleAction('p0', 'next');
      }
      assert.equal(g.phase, 'gameOver', `${n} joueurs ${twoCloses} ${revolution}`);
      const total = g.players.reduce((a, p) => a + p.score, 0);
      const perRound = titlesFor(n).reduce((a, t) => a + POINTS[t], 0);
      assert.equal(total, 5 * perRound);
    }
  }
});

test('manifeste : options du salon et création de la partie', () => {
  assert.equal(manifest.id, 'president');
  assert.equal(manifest.name, 'Président');
  assert.equal(manifest.minPlayers, 3);
  assert.equal(manifest.maxPlayers, 8);
  assert.equal(manifest.scoreLabel, 'Points');
  const opt = Object.fromEntries(manifest.options.map((o) => [o.id, o]));
  assert.equal(opt.rounds.default, 8);
  assert.deepEqual(opt.rounds.choices.map((c) => c.value), [5, 8, 12]);
  assert.equal(opt.twoCloses.default, 'ferme');
  assert.deepEqual(opt.twoCloses.choices.map((c) => c.value), ['ferme', 'normal']);
  assert.equal(opt.revolution.default, 'non');
  assert.deepEqual(opt.revolution.choices.map((c) => c.value), ['non', 'oui']);
  const g = manifest.createGame({ players: players(3), options: { rounds: 12, twoCloses: 'normal', revolution: 'oui' } });
  assert.equal(g.totalRounds, 12);
  assert.equal(g.twoCloses, false);
  assert.equal(g.revolutionAllowed, true);
  const d = manifest.createGame({ players: players(4), options: { rounds: 8, twoCloses: 'ferme', revolution: 'non' } });
  assert.deepEqual(d.getStateFor('p0').options, { twoCloses: true, revolution: false });
  assert.equal(d.getStateFor('p0').totalRounds, 8);
  assert.throws(() => manifest.createGame({ players: players(2), options: {} }), /3 à 8/);
  assert.throws(() => manifest.createGame({ players: players(9), options: {} }), /3 à 8/);
  // mélange : le rng injecté rend la donne reproductible
  assert.deepEqual(shuffle([1, 2, 3, 4, 5], seeded(4)), shuffle([1, 2, 3, 4, 5], seeded(4)));
});
