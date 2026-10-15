'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Rami } = require('../games/rami/server/Rami');
const M = require('../games/rami/server/melds');
const mod = require('../games/rami/server');

/** 'H7a' -> { id, suit: 'H', rank: 7 } ; 'JK1' -> Joker. */
function c(id) {
  if (id.startsWith('JK')) return { id, suit: 'JK', rank: 0, joker: true };
  return { id, suit: id[0], rank: Number(id.slice(1, -1)) };
}
const cs = (s) => s.split(' ').map(c);
const ids = (s) => s.split(' ');

function seeded(seed = 1) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

const P2 = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
const P3 = [...P2, { id: 'c', name: 'Chloé' }];

/** Partie truquée : mains, talon (dernier = dessus), défausse (dernier = dessus). Le premier joueur est 'b' (donneur 'a'). */
function rigged({ players = P2, hands, stock = 'S2a S3a S4a S5a S6a S7a', discard = 'C9b', options } = {}) {
  const g = new Rami({ players, options, rng: seeded(7) });
  for (const p of g.players) p.hand = hands[p.id] ? cs(hands[p.id]) : cs('S9a S9b H9a H2a H4a H6a D8a D10a C3a C5a C12a C13a S12a');
  g.stock = cs(stock);
  g.discard = cs(discard);
  return g;
}

const err = (fn, re) => assert.throws(fn, (e) => e.isGameError === true && (!re || re.test(e.message)));

// ===================================================================== combinaisons

test('melds : le paquet compte 108 cartes uniques dont 4 Jokers', () => {
  const deck = M.buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((x) => x.id)).size, 108);
  assert.equal(deck.filter(M.isJoker).length, 4);
});

test('melds : brelans et carrés', () => {
  const r = M.analyzeMeld(cs('H7a S7a D7a'));
  assert.equal(r.ok, true);
  assert.equal(r.type, 'set');
  assert.equal(r.value, 21);
  assert.equal(M.analyzeMeld(cs('H7a S7a D7a C7b')).ok, true);
  assert.equal(M.analyzeMeld(cs('H1a S1a D1a')).value, 33); // As 11 dans un brelan
  assert.equal(M.analyzeMeld(cs('H12a S12a D12a')).value, 30);
  assert.equal(M.analyzeMeld(cs('H7a H7b D7a')).ok, false); // deux fois Cœur
  assert.equal(M.analyzeMeld(cs('H7a S7a D7a C7a H7b')).ok, false); // 5 cartes
  assert.equal(M.analyzeMeld(cs('H7a S7a')).ok, false); // 2 cartes
});

test('melds : suites, As bas ou haut, pas de tour du coin', () => {
  const r = M.analyzeMeld(cs('H5a H3a H4a'));
  assert.equal(r.ok, true);
  assert.equal(r.type, 'run');
  assert.deepEqual(r.cards.map((x) => x.rank), [3, 4, 5]);
  assert.equal(r.value, 12);
  const low = M.analyzeMeld(cs('S1a S2a S3a'));
  assert.equal(low.ok, true);
  assert.equal(low.value, 6); // As bas = 1
  const high = M.analyzeMeld(cs('S12a S13a S1a'));
  assert.equal(high.ok, true);
  assert.equal(high.value, 31); // As haut = 11
  assert.deepEqual(high.cards.map((x) => x.pos), [12, 13, 14]);
  assert.equal(M.analyzeMeld(cs('S13a S1a S2a')).ok, false); // R-A-2 refusé
  assert.equal(M.analyzeMeld(cs('S4a S5a H6a')).ok, false); // couleurs mêlées
  assert.equal(M.analyzeMeld(cs('S4a S5a S7a')).ok, false); // trou
  assert.equal(M.analyzeMeld(cs('S4a S5a S5b')).ok, false); // doublon
  const long = M.analyzeMeld(cs('D1a D2a D3a D4a D5a D6a D7a D8a D9a D10a D11a D12a D13a'));
  assert.equal(long.ok, true);
});

