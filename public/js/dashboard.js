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

function avatar(user, size = 'sm') {
  if (user.avatarUrl) return el('img', { class: `avatar avatar-${size}`, src: user.avatarUrl, alt: '' });
  return el('span', { class: `avatar avatar-${size} avatar-initial`, 'aria-hidden': 'true' }, (user.name || '?')[0].toUpperCase());
}

const empty = (text) => el('li', { class: 'empty' }, text);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

// ------------------------------------------------------------------ salons & en ligne

export function renderLobby(lobby, { onJoin }) {
  const rooms = lobby.rooms ?? [];
  $('#online-count').textContent = lobby.onlineCount ?? 0;
  $('#room-count').textContent = rooms.length ? `(${rooms.length})` : '';

  $('#room-list').replaceChildren(
    ...(rooms.length
      ? rooms.map((room) => {
          const playing = room.status === 'playing';
          const full = room.playerCount >= room.maxPlayers;
          return el(
            'li',
            { class: `room-item ${playing ? 'is-playing' : ''}` },
            el(
              'div',
              { class: 'room-main' },
              el('div', { class: 'room-title' },
                el('strong', {}, room.gameName ?? 'Jeu à choisir'),
                el('span', { class: `room-status ${playing ? 'playing' : 'open'}` }, playing ? 'En partie' : 'Ouvert'),
              ),
              el('div', { class: 'room-meta muted' },
                `Salon ${room.code} · hôte ${room.hostName ?? '—'} · ${room.playerCount}/${room.maxPlayers} joueur${room.maxPlayers > 1 ? 's' : ''}`),
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
      : [empty('Aucun salon ouvert pour le moment. Créez-en un !')]),
  );

  const online = lobby.online ?? [];
  $('#online-list').replaceChildren(
    ...(online.length
      ? online.map((u) =>
          el('li', { class: 'user-row' },
            avatar(u),
            el('span', { class: 'user-row-name' }, u.name),
            el('span', { class: 'muted small' }, u.roomCode ? `salon ${u.roomCode}` : 'au Hub'),
          ),
        )
      : [empty(lobby.onlineCount ? `${lobby.onlineCount} joueur(s) connecté(s)` : 'Personne pour le moment.')]),
  );
}

// ------------------------------------------------------------------ statistiques

export function renderStats({ stats, recent }, games) {
  const nameOf = (id) => games.find((g) => g.id === id)?.name ?? id;
  const scoreLabel = (id) => games.find((g) => g.id === id)?.scoreLabel;

  $('#stats-cards').replaceChildren(
    ...(stats.length
      ? stats.map((s) => {
          const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
          return el(
            'article',
            { class: 'stat-card' },
            el('h3', {}, nameOf(s.gameId)),
            el('div', { class: 'stat-grid' },
              stat(s.played, s.played > 1 ? 'parties' : 'partie'),
              stat(s.wins, s.wins > 1 ? 'victoires' : 'victoire'),
              stat(`${rate}%`, 'réussite'),
              s.bestScore !== null && stat(s.bestScore, scoreLabel(s.gameId) ? `record · ${scoreLabel(s.gameId).toLowerCase()}` : 'meilleur score'),
            ),
            el('div', { class: 'rate-bar', role: 'img', 'aria-label': `${rate}% de victoires` },
              el('span', { style: `width:${rate}%` })),
          );
        })
      : [el('p', { class: 'muted' }, 'Pas encore de partie terminée. Vos statistiques apparaîtront ici.')]),
  );

  $('#recent-list').replaceChildren(
    ...(recent.length
      ? recent.map((m) =>
          el('li', { class: 'recent-item' },
            el('span', { class: `result-pill ${m.result}` }, { win: 'Victoire', loss: 'Défaite', draw: 'Égalité' }[m.result]),
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
