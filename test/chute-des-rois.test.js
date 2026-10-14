'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChuteDesRois, validateCombo } = require('../games/chute-des-rois/server/ChuteDesRois');
const { makeCard, makeJoker } = require('../games/chute-des-rois/server/cards');
const chuteModule = require('../games/chute-des-rois/server');

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
  assert.throws(() => game.handleAction('p1', 'yield'), /dois jouer/);
});

test('les actions hors tour sont refusées', () => {
  const game = setup({ hand: [makeCard('H', 10)] });
  assert.throws(() => game.handleAction('p1', 'play', { cardIds: ['10H'] }), /pas ton tour/);
  assert.throws(() => game.handleAction('p0', 'play', { cardIds: ['XX'] }), /pas dans ta main/);
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

test('souverains vaincus : liste publique avec le K.O. pile, et contribution de chaque joueur', () => {
  const game = setup({ hand: [makeCard('C', 10), makeCard('H', 2), makeCard('S', 9)] });
  assert.deepEqual(game.getStateFor('p1').fallen, []);
  game.handleAction('p0', 'play', { cardIds: ['10C'] }); // 20 dégâts pile sur 20 PV
  const next = game.boss.card;
  game.boss.hp = 5;
  game.handleAction('p0', 'play', { cardIds: ['9S'] }); // au-delà de 0
  const view = game.getStateFor('p1');
  assert.deepEqual(view.fallen, [{ card: makeCard('S', 11), exact: true }, { card: next, exact: false }]);
  assert.equal(view.players[0].damage, 25, 'les dégâts au-delà des PV ne comptent pas');
  assert.equal(view.players[0].kos, 1);
  assert.equal(view.players[1].damage, 0);
});

test('défausse : la carte du dessus est publique', () => {
  const game = setup({ hand: [makeCard('C', 2), makeCard('H', 6), makeCard('D', 5)] });
  assert.equal(game.getStateFor('p1').discardTop, null);
  game.handleAction('p0', 'play', { cardIds: ['2C'] });
  game.handleAction('p0', 'defend', { cardIds: ['5D', '6H'] });
  assert.deepEqual(game.getStateFor('p1').discardTop, makeCard('H', 6));
  assert.equal(game.getStateFor('p1').discardCount, 2);
});

test('défaite : l’événement dit qui est bloqué et ce qu’il fallait encaisser', () => {
  const game = setup({ hand: [makeCard('C', 2), makeCard('H', 3)] });
  game.handleAction('p0', 'play', { cardIds: ['2C'] });
  const defeat = game.getStateFor('p1').events.at(-1);
  assert.equal(defeat.type, 'defeat');
  assert.deepEqual({ playerId: defeat.playerId, need: defeat.need, total: defeat.total }, { playerId: 'p0', need: 10, total: 3 });
  assert.equal(game.getStateFor('p1').players[1].hand, undefined, 'aucune main adverse dans la vue');
});

// ================================================================ Joker

const JK = makeJoker(1);
const jokersIn = (game) => [...game.tavern, ...game.players.flatMap((p) => p.hand)].filter((c) => c.joker);

test('Joker : 2 / 1 / 0 selon la difficulté (Taverne + mains), Normal par défaut', () => {
  const option = chuteModule.options.find((o) => o.id === 'difficulty');
  assert.equal(option.default, 'normal');
  assert.deepEqual(option.choices.map((c) => c.value), ['facile', 'normal', 'classique']);
  for (const [difficulty, count] of [['facile', 2], ['normal', 1], ['classique', 0]]) {
    for (const n of [1, 4]) {
      const game = chuteModule.createGame({ players: players(n), options: { difficulty } });
      assert.equal(jokersIn(game).length, count, `${difficulty} à ${n}`);
      assert.equal(game.tavern.length + game.players.reduce((sum, p) => sum + p.hand.length, 0), 40 + count);
      assert.equal(game.getStateFor('p0').difficulty, difficulty);
      assert.equal(game.getStateFor('p0').jokerCount, count);
    }
  }
  assert.equal(jokersIn(chuteModule.createGame({ players: players(2) })).length, 1, 'sans option : Normal');
  assert.equal(jokersIn(new ChuteDesRois({ players: players(2) })).length, 0, 'moteur seul : règles classiques');
  assert.throws(() => new ChuteDesRois({ players: players(2), difficulty: 'extreme' }));
});

test('Joker : option réglée dans le salon puis transmise au moteur', () => {
  const { GameRegistry } = require('../src/core/gameRegistry');
  const { Room } = require('../src/core/Room');
  const registry = new GameRegistry();
  registry.register(chuteModule);
  const room = new Room({ code: 'JOKR', registry, transport: { toRoom() {}, toPlayer() {} }, maxPlayers: 4 });
  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });
  assert.deepEqual(room.publicState().gameOptions, { difficulty: 'normal' });
  room.setOption('p1', 'difficulty', 'facile');
  room.startGame('p1');
  assert.equal(room.game.instance.jokerCount, 2);
  assert.equal(jokersIn(room.game.instance).length, 2);
});

