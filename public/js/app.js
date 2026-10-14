import { el, $ } from './dom.js';
import { renderLobby, renderStats, renderLeaderboard, renderAdmin } from './dashboard.js';

/* =====================================================================
 * Client du Hub : connexion, salons et montage des modules de jeu.
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
  auth: { enabled: false, user: null }, // connexion Discord : user = { id, name, avatarUrl, status, isAdmin }
  lobby: { rooms: [], online: [], onlineCount: 0 },
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

const SCREENS = ['login', 'pending', 'home', 'room'];
function showScreen(name) {
  for (const screen of SCREENS) $(`#screen-${screen}`).classList.toggle('hidden', screen !== name);
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

async function joinRoom(code) {
  const name = readName();
  if (!name) return;
  try {
    await request('room:join', { code, name });
  } catch (err) {
    homeError(err.message);
  }
}

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
  renderGameOptions(selected, room, host);
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

/** Options du jeu sélectionné : l'hôte les règle, les autres joueurs les voient. */
function renderGameOptions(game, room, host) {
  const options = game?.options ?? [];
  $('#game-options').replaceChildren(
    ...options.map((opt) => {
      const value = room.gameOptions?.[opt.id] ?? opt.default;
      const current = opt.choices.find((c) => c.value === value) ?? opt.choices[0];
      const id = `opt-${opt.id}`;
      const control = host
        ? el(
            'select',
            {
              id,
              class: 'select',
              onchange: (e) => {
                const choice = opt.choices[Number(e.target.value)];
                request('room:setOption', { optionId: opt.id, value: choice.value }).catch((err) => {
                  toast(err.message, 'error');
                  renderRoom();
                });
              },
            },
            ...opt.choices.map((c, i) => el('option', { value: String(i), selected: c === current }, c.label)),
          )
        : el('span', { id, class: 'game-option-value' }, current.label);
      return el(
        'div',
        { class: 'game-option' },
        el(host ? 'label' : 'span', host ? { for: id } : {}, opt.label),
        control,
        current.description && el('p', { class: 'game-option-desc' }, current.description),
      );
    }),
  );
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
  renderLeaderboardSelect();
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
  history.replaceState(null, '', '/');
  codeInput.value = '';
  homeError('');
  if (state.auth.enabled && state.auth.user?.status !== 'approved') return;
  showScreen('home');
  refreshDashboard();
}

// Annonces du salon (arrivée, départ, nouvel hôte...).
socket.on('room:notice', ({ text }) => toast(text));

socket.on('game:state', (payload) => {
  state.pendingGameState = payload;
  if (state.mounted?.gameId === payload.gameId && state.mounted.instance) {
    state.mounted.instance.update(payload.state);
  }
});

socket.on('connect', () => $('#connection-banner').classList.add('hidden'));
socket.on('disconnect', (reason) => {
  // Déconnexion volontaire par le serveur = accès retiré par l'admin.
  if (reason === 'io server disconnect' && state.auth.enabled) return checkAccess();
  $('#connection-banner').classList.remove('hidden');
});
socket.on('connect_error', (err) => {
  if (['unauthorized', 'pending', 'rejected'].includes(err.message)) {
    socket.disconnect();
    checkAccess();
  }
});

// ------------------------------------------------------------------ Hub : salons, stats, admin

socket.on('hub:lobby', (lobby) => {
  state.lobby = lobby;
  renderLobby(lobby, { onJoin: joinRoom });
});

socket.on('stats:changed', () => {
  loadStats();
  loadLeaderboard();
});

socket.on('admin:changed', loadAdmin);
socket.on('admin:request', ({ name }) => toast(`Nouvelle demande d'accès : ${name}`, 'success'));

const hasStats = () => state.auth.enabled && state.auth.user?.status === 'approved';

async function loadStats() {
  if (!hasStats()) return;
  try {
    renderStats(await request('stats:get'), state.games);
  } catch (err) {
    console.warn(err);
  }
}

function renderLeaderboardSelect() {
  const select = $('#lb-game');
  const current = select.value;
  select.replaceChildren(...state.games.map((g) => el('option', { value: g.id }, g.name)));
  if (current && state.games.some((g) => g.id === current)) select.value = current;
  loadLeaderboard();
}

async function loadLeaderboard() {
  const gameId = $('#lb-game').value;
  if (!hasStats() || !gameId) return;
  try {
    const { leaderboard } = await request('stats:leaderboard', { gameId });
    renderLeaderboard(leaderboard, { meId: state.auth.user.id });
  } catch (err) {
    console.warn(err);
  }
}
$('#lb-game').addEventListener('change', loadLeaderboard);