test('melds : le Joker comble un trou ou prolonge la suite (en haut par défaut)', () => {
  const gap = M.analyzeMeld(cs('H5a JK1 H7a'));
  assert.equal(gap.ok, true);
  const j = gap.cards.find(M.isJoker);
  assert.deepEqual(j.as, { rank: 6, suit: 'H', pos: 6 });
  assert.equal(gap.value, 18);
  const end = M.analyzeMeld(cs('H5a H6a JK1'));
  assert.equal(end.cards.at(-1).as.rank, 7);
  assert.equal(end.value, 18);
  const low = M.analyzeMeld(cs('H5a H6a JK1'), { jokerEnd: 'low' });
  assert.equal(low.cards[0].as.rank, 4);
  const top = M.analyzeMeld(cs('H12a H13a JK1')); // D-R-Joker : le Joker est l'As haut
  assert.equal(top.cards.at(-1).as.pos, 14);
  assert.equal(top.value, 31);
  const ace = M.analyzeMeld(cs('H1a H13a JK1')); // As + Roi + Joker = D-R-A
  assert.equal(ace.ok, true);
  assert.equal(ace.cards[0].as.rank, 12);
  const set = M.analyzeMeld(cs('H8a S8a JK1'));
  assert.equal(set.type, 'set');
  assert.equal(set.value, 24);
  assert.equal(set.cards.at(-1).as.rank, 8);
  const four = M.analyzeMeld(cs('H8a S8a D8a JK1'));
  assert.equal(four.cards.at(-1).as.suit, 'C'); // la couleur manquante
});

test('melds : un seul Joker par combinaison, et pas de combinaison sans vraie carte', () => {
  assert.equal(M.analyzeMeld(cs('H5a JK1 JK2')).ok, false);
  assert.match(M.analyzeMeld(cs('H5a JK1 JK2')).error, /seul Joker/);
  assert.equal(M.analyzeMeld(cs('H5a H8a JK1')).ok, false); // deux trous
  assert.equal(M.analyzeMeld(cs('H5a S7a JK1')).ok, false);
});

test('melds : pénalités (Joker 20, As 11, figures 10)', () => {
  assert.equal(M.handPenalty(cs('JK1 H1a S13a D12a C11a H7a')), 20 + 11 + 10 + 10 + 10 + 7);
});

// ===================================================================== module et options

test('module : manifeste et options par défaut', () => {
  assert.equal(mod.id, 'rami');
  assert.equal(mod.minPlayers, 2);
  assert.equal(mod.maxPlayers, 6);
  const opening = mod.options.find((o) => o.id === 'opening');
  const rounds = mod.options.find((o) => o.id === 'rounds');
  assert.equal(opening.default, 51);
  assert.deepEqual(opening.choices.map((x) => x.value), [51, 30]);
  assert.equal(rounds.default, 5);
  assert.deepEqual(rounds.choices.map((x) => x.value), [3, 5, 7]);
  const g = mod.createGame({ players: P3, options: { opening: 30, rounds: 3 } });
  const s = g.getStateFor('a');
  assert.equal(s.opening, 30);
  assert.equal(s.totalRounds, 3);
  assert.throws(() => new Rami({ players: [P2[0]] }));
  assert.throws(() => new Rami({ players: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `P${i}` })) }));
});

test('donne : 13 cartes chacun, une carte retournée, le voisin du donneur commence', () => {
  const g = new Rami({ players: P3, rng: seeded(3) });
  const s = g.getStateFor('a');
  assert.equal(s.myHand.length, 13);
  assert.equal(s.players.every((p) => p.cardCount === 13), true);
  assert.equal(s.discardCount, 1);
  assert.equal(s.stockCount, 108 - 39 - 1);
  assert.equal(s.dealerId, 'a');
  assert.equal(s.currentPlayerId, 'b');
  assert.equal(s.phase, 'draw');
  // toutes les cartes sont uniques
  const all = [...g.players.flatMap((p) => p.hand), ...g.stock, ...g.discard];
  assert.equal(new Set(all.map((x) => x.id)).size, 108);
});

// ===================================================================== tour de jeu

test('tour : hors tour refusé, pioche obligatoire avant de poser ou de défausser', () => {
  const g = rigged({ hands: { a: 'H2a H3a H4a S9a S9b C1a C5a D7a D8a C12a C13a S12a H13a' } });
  err(() => g.handleAction('a', 'draw', { from: 'stock' }), /pas ton tour/);
  err(() => g.handleAction('b', 'discard', { cardId: g.players[1].hand[0].id }), /Pioche/);
  err(() => g.handleAction('b', 'lay', { melds: [] }), /Pioche/);
  err(() => g.handleAction('x', 'draw', { from: 'stock' }), /ne joues pas/);
  g.handleAction('b', 'draw', { from: 'stock' });
  assert.equal(g.getStateFor('b').myHand.length, 14);
  assert.equal(g.getStateFor('b').myHand.at(-1).id, 'S7a');
  err(() => g.handleAction('b', 'draw', { from: 'stock' }), /déjà pioché/);
  err(() => g.handleAction('b', 'oops'), /inconnue/);
  g.handleAction('b', 'discard', { cardId: 'S7a' });
  const s = g.getStateFor('a');
  assert.equal(s.currentPlayerId, 'a');
  assert.equal(s.discardTop.id, 'S7a');
  assert.equal(s.isMyTurn, true);
  assert.equal(s.phase, 'draw');
});