test('Joker : se joue seul, jamais en combo ni avec un As', () => {
  assert.doesNotThrow(() => validateCombo([JK]));
  assert.throws(() => validateCombo([JK, makeCard('H', 5)]), /seul/);
  assert.throws(() => validateCombo([makeCard('S', 1), JK]), /seul/);
  assert.throws(() => validateCombo([JK, makeJoker(2)]), /seul/);
  const game = setup({ hand: [JK, makeCard('H', 1), makeCard('D', 10)] });
  assert.throws(() => game.handleAction('p0', 'play', { cardIds: ['1H', 'JK1'] }), /seul/);
  assert.equal(game.players[0].hand.length, 3, 'rien n’a bougé');
  assert.equal(game.phase, 'attack');
});

test('Joker : aucun dégât, pas de riposte, le joueur choisit qui joue (mains révélées)', () => {
  const game = setup({ n: 3, hand: [JK, makeCard('H', 10)] });
  game.players[1].hand = [makeCard('C', 4), makeCard('S', 9)];
  game.players[2].hand = [makeCard('D', 2)];
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  assert.equal(game.boss.hp, 20, 'aucun dégât');
  assert.equal(game.phase, 'choose', 'pas de riposte : on choisit qui joue');
  assert.equal(game.pendingDamage, 0);
  assert.deepEqual(game.plays, [{ playerId: 'p0', cards: [JK] }], 'posé contre ce boss');

  const view = game.getStateFor('p2');
  assert.equal(view.chooserId, 'p0');
  assert.equal(view.canYield, false);
  assert.equal(view.boss.immuneSuit, null);
  assert.equal(view.boss.immunityBroken, true);
  assert.deepEqual(view.players[0].hand, [makeCard('H', 10)], 'toutes les mains sont visibles de tous');
  assert.deepEqual(view.players[1].hand, [makeCard('S', 9), makeCard('C', 4)]);
  assert.deepEqual(view.players[2].hand, [makeCard('D', 2)]);
  assert.deepEqual(view.events.map((e) => e.type), ['joker']);
  assert.equal(view.events[0].broken, true);
  assert.match(view.log.at(-1).text, /Joueur 0 joue le Joker : l’immunité du Valet de Pique tombe, pas de riposte/);

  game.handleAction('p0', 'choose', { playerId: 'p2' });
  assert.equal(game.phase, 'attack');
  assert.equal(game.currentPlayer().id, 'p2');
  for (const id of ['p0', 'p1', 'p2']) {
    const after = game.getStateFor(id);
    assert.equal(after.chooserId, null);
    assert.ok(after.players.every((p) => p.hand === undefined), 'mains de nouveau secrètes');
  }
  const choose = game.getStateFor('p1').events.at(-1);
  assert.deepEqual({ type: choose.type, playerId: choose.playerId, targetId: choose.targetId }, { type: 'choose', playerId: 'p0', targetId: 'p2' });
  assert.ok(!JSON.stringify(game.getStateFor('p1').events).includes('"9S"'), 'aucune main dans les événements');
  assert.match(game.getStateFor('p1').log.at(-1).text, /Joueur 0 choisit Joueur 2\./);
});

test('Joker : seul son joueur choisit, une seule fois, parmi les joueurs de la partie', () => {
  const game = setup({ hand: [JK, makeCard('H', 10)] });
  game.players[1].hand = [makeCard('C', 4)];
  assert.throws(() => game.handleAction('p0', 'choose', { playerId: 'p1' }), /pas le moment/);
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  assert.throws(() => game.handleAction('p1', 'choose', { playerId: 'p1' }), /Joueur 0 de choisir/);
  assert.throws(() => game.handleAction('p0', 'choose', { playerId: 'intrus' }), /pas dans la partie/);
  assert.throws(() => game.handleAction('p0', 'play', { cardIds: ['10H'] }), /Choisis d’abord/);
  assert.throws(() => game.handleAction('p0', 'yield'), /Choisis d’abord/);
  assert.throws(() => game.handleAction('p1', 'play', { cardIds: ['4C'] }), /pas ton tour/);
  game.handleAction('p0', 'choose', { playerId: 'p1' });
  assert.throws(() => game.handleAction('p0', 'choose', { playerId: 'p0' }), /pas le moment/);
});