async function loadAdmin() {
  if (!state.auth.user?.isAdmin) return;
  try {
    renderAdmin(await request('admin:users'), { meId: state.auth.user.id, onDecide: decide });
  } catch (err) {
    console.warn(err);
  }
}

async function decide(user, status) {
  const verb = { approved: 'Autoriser', rejected: 'Refuser / retirer' }[status];
  if (status === 'rejected' && !confirm(`${verb} l'accès de ${user.name} ?`)) return;
  try {
    await request('admin:decide', { userId: user.id, status });
    toast(status === 'approved' ? `${user.name} peut maintenant jouer.` : `Accès de ${user.name} retiré.`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function refreshDashboard() {
  renderLobby(state.lobby, { onJoin: joinRoom });
  loadStats();
  loadLeaderboard();
  loadAdmin();
}

// ------------------------------------------------------------------ connexion Discord

const AUTH_ERRORS = {
  refuse: "Accès refusé : votre compte Discord n'est pas autorisé sur ce site.",
  erreur: 'La connexion Discord a échoué, réessayez.',
};

let pendingTimer = null;

/** Affiche l'écran adapté à l'état de connexion, et ouvre la socket si l'accès est accordé. */
function renderAuth() {
  const { enabled, user } = state.auth;
  clearTimeout(pendingTimer);

  // Après connexion, Discord nous ramène ici (le ?room= de l'invitation est conservé).
  $('#btn-discord').href = `/auth/discord?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

  if (enabled && !user) {
    showScreen('login');
    return;
  }
  if (enabled && user.status !== 'approved') {
    const rejected = user.status === 'rejected';
    $('#pending-title').textContent = rejected ? 'Accès refusé' : 'Demande envoyée';
    $('#pending-text').textContent = rejected
      ? "L'administrateur n'a pas autorisé ce compte Discord."
      : `Bonjour ${user.name} ! Un administrateur doit valider votre accès. Vous entrerez automatiquement dès qu'il aura accepté.`;
    $('#pending-wait').classList.toggle('hidden', rejected);
    $('#pending-avatar').src = user.avatarUrl || '';
    $('#pending-avatar').classList.toggle('hidden', !user.avatarUrl);
    showScreen('pending');
    if (!rejected) pendingTimer = setTimeout(checkAccess, 8000); // suit la décision de l'admin
    return;
  }

  // Accès accordé (ou mode pseudo libre).
  const discord = enabled && user;
  $('#user-chip').classList.toggle('hidden', !discord);
  $('#btn-logout').classList.toggle('hidden', !discord);
  $('#field-name').classList.toggle('hidden', Boolean(discord));
  $('#panel-stats').classList.toggle('hidden', !discord);
  $('#panel-leaderboard').classList.toggle('hidden', !discord);
  $('#panel-admin').classList.toggle('hidden', !user?.isAdmin);
  $('#welcome-title').textContent = discord ? `Bonjour ${user.name} !` : 'Bienvenue !';
  if (discord) {
    $('#user-name').textContent = user.name;
    $('#user-avatar').src = user.avatarUrl || '';
    $('#user-avatar').classList.toggle('hidden', !user.avatarUrl);
    $('#user-admin').classList.toggle('hidden', !user.isAdmin);
  }
  if (!state.room) showScreen('home');
  if (!socket.connected) socket.connect();
  else refreshDashboard();
}

async function checkAccess() {
  try {
    const me = await fetch('/api/me').then((r) => r.json());
    state.auth = { enabled: me.authEnabled, user: me.user };
  } catch {
    state.auth = { enabled: false, user: null };
  }
  if (state.auth.enabled && state.auth.user?.status !== 'approved') {
    if (socket.connected) socket.disconnect();
    state.room = null;
    unmountGame();
  }
  renderAuth();
}

socket.on('connect', refreshDashboard);

for (const button of document.querySelectorAll('.js-logout')) {
  button.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    socket.disconnect();
    state.auth.user = null;
    state.room = null;
    unmountGame();
    renderAuth();
  });
}

function start() {
  const params = new URLSearchParams(location.search);
  const authError = AUTH_ERRORS[params.get('auth')];
  if (authError) {
    $('#login-error').textContent = authError;
    params.delete('auth');
    history.replaceState(null, '', params.size ? `/?${params}` : '/');
  }
  checkAccess();
}

start();
