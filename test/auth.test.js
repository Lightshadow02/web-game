'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createHubServer } = require('../src/index');
const { createAuth, createSigner } = require('../src/core/auth');

const ENV = {
  DISCORD_CLIENT_ID: 'client-id',
  DISCORD_CLIENT_SECRET: 'client-secret',
  PUBLIC_URL: 'https://jeux.example.com',
  SESSION_SECRET: 'x'.repeat(40),
  DISCORD_GUILD_ID: 'guild-1',
  DISCORD_ROLE_IDS: 'role-joueur',
};

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

/** Faux Discord : `member` = réponse de /users/@me/guilds/:id/member (null = pas membre). */
function fakeDiscord({ member }) {
  return async (url) => {
    const u = String(url);
    if (u.endsWith('/oauth2/token')) return json(200, { access_token: 'token-abc' });
    if (u.endsWith('/users/@me')) return json(200, { id: '42', username: 'arthur', global_name: 'Arthur', avatar: 'av1' });
    if (u.includes('/guilds/guild-1/member')) return member ? json(200, member) : json(404, { message: 'Unknown Guild' });
    throw new Error(`URL inattendue ${u}`);
  };
}

async function startServer(t, member) {
  const auth = createAuth(ENV, { fetchImpl: fakeDiscord({ member }) });
  const { server, io } = createHubServer({ auth });
  await new Promise((r) => server.listen(0, r));
  t.after(() => { io.close(); server.close(); });
  return `http://localhost:${server.address().port}`;
}

const cookieFrom = (res, name) =>
  res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));

/** Déroule le flux OAuth complet ; renvoie la réponse du callback. */
async function login(url, { tamperState = false } = {}) {
  const start = await fetch(`${url}/auth/discord?returnTo=${encodeURIComponent('/?room=ABCD')}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const discordUrl = new URL(start.headers.get('location'));
  assert.equal(discordUrl.origin, 'https://discord.com');
  assert.equal(discordUrl.searchParams.get('redirect_uri'), 'https://jeux.example.com/auth/discord/callback');
  assert.equal(discordUrl.searchParams.get('scope'), 'identify guilds.members.read');
  const state = tamperState ? 'faux' : discordUrl.searchParams.get('state');
  return fetch(`${url}/auth/discord/callback?code=c0de&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: cookieFrom(start, 'gh_oauth') },
  });
}

test('cookie signé : valide, falsifié, expiré', () => {
  const signer = createSigner('secret'.repeat(8));
  const token = signer.sign({ id: '1', exp: Date.now() + 1000 });
  assert.equal(signer.verify(token).id, '1');
  assert.equal(signer.verify(token.replace(/^./, 'A')), null);
  assert.equal(signer.verify(`${token}x`), null);
  assert.equal(signer.verify(signer.sign({ id: '1', exp: Date.now() - 1 })), null);
  assert.equal(createSigner('autre'.repeat(8)).verify(token), null);
});

test('configuration Discord incomplète refusée au démarrage', () => {
  assert.throws(() => createAuth({ ...ENV, SESSION_SECRET: 'court' }), /SESSION_SECRET/);
  assert.throws(() => createAuth({ ...ENV, PUBLIC_URL: '' }), /PUBLIC_URL/);
  assert.equal(createAuth({}).enabled, false);
});

test('membre du serveur avec le rôle : connexion puis jeu', async (t) => {
  const url = await startServer(t, { nick: 'Roi Arthur', roles: ['role-joueur'] });

  assert.deepEqual(await fetch(`${url}/api/me`).then((r) => r.json()), { authEnabled: true, user: null });

  // Sans cookie, la socket est refusée.
  const anonymous = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const err = await new Promise((resolve) => anonymous.on('connect_error', resolve));
  assert.equal(err.message, 'unauthorized');
  anonymous.close();

  const callback = await login(url);
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/?room=ABCD', 'retour vers le lien d’invitation');
  const session = cookieFrom(callback, 'gh_session');
  assert.ok(session);
  assert.match(callback.headers.getSetCookie().join(), /HttpOnly/);
  assert.match(callback.headers.getSetCookie().join(), /Secure/);

  const me = await fetch(`${url}/api/me`, { headers: { cookie: session } }).then((r) => r.json());
  assert.equal(me.user.name, 'Roi Arthur', 'surnom du serveur prioritaire');
  assert.equal(me.user.avatarUrl, 'https://cdn.discordapp.com/avatars/42/av1.png?size=128');

  // Cookie falsifié : refusé.
  const forged = await fetch(`${url}/api/me`, { headers: { cookie: `${session}x` } }).then((r) => r.json());
  assert.equal(forged.user, null);

  // La socket connectée joue sous son identité Discord (pseudo saisi ignoré).
  const socket = connect(url, { transports: ['websocket'], forceNew: true, extraHeaders: { cookie: session } });
  t.after(() => socket.close());
  const hello = await new Promise((resolve) => socket.on('session', resolve));
  assert.equal(hello.token, null, 'pas de jeton localStorage en mode Discord');
  assert.equal(hello.user.name, 'Roi Arthur');
  const room = new Promise((resolve) => socket.on('room:state', resolve));
  const created = await new Promise((resolve) => socket.emit('room:create', { name: 'Usurpateur' }, resolve));
  assert.equal(created.ok, true);
  const player = (await room).players[0];
  assert.equal(player.name, 'Roi Arthur');
  assert.equal(player.avatarUrl, me.user.avatarUrl);
});

test('accès refusé : pas membre du serveur, ou rôle manquant', async (t) => {
  const notMember = await startServer(t, null);
  assert.equal((await login(notMember)).headers.get('location'), '/?auth=refuse');

  const noRole = await startServer(t, { nick: null, roles: ['autre-role'] });
  const res = await login(noRole);
  assert.equal(res.headers.get('location'), '/?auth=refuse');
  assert.equal(cookieFrom(res, 'gh_session'), undefined);
});

test('state OAuth invalide : rejeté', async (t) => {
  const url = await startServer(t, { roles: ['role-joueur'] });
  const res = await login(url, { tamperState: true });
  assert.equal(res.headers.get('location'), '/?auth=erreur');
});

test('returnTo vers un domaine extérieur : neutralisé', async (t) => {
  const url = await startServer(t, { roles: ['role-joueur'] });
  const start = await fetch(`${url}/auth/discord?returnTo=//evil.com`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const res = await fetch(`${url}/auth/discord/callback?code=c&state=${state}`, {
    redirect: 'manual',
    headers: { cookie: cookieFrom(start, 'gh_oauth') },
  });
  assert.equal(res.headers.get('location'), '/');
});

test('liste blanche : DISCORD_ALLOWED_IDS passe sans être membre', async (t) => {
  const auth = createAuth({ ...ENV, DISCORD_ALLOWED_IDS: '42' }, { fetchImpl: fakeDiscord({ member: null }) });
  const { server, io } = createHubServer({ auth });
  await new Promise((r) => server.listen(0, r));
  t.after(() => { io.close(); server.close(); });
  const res = await login(`http://localhost:${server.address().port}`);
  assert.equal(res.headers.get('location'), '/?room=ABCD');
  assert.ok(cookieFrom(res, 'gh_session'));
});
