import { el, $ } from './dom.js';

/* =====================================================================
 * Rendu des panneaux du Hub (accueil connecté) : salons, en ligne,
 * statistiques, classement et administration des accès.
 * Fonctions pures d'affichage : les actions passent par des callbacks.
 * ===================================================================== */

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

export function timeAgo(ts) {
  const seconds = Math.round((ts - Date.now()) / 1000);
  const steps = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "à l'instant";
}

export function avatar(user, size = 'sm') {
  if (user.avatarUrl) return el('img', { class: `avatar avatar-${size}`, src: user.avatarUrl, alt: '' });
  return el('span', { class: `avatar avatar-${size} avatar-initial`, 'aria-hidden': 'true' }, (user.name || '?')[0].toUpperCase());
}

/** Icône du sprite de index.html (#i-<name>). */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** Vignette d'un jeu (games/<id>/client/cover.svg), ou son initiale à défaut. */
export function cover(game) {
  if (game?.cover) return el('img', { class: 'cover', src: game.cover, alt: '', loading: 'lazy', decoding: 'async' });
  return el('span', { class: 'cover cover-fallback', 'aria-hidden': 'true' }, (game?.name || '?')[0]);
}

const playersText = (g) => (g.minPlayers === g.maxPlayers ? `${g.minPlayers} joueurs` : `${g.minPlayers} à ${g.maxPlayers} joueurs`);

// ------------------------------------------------------------------ catalogue des jeux

export function renderCatalog(games, { onPlay }) {
  $('#catalog').replaceChildren(
    ...games.map((g) =>
      el('li', {},
        el('button', {
          class: 'game-tile',
          title: `Ouvrir un salon de ${g.name}`,
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await onPlay(g.id); } finally { btn.disabled = false; }
          },
        },
        cover(g),
        el('span', { class: 'game-tile-body' },
          el('span', { class: 'game-tile-head' },
            el('span', { class: 'game-tile-name' }, g.name),
            el('span', { class: 'players-range' }, icon('users'), playersText(g)),
          ),
          el('p', {}, g.description),
          el('span', { class: 'game-tile-cta' }, icon('play'), 'Ouvrir une table'),
        )),
      ),
    ),
  );
}

/** Vignettes décoratives de l'écran de connexion. */
export function renderCoverStrip(games) {
  $('#login-games').replaceChildren(...games.map((g) => el('li', {}, cover(g), el('span', {}, g.name))));
}

const empty = (text) => el('li', { class: 'empty' }, text);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ------------------------------------------------------------------ salons & en ligne

export function renderLobby(lobby, { onJoin, games = [] }) {
  const rooms = lobby.rooms ?? [];
  $('#online-count').textContent = lobby.onlineCount ?? 0;
  $('#room-count').textContent = rooms.length;
  $('#room-count').classList.toggle('hidden', !rooms.length);

  $('#room-list').replaceChildren(
    ...(rooms.length
      ? rooms.map((room) => {
          const playing = room.status === 'playing';
          const full = room.playerCount >= room.maxPlayers;
          return el(
            'li',
            { class: `room-item ${playing ? 'is-playing' : ''}` },
            cover(games.find((g) => g.id === room.gameId) ?? { name: room.gameName }),
            el(
              'div',
              { class: 'room-main' },
              el('div', { class: 'room-title' },
                el('strong', {}, room.gameName ?? 'Jeu à choisir'),
                el('span', { class: `room-status ${playing ? 'playing' : 'open'}` }, playing ? 'En partie' : 'Ouvert'),
              ),
              el('div', { class: 'room-meta muted' },
                'Salon ', el('b', {}, room.code), ` · hôte ${room.hostName ?? '—'} · ${room.playerCount}/${room.maxPlayers}`),
              el('div', { class: 'avatar-stack' }, room.players.slice(0, 6).map((p) => avatar(p, 'xs'))),
            ),
            el(
              'button',
              {
                class: 'btn btn-small',
                disabled: playing || full,
                title: playing ? 'Partie en cours' : full ? 'Salon complet' : `Rejoindre le salon ${room.code}`,
                onclick: () => onJoin(room.code),
              },
              playing ? 'En cours' : full ? 'Complet' : 'Rejoindre',
            ),
          );
        })
      : [empty('Aucune table ouverte pour le moment : choisis un jeu ci-dessus pour en ouvrir une.')]),
  );

  const online = lobby.online ?? [];
  $('#online-list').replaceChildren(
    ...(online.length
      ? online.map((u) =>
          el('li', { class: 'user-row' },
            avatar(u),
            el('span', { class: 'user-row-name' }, u.name),
            el('span', { class: `where-pill ${u.roomCode ? 'in-room' : ''}` }, u.roomCode ? `salon ${u.roomCode}` : 'au Hub'),
          ),
        )
      : [empty(lobby.onlineCount ? `${lobby.onlineCount} joueur(s) connecté(s)` : 'Personne pour le moment.')]),
  );
}

// ------------------------------------------------------------------ statistiques

