'use strict';

/**
 * Connexion via Discord (OAuth2), sans base de données.
 *
 * Même flux que JDR-WEB (state anti-CSRF dans un cookie signé, retour interne
 * uniquement), mais la session est un cookie signé HMAC autoporteur :
 * { id, name, avatarUrl, exp }. Rien n'est stocké côté serveur.
 *
 * Qui peut jouer (variables d'environnement, toutes optionnelles) :
 *   DISCORD_ALLOWED_IDS  : ces comptes passent toujours ;
 *   DISCORD_GUILD_ID     : sinon, il faut être membre de ce serveur Discord ;
 *   DISCORD_ROLE_IDS     : ... et avoir au moins un de ces rôles.
 *   Rien de défini : tout compte Discord peut jouer.
 *
 * Désactivé (mode pseudo libre, comme avant) si DISCORD_CLIENT_ID/SECRET sont absents.
 */

const crypto = require('crypto');
const express = require('express');
const { cleanText } = require('./utils');

const SESSION_COOKIE = 'gh_session';
const STATE_COOKIE = 'gh_oauth';
const SESSION_DAYS = 7;
const NAME_MAX_LENGTH = 20;
const DISCORD_API = 'https://discord.com/api';

const list = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** On ne redirige qu'à l'intérieur de l'app, jamais vers un domaine extérieur. */
const safeReturnTo = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/');

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      /* cookie mal encodé : ignoré */
    }
  }
  return cookies;
}

function createSigner(secret) {
  const mac = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    sign(payload) {
      const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return `${data}.${mac(data)}`;
    },
    /** Renvoie le contenu si la signature est valide et non expirée, sinon null. */
    verify(token) {
      if (typeof token !== 'string') return null;
      const [data, signature] = token.split('.');
      if (!data || !signature) return null;
      const expected = Buffer.from(mac(data));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
      try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null;
        return payload;
      } catch {
        return null;
      }
    },
  };
}

function createAuth(env = process.env, { fetchImpl = fetch } = {}) {
  const clientId = env.DISCORD_CLIENT_ID;
  const clientSecret = env.DISCORD_CLIENT_SECRET;
  const enabled = Boolean(clientId && clientSecret);

  if (!enabled) {
    return {
      enabled: false,
      router: express.Router().get('/api/me', (req, res) => res.json({ authEnabled: false, user: null })),
      userFromCookieHeader: () => null,
    };
  }

  const publicUrl = env.PUBLIC_URL;
  if (!publicUrl || !/^https?:\/\//.test(publicUrl)) {
    throw new Error('PUBLIC_URL (ex. https://jeux.mondomaine.fr) est requis quand la connexion Discord est activée.');
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET (32 caractères minimum : openssl rand -base64 48) est requis avec Discord.');
  }

  const signer = createSigner(env.SESSION_SECRET);
  const secure = publicUrl.startsWith('https://');
  const redirectUri = new URL('/auth/discord/callback', publicUrl).toString();
  const guildId = env.DISCORD_GUILD_ID || null;
  const roleIds = list(env.DISCORD_ROLE_IDS);
  const allowedIds = new Set(list(env.DISCORD_ALLOWED_IDS));
  const scope = guildId ? 'identify guilds.members.read' : 'identify';

  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure };

  const userFromCookieHeader = (header) => {
    const payload = signer.verify(parseCookies(header)[SESSION_COOKIE]);
    return payload?.id ? { id: payload.id, name: payload.name, avatarUrl: payload.avatarUrl ?? null } : null;
  };

  /** Applique les règles d'accès ; renvoie le nom à afficher ou null si refusé. */
  async function checkAccess(accessToken, discordUser) {
    const defaultName = discordUser.global_name || discordUser.username;
    if (allowedIds.has(discordUser.id)) return defaultName;
    if (!guildId) return allowedIds.size ? null : defaultName;

    const res = await fetchImpl(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null; // pas membre du serveur
    const member = await res.json();
    if (roleIds.length && !roleIds.some((r) => member.roles?.includes(r))) return null;
    return member.nick || defaultName; // surnom sur le serveur en priorité
  }

  const router = express.Router();

  router.get('/api/me', (req, res) => {
    res.json({ authEnabled: true, user: userFromCookieHeader(req.headers.cookie) });
  });

  router.get('/auth/discord', (req, res) => {
    const state = crypto.randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, signer.sign({ state, returnTo: safeReturnTo(req.query.returnTo), exp: Date.now() + 600_000 }), {
      ...cookieOptions,
      path: '/auth',
      maxAge: 600_000,
    });
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
      prompt: 'none',
    }).toString();
    res.redirect(url.toString());
  });

  router.get('/auth/discord/callback', async (req, res) => {
    const fail = (reason) => res.redirect(`/?auth=${reason}`);
    const saved = signer.verify(parseCookies(req.headers.cookie)[STATE_COOKIE]);
    res.clearCookie(STATE_COOKIE, { path: '/auth' });
    if (!saved || !req.query.code || saved.state !== req.query.state) return fail('erreur');

    try {
      const tokenRes = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'authorization_code',
          code: String(req.query.code),
          redirect_uri: redirectUri,
        }),
      });
      if (!tokenRes.ok) return fail('erreur');
      const { access_token: accessToken } = await tokenRes.json();

      const meRes = await fetchImpl(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!meRes.ok) return fail('erreur');
      const discordUser = await meRes.json();

      const displayName = await checkAccess(accessToken, discordUser);
      if (!displayName) return fail('refuse');

      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
        : null;
      const maxAge = SESSION_DAYS * 24 * 3600 * 1000;
      const session = {
        id: discordUser.id,
        name: cleanText(displayName, NAME_MAX_LENGTH) || 'Joueur',
        avatarUrl,
        exp: Date.now() + maxAge,
      };
      res.cookie(SESSION_COOKIE, signer.sign(session), { ...cookieOptions, path: '/', maxAge });
      res.redirect(safeReturnTo(saved.returnTo));
    } catch (err) {
      console.error('[auth] échec de la connexion Discord', err);
      fail('erreur');
    }
  });

  router.post('/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return { enabled: true, router, userFromCookieHeader };
}

module.exports = { createAuth, createSigner, parseCookies, SESSION_COOKIE };