test('défausse : la carte prise doit être posée dans le tour, ou reposée', () => {
  const g = rigged({
    hands: { b: 'H7a H8a S2a S4a S6a D9a D11a C3a C5a C13a H13a S13a D1a' },
    discard: 'S1a H9a',
  });
  g.handleAction('b', 'draw', { from: 'discard' });
  let s = g.getStateFor('b');
  assert.deepEqual(s.turn.mustUse, ['H9a']);
  assert.equal(s.discardTop.id, 'S1a');
  err(() => g.handleAction('b', 'discard', { cardId: 'S2a' }), /Pose d’abord/);
  err(() => g.handleAction('b', 'discard', { cardId: 'H9a' }), /Pose d’abord/);
  // pas encore ouvert : 7-8-9 de Cœur ne vaut que 24
  err(() => g.handleAction('b', 'lay', { melds: [ids('H7a H8a H9a')] }), /51 points/);
  // on repose la carte, puis on doit piocher au talon
  g.handleAction('b', 'cancel', { cardId: 'H9a' });
  s = g.getStateFor('b');
  assert.equal(s.phase, 'draw');
  assert.equal(s.discardTop.id, 'H9a');
  err(() => g.handleAction('b', 'draw', { from: 'discard' }), /talon/);
  g.handleAction('b', 'draw', { from: 'stock' });
  g.handleAction('b', 'discard', { cardId: 'S2a' });
  assert.equal(g.getStateFor('a').currentPlayerId, 'a');
});