test('Joker : son joueur peut se choisir lui-même', () => {
  const game = setup({ hand: [JK, makeCard('H', 10)] });
  const turn = game.turn;
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  game.handleAction('p0', 'choose', { playerId: 'p0' });
  assert.equal(game.currentPlayer().id, 'p0');
  assert.equal(game.phase, 'attack');
  assert.equal(game.turn, turn + 1);
  assert.match(game.log.at(-1).text, /choisit de rejouer/);
});

test('Joker : l’immunité tombe pour la suite du combat, sans effet rétroactif', () => {
  // Valet de Cœur : le 5♥ joué avant le Joker ne soigne pas, le 3♥ joué après soigne.
  const game = setup({ boss: makeCard('H', 11), hand: [makeCard('H', 5), makeCard('D', 10)] });
  game.discard = [makeCard('C', 2), makeCard('C', 4), makeCard('C', 6), makeCard('C', 8)];
  game.players[1].hand = [JK, makeCard('H', 3), makeCard('S', 4)];
  game.handleAction('p0', 'play', { cardIds: ['5H'] });
  assert.equal(game.discard.length, 4, 'immunisé : aucun soin');
  game.handleAction('p0', 'defend', { cardIds: ['10D'] }); // la défausse passe à 5 cartes (le 5♥ reste posé)
  game.handleAction('p1', 'play', { cardIds: ['JK1'] });
  assert.equal(game.discard.length, 5, 'pas de soin rétroactif');
  game.handleAction('p1', 'choose', { playerId: 'p1' });
  const tavern = game.tavern.length;
  game.handleAction('p1', 'play', { cardIds: ['3H'] });
  assert.equal(game.discard.length, 2, 'le Cœur soigne contre le Valet de Cœur');
  assert.equal(game.tavern.length, tavern + 3);
  const attack = game.getStateFor('p0').events.findLast((e) => e.type === 'attack');
  assert.equal(attack.healed, 3);
  assert.equal(attack.blockedSuit, null);
});

test('Joker : le Pique protège après le Joker, pas avant', () => {
  const game = setup({ boss: makeCard('S', 11), hand: [makeCard('S', 4), makeCard('D', 10)] });
  game.players[1].hand = [JK, makeCard('S', 3), makeCard('C', 10)];
  game.handleAction('p0', 'play', { cardIds: ['4S'] });
  assert.equal(game.boss.shield, 0, 'immunisé : pas de bouclier');
  game.handleAction('p0', 'defend', { cardIds: ['10D'] });
  game.handleAction('p1', 'play', { cardIds: ['JK1'] });
  game.handleAction('p1', 'choose', { playerId: 'p1' });
  game.handleAction('p1', 'play', { cardIds: ['3S'] });
  assert.equal(game.boss.shield, 3, 'seul le Pique joué après le Joker compte');
  assert.equal(game.pendingDamage, 7);
});

test('Joker : le boss suivant est de nouveau immunisé', () => {
  const game = setup({ boss: makeCard('C', 11), hand: [JK, makeCard('C', 10), makeCard('C', 6), makeCard('D', 9)] });
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  game.handleAction('p0', 'choose', { playerId: 'p0' });
  game.handleAction('p0', 'play', { cardIds: ['10C'] }); // Trèfle doublé : 20 dégâts, K.O. pile
  assert.equal(game.fallen.length, 1);
  const next = game.boss.card;
  assert.equal(game.boss.jokered, false);
  const view = game.getStateFor('p1');
  assert.equal(view.boss.immuneSuit, next.suit);
  assert.equal(view.boss.immunityBroken, false);
  // une carte de la couleur du nouveau boss est de nouveau bloquée
  game.players[0].hand = [makeCard(next.suit, 2), makeCard('D', 10), makeCard('H', 10)];
  game.handleAction('p0', 'play', { cardIds: [`2${next.suit}`] });
  assert.equal(game.getStateFor('p1').events.findLast((e) => e.type === 'attack').blockedSuit, next.suit);
});

test('Joker : un second Joker contre le même boss évite encore la riposte', () => {
  const game = setup({ hand: [JK, makeJoker(2), makeCard('H', 10)] });
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  game.handleAction('p0', 'choose', { playerId: 'p0' });
  game.handleAction('p0', 'play', { cardIds: ['JK2'] });
  assert.equal(game.phase, 'choose');
  const last = game.getStateFor('p1').events.at(-1);
  assert.equal(last.type, 'joker');
  assert.equal(last.broken, false, 'immunité déjà levée');
  assert.match(game.log.at(-1).text, /déjà levée/);
});