export function renderStats({ stats, recent }, games) {
  const nameOf = (id) => games.find((g) => g.id === id)?.name ?? id;
  const scoreLabel = (id) => games.find((g) => g.id === id)?.scoreLabel;

  const gameOf = (id) => games.find((g) => g.id === id) ?? { id, name: id };
  $('#stats-cards').replaceChildren(
    ...(stats.length
      ? stats.map((s) => {
          const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
          const label = scoreLabel(s.gameId);
          return el(
            'article',
            { class: 'stat-card' },
            cover(gameOf(s.gameId)),
            el('h3', {}, nameOf(s.gameId)),
            el('div', { class: 'stat-line' },
              stat(s.played, s.played > 1 ? 'parties' : 'partie'),
              stat(s.wins, s.wins > 1 ? 'victoires' : 'victoire'),
              stat(`${rate} %`, 'réussite'),
              s.bestScore !== null && stat(s.bestScore, label ? `record (${label.toLowerCase()})` : 'record'),
            ),
            el('div', { class: 'rate-bar', role: 'img', 'aria-label': `${rate} % de victoires` },
              el('span', { style: `width:${rate}%` })),
          );
        })
      : [el('p', { class: 'stats-empty' }, 'Pas encore de partie terminée : tes statistiques apparaîtront ici.')]),
  );

  $('#recent-list').replaceChildren(
    ...(recent.length
      ? recent.map((m) =>
          el('li', { class: 'recent-item' },
            el('span', { class: `result-pill ${m.result}` }, { win: 'Victoire', loss: 'Défaite', draw: 'Égalité' }[m.result]),
            cover(gameOf(m.gameId)),
            el('div', { class: 'recent-main' },
              el('strong', {}, nameOf(m.gameId)),
              el('span', { class: 'muted small' },
                [m.summary, m.with.length ? `avec ${m.with.join(', ')}` : 'en solo'].filter(Boolean).join(' · ')),
            ),
            el('time', { class: 'muted small', dateTime: new Date(m.endedAt).toISOString() }, timeAgo(m.endedAt)),
          ),
        )
      : [empty('Aucune partie récente.')]),
  );
}

function stat(value, label) {
  return el('div', { class: 'hub-stat' }, el('strong', {}, String(value)), el('span', {}, label));
}

export function renderLeaderboard(rows, { meId }) {
  $('#lb-list').replaceChildren(
    ...(rows.length
      ? rows.map((r, i) =>
          el('li', { class: `lb-row ${r.userId === meId ? 'me' : ''}` },
            el('span', { class: `lb-rank rank-${i + 1}` }, String(i + 1)),
            avatar(r),
            el('span', { class: 'lb-name' }, r.name),
            el('span', { class: 'lb-stat' }, el('strong', {}, String(r.wins)), r.wins > 1 ? ' victoires' : ' victoire'),
            el('span', { class: 'lb-stat muted' }, plural(r.played, 'partie')),
            r.bestScore !== null && el('span', { class: 'lb-stat muted' }, `record ${r.bestScore}`),
          ),
        )
      : [empty('Aucune partie enregistrée pour ce jeu.')]),
  );
}

// ------------------------------------------------------------------ administration

export function renderAdmin({ pending, approved, rejected }, { meId, onDecide }) {
  const count = $('#admin-count');
  count.textContent = pending.length;
  count.classList.toggle('hidden', !pending.length);
  $('#admin-members-count').textContent = `(${approved.length})`;
  $('#admin-rejected-count').textContent = `(${rejected.length})`;

  const row = (user, actions, meta) =>
    el('li', { class: 'user-row' },
      avatar(user),
      el('div', { class: 'user-row-main' },
        el('span', { class: 'user-row-name' }, user.name, user.isAdmin && el('span', { class: 'badge' }, 'Admin')),
        el('span', { class: 'muted small' }, meta),
      ),
      el('div', { class: 'user-row-actions' }, actions),
    );

  $('#admin-pending').replaceChildren(
    ...(pending.length
      ? pending.map((u) =>
          row(u, [
            el('button', { class: 'btn btn-small btn-primary', onclick: () => onDecide(u, 'approved') }, 'Accepter'),
            el('button', { class: 'btn btn-small btn-danger', onclick: () => onDecide(u, 'rejected') }, 'Refuser'),
          ], `demande ${timeAgo(u.createdAt)}`),
        )
      : [empty('Aucune demande en attente.')]),
  );

  $('#admin-members').replaceChildren(
    ...approved.map((u) =>
      row(u,
        u.isAdmin || u.id === meId
          ? []
          : [el('button', { class: 'btn btn-small btn-ghost', onclick: () => onDecide(u, 'rejected') }, 'Retirer')],
        `vu ${timeAgo(u.lastSeenAt)}`),
    ),
  );

  $('#admin-rejected').replaceChildren(
    ...(rejected.length
      ? rejected.map((u) =>
          row(u, [el('button', { class: 'btn btn-small', onclick: () => onDecide(u, 'approved') }, 'Autoriser')],
            u.decidedAt ? `refusé ${timeAgo(u.decidedAt)}` : ''),
        )
      : [empty('Personne.')]),
  );
}