test('ouverture : 51 points en une fois (plusieurs combinaisons), carte de la défausse comprise', () => {
  const g = rigged({
    hands: { b: 'H11a H12a S13a D13a C13a S2a S4a S6a D9a C3a C5a D1a H2a' },
    discard: 'S1a H13a',
  });
  g.handleAction('b', 'draw', { from: 'discard' });
  // V-D-R de Cœur (30) seul : pas assez
  err(() => g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a')] }), /51 points.*30/);
  // brelan de Rois (30) + V-D de Cœur... on rassemble : V-D-R ♥ 30 + R♠ R♦ R♣ 30 = 60
  g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a'), ids('S13a D13a C13a')] });
  const s = g.getStateFor('b');
  assert.equal(s.players.find((p) => p.id === 'b').opened, true);
  assert.equal(s.melds.length, 2);
  assert.deepEqual(s.turn.mustUse, []);
  assert.equal(s.myHand.length, 8);
  const lay = s.events.find((e) => e.type === 'lay');
  assert.equal(lay.value, 60);
  assert.equal(lay.opened, true);
  g.handleAction('b', 'discard', { cardId: 'S2a' });
});

test('ouverture : la carte prise à la défausse doit faire partie de l’ouverture', () => {
  const g = rigged({
    hands: { b: 'H10a H11a H12a H13a S10a D10a C10a S2a S4a D9a C3a C5a D1a' },
    discard: 'S1a H9b',
  });
  g.handleAction('b', 'draw', { from: 'discard' });
  // 70 points sans le 9♥ pris : refusé (on ne « pêche » pas la carte pour l'ajouter après)
  err(() => g.handleAction('b', 'lay', { melds: [ids('H10a H11a H12a H13a'), ids('S10a D10a C10a')] }), /défausse.*ouverture/);
  assert.equal(g.players[1].opened, false);
  assert.equal(g.players[1].hand.length, 14);
  // avec le 9♥ dans l'ouverture : accepté
  g.handleAction('b', 'lay', { melds: [ids('H9b H10a H11a H12a H13a'), ids('S10a D10a C10a')] });
  assert.equal(g.players[1].opened, true);
  assert.deepEqual(g.getStateFor('b').turn.mustUse, []);
  g.handleAction('b', 'discard', { cardId: 'S2a' });
});

test('actions mal formées : erreurs de jeu, rien ne bouge', () => {
  const g = rigged({ hands: { b: 'H11a H12a H13a S13a D13a C13a S4a S6a D9a C3a C5a D1a H2a' } });
  g.handleAction('b', 'draw', { from: 'stock' });
  err(() => g.handleAction('b', 'lay', { melds: ['H11a'] }));
  err(() => g.handleAction('b', 'lay', { melds: [[]] }));
  err(() => g.handleAction('b', 'lay', { melds: [[1, 2, 3]] }));
  err(() => g.handleAction('b', 'lay', { melds: 'H11a' }));
  err(() => g.handleAction('b', 'lay', {}));
  g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a'), ids('S13a D13a C13a')] });
  err(() => g.handleAction('b', 'add', { meldId: g.melds[0].id, cardIds: [{}] }));
  err(() => g.handleAction('b', 'add', { meldId: g.melds[0].id, cardIds: null }));
  assert.equal(g.players[1].hand.length, 8);
});

test('ouverture à 30 points (option)', () => {
  const g = rigged({ options: { opening: 30 }, hands: { b: 'H11a H12a H13a S2a S4a S6a D9a C3a C5a D1a H2a C8a D4a' } });
  g.handleAction('b', 'draw', { from: 'stock' });
  g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a')] });
  assert.equal(g.players[1].opened, true);
});

test('combinaison invalide refusée avec son explication, cartes absentes refusées', () => {
  const g = rigged({ hands: { b: 'H11a H12a H13a S13a D13a C13a S4a S6a D9a C3a C5a D1a H2a' } });
  g.handleAction('b', 'draw', { from: 'stock' });
  err(() => g.handleAction('b', 'lay', { melds: [ids('H11a H12a S4a')] }), /couleur/);
  err(() => g.handleAction('b', 'lay', { melds: [ids('H11a H12a H10b')] }), /pas dans ta main/);
  err(() => g.handleAction('b', 'lay', { melds: [ids('H11a H11a H12a')] }), /deux fois/);
  err(() => g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a'), ids('S13a D13a C13a S4a')] }), /Combinaison 2/);
  assert.equal(g.players[1].hand.length, 14); // rien n'a bougé
});

test('ajouts : interdits avant d’ouvrir, permis ensuite sur toutes les combinaisons', () => {
  const g = rigged({
    hands: {
      b: 'H11a H12a H13a S13a D13a C13a S4a S6a D9a C3a C5a D1a H2a',
      a: 'H10a S10a D10a C10a S1a S5a S7a S8a S9a D2a D3a D4a C7a',
    },
    stock: 'S2b C2a H1a',
  });
  g.handleAction('b', 'draw', { from: 'stock' }); // H1a
  g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a'), ids('S13a D13a C13a')] });
  const run = g.melds[0].id;
  // l'As haut prolonge V-D-R de Cœur dès le tour de l'ouverture
  g.handleAction('b', 'add', { meldId: run, cardIds: ['H1a'] });
  assert.deepEqual(g.melds[0].cards.map((x) => x.pos), [11, 12, 13, 14]);
  g.handleAction('b', 'discard', { cardId: 'S4a' });
  // Alice n'a pas ouvert : pas d'ajout
  g.handleAction('a', 'draw', { from: 'stock' }); // C2a
  err(() => g.handleAction('a', 'add', { meldId: run, cardIds: ['H10a'] }), /Ouvre d’abord/);
  // elle ouvre : carré de 10 (40) + 7-8-9 ♠ (24) = 64 ; le 5 de Pique ne suit pas sa suite
  g.handleAction('a', 'lay', { melds: [ids('H10a S10a D10a C10a'), ids('S7a S8a S9a')] });
  err(() => g.handleAction('a', 'add', { meldId: g.melds[3].id, cardIds: ['S5a'] }), /suivent/);
  // un 2 de Carreau ne va pas sur le brelan de Rois de Bob
  err(() => g.handleAction('a', 'add', { meldId: g.melds[1].id, cardIds: ['D2a'] }), /même rang/);
  g.handleAction('a', 'discard', { cardId: 'S1a' });
  assert.equal(g.getStateFor('a').players.find((p) => p.id === 'a').opened, true);
});

test('ajout sur la combinaison d’un autre joueur et Joker en bout de suite', () => {
  const g = rigged({
    hands: {
      b: 'H11a H12a H13a S13a D13a C13a S4a S6a D9a C3a C5a D1a H2a',
      a: 'C10a C11a C12a C13b D10a S10a H10b C10b JK1 S5a D3a D4a C2a',
    },
    stock: 'S2b C2b H8b',
  });
  g.handleAction('b', 'draw', { from: 'stock' });
  g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a'), ids('S13a D13a C13a')] });
  g.handleAction('b', 'discard', { cardId: 'S4a' });
  g.handleAction('a', 'draw', { from: 'stock' }); // C2b
  g.handleAction('a', 'lay', { melds: [ids('C10a C11a C12a C13b'), ids('D10a S10a C10b')] }); // 40 + 30
  // Alice complète la suite de Bob (10 de Cœur en bas)
  g.handleAction('a', 'add', { meldId: g.melds[0].id, cardIds: ['H10b'] });
  assert.equal(g.melds[0].cards.length, 4);
  assert.equal(g.melds[0].owner, 'b');
  // Joker ajouté en bas (end: 'low') : il devient le 8 de Cœur
  g.handleAction('a', 'add', { meldId: g.melds[0].id, cardIds: ['JK1'], end: 'low' });
  assert.deepEqual(g.melds[0].cards[0].as, { rank: 9, suit: 'H', pos: 9 });
  // second Joker refusé sur cette combinaison
  g.players[0].hand.push({ id: 'JK2', suit: 'JK', rank: 0, joker: true });
  err(() => g.handleAction('a', 'add', { meldId: g.melds[0].id, cardIds: ['JK2'] }), /seul Joker/);
  const ev = g.events.filter((e) => e.type === 'add');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].meldId, g.melds[0].id);
});