test('Joker : en solo, pas de choix, le joueur rejoue (Renouveaux intacts)', () => {
  const game = setup({ n: 1, hand: [JK, makeCard('H', 10)] });
  const turn = game.turn;
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  assert.equal(game.phase, 'attack');
  assert.equal(game.currentPlayer().id, 'p0');
  assert.equal(game.turn, turn + 1);
  assert.equal(game.renewalsLeft, 2);
  const view = game.getStateFor('p0');
  assert.equal(view.chooserId, null);
  assert.equal(view.players[0].hand, undefined);
  assert.deepEqual(view.events.map((e) => e.type), ['joker']);
  assert.match(view.log.at(-1).text, /pas de riposte\. Joueur 0 rejoue\./);
  assert.throws(() => game.handleAction('p0', 'choose', { playerId: 'p0' }), /pas le moment/);
});

test('Joker : en solo, une main vide après le Joker reste sauvable par un Renouveau', () => {
  const game = setup({ n: 1, hand: [JK] });
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  assert.equal(game.phase, 'attack', 'Renouveau encore possible');
  game.renewalsLeft = 0;
  game.checkStalemate();
  assert.equal(game.phase, 'defeat');
});

test('Joker : compte comme un coup joué pour la règle « tout le monde a passé »', () => {
  const game = setup({ n: 3, hand: [makeCard('H', 10), makeCard('D', 10)] });
  game.players[1].hand = [makeCard('S', 10), makeCard('C', 10)];
  game.players[2].hand = [JK, makeCard('H', 9)];
  game.handleAction('p0', 'yield');
  game.handleAction('p0', 'defend', { cardIds: ['10H'] });
  game.handleAction('p1', 'yield');
  game.handleAction('p1', 'defend', { cardIds: ['10S'] });
  assert.equal(game.canYield(), false, 'p2 doit jouer');
  game.handleAction('p2', 'play', { cardIds: ['JK1'] });
  game.handleAction('p2', 'choose', { playerId: 'p0' });
  assert.equal(game.canYield(), true, 'la série de passes est remise à zéro');
});

test('Joker : défaussé pour 0 pendant une riposte, puis ramené par le Cœur', () => {
  const game = setup({ hand: [makeCard('C', 2), JK, makeCard('D', 10), makeCard('H', 4)] });
  game.handleAction('p0', 'play', { cardIds: ['2C'] });
  assert.equal(game.phase, 'defend');
  assert.throws(() => game.handleAction('p0', 'defend', { cardIds: ['JK1'] }), /au moins 10 points \(sélection : 0\)/);
  game.handleAction('p0', 'defend', { cardIds: ['JK1', '10D'] });
  assert.ok(game.discard.some((c) => c.joker), 'le Joker est à la défausse');
  assert.deepEqual(game.getStateFor('p1').discardTop, makeCard('D', 10));
  // Le Cœur remet toute la défausse (2 cartes) sous la Taverne : le Joker revient en jeu.
  game.discard = [JK, makeCard('D', 10)];
  game.players[1].hand = [makeCard('H', 5), makeCard('S', 10), makeCard('C', 10)];
  game.handleAction('p1', 'play', { cardIds: ['5H'] });
  assert.ok(game.tavern.slice(0, 2).some((c) => c.joker), 'sous la Taverne');
  assert.equal(game.discard.length, 0);
});

test('Joker : défaite si la main ne contient que des Jokers face à une riposte', () => {
  const game = setup({ hand: [makeCard('C', 2), JK, makeJoker(2)] });
  game.handleAction('p0', 'play', { cardIds: ['2C'] });
  assert.equal(game.phase, 'defeat');
  const defeat = game.getStateFor('p1').events.at(-1);
  assert.deepEqual({ type: defeat.type, need: defeat.need, total: defeat.total }, { type: 'defeat', need: 10, total: 0 });
});

test('Joker : compte dans la taille de la main (pioche du Carreau)', () => {
  const game = setup({ hand: [makeCard('D', 3), makeCard('C', 10)] });
  game.players[1].hand = [JK, makeCard('S', 2), makeCard('S', 3), makeCard('S', 4), makeCard('S', 5), makeCard('S', 6), makeCard('S', 7)];
  game.handleAction('p0', 'play', { cardIds: ['3D'] });
  assert.equal(game.players[1].hand.length, 7, 'main pleine avec le Joker : rien pioché');
  assert.equal(game.players[0].hand.length, 1 + 3);
});

test('Joker : rangé en fin de main, journal lisible', () => {
  const game = setup({ hand: [JK, makeCard('S', 2), makeCard('H', 1)] });
  assert.deepEqual(game.getStateFor('p0').myHand.map((c) => c.id), ['2S', '1H', 'JK1']);
  game.handleAction('p0', 'play', { cardIds: ['JK1'] });
  assert.equal(game.lastAttack.damage, 0);
  assert.equal(game.players[0].lastAction.type, 'joker');
  assert.ok(!/undefined|null/.test(game.log.at(-1).text));
});
