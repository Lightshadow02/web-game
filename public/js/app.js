import { el, $ } from './dom.js';

/* =====================================================================
 * Client du Hub : connexion, salons, chat et montage des modules de jeu.
 *
 * Interface attendue d'un module de jeu (servi sur /games/<id>/index.js) :
 *
 *   export function mount(root, ctx) {
 *     // root : élément DOM réservé au jeu
 *     // ctx  : { me, getRoom(), sendAction(type, payload) -> Promise, toast(msg, type) }
 *     return {
 *       update(state) { ... },  // appelé à chaque 'game:state'
 *       unmount() { ... },      // appelé au retour au salon
 *     };
 *   }
 * ===================================================================== */

const TOKEN_KEY = 'hub.token';
const NAME_KEY = 'hub.name';

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
};

const state = {
  me: null, // { playerId }
  auth: { enabled: false, user: null }, // connexion Discord
  games: [],
  room: null,
  mounted: null, // { gameId, instance, loading }
  pendingGameState: null,
};

// Connexion différée : on vérifie d'abord la session Discord (/api/me).
const socket = io({ autoConnect: false, auth: (cb) => cb({ token: store.get(TOKEN_KEY) }) });

// ------------------------------------------------------------------ utilitaires

function request(event, data = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, data, (err, res) => {
      if (err) return reject(new Error('Le serveur ne répond pas.'));
      if (!res?.ok) return reject(new Error(res?.error || 'Erreur inconnue.'));
      resolve(res);
    });
  });
}

export function toast(message, type = 'info') {
  const node = el('div', { class: `toast toast-${type}` }, message);
  $('#toasts').append(node);
  setTimeout(() => node.classList.add('fade'), 3200);
  setTimeout(() => node.remove(), 3700);
}

function showScreen(name) {
  $('#screen-home').classList.toggle('hidden', name !== 'home');
  $('#screen-room').classList.toggle('hidden', name !== 'room');
}

const isHost = () => state.room && state.me && state.room.hostId === state.me.playerId;
const gameById = (id) => state.games.find((g) => g.id === id);

// ------------------------------------------------------------------ accueil

const nameInput = $('#input-name');
const codeInput = $('#input-code');
nameInput.value = store.get(NAME_KEY) || '';
codeInput.value = new URLSearchParams(location.search).get('room')?.toUpperCase() || '';

function homeError(message) {
  $('#home-error').textContent = message || '';
}

function readName() {
  if (state.auth.user) return state.auth.user.name; // mode Discord : nom imposé par le serveur
  const name = nameInput.value.trim();
  if (name.length < 2) {
    homeError('Entrez un pseudo (2 caractères minimum).');
    nameInput.focus();
    return null;
  }
  store.set(NAME_KEY, name);
  return name;
}

$('#btn-create').addEventListener('click', async () => {
  const name = readName();
  if (!name) return;
  try {
    await request('room:create', { name });
  } catch (err) {
    homeError(err.message);
  }
});

$('#form-join').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = readName();
  if (!name) return;
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) return homeError('Entrez le code du salon (4 ou 5 lettres).');
  try {
    await request('room:join', { code, name });
  } catch (err) {
    homeError(err.message);
  }
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
});

// ------------------------------------------------------------------ salon

$('#btn-leave').addEventListener('click', () => {
  if (state.room?.status === 'playing' && !confirm('Quitter interrompra la partie pour tout le monde. Continuer ?')) return;
  request('room:leave').catch((err) => toast(err.message, 'error'));
});

$('#btn-end-game').addEventListener('click', () => {
  if (!confirm('Arrêter la partie et revenir au salon ?')) return;
  request('room:endGame').catch((err) => toast(err.message, 'error'));
});

$('#btn-start').addEventListener('click', () => {
  request('room:startGame').catch((err) => toast(err.message, 'error'));
});