test('échange du Joker : carte exacte exigée, Joker à reposer dans le tour, annulation possible', () => {
  const g = rigged({
    hands: {
      b: 'H5a JK1 H7a S13a D13a C13a H13a S4a D9a C3a C5a D1a H2a',
      a: 'H6b S9a S10a S11a D2a D3a D4a C7a C8a C9a S1a D12a C1a',
    },
    stock: 'S2b C2b H8b',
  });
  g.handleAction('b', 'draw', { from: 'stock' }); // H8b
  g.handleAction('b', 'lay', { melds: [ids('H5a JK1 H7a'), ids('S13a D13a C13a H13a')] }); // 18 + 40
  const runId = g.melds[0].id;
  g.handleAction('b', 'discard', { cardId: 'S4a' });
  g.handleAction('a', 'draw', { from: 'stock' }); // C2b
  // pas encore ouvert : pas d'échange
  err(() => g.handleAction('a', 'swap', { meldId: runId, cardId: 'H6b' }), /Ouvre d’abord/);
  g.handleAction('a', 'lay', { melds: [ids('S9a S10a S11a'), ids('C7a C8a C9a'), ids('D2a D3a D4a')] }); // 30 + 24 + 9 = 63
  err(() => g.handleAction('a', 'swap', { meldId: runId, cardId: 'S1a' }), /6♥/);
  err(() => g.handleAction('a', 'swap', { meldId: g.melds[1].id, cardId: 'H6b' }), /pas de Joker/);
  g.handleAction('a', 'swap', { meldId: runId, cardId: 'H6b' });
  let s = g.getStateFor('a');
  assert.ok(s.myHand.some((x) => x.id === 'JK1'));
  assert.deepEqual(s.turn.mustUse, ['JK1']);
  assert.deepEqual(g.melds[0].cards.map((x) => x.id), ['H5a', 'H6b', 'H7a']);
  err(() => g.handleAction('a', 'discard', { cardId: 'S1a' }), /Joker/);
  // annulation : le Joker retourne à sa place, le 6 en main
  g.handleAction('a', 'cancel', { cardId: 'JK1' });
  assert.deepEqual(g.melds[0].cards.map((x) => x.id), ['H5a', 'JK1', 'H7a']);
  assert.ok(g.players[0].hand.some((x) => x.id === 'H6b'));
  // nouvel échange ; après un ajout sur la même combinaison, il ne s'annule plus
  g.handleAction('a', 'swap', { meldId: runId, cardId: 'H6b' });
  g.players[0].hand.push({ id: 'H8z', suit: 'H', rank: 8 });
  g.handleAction('a', 'add', { meldId: runId, cardIds: ['H8z'] });
  err(() => g.handleAction('a', 'cancel', { cardId: 'JK1' }), /a changé/);
  // le Joker est reposé sur la suite de Pique
  g.handleAction('a', 'add', { meldId: g.melds[2].id, cardIds: ['JK1'] });
  assert.equal(g.melds[2].cards.at(-1).as.rank, 12);
  s = g.getStateFor('a');
  assert.deepEqual(s.turn.mustUse, []);
  g.handleAction('a', 'discard', { cardId: 'S1a' });
  assert.equal(g.getStateFor('b').currentPlayerId, 'b');
});

