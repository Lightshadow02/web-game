'use strict';

/**
 * Stockage persistant du Hub (SQLite intégré à Node, aucune dépendance) :
 *   - users          : comptes Discord et statut d'accès (pending / approved / rejected)
 *   - matches        : parties terminées (générique : n'importe quel jeu)
 *   - match_players  : résultat de chaque joueur (win / loss / draw + score)
 *
 * Utilisé uniquement quand la connexion Discord est active (les stats ont besoin d'une identité).
 */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');

const STATUSES = ['pending', 'approved', 'rejected'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,           -- ID Discord
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    is_admin    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    decided_at  INTEGER,
    decided_by  TEXT
  );
  CREATE TABLE IF NOT EXISTS matches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id    TEXT NOT NULL,
    room_code  TEXT,
    summary    TEXT,
    ended_at   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS match_players (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id  TEXT NOT NULL REFERENCES users(id),
    result   TEXT NOT NULL,                 -- win | loss | draw
    score    INTEGER,
    PRIMARY KEY (match_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_game ON matches(game_id, ended_at);
`;

const publicUser = (row) =>
  row && {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatar_url,
    status: row.status,
    isAdmin: Boolean(row.is_admin),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    decidedAt: row.decided_at,
  };

class Store extends EventEmitter {
  /** @param {string} file chemin de la base, ou ':memory:' (tests) */
  constructor(file) {
    super();
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ---------------------------------------------------------------- comptes

  getUser(id) {
    return publicUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(String(id)));
  }

  /**
   * Enregistre une connexion Discord. Nouveau compte : `initialStatus` (pending ou approved).
   * Les admins sont toujours approuvés ; le nom et l'avatar sont rafraîchis à chaque connexion.
   */
  recordLogin({ id, name, avatarUrl, isAdmin = false, initialStatus = 'pending' }) {
    const now = Date.now();
    const existing = this.getUser(id);
    if (!existing) {
      const status = isAdmin ? 'approved' : initialStatus;
      this.db
        .prepare(
          `INSERT INTO users (id, name, avatar_url, status, is_admin, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, name, avatarUrl ?? null, status, isAdmin ? 1 : 0, now, now);
      const user = this.getUser(id);
      if (status === 'pending') this.emit('request', user);
      this.emit('users:changed');
      return user;
    }
    this.db
      .prepare(
        `UPDATE users SET name = ?, avatar_url = ?, is_admin = ?, last_seen_at = ?,
           status = CASE WHEN ? = 1 THEN 'approved' ELSE status END
         WHERE id = ?`,
      )
      .run(name, avatarUrl ?? null, isAdmin ? 1 : 0, now, isAdmin ? 1 : 0, id);
    return this.getUser(id);
  }

  /** Décision de l'admin (approuver, refuser, révoquer = refuser un compte approuvé). */
  setStatus(id, status, decidedBy) {
    if (!STATUSES.includes(status)) throw new Error(`Statut inconnu : ${status}`);
    const user = this.getUser(id);
    if (!user) return null;
    if (user.isAdmin) throw new Error("Impossible de modifier le statut d'un administrateur.");
    this.db
      .prepare('UPDATE users SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
      .run(status, Date.now(), decidedBy ?? null, id);
    const updated = this.getUser(id);
    this.emit('users:changed');
    this.emit('status', updated);
    return updated;
  }

  listUsers(status) {
    const rows = status
      ? this.db.prepare('SELECT * FROM users WHERE status = ? ORDER BY created_at DESC').all(status)
      : this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    return rows.map(publicUser);
  }

  // ---------------------------------------------------------------- parties & stats

  /**
   * @param {{ gameId, roomCode, summary, players: [{ userId, result, score }] }} match
   */
  recordMatch({ gameId, roomCode, summary, players }) {
    const ranked = players.filter((p) => p.userId && ['win', 'loss', 'draw'].includes(p.result));
    if (!ranked.length) return null;
    const insertMatch = this.db.prepare(
      'INSERT INTO matches (game_id, room_code, summary, ended_at) VALUES (?, ?, ?, ?)',
    );
    const insertPlayer = this.db.prepare(
      'INSERT OR IGNORE INTO match_players (match_id, user_id, result, score) VALUES (?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      const { lastInsertRowid } = insertMatch.run(gameId, roomCode ?? null, summary ?? null, Date.now());
      const matchId = Number(lastInsertRowid);
      for (const p of ranked) {
        insertPlayer.run(matchId, p.userId, p.result, Number.isFinite(p.score) ? p.score : null);
      }
      this.db.exec('COMMIT');
      this.emit('match', { matchId, gameId, userIds: ranked.map((p) => p.userId) });
      return matchId;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Statistiques d'un joueur, par jeu. */
  statsForUser(userId) {
    return this.db
      .prepare(
        `SELECT m.game_id AS gameId,
                COUNT(*) AS played,
                SUM(mp.result = 'win') AS wins,
                SUM(mp.result = 'loss') AS losses,
                SUM(mp.result = 'draw') AS draws,
                MAX(mp.score) AS bestScore,
                MAX(m.ended_at) AS lastPlayedAt
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.user_id = ?
         GROUP BY m.game_id
         ORDER BY played DESC`,
      )
      .all(String(userId))
      .map((row) => ({ ...row }));
  }

  /** Dernières parties d'un joueur (avec les coéquipiers / adversaires). */
  recentMatches(userId, limit = 8) {
    const matches = this.db
      .prepare(
        `SELECT m.id, m.game_id AS gameId, m.summary, m.ended_at AS endedAt, mp.result, mp.score
         FROM match_players mp JOIN matches m ON m.id = mp.match_id
         WHERE mp.user_id = ?
         ORDER BY m.ended_at DESC, m.id DESC LIMIT ?`,
      )
      .all(String(userId), limit);
    const others = this.db.prepare(
      `SELECT u.name FROM match_players mp JOIN users u ON u.id = mp.user_id
       WHERE mp.match_id = ? AND mp.user_id != ? ORDER BY u.name`,
    );
    return matches.map((m) => ({ ...m, with: others.all(m.id, String(userId)).map((o) => o.name) }));
  }

  /** Classement d'un jeu : victoires, puis meilleur score, puis parties jouées. */
  leaderboard(gameId, limit = 10) {
    return this.db
      .prepare(
        `SELECT u.id AS userId, u.name, u.avatar_url AS avatarUrl,
                COUNT(*) AS played,
                SUM(mp.result = 'win') AS wins,
                MAX(mp.score) AS bestScore
         FROM match_players mp
         JOIN matches m ON m.id = mp.match_id
         JOIN users u ON u.id = mp.user_id
         WHERE m.game_id = ?
         GROUP BY u.id
         ORDER BY wins DESC, bestScore DESC, played DESC
         LIMIT ?`,
      )
      .all(gameId, limit)
      .map((row) => ({ ...row }));
  }
}

module.exports = { Store, STATUSES };
