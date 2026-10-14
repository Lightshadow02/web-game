'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameRegistry, resolveOptions } = require('../src/core/gameRegistry');
const { Room } = require('../src/core/Room');

/** Jeu factice avec une option, qui mémorise les options reçues. */
function fakeGame(received) {
  return {
    id: 'faux',
    name: 'Faux',
    description: '',
    minPlayers: 1,
    maxPlayers: 4,
    options: [
      { id: 'mode', label: 'Mode', default: 'normal', choices: [
        { value: 'facile', label: 'Facile' }, { value: 'normal', label: 'Normal' }] },
      { id: 'jetons', label: 'Jetons', default: 100, choices: [{ value: 100, label: '100' }, { value: 500, label: '500' }] },
    ],
    createGame({ players, options }) {
      received.push(options);
      return { handleAction() {}, getStateFor: () => ({ players: players.length }) };
    },
  };
}

test('options de jeu : validation, réglage par l’hôte, transmission à createGame', () => {
  const received = [];
  const registry = new GameRegistry();
  registry.register(fakeGame(received));
  assert.deepEqual(registry.list()[0].options.map((o) => o.id), ['mode', 'jetons']);
  assert.equal(registry.list()[0].cover, null, 'pas de vignette sans client/cover.svg');

  // option invalide refusée à l'enregistrement
  assert.throws(() => registry.register({ ...fakeGame([]), id: 'casse', options: [{ id: 'x', label: 'X', default: 3, choices: [{ value: 1, label: '1' }] }] }));

  const sent = [];
  const transport = { toRoom: (code, event, data) => sent.push({ event, data }), toPlayer() {} };
  const room = new Room({ code: 'ABCD', registry, transport, maxPlayers: 4 });
  room.addPlayer({ id: 'p1', name: 'Alice' });
  room.addPlayer({ id: 'p2', name: 'Bob' });

  assert.deepEqual(room.publicState().gameOptions, { mode: 'normal', jetons: 100 });
  assert.throws(() => room.setOption('p2', 'mode', 'facile'), /hôte/i);
  assert.throws(() => room.setOption('p1', 'inconnue', 1));
  assert.throws(() => room.setOption('p1', 'mode', 'impossible'));
  assert.throws(() => room.setOption('p1', 'jetons', '500'), 'le type compte');

  room.setOption('p1', 'jetons', 500);
  assert.deepEqual(room.publicState().gameOptions, { mode: 'normal', jetons: 500 });

  room.startGame('p1');
  assert.deepEqual(received, [{ mode: 'normal', jetons: 500 }]);
  assert.throws(() => room.setOption('p1', 'mode', 'facile'), /pendant une partie/);
});

test('resolveOptions : valeurs par défaut et valeurs inconnues ignorées', () => {
  const mod = fakeGame([]);
  assert.deepEqual(resolveOptions(mod), { mode: 'normal', jetons: 100 });
  assert.deepEqual(resolveOptions(mod, { mode: 'facile', jetons: 7 }), { mode: 'facile', jetons: 100 });
  assert.deepEqual(resolveOptions(null), {});
  assert.deepEqual(resolveOptions({ id: 'sans' }), {});
});

test('vignettes : chaque jeu livré a sa cover.svg, servie sur /games/<id>/cover.svg', () => {
  const path = require('path');
  const registry = new GameRegistry();
  registry.loadFromDirectory(path.join(__dirname, '..', 'games'));
  for (const g of registry.list()) assert.equal(g.cover, `/games/${g.id}/cover.svg`);
});