$('#btn-copy').addEventListener('click', async () => {
  const link = `${location.origin}/?room=${state.room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Lien copié !', 'success');
  } catch {
    prompt('Copiez ce lien :', link);
  }
});

function renderRoom() {
  const room = state.room;
  $('#room-code').textContent = room.code;
  $('#btn-end-game').classList.toggle('hidden', !(isHost() && room.status === 'playing'));

  // Joueurs
  $('#player-count').textContent = `(${room.players.length}/${room.maxPlayers})`;
  $('#player-list').replaceChildren(
    ...room.players.map((p) =>
      el(
        'li',
        { class: `player ${p.connected ? '' : 'offline'}` },
        el('span', { class: 'status-dot', title: p.connected ? 'Connecté' : 'Déconnecté' }),
        p.avatarUrl && el('img', { class: 'avatar avatar-sm', src: p.avatarUrl, alt: '' }),
        el('span', { class: 'player-name' }, p.name),
        p.isHost && el('span', { class: 'badge' }, '👑 Hôte'),
        p.id === state.me.playerId && el('span', { class: 'badge badge-me' }, 'Vous'),
      ),
    ),
  );

  // Jeux
  const host = isHost();
  $('#game-hint').textContent = host
    ? 'Choisissez le jeu pour ce salon.'
    : "L'hôte choisit le jeu.";
  $('#game-list').replaceChildren(
    ...state.games.map((g) => {
      const selected = g.id === room.selectedGameId;
      const fits = room.players.length >= g.minPlayers && room.players.length <= g.maxPlayers;
      return el(
        'button',
        {
          class: `game-card ${selected ? 'selected' : ''}`,
          disabled: !host,
          onclick: () => !selected && request('room:selectGame', { gameId: g.id }).catch((err) => toast(err.message, 'error')),
        },
        el('strong', {}, g.name),
        el('span', { class: `players-range ${fits ? '' : 'warn'}` }, `${g.minPlayers}–${g.maxPlayers} joueurs`),
        el('p', {}, g.description),
      );
    }),
  );

  const selected = gameById(room.selectedGameId);
  const count = room.players.length;
  let hint = '';
  if (!selected) hint = 'Aucun jeu sélectionné.';
  else if (count < selected.minPlayers || count > selected.maxPlayers)
    hint = `${selected.name} nécessite ${selected.minPlayers} à ${selected.maxPlayers} joueurs.`;
  else if (!host) hint = "En attente du lancement par l'hôte...";
  $('#start-hint').textContent = hint;
  $('#btn-start').classList.toggle('hidden', !host);
  $('#btn-start').disabled = !selected || count < selected.minPlayers || count > selected.maxPlayers;

  // Lobby vs jeu
  const playing = room.status === 'playing';
  $('#lobby').classList.toggle('hidden', playing);
  $('#game-root').classList.toggle('hidden', !playing);
  if (playing) ensureGameMounted(room.gameId);
  else unmountGame();
}

// ------------------------------------------------------------------ montage des jeux

async function ensureGameMounted(gameId) {
  if (state.mounted?.gameId === gameId) return;
  unmountGame();
  const mounted = { gameId, instance: null };
  state.mounted = mounted;
  try {
    const module = await import(`/games/${gameId}/index.js`);
    if (state.mounted !== mounted) return; // démonté entre-temps
    const root = $('#game-root');
    root.replaceChildren();
    mounted.instance = module.mount(root, {
      me: { id: state.me.playerId },
      getRoom: () => state.room,
      sendAction: (type, payload) => request('game:action', { type, payload }),
      toast,
    });
    if (state.pendingGameState?.gameId === gameId) mounted.instance.update(state.pendingGameState.state);
  } catch (err) {
    console.error(err);
    toast(`Impossible de charger le jeu "${gameId}".`, 'error');
  }
}

function unmountGame() {
  if (!state.mounted) return;
  state.mounted.instance?.unmount?.();
  state.mounted = null;
  state.pendingGameState = null;
  $('#game-root').replaceChildren();
}

// ------------------------------------------------------------------ chat

function renderChatMessage(msg) {
  const list = $('#chat-messages');
  const time = new Date(msg.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const mine = msg.playerId && msg.playerId === state.me?.playerId;
  list.append(
    msg.system
      ? el('li', { class: 'chat-system' }, msg.text)
      : el(
          'li',
          { class: `chat-msg ${mine ? 'mine' : ''}` },
          el('span', { class: 'chat-meta' }, `${msg.name} · ${time}`),
          el('span', { class: 'chat-text' }, msg.text),
        ),
  );
  while (list.children.length > 100) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}

$('#form-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#input-chat');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  request('chat:send', { text }).catch((err) => toast(err.message, 'error'));
});

// ------------------------------------------------------------------ événements serveur

socket.on('session', ({ token, playerId, roomCode }) => {
  if (token) store.set(TOKEN_KEY, token);
  state.me = { playerId };
  // Session expirée côté serveur (ex. redémarrage) : retour à l'accueil.
  if (!roomCode && state.room) leaveRoomScreen();
});

socket.on('games:list', (games) => {
  state.games = games;
  if (state.room) renderRoom();
});

socket.on('room:state', (room) => {
  const firstRender = !state.room;
  state.room = room;
  showScreen('room');
  if (firstRender) history.replaceState(null, '', `/?room=${room.code}`);
  renderRoom();
});

socket.on('room:left', leaveRoomScreen);

function leaveRoomScreen() {
  state.room = null;
  unmountGame();
  $('#chat-messages').replaceChildren();
  history.replaceState(null, '', '/');
  codeInput.value = '';
  homeError('');
  showScreen('home');
}

socket.on('chat:history', (messages) => {
  $('#chat-messages').replaceChildren();
  messages.forEach(renderChatMessage);
});
socket.on('chat:message', renderChatMessage);

socket.on('game:state', (payload) => {
  state.pendingGameState = payload;
  if (state.mounted?.gameId === payload.gameId && state.mounted.instance) {
    state.mounted.instance.update(payload.state);
  }
});

socket.on('connect', () => $('#connection-banner').classList.add('hidden'));
socket.on('disconnect', () => $('#connection-banner').classList.remove('hidden'));
socket.on('connect_error', (err) => {
  if (err.message === 'unauthorized') {
    // Session Discord expirée ou absente : retour à l'écran de connexion.
    socket.disconnect();
    state.auth.user = null;
    leaveRoomScreen();
    renderAuth();
  }
});

// ------------------------------------------------------------------ connexion Discord

const AUTH_ERRORS = {
  refuse: "Accès refusé : votre compte Discord n'est pas autorisé sur ce site.",
  erreur: 'La connexion Discord a échoué, réessayez.',
};

function renderAuth() {
  const { enabled, user } = state.auth;
  $('#auth-login').classList.toggle('hidden', !enabled || !!user);
  $('#home-actions').classList.toggle('hidden', enabled && !user);
  $('#auth-user').classList.toggle('hidden', !user);
  $('#field-name').classList.toggle('hidden', !!user);
  if (user) {
    $('#auth-name').textContent = user.name;
    $('#auth-avatar').src = user.avatarUrl || '';
    $('#auth-avatar').classList.toggle('hidden', !user.avatarUrl);
  }
  // Après connexion, Discord nous ramène ici (le ?room= de l'invitation est conservé).
  $('#btn-discord').href = `/auth/discord?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
}

$('#btn-logout').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
  socket.disconnect();
  state.auth.user = null;
  renderAuth();
});

async function start() {
  const params = new URLSearchParams(location.search);
  const authError = AUTH_ERRORS[params.get('auth')];
  if (authError) {
    homeError(authError);
    params.delete('auth');
    history.replaceState(null, '', params.size ? `/?${params}` : '/');
  }
  try {
    const me = await fetch('/api/me').then((r) => r.json());
    state.auth = { enabled: me.authEnabled, user: me.user };
  } catch {
    state.auth = { enabled: false, user: null };
  }
  renderAuth();
  showScreen('home');
  if (!state.auth.enabled || state.auth.user) socket.connect();
}

start();