test('échange dans un brelan : une couleur absente du brelan', () => {
  const g = rigged({
    hands: {
      b: 'H8a S8a JK1 S13a D13a C13a H13a S4a D9a C3a C5a D1a H2a',
      a: 'H8b D8b S9a S10a S11a D2a D3a D4a C7a C8a C9a D12a C1a',
    },
  });
  g.handleAction('b', 'draw', { from: 'stock' });
  g.handleAction('b', 'lay', { melds: [ids('H8a S8a JK1'), ids('S13a D13a C13a H13a')] });
  g.handleAction('b', 'discard', { cardId: 'S4a' });
  g.handleAction('a', 'draw', { from: 'stock' });
  g.handleAction('a', 'lay', { melds: [ids('S9a S10a S11a'), ids('C7a C8a C9a'), ids('D2a D3a D4a')] });
  err(() => g.handleAction('a', 'swap', { meldId: g.melds[0].id, cardId: 'H8b' }), /remplace/); // Cœur déjà là
  g.handleAction('a', 'swap', { meldId: g.melds[0].id, cardId: 'D8b' });
  assert.deepEqual(g.melds[0].cards.map((x) => x.id).sort(), ['D8b', 'H8a', 'S8a']);
});

test('ajouter la carte que remplace le Joker d’une suite : il faut l’échanger', () => {
  const g = rigged({
    hands: { b: 'H5a JK1 H7a S13a D13a C13a H13a H6b D9a C3a C5a D1a H2a' },
  });
  g.handleAction('b', 'draw', { from: 'stock' });
  g.handleAction('b', 'lay', { melds: [ids('H5a JK1 H7a'), ids('S13a D13a C13a H13a')] });
  err(() => g.handleAction('b', 'add', { meldId: g.melds[0].id, cardIds: ['H6b'] }), /Échanger le Joker/);
});

// ===================================================================== fin de donne

test('rami : ouvrir et sortir dans le même tour double les pénalités', () => {
  const g = rigged({
    players: P3,
    hands: { b: 'H11a H12a H13a S13a D13a C13a S4a S5a S6a D1a D2a D3a C9a', a: 'JK1 H1a S12a D7a', c: 'C2a C3a' },
    stock: 'S2b C2b D4b',
  });
  g.handleAction('b', 'draw', { from: 'stock' }); // D4b
  g.handleAction('b', 'lay', { melds: [ids('H11a H12a H13a'), ids('S13a D13a C13a'), ids('S4a S5a S6a'), ids('D1a D2a D3a D4b')] });
  assert.deepEqual(g.players[1].hand.map((x) => x.id), ['C9a']);
  g.handleAction('b', 'discard', { cardId: 'C9a' });
  const s = g.getStateFor('a');
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.summary.winnerId, 'b');
  assert.equal(s.summary.rami, true);
  // Alice : Joker 20 + As 11 + Dame 10 + 7 = 48, doublé 96 ; Chloé : 2 + 3 = 5, doublé 10
  assert.equal(s.summary.penalties.a.base, 48);
  assert.equal(s.summary.penalties.a.points, 96);
  assert.equal(s.summary.penalties.c.points, 10);
  assert.equal(s.summary.penalties.b.points, 0);
  assert.deepEqual(s.summary.hands.c.map((x) => x.id), ['C2a', 'C3a']); // mains montrées en fin de donne
  assert.equal(s.players.find((p) => p.id === 'a').total, 96);
  assert.equal(s.events.some((e) => e.type === 'out' && e.rami), true);
  err(() => g.handleAction('b', 'draw', { from: 'stock' }), /terminée/);
  g.handleAction('c', 'next');
  const n = g.getStateFor('a');
  assert.equal(n.phase, 'draw');
  assert.equal(n.roundNumber, 2);
  assert.equal(n.dealerId, 'b');
  assert.equal(n.currentPlayerId, 'c');
  assert.equal(n.myHand.length, 13);
  assert.equal(n.melds.length, 0);
  assert.equal(n.players.every((p) => !p.opened), true);
  assert.equal(n.history.length, 1);
  err(() => g.handleAction('a', 'next'), /en cours/);
});

