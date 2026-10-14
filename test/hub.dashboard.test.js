'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createHubServer } = require('../src/index');
const { createAuth } = require('../src/core/auth');
const { Store } = require('../src/core/store');

// ------------------------------------------------------------------ stockage

test('store : demandes, décisions, admins', () => {
  const store = new Store(':memory:');
  const requests = [];
  store.on('request', (u) => requests.push(u.name));

  assert.equal(store.recordLogin({ id: '1', name: 'Admin', isAdmin: true }).status, 'approved');
  assert.equal(store.recordLogin({ id: '2', name: 'Bob' }).status, 'pending');
  assert.equal(store.recordLogin({ id: '3', name: 'Ami', initialStatus: 'approved' }).status, 'approved');
  assert.deepEqual(requests, ['Bob'], 'seul un nouveau compte en attente déclenche une demande');

  // Reconnexion : nom rafraîchi, statut conservé, pas de nouvelle demande.
  assert.equal(store.recordLogin({ id: '2', name: 'Bobby' }).name, 'Bobby');
  assert.equal(store.getUser('2').status, 'pending');
  assert.equal(requests.length, 1);

  assert.equal(store.setStatus('2', 'approved', '1').status, 'approved');
  assert.equal(store.setStatus('2', 'rejected', '1').status, 'rejected');
  assert.throws(() => store.setStatus('1', 'rejected', '1'), /administrateur/);
  assert.equal(store.setStatus('inconnu', 'approved', '1'), null);
  assert.deepEqual(store.listUsers('rejected').map((u) => u.id), ['2']);
});

test('store : parties, stats et classement', () => {
  const store = new Store(':memory:');
  for (const [id, name] of [['a', 'Alice'], ['b', 'Bob']]) store.recordLogin({ id, name, initialStatus: 'approved' });

  store.recordMatch({ gameId: 'g', summary: 'Victoire', players: [{ userId: 'a', result: 'win', score: 12 }, { userId: 'b', result: 'win', score: 12 }] });
  store.recordMatch({ gameId: 'g', summary: 'Défaite', players: [{ userId: 'a', result: 'loss', score: 5 }, { userId: null, result: 'loss' }] });
  assert.equal(store.recordMatch({ gameId: 'g', players: [{ userId: null, result: 'win' }] }), null, 'invités ignorés');

  const [alice] = store.statsForUser('a');
  assert.deepEqual(
    { played: alice.played, wins: alice.wins, losses: alice.losses, bestScore: alice.bestScore },
    { played: 2, wins: 1, losses: 1, bestScore: 12 },
  );
  const recent = store.recentMatches('a');
  assert.equal(recent[0].summary, 'Défaite');
  assert.deepEqual(recent[1].with, ['Bob']);
  assert.deepEqual(store.leaderboard('g').map((r) => [r.name, r.wins, r.played]), [['Alice', 1, 2], ['Bob', 1, 1]]);
});

// ------------------------------------------------------------------ parcours complet

const ENV = {
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  PUBLIC_URL: 'http://jeux.example.com',
  SESSION_SECRET: 's'.repeat(40),
  ADMIN_DISCORD_IDS: '42',
};

/** Faux Discord : le code OAuth "u<ID>" connecte l'utilisateur <ID>. */
const NAMES = { 42: 'lightshadow02', 77: 'Perceval', 88: 'Karadoc' };
const fakeDiscord = async (url, init) => {
  const u = String(url);
  const json = (body) => ({ ok: true, json: async () => body });
  if (u.endsWith('/oauth2/token')) return json({ access_token: `tok-${new URLSearchParams(init.body).get('code').slice(1)}` });
  if (u.endsWith('/users/@me')) {
    const id = init.headers.Authorization.split('-')[1];
    return json({ id, username: NAMES[id], global_name: null, avatar: null });
  }
  throw new Error(`URL inattendue ${u}`);
};

async function startHub(t) {
  const store = new Store(':memory:');
  const auth = createAuth(ENV, { fetchImpl: fakeDiscord, store });
  const hub = createHubServer({ auth, store });
  await new Promise((r) => hub.server.listen(0, r));
  t.after(() => { hub.io.close(); hub.server.close(); store.close(); });
  return { ...hub, url: `http://localhost:${hub.server.address().port}` };
}

