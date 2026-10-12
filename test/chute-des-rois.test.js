'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChuteDesRois, validateCombo } = require('../games/chute-des-rois/server/ChuteDesRois');
const { makeCard } = require('../games/chute-des-rois/server/cards');

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Joueur ${i}` }));

/** Partie dont on force le boss et la main du joueur actif pour des tests déterministes. */
function setup({ n = 2, boss = makeCard('S', 11), hand = [] } = {}) {
  const game = new ChuteDesRois({ players: players(n) });
  game.boss = { card: boss, hp: 20, maxHp: 20, attack: 10, shield: 0 };
  game.players[0].hand = hand;
  return game;
}

test('mise en place : mains, boss et pioches', () => {
  const game = new ChuteDesRois({ players: players(3) });
  assert.equal(game.players[0].hand.length, 6);
  assert.equal(game.tavern.length, 40 - 18);
  assert.equal(game.boss.card.rank, 11, 'le premier boss est un Valet');
  assert.equal(game.castle.length, 11);
  assert.equal(game.castle[0].rank, 13, 'les Rois sont au fond du château');
});

test('combos', () => {
  assert.doesNotThrow(() => validateCombo([makeCard('H', 7)]));
  assert.doesNotThrow(() => validateCombo([makeCard('H', 1), makeCard('C', 9)]));
  assert.doesNotThrow(() => validateCombo([makeCard('H', 3), makeCard('C', 3), makeCard('D', 3)]));
  assert.throws(() => validateCombo([makeCard('H', 6), makeCard('C', 6)]));
  assert.throws(() => validateCombo([makeCard('H', 2), makeCard('C', 3)]));
});

test('Trèfle double les dégâts', () => {
  const game = setup({ hand: [makeCard('C', 5), makeCard('H', 10), makeCard('D', 10)] });
  game.handleAction('p0', 'play', { cardIds: ['5C'] });
  assert.equal(game.boss.hp, 10);
  assert.equal(game.phase, 'defend');
  assert.equal(game.pendingDamage, 10);
});

test("Pique réduit l'attaque du boss (cumulatif)", () => {
  const game = setup({ boss: makeCard('H', 11), hand: [makeCard('S', 4), makeCard('D', 10)] });
  game.handleAction('p0', 'play', { cardIds: ['4S'] });
  assert.equal(game.boss.shield, 4);
  assert.equal(game.pendingDamage, 6);
});

test('Cœur remet des cartes de la défausse sous la pioche', () => {
  const game = setup({ hand: [makeCard('H', 3), makeCard('D', 10)] });
  game.discard = [makeCard('C', 2), makeCard('C', 4), makeCard('C', 6), makeCard('C', 8)];
  const tavernBefore = game.tavern.length;
  game.handleAction('p0', 'play', { cardIds: ['3H'] });
  assert.equal(game.discard.length, 1);
  assert.equal(game.tavern.length, tavernBefore + 3);
});

test('Carreau fait piocher les joueurs à tour de rôle', () => {
  const game = setup({ hand: [makeCard('D', 4), makeCard('C', 10)] });
  game.players[1].hand = [];
  game.handleAction('p0', 'play', { cardIds: ['4D'] });
  assert.equal(game.players[0].hand.length, 1 + 2);
  assert.equal(game.players[1].hand.length, 2);
});

test('le boss est immunisé contre sa propre couleur', () => {
  const game = setup({ boss: makeCard('C', 11), hand: [makeCard('C', 5), makeCard('D', 10)] });
  game.handleAction('p0', 'play', { cardIds: ['5C'] });
  assert.equal(game.boss.hp, 15, 'pas de doublement contre un boss Trèfle');
});

test('défense : il faut défausser assez de points', () => {
  const game = setup({ hand: [makeCard('C', 2), makeCard('H', 6), makeCard('D', 5)] });
  game.handleAction('p0', 'play', { cardIds: ['2C'] });
  assert.throws(() => game.handleAction('p0', 'defend', { cardIds: ['5D'] }), /au moins 10/);
  game.handleAction('p0', 'defend', { cardIds: ['5D', '6H'] });
  assert.equal(game.phase, 'attack');
  assert.equal(game.currentPlayer().id, 'p1');
});

test('défaite si la main ne peut pas absorber la riposte', () => {
  const game = setup({ hand: [makeCard('C', 2), makeCard('H', 3)] });
  game.handleAction('p0', 'play', { cardIds: ['2C'] });
  assert.equal(game.phase, 'defeat');
});

test('boss vaincu pile : il rejoint la pioche et le joueur rejoue', () => {
  const game = setup({ hand: [makeCard('C', 10), makeCard('H', 2)] });
  game.handleAction('p0', 'play', { cardIds: ['10C'] });
  assert.equal(game.tavern.at(-1).id, '11S');
  assert.equal(game.phase, 'attack');
  assert.equal(game.currentPlayer().id, 'p0');
  assert.equal(game.castle.length, 10);
});

test('passer son tour : interdit si tous les autres ont déjà passé', () => {
  const game = setup({ hand: [makeCard('H', 10), makeCard('D', 10)] });
  game.players[1].hand = [makeCard('S', 10), makeCard('C', 10)];
  game.handleAction('p0', 'yield');
  game.handleAction('p0', 'defend', { cardIds: ['10H'] });
  assert.throws(() => game.handleAction('p1', 'yield'), /devez jouer/);
});

test('les actions hors tour sont refusées', () => {
  const game = setup({ hand: [makeCard('H', 10)] });
  assert.throws(() => game.handleAction('p1', 'play', { cardIds: ['10H'] }), /pas votre tour/);
  assert.throws(() => game.handleAction('p0', 'play', { cardIds: ['XX'] }), /pas dans votre main/);
});

test('victoire après le dernier souverain', () => {
  const game = setup({ hand: [makeCard('C', 10), makeCard('H', 2)] });
  game.castle = [];
  game.handleAction('p0', 'play', { cardIds: ['10C'] });
  assert.equal(game.phase, 'victory');
  assert.equal(game.getStateFor('p0').bossesDefeated, 12);
});

test("la vue d'un joueur ne révèle pas la main des autres", () => {
  const game = new ChuteDesRois({ players: players(2) });
  const view = game.getStateFor('p0');
  assert.equal(view.myHand.length, 7);
  assert.equal(view.players[1].cardCount, 7);
  assert.equal(view.players[1].hand, undefined);
});

test('cartes posées par joueur et événements pour les animations', () => {
  const game = setup({ hand: [makeCard('D', 3), makeCard('H', 10), makeCard('S', 10)] });
  game.players[1].hand = [];
  game.handleAction('p0', 'play', { cardIds: ['3D'] });

  const view = game.getStateFor('p1');
  assert.deepEqual(view.plays, [{ playerId: 'p0', cards: [makeCard('D', 3)] }]);
  assert.equal(view.players[0].lastAction.type, 'attack');

  const [attack, riposte] = view.events;
  assert.equal(attack.type, 'attack');
  assert.equal(attack.damage, 3);
  assert.deepEqual(attack.drawn, { p0: 2, p1: 1 }, 'nombre de cartes piochées par joueur, sans les révéler');
  assert.equal(riposte.type, 'riposte');
  assert.equal(riposte.damage, 10);
  assert.ok(riposte.id > attack.id);

  game.handleAction('p0', 'defend', { cardIds: ['10H'] });
  assert.equal(game.getStateFor('p1').events.at(-1).type, 'defend');
  assert.equal(game.getStateFor('p1').players[0].lastAction.damage, 10);
});

test('boss vaincu : les cartes posées sont nettoyées, nouveau boss annoncé', () => {
  const game = setup({ hand: [makeCard('C', 10), makeCard('H', 2)] });
  game.handleAction('p0', 'play', { cardIds: ['10C'] });
  const view = game.getStateFor('p0');
  assert.deepEqual(view.plays, []);
  assert.deepEqual(view.events.slice(-2).map((e) => e.type), ['bossDefeated', 'newBoss']);
  assert.equal(view.events.at(-2).exact, true);
});
