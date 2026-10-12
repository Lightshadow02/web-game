'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Tarot, legalCards, trickWinner } = require('../games/tarot/server/Tarot');
const { buildDeck, sumPoints, makeCard } = require('../games/tarot/server/cards');

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` }));
const C = (id) => (id === 'EX' ? makeCard('E', 0) : makeCard(id[0], Number(id.slice(1))));
const t = (playerId, id) => ({ playerId, card: C(id) });

/** Bot naïf : enchère aléatoire basse, écart valide, carte légale au hasard. */
function autoPlay(game, rng = Math.random) {
  let steps = 0;
  while (!game.isOver() && game.phase !== 'roundEnd') {
    if (++steps > 2000) throw new Error('boucle infinie');
    const p = game.players[game.currentIndex];
    const s = game.getStateFor(p.id);
    if (game.phase === 'bidding') {
      const bids = s.availableBids;
      game.handleAction(p.id, 'bid', { bid: rng() < 0.6 ? 'passe' : bids[Math.min(bids.length - 1, 1 + Math.floor(rng() * 2))] });
    } else if (game.phase === 'calling') {
      game.handleAction(p.id, 'call', { cardId: s.callableCards[Math.floor(rng() * 4)].id });
    } else if (game.phase === 'discard') {
      const ok = s.myHand.filter((c) => ['S', 'H', 'D', 'C'].includes(c.suit) && c.rank !== 14);
      const pool = ok.length >= s.discardCount ? ok : [...ok, ...s.myHand.filter((c) => c.suit === 'T' && c.rank !== 1 && c.rank !== 21)];
      game.handleAction(p.id, 'discard', { cardIds: pool.slice(0, s.discardCount).map((c) => c.id) });
    } else {
      if (s.poigneeOptions.length && rng() < 0.5) game.handleAction(p.id, 'poignee', { size: s.poigneeOptions[0].id });
      const legal = s.legalCardIds;
      game.handleAction(p.id, 'play', { cardId: legal[Math.floor(rng() * legal.length)] });
    }
  }
}

test('jeu de 78 cartes, 91 points, 3 bouts', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 78);
  assert.equal(new Set(deck.map((c) => c.id)).size, 78);
  assert.equal(sumPoints(deck), 91);
});

test('distribution selon le nombre de joueurs', () => {
  for (const [n, hand, chien] of [[3, 24, 6], [4, 18, 6], [5, 15, 3]]) {
    const game = new Tarot({ players: players(n) });
    assert.ok(game.players.every((p) => p.hand.length === hand), `${n} joueurs : ${hand} cartes`);
    assert.equal(game.chien.length, chien);
    assert.equal(game.getStateFor('p0').chien, null, 'chien caché pendant les enchères');
  }
});

test('enchères : ordre, montée obligatoire, tout le monde passe', () => {
  const game = new Tarot({ players: players(4) });
  assert.equal(game.players[game.currentIndex].id, 'p0', 'le joueur après le donneur parle en premier');
  assert.throws(() => game.handleAction('p1', 'bid', { bid: 'garde' }), /pas votre tour/);
  game.handleAction('p0', 'bid', { bid: 'garde' });
  assert.throws(() => game.handleAction('p1', 'bid', { bid: 'petite' }), /plus haut/);
  assert.deepEqual(game.getStateFor('p1').availableBids, ['passe', 'garde_sans', 'garde_contre']);
  game.handleAction('p1', 'bid', { bid: 'passe' });
  game.handleAction('p2', 'bid', { bid: 'passe' });
  game.handleAction('p3', 'bid', { bid: 'passe' });
  assert.equal(game.takerId, 'p0');
  assert.equal(game.phase, 'discard');
  assert.equal(game.getStateFor('p2').chien.length, 6, 'chien retourné pour tous');
  assert.equal(game.player('p0').hand.length, 24);

  const other = new Tarot({ players: players(4) });
  for (const id of ['p0', 'p1', 'p2', 'p3']) other.handleAction(id, 'bid', { bid: 'passe' });
  assert.equal(other.phase, 'bidding', 'redistribution');
  assert.equal(other.players[other.currentIndex].id, 'p1', 'le donneur suivant distribue');
  assert.equal(other.roundNumber, 1, 'une donne non jouée ne compte pas');
});

test("écart : ni roi ni bout, atouts seulement si nécessaire", () => {
  const game = new Tarot({ players: players(4) });
  game.handleAction('p0', 'bid', { bid: 'petite' });
  for (const id of ['p1', 'p2', 'p3']) game.handleAction(id, 'bid', { bid: 'passe' });
  const taker = game.player('p0');
  const forced = ['S14', 'T1', 'T5', 'H2', 'H3', 'H4', 'C5', 'C6', 'D7', 'D8'];
  const rest = buildDeck().filter((c) => !forced.includes(c.id)).slice(0, 14);
  taker.hand = [...forced.map(C), ...rest];
  assert.throws(() => game.handleAction('p0', 'discard', { cardIds: ['S14', 'H2', 'H3', 'H4', 'C5', 'C6'] }), /Roi/);
  assert.throws(() => game.handleAction('p0', 'discard', { cardIds: ['T1', 'H2', 'H3', 'H4', 'C5', 'C6'] }), /bout/);
  assert.throws(() => game.handleAction('p0', 'discard', { cardIds: ['T5', 'H2', 'H3', 'H4', 'C5', 'C6'] }), /atouts/);
  assert.throws(() => game.handleAction('p0', 'discard', { cardIds: ['H2'] }), /exactement 6/);
  game.handleAction('p0', 'discard', { cardIds: ['H2', 'H3', 'H4', 'C5', 'C6', 'D7'] });
  assert.equal(game.phase, 'playing');
  assert.equal(taker.hand.length, 18);
  assert.equal(game.getStateFor('p1').chien, null, 'chien de nouveau caché');
});

test('garde sans / garde contre : le chien va au bon camp sans être vu', () => {
  const sans = new Tarot({ players: players(4) });
  sans.handleAction('p0', 'bid', { bid: 'garde_sans' });
  for (const id of ['p1', 'p2', 'p3']) sans.handleAction(id, 'bid', { bid: 'passe' });
  assert.equal(sans.phase, 'playing');
  assert.equal(sans.player('p0').won.length, 6);
  assert.equal(sans.getStateFor('p1').chien, null);

  const contre = new Tarot({ players: players(4) });
  contre.handleAction('p0', 'bid', { bid: 'garde_contre' });
  for (const id of ['p1', 'p2', 'p3']) contre.handleAction(id, 'bid', { bid: 'passe' });
  assert.equal(contre.player('p0').won.length, 0);
  assert.equal(contre.defenseExtra.length, 6);
});

test('cartes jouables : fournir, couper, monter, Excuse', () => {
  const hand = ['H3', 'H12', 'T4', 'T15', 'S2', 'EX'].map(C);
  const ids = (cards) => cards.map((c) => c.id).sort();
  assert.deepEqual(ids(legalCards(hand, [t('a', 'H5')])), ['EX', 'H12', 'H3'], 'fournir');
  assert.deepEqual(ids(legalCards(hand, [t('a', 'C5')])), ['EX', 'T15', 'T4'], 'couper');
  assert.deepEqual(ids(legalCards(hand, [t('a', 'C5'), t('b', 'T10')])), ['EX', 'T15'], 'surcouper');
  assert.deepEqual(ids(legalCards(hand, [t('a', 'T20')])), ['EX', 'T15', 'T4'], 'pisser si on ne peut monter');
  assert.deepEqual(ids(legalCards(hand, [t('a', 'EX')])), ids(hand), "après l'Excuse, la carte suivante donne la couleur");
  assert.deepEqual(ids(legalCards(['C2', 'D3'].map(C), [t('a', 'H5')])), ['C2', 'D3'], 'défausse libre');
});

test("gagnant d'un pli", () => {
  assert.equal(trickWinner([t('a', 'H5'), t('b', 'H14'), t('c', 'C14'), t('d', 'H2')]).playerId, 'b');
  assert.equal(trickWinner([t('a', 'H5'), t('b', 'H14'), t('c', 'T1'), t('d', 'EX')]).playerId, 'c');
  assert.equal(trickWinner([t('a', 'EX'), t('b', 'D3'), t('c', 'D9'), t('d', 'S14')]).playerId, 'c');
});

/** Donne truquée : on fixe les plis gagnés pour vérifier le décompte. */
function scoredRound({ n = 4, contract = 'garde', attackCards, partnerId = null, petitAuBout = null, poignees = [] }) {
  const game = new Tarot({ players: players(n) });
  game.takerId = 'p0';
  game.partnerId = partnerId;
  game.contract = contract;
  game.petitAuBout = petitAuBout;
  game.poignees = poignees;
  for (const p of game.players) p.won = [];
  game.player('p0').won = attackCards.map(C);
  game.scoreRound();
  return game;
}

const deckIds = buildDeck().map((c) => c.id);

test('décompte : garde réussie à 4 (2 bouts, 45 points)', () => {
  // 2 bouts (Petit + 21) = 9 pts, + 4 rois (18) = 27, + 36 petites cartes = 18 -> 45
  const small = deckIds.filter((id) => /^[SHDC]([1-9]|10)$/.test(id)).slice(0, 36);
  const game = scoredRound({ attackCards: ['T1', 'T21', 'S14', 'H14', 'D14', 'C14', ...small] });
  const s = game.summary;
  assert.equal(s.points, 45);
  assert.equal(s.needed, 41);
  assert.equal(s.made, true);
  assert.equal(s.total, (25 + 4) * 2);
  assert.deepEqual(s.changes, { p0: 174, p1: -58, p2: -58, p3: -58 });
  assert.equal(Object.values(s.changes).reduce((a, b) => a + b, 0), 0);
});

test('décompte : chute, Petit au bout et poignée', () => {
  // 0 bout, 30 points : il en fallait 56 -> chute de 26
  const kings = ['S14', 'H14', 'D14', 'C14', 'S13', 'H13'];
  const small = deckIds.filter((id) => /^[SHDC]([1-9]|10)$/.test(id)).slice(0, 12);
  const game = scoredRound({
    contract: 'petite',
    attackCards: [...kings, ...small, 'S12', 'H12'], // 18 + 7 + 6 + 5 = 36 ? recalculé ci-dessous
    petitAuBout: { winnerId: 'p1' },
    poignees: [{ playerId: 'p2', size: 'simple', bonus: 20 }],
  });
  const s = game.summary;
  assert.equal(s.made, false);
  const expected = -(25 + Math.round(56 - s.points)) - 10 - 20;
  assert.equal(s.total, expected);
  assert.equal(s.changes.p0, expected * 3);
});

test('à 5 : appel au roi, partenaire secret puis révélé, répartition 2/1/-1', () => {
  const game = new Tarot({ players: players(5) });
  game.handleAction('p0', 'bid', { bid: 'garde' });
  for (const id of ['p1', 'p2', 'p3', 'p4']) game.handleAction(id, 'bid', { bid: 'passe' });
  assert.equal(game.phase, 'calling');
  const king = game.getStateFor('p0').callableCards.find((c) => c.rank === 14 && !game.player('p0').hand.some((h) => h.id === c.id) && !game.chien.some((h) => h.id === c.id));
  game.handleAction('p0', 'call', { cardId: king.id });
  const holder = game.players.find((p) => p.hand.some((c) => c.id === king.id));
  assert.equal(game.partnerId, holder.id);
  assert.equal(game.getStateFor('p3').partnerId, null, 'partenaire caché');
  assert.equal(game.getStateFor(holder.id).iAmPartner, true, 'le partenaire le sait');
  assert.equal(game.phase, 'discard');
  assert.equal(game.player('p0').hand.length, 18);

  // Décompte truqué : réussite de 10 points -> (25 + 10) × 2 = 70
  for (const p of game.players) p.won = [];
  const small = deckIds.filter((id) => /^[SHDC]([1-9]|10)$/.test(id));
  game.player('p0').won = ['T1', 'T21', 'S14', 'H14', 'D14', 'C14', 'S13', 'H13', ...small.slice(0, 14)].map(C); // 9+18+7+7 = 41... +10
  game.player(holder.id).won = ['D13', 'C13', 'S12', 'H12', 'D12', 'C12'].map(C);
  game.scoreRound();
  const s = game.summary;
  assert.equal(s.partnerId, holder.id);
  const sum = Object.values(s.changes).reduce((a, b) => a + b, 0);
  assert.equal(sum, 0);
  assert.equal(s.changes.p0, 2 * s.total);
  assert.equal(s.changes[holder.id], s.total);
  assert.equal(game.getStateFor('p3').partnerId, holder.id, 'révélé en fin de donne');
});

test('Excuse : gardée par son camp contre une demi-carte, perdue au dernier pli', () => {
  const game = new Tarot({ players: players(4) });
  game.takerId = 'p0';
  game.contract = 'garde';
  game.phase = 'playing';
  game.trickNumber = 3;
  game.currentIndex = 0;
  game.player('p0').hand = [C('EX')];
  game.player('p1').hand = [C('H5')];
  game.player('p2').hand = [C('H9')];
  game.player('p3').hand = [C('H2')];
  game.trick = { cards: [t('p1', 'H5'), t('p2', 'H9'), t('p3', 'H2')] };
  game.currentIndex = 0;
  game.trick.cards = [];
  game.currentIndex = 1;
  game.handleAction('p1', 'play', { cardId: 'H5' });
  game.handleAction('p2', 'play', { cardId: 'H9' });
  game.handleAction('p3', 'play', { cardId: 'H2' });
  game.handleAction('p0', 'play', { cardId: 'EX' });
  assert.ok(game.player('p0').won.some((c) => c.id === 'EX'), "l'Excuse reste au preneur");
  assert.deepEqual(game.excuseTransfer, { ownerId: 'p0', winnerId: 'p2' });
});

test('parties complètes aléatoires à 3, 4 et 5 : se terminent, scores à somme nulle', () => {
  for (const n of [3, 4, 5]) {
    for (let g = 0; g < 60; g++) {
      const game = new Tarot({ players: players(n) });
      let rounds = 0;
      while (!game.isOver()) {
        autoPlay(game);
        if (game.phase === 'roundEnd') {
          rounds++;
          const s = game.getStateFor('p0').summary;
          assert.equal(Object.values(s.changes).reduce((a, b) => a + b, 0), 0);
          game.handleAction('p1', 'next', {});
        }
        // invariant : 78 cartes en jeu
        const total = game.players.reduce((a, p) => a + p.hand.length + p.won.length, 0) + (game.phase === 'bidding' || game.phase === 'calling' ? game.chien.length : 0) + (game.phase === 'playing' ? game.trick.cards.length : 0) + game.defenseExtra.length;
        if (game.phase !== 'discard') assert.equal(total, 78, `cartes perdues (${game.phase})`);
      }
      assert.equal(game.history.length, n);
      assert.equal(game.players.reduce((a, p) => a + p.score, 0), 0);
      const result = game.getResult();
      assert.equal(result.players.length, n);
      assert.ok(result.players.some((p) => p.result === 'win' || p.result === 'draw'));
    }
  }
});

test("la vue d'un joueur ne révèle ni les mains adverses ni l'écart", () => {
  const game = new Tarot({ players: players(4) });
  const view = game.getStateFor('p1');
  assert.equal(view.myHand.length, 18);
  assert.equal(view.players[0].hand, undefined);
  assert.equal(JSON.stringify(view).includes(game.player('p0').hand[0].id + '"'), view.myHand.some((c) => c.id === game.player('p0').hand[0].id));
});