async function login(url, id) {
  const start = await fetch(`${url}/auth/discord`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const oauthCookie = start.headers.getSetCookie()[0].split(';')[0];
  const res = await fetch(`${url}/auth/discord/callback?code=u${id}&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: oauthCookie },
  });
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('gh_session='));
  return { location: res.headers.get('location'), cookie };
}

const me = (url, cookie) => fetch(`${url}/api/me`, { headers: { cookie } }).then((r) => r.json());

/** Socket connectée (ou erreur de connexion) + outils d'attente. */
function open(url, cookie) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: { cookie } });
  const events = {};
  socket.onAny((event, data) => (events[event] = data ?? true));
  const request = (event, data = {}) => new Promise((resolve) => socket.emit(event, data, resolve));
  const until = (event) => new Promise((resolve) => (events[event] ? resolve(events[event]) : socket.once(event, resolve)));
  const ready = new Promise((resolve) => {
    socket.on('connect', () => resolve(null));
    socket.on('connect_error', (err) => resolve(err.message));
  });
  return { socket, events, request, until, ready };
}

test("demande d'accès : en attente, validée par l'admin, puis révoquée", async (t) => {
  const { url } = await startHub(t);

  // L'admin (ADMIN_DISCORD_IDS) est accepté d'office.
  const admin = await login(url, 42);
  assert.equal((await me(url, admin.cookie)).user.isAdmin, true);
  const adminSocket = open(url, admin.cookie);
  t.after(() => adminSocket.socket.close());
  assert.equal(await adminSocket.ready, null);

  // Un inconnu : cookie posé, mais compte en attente et socket refusée.
  const newcomer = await login(url, 77);
  assert.equal(newcomer.location, '/');
  assert.equal((await me(url, newcomer.cookie)).user.status, 'pending');
  const refused = open(url, newcomer.cookie);
  assert.equal(await refused.ready, 'pending');

  // L'admin est prévenu en direct et voit la demande.
  assert.deepEqual(await adminSocket.until('admin:request'), { name: 'Perceval' });
  const { pending } = await adminSocket.request('admin:users');
  assert.deepEqual(pending.map((u) => u.name), ['Perceval']);

  // L’admin ne peut pas se retirer lui-même son accès.
  assert.equal((await adminSocket.request('admin:decide', { userId: '42', status: 'rejected' })).ok, false);

  // Validation -> le joueur entre.
  assert.equal((await adminSocket.request('admin:decide', { userId: '77', status: 'approved' })).ok, true);
  assert.equal((await me(url, newcomer.cookie)).user.status, 'approved');
  const player = open(url, newcomer.cookie);
  assert.equal(await player.ready, null);
  assert.equal((await player.request('admin:users')).ok, false, 'pas admin');
  await player.request('room:create', {});
  const lobby = await adminSocket.request('hub:get');
  assert.equal(lobby.lobby.rooms[0].hostName, 'Perceval');

  // Révocation -> déconnecté immédiatement, retiré du salon, plus de reconnexion possible.
  const disconnected = new Promise((resolve) => player.socket.on('disconnect', resolve));
  await adminSocket.request('admin:decide', { userId: '77', status: 'rejected' });
  await disconnected;
  assert.equal((await adminSocket.request('hub:get')).lobby.rooms.length, 0);
  assert.equal(await open(url, newcomer.cookie).ready, 'rejected');
  assert.equal((await login(url, 77)).location, '/?auth=refuse');
});

test('fin de partie : stats enregistrées, joueurs prévenus, classement', async (t) => {
  const { url, manager, store } = await startHub(t);
  store.recordLogin({ id: '88', name: 'Karadoc', initialStatus: 'approved' });

  const a = open(url, (await login(url, 42)).cookie);
  const b = open(url, (await login(url, 88)).cookie);
  t.after(() => { a.socket.close(); b.socket.close(); });
  await Promise.all([a.ready, b.ready]);

  const { code } = await a.request('room:create', {});
  await b.request('room:join', { code });
  assert.equal((await a.request('room:selectGame', { gameId: 'chute-des-rois' })).ok, true);
  assert.equal((await a.request('room:startGame')).ok, true);

  // On termine la partie (victoire) puis on laisse le Hub la constater.
  const room = manager.rooms.get(code);
  Object.assign(room.game.instance, { phase: 'victory', castle: [], boss: null });
  room.checkGameEnd();

  await Promise.all([a.until('stats:changed'), b.until('stats:changed')]);
  const { stats, recent } = await b.request('stats:get');
  assert.deepEqual(
    { gameId: stats[0].gameId, played: stats[0].played, wins: stats[0].wins, bestScore: stats[0].bestScore },
    { gameId: 'chute-des-rois', played: 1, wins: 1, bestScore: 12 },
  );
  assert.equal(recent[0].summary, 'Victoire — 12/12 souverains');
  assert.deepEqual(recent[0].with, ['lightshadow02']);

  const { leaderboard } = await a.request('stats:leaderboard', { gameId: 'chute-des-rois' });
  assert.deepEqual(leaderboard.map((r) => r.name).sort(), ['Karadoc', 'lightshadow02']);

  // Une seule partie enregistrée même si on re-vérifie.
  room.checkGameEnd();
  assert.equal(store.statsForUser('88')[0].played, 1);
});
