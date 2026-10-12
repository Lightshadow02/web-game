'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createHubServer } = require('../src/index');

/** Client de test : mémorise le dernier état reçu par événement. */
function client(url, token) {
  const socket = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
  const last = {};
  for (const event of ['session', 'games:list', 'room:state', 'game:state', 'room:left']) {
    socket.on(event, (data) => (last[event] = data ?? true));
  }
  const notices = [];
  socket.on('room:notice', (m) => notices.push(m.text));
  const request = (event, data = {}) => new Promise((resolve) => socket.emit(event, data, resolve));
  const waitFor = async (predicate, timeout = 2000) => {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeout) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { socket, last, notices, request, waitFor };
}

test('parcours complet : salon, annonces, lancement, action, reconnexion', async (t) => {
  const { server, io } = createHubServer({ reconnectGraceMs: 200 });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  t.after(() => { io.close(); server.close(); });

  const alice = client(url);
  await alice.waitFor(() => alice.last.session && alice.last['games:list']);
  assert.ok(alice.last['games:list'].some((g) => g.id === 'chute-des-rois'));

  // Pseudo invalide
  assert.equal((await alice.request('room:create', { name: 'A' })).ok, false);

  const created = await alice.request('room:create', { name: 'Alice' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z]{4,5}$/);

  const bob = client(url);
  await bob.waitFor(() => bob.last.session);
  assert.equal((await bob.request('room:join', { code: 'ZZZZ', name: 'Bob' })).ok, false);
  assert.equal((await bob.request('room:join', { code: created.code, name: 'alice' })).ok, false, 'pseudo déjà pris');
  assert.equal((await bob.request('room:join', { code: created.code.toLowerCase(), name: 'Bob' })).ok, true);

  await alice.waitFor(() => alice.last['room:state']?.players.length === 2);
  const room = alice.last['room:state'];
  assert.equal(room.hostId, alice.last.session.playerId);

  // Seul l'hôte lance la partie
  assert.equal((await bob.request('room:startGame')).ok, false);

  // Annonce d'arrivée (notification du salon)
  await alice.waitFor(() => alice.notices.includes('Bob a rejoint le salon.'));

  // Lancement : chaque joueur reçoit SA main
  assert.equal((await alice.request('room:startGame')).ok, true);
  await alice.waitFor(() => alice.last['game:state'] && bob.last['game:state']);
  const aliceView = alice.last['game:state'].state;
  const bobView = bob.last['game:state'].state;
  assert.equal(aliceView.myHand.length, 7);
  assert.notDeepEqual(aliceView.myHand, bobView.myHand);
  assert.equal(aliceView.isMyTurn, true);

  // Action hors tour refusée, action valide acceptée
  const bobTry = await bob.request('game:action', { type: 'play', payload: { cardIds: [bobView.myHand[0].id] } });
  assert.equal(bobTry.ok, false);
  const played = await alice.request('game:action', { type: 'play', payload: { cardIds: [aliceView.myHand[0].id] } });
  assert.equal(played.ok, true, played.error);
  await bob.waitFor(() => bob.last['game:state'].state.table.length === 1);

  // Reconnexion de Bob avec son jeton : il retrouve la partie
  const bobToken = bob.last.session.token;
  bob.socket.disconnect();
  await alice.waitFor(() => alice.last['room:state'].players.some((p) => !p.connected));
  const bob2 = client(url, bobToken);
  await bob2.waitFor(() => bob2.last['game:state'] && bob2.last['room:state']);
  assert.equal(bob2.last.session.playerId, bob.last.session.playerId);
  assert.ok(bob2.last['room:state'].players.every((p) => p.connected));

  // Bob quitte : la partie est interrompue, l'hôte reste
  await bob2.request('room:leave');
  await alice.waitFor(() => alice.last['room:state'].status === 'lobby' && alice.last['room:state'].players.length === 1);
  assert.ok(bob2.last['room:left']);

  // Alice se déconnecte définitivement : le salon disparaît après le délai de grâce
  alice.socket.disconnect();
  bob2.socket.disconnect();
  const res = await fetch(`${url}/health`).then((r) => r.json());
  assert.equal(res.status, 'ok');
  await new Promise((r) => setTimeout(r, 350));
  assert.equal((await fetch(`${url}/health`).then((r) => r.json())).rooms, 0);
});