test('sortie en posant toutes ses cartes (sans défausse finale), sans rami si déjà ouvert', () => {
  const g = rigged({
    hands: { b: 'H11a H12a H13a C9a', a: 'JK1 H1a S12a D7a' },
    stock: 'S2b C2b H10b',
  });
  g.players[1].opened = true;
  g.turn.openedBefore = true;
  g.handleAction('b', 'draw', { from: 'stock' }); // H10b
  g.handleAction('b', 'lay', { melds: [ids('H10b H11a H12a H13a')] });
  g.handleAction('b', 'discard', { cardId: 'C9a' });
  const s = g.getStateFor('a');
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.summary.rami, false);
  assert.equal(s.summary.penalties.a.points, 48);
  // autre cas : tout posé, la main est vide sans défausser
  const h = rigged({ hands: { b: 'H11a H12a H13a' }, stock: 'S2b C2b H10b' });
  h.players[1].opened = true;
  h.turn.openedBefore = true;
  h.handleAction('b', 'draw', { from: 'stock' });
  h.handleAction('b', 'lay', { melds: [ids('H10b H11a H12a H13a')] });
  assert.equal(h.getStateFor('a').phase, 'roundEnd');
  assert.equal(h.getStateFor('a').summary.winnerId, 'b');
});

test('talon épuisé : la défausse (sauf la carte du dessus) est mélangée', () => {
  const g = rigged({ hands: { b: 'H2a H4a H6a H8a', a: 'S2a S4a S6a S8a' }, stock: 'C5a', discard: 'D1a D2a D3a D4a' });
  g.handleAction('b', 'draw', { from: 'stock' }); // C5a, talon vide
  g.handleAction('b', 'discard', { cardId: 'C5a' });
  const s = g.getStateFor('a');
  assert.equal(s.discardCount, 1);
  assert.equal(s.discardTop.id, 'C5a');
  assert.equal(s.stockCount, 4);
  assert.equal(s.events.some((e) => e.type === 'reshuffle' && e.count === 4), true);
  g.handleAction('a', 'draw', { from: 'stock' });
  assert.equal(g.players[0].hand.length, 5);
});

test('donne bloquée : plus rien à piocher', () => {
  const g = rigged({ hands: { b: 'H2a H4a H6a H8a', a: 'S2a S4a S6a S8a' }, stock: '', discard: 'D1a' });
  g.stock = [];
  g.handleAction('b', 'draw', { from: 'stock' });
  const s = g.getStateFor('a');
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.summary.winnerId, null);
  assert.equal(s.summary.blocked, true);
  assert.equal(s.summary.penalties.a.points, 20);
});

// ===================================================================== partie complète, résultat

test('partie : fin après le nombre de donnes, le plus petit total gagne', () => {
  const g = new Rami({ players: P3, options: { rounds: 3 }, rng: seeded(11) });
  const totals = [[30, 0, 12], [5, 40, 0], [0, 7, 9]]; // a, b, c
  for (let r = 0; r < 3; r++) {
    // mains fabriquées : autant de 2 de Pique que de points voulus / 2
    g.players.forEach((p, i) => { p.hand = Array.from({ length: totals[r][i] }, (_, k) => ({ id: `Y${r}${i}${k}`, suit: 'S', rank: 2 })); });
    g.endRound(g.players[totals[r].indexOf(0)]);
    if (r < 2) {
      assert.equal(g.phase, 'roundEnd');
      g.handleAction('a', 'next');
    }
  }
  assert.equal(g.isOver(), true);
  err(() => g.handleAction('a', 'next'), /terminée/);
  // totaux : a = (30+5+0)*2 = 70, b = (0+40+7)*2 = 94, c = (12+0+9)*2 = 42 (cartes de 2 points)
  const s = g.getStateFor('a');
  assert.deepEqual(s.players.map((p) => p.total), [70, 94, 42]);
  const res = g.getResult();
  assert.deepEqual(res.players.map((p) => p.result), ['loss', 'loss', 'win']);
  assert.deepEqual(res.players.map((p) => p.score), [24, 0, 52]); // points d'avance sur le dernier
  assert.match(res.summary, /1\. Chloé 42 pts, 2\. Alice 70 pts, 3\. Bob 94 pts/);
});

test('résultat : ex aequo, tous gagnants', () => {
  const g = new Rami({ players: P2, options: { rounds: 3 }, rng: seeded(2) });
  g.players[0].total = 10;
  g.players[1].total = 10;
  g.phase = 'gameOver';
  assert.deepEqual(g.getResult().players.map((p) => p.result), ['win', 'win']);
});

// ===================================================================== secret

test('getStateFor : jamais les mains des autres ni l’ordre du talon', () => {
  const g = new Rami({ players: P3, rng: seeded(5) });
  g.handleAction('b', 'draw', { from: 'stock' });
  for (const pid of ['a', 'b', 'c']) {
    const s = g.getStateFor(pid);
    const json = JSON.stringify(s);
    for (const other of g.players.filter((p) => p.id !== pid)) {
      for (const card of other.hand) {
        // une carte d'un autre ne figure dans l'état que si elle est publique (défausse)
        assert.equal(json.includes(`"${card.id}"`), false, `${pid} voit ${card.id} de ${other.id}`);
      }
    }
    for (const card of g.stock) assert.equal(json.includes(`"${card.id}"`), false, `${pid} voit le talon (${card.id})`);
    assert.equal('stock' in s, false);
    assert.equal(s.players.every((p) => !('hand' in p)), true);
    assert.equal(typeof s.stockCount, 'number');
  }
  // le joueur qui pioche au talon ne révèle pas sa carte dans les événements
  const draw = g.getStateFor('a').events.find((e) => e.type === 'draw');
  assert.equal(draw.from, 'stock');
  assert.equal('card' in draw, false);
  // mustUse / Jokers récupérés : seulement pour le joueur concerné
  assert.deepEqual(g.getStateFor('a').turn.mustUse, []);
});

test('partie jouée au hasard jusqu’au bout (2 à 6 joueurs) : invariants', () => {
  for (const n of [2, 4, 6]) {
    const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` }));
    const rng = seeded(100 + n);
    const g = new Rami({ players, options: { rounds: 3, opening: 30 }, rng });
    let guard = 0;
    while (!g.isOver() && guard++ < 20000) {
      if (g.phase === 'roundEnd') { g.handleAction('p0', 'next'); continue; }
      const p = g.current;
      if (g.phase === 'draw') g.handleAction(p.id, 'draw', { from: 'stock' });
      // pose gloutonne de brelans pour faire avancer la partie
      const byRank = {};
      for (const x of p.hand) if (!x.joker) (byRank[x.rank] ??= {})[x.suit] ??= x;
      const melds = Object.values(byRank).map((o) => Object.values(o)).filter((a) => a.length >= 3).map((a) => a.slice(0, 4).map((x) => x.id));
      if (melds.length) {
        try { g.handleAction(p.id, 'lay', { melds }); } catch (e) { assert.equal(e.isGameError, true); }
      }
      if (g.phase !== 'play') continue;
      if (p.opened) {
        for (const x of [...p.hand]) {
          for (const m of g.melds) {
            if (p.hand.length <= 1) break;
            try { g.handleAction(p.id, 'add', { meldId: m.id, cardIds: [x.id] }); break; } catch (e) { assert.equal(e.isGameError, true); }
          }
          if (g.phase !== 'play') break;
        }
      }
      if (g.phase !== 'play') continue;
      g.handleAction(p.id, 'discard', { cardId: p.hand[0].id });
      // conservation des 108 cartes
      const all = [...g.players.flatMap((q) => q.hand), ...g.stock, ...g.discard, ...g.melds.flatMap((m) => m.cards)];
      assert.equal(all.length, 108);
      assert.equal(new Set(all.map((x) => x.id)).size, 108);
    }
    assert.equal(g.isOver(), true, `partie à ${n} terminée`);
    assert.equal(g.history.length, 3);
    const r = g.getResult();
    assert.equal(r.players.length, n);
    assert.ok(r.players.some((x) => x.result === 'win'));
  }
});

test('client : la validation de l’aperçu donne les mêmes réponses que le serveur', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '../games/rami/client/melds.js'), 'utf8');
  const C = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  const deck = M.buildDeck();
  const rng = seeded(42);
  for (let k = 0; k < 4000; k++) {
    // tirages biaisés vers des combinaisons plausibles : même couleur ou même rang
    const base = deck[Math.floor(rng() * deck.length)];
    const pool = deck.filter((x) => x.joker || (rng() < 0.5 ? x.suit === base.suit : x.rank === base.rank));
    const n = 2 + Math.floor(rng() * 5);
    const pick = M.shuffle(pool, rng).slice(0, n);
    const opts = rng() < 0.3 ? { jokerEnd: 'low' } : {};
    const a = M.analyzeMeld(pick, opts);
    const b = C.analyzeMeld(pick, opts);
    assert.deepEqual(b, a);
    if (a.ok) {
      for (const x of deck.slice(0, 60)) assert.equal(C.canReplaceJoker(a, x), M.canReplaceJoker(a, x));
      assert.equal(C.meldValue(a), M.meldValue(a));
    }
  }
  assert.equal(C.handPenalty(cs('JK1 H1a S13a D7a')), M.handPenalty(cs('JK1 H1a S13a D7a')));
});
