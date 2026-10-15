import { SUITS, glyph } from './cards.js';
import {
  viewContext, tableHtml, trickHtml, panelHtml, statusFor, summaryDialog, endScreen, scoreSheet, journalHtml,
} from './view.js';
import { rulesDialog } from './rules.js';

/* =====================================================================
 * Interface de la Belote, dessinée avec le design system Claude Design « Tapis »
 * (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD), table « salon ».
 * Le système est importé dans public/vendor/tapis/ (bundle.js -> window.Tapis, tapis.css).
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie : take, pass, announce, play, next.
 *
 * Mouvement (même architecture que le Tarot) : chaque nouvel état est d'abord joué sur l'écran
 * affiché (ce qui part : pli ramassé, retournée emportée, talon distribué), puis la table est
 * redessinée depuis l'état reçu, puis ce qui arrive est animé (donne, carte posée, bulles…).
 * Les états reçus pendant une animation attendent leur tour ; s'ils s'accumulent, les animations
 * en cours sont terminées d'un coup (Tapis : .finish()).
 * ===================================================================== */

const TAPIS_JS = '/vendor/tapis/bundle.js';
const TAPIS_CSS = '/vendor/tapis/tapis.css';
const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'tapis.motion'; // partagé par les jeux de cartes
const HOLD = 1200; // pli complet gardé à l'écran avant d'être ramassé (design : 1,2 s)

let tapisLoading = null;
function loadTapis() {
  if (window.Tapis) return Promise.resolve(window.Tapis);
  tapisLoading ??= new Promise((resolve, reject) => {
    // un seul <script>, même si un autre jeu de cartes est en train de le charger
    let script = document.querySelector(`script[src="${TAPIS_JS}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = TAPIS_JS;
      document.head.append(script);
    }
    script.addEventListener('load', () => resolve(window.Tapis), { once: true });
    script.addEventListener('error', () => {
      tapisLoading = null;
      script.remove();
      reject(new Error('Design system introuvable.'));
    }, { once: true });
  });
  return tapisLoading;
}

function addCss(href) {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
  const ready = new Promise((resolve) => {
    link.onload = resolve;
    link.onerror = resolve;
  });
  document.head.append(link);
  return { link, ready };
}

function readMotion() {
  try {
    return localStorage.getItem(MOTION_KEY);
  } catch {
    return null;
  }
}

const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

export function mount(root, ctx) {
  const me = ctx.me.id;
  // tapis.css d'abord, puis nos réglages (qui gagnent aussi par leur spécificité)
  const css = [addCss(TAPIS_CSS), addCss(`${BASE}style.css`)];

  // .tp-scope porte les tokens du système, la table « salon » et l'interrupteur d'animations.
  const host = document.createElement('div');
  host.className = 'tp-scope blt';
  host.dataset.table = 'salon';
  host.dataset.theme = 'salon';
  host.setAttribute('data-motion-host', '');
  const saved = readMotion();
  if (saved === 'on' || saved === 'off') host.dataset.motion = saved; // sinon : prefers-reduced-motion décide
  host.innerHTML = '<p class="blt-loading">Ouverture de la table…</p>';
  root.append(host);

  let T = null;
  let zone = null;
  let layers = null;
  let state = null; // état courant (le plus récent traité)
  let shown = null; // état réellement dessiné à l'écran
  let latest = null; // dernier état reçu
  let chain = Promise.resolve();
  let queued = 0;
  let disposed = false;
  let busy = false; // une action attend la réponse du serveur
  let animating = false;
  let dirty = false; // un rendu demandé pendant une animation, fait à la fin
  let wake = null; // interrompt une pause statique (pli complet sans animation)
  let roomSig = '';
  let viewHtml = '';
  const ui = {
    lastEvent: 0,
    dealKey: null,
    announceDismissed: null, // « Ne rien annoncer » (clé de donne)
    announceSent: false,
    panel: null, // 'last' (dernier pli) | 'announces'
    beloteBubble: null, // { playerId, step } : bulle « Belote ! » / « Rebelote ! »
    heldTrick: null, // pli complet gardé à l'écran
    turnedDown: false, // la retournée est dessinée de dos, pour être retournée après la donne
    annFaceDown: false, // les cartes des annonces sont dessinées de dos, pour être montrées
    view: null, // 'summary' | 'end'
    rules: false,
    rulesTab: 'cartes',
    fromBox: {},
  };

  // ================================================================ hauteur : la table tient dans la fenêtre

  function fit() {
    const top = host.getBoundingClientRect().top + window.scrollY;
    const layout = host.closest('.room-layout');
    const pad = layout ? parseFloat(getComputedStyle(layout).paddingBottom) || 0 : 16;
    host.style.height = `${Math.max(320, Math.floor(window.innerHeight - top - pad))}px`;
  }
  fit();
  window.addEventListener('resize', fit);

  const onMotion = (e) => {
    try {
      localStorage.setItem(MOTION_KEY, e.detail.on ? 'on' : 'off');
    } catch { /* stockage indisponible */ }
  };
  document.addEventListener('tapis:motion', onMotion);

  const onVisibility = () => {
    if (document.hidden && T) {
      T.anim.finishAll();
      wake?.();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  Promise.all([loadTapis(), ...css.map((c) => c.ready)]).then(([t]) => {
    if (disposed) return;
    T = t;
    build();
    if (latest) enqueue(latest);
  }).catch((err) => {
    host.innerHTML = '';
    ctx.toast(err.message, 'error');
  });

  // les connexions et avatars viennent du salon : on suit leurs changements
  const poll = setInterval(() => {
    if (!T || !state || disposed) return;
    if (roomSignature() !== roomSig) renderTable();
  }, 1500);

  function roomSignature() {
    return JSON.stringify((ctx.getRoom()?.players ?? []).map((p) => [p.id, p.connected, p.avatarUrl]));
  }

  // ================================================================ squelette (une fois)

  function decor() {
    const t = document.createElement('template');
    t.innerHTML = T.screens.app({ table: 'salon', body: '' });
    return t.content.querySelector('.tp-zone > .tp-decor')?.outerHTML ?? '';
  }

  function build() {
    host.innerHTML = `<div class="tp-app"><main class="tp-zone" data-zone="game" aria-label="Table de Belote">${decor()}`
      + '<div class="tp-table tp-table--salon"></div>'
      + T.Tools({ buttons: ['journal', 'scores', 'regles', 'animations'] })
      + '<div class="tp-toasts" aria-live="polite"></div>'
      + T.Drawer({ id: 'journal', title: 'Journal', body: '' })
      + T.Drawer({ id: 'scores', title: 'Feuille de scores', className: 'tp-drawer--wide', body: '' })
      + '<div class="blt-layer" data-layer="view"></div><div class="blt-layer" data-layer="rules"></div></main></div>';
    zone = host.querySelector('.tp-zone');
    layers = { view: zone.querySelector('[data-layer="view"]'), rules: zone.querySelector('[data-layer="rules"]') };
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    // la zone ne défile jamais (overflow: hidden) : un focus sur un tiroir en mouvement pourrait la décaler
    for (const el of [zone, host.querySelector('.tp-app')]) {
      el.addEventListener('scroll', () => {
        if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0);
      });
    }
    fit();
  }

  // ================================================================ file des états

  function enqueue(next) {
    queued++;
    if (queued > 1 && T) {
      // les états s'accumulent : on termine tout de suite ce qui est en cours
      T.anim.finishAll();
      wake?.();
    }
    // une tâche d'attente : les messages déjà reçus du serveur passent d'abord, et un état dépassé n'est pas dessiné
    chain = chain.then(tick).then(() => step(next)).catch((err) => console.error(err));
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Attend une animation Tapis ; si des états s'accumulent, elle saute tout de suite à sa fin. */
  function go(tl) {
    if (queued > 1) tl.finish();
    return tl.done();
  }

  async function step(next) {
    queued--;
    if (disposed || !T) return;
    const prev = state;
    const fresh = prev ? next.events.filter((e) => e.id > ui.lastEvent) : [];
    const gap = !!prev && fresh.length > 0 && fresh[0].id > ui.lastEvent + 1; // événements perdus (reconnexion…)
    ui.lastEvent = next.events.reduce((m, e) => Math.max(m, e.id), ui.lastEvent);
    // un état déjà dépassé par un plus récent n'est pas dessiné (rattrapage d'un retard)
    const superseded = queued > 0;
    const tricks = fresh.filter((e) => e.type === 'trick').length;
    const deals = fresh.filter((e) => e.type === 'deal').length;
    const live = !!prev && prev === shown && !gap && tricks <= 1 && deals <= 1 && fresh.length <= 12;
    const motion = live && !superseded && T.motion.enabled() && !document.hidden;
    setAnimating(true);
    try {
      if (live && !superseded) await before(prev, next, fresh, motion).catch((err) => console.error(err));
      if (disposed) return;
      prepare(prev, next, fresh, { live, motion });
      state = next;
      if (superseded) return;
      render();
      if (live) notices(prev, next, fresh);
      if (motion) await after(prev, next, fresh).catch((err) => console.error(err));
      else if (!prev && freshDeal(next) && T.motion.enabled() && !document.hidden) {
        ui.turnedDown = true;
        renderTable(true);
        await dealAnim(next).catch((err) => console.error(err));
      }
    } finally {
      ui.heldTrick = null;
      ui.turnedDown = false;
      ui.annFaceDown = false;
      setAnimating(false);
    }
  }

  /** Animation locale (sans nouvel état) : passe dans la même file que les états. */
  function local(fn) {
    chain = chain.then(async () => {
      if (disposed || !T || !state) return;
      if (state !== shown) render();
      setAnimating(true);
      try {
        await fn(T.motion.enabled() && !document.hidden);
      } catch (err) {
        console.error(err);
      } finally {
        setAnimating(false);
      }
    });
    return chain;
  }

  function setAnimating(on) {
    animating = on;
    host.toggleAttribute('data-animating', on);
    if (!on && dirty) {
      dirty = false;
      renderTable();
    }
  }

  /** Pause sans animation (pli complet), écourtée si d'autres états arrivent. */
  function hold(ms) {
    if (queued > 1) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        if (wake === done) wake = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wake = done;
    });
  }

  const freshDeal = (s) => s.phase === 'bidding' && !s.bids.length && s.dealNumber === 1 && s.events.length <= 2 && s.events.some((e) => e.type === 'deal');

  /** Met à jour l'état local de l'interface quand la situation change. */
  function prepare(prev, next, fresh, { live, motion }) {
    const key = `${next.dealNumber}:${next.dealerId}`;
    if (key !== ui.dealKey) {
      Object.assign(ui, { dealKey: key, announceDismissed: null, announceSent: false, panel: null, beloteBubble: null });
    }
    if (next.phase !== 'playing') {
      ui.panel = null;
      ui.beloteBubble = null;
    }
    if (!next.canAnnounce) ui.announceSent = false;
    // les annonces gagnantes sont montrées au deuxième pli, puis le panneau se replie
    if (live && fresh.some((e) => e.type === 'announces')) ui.panel = 'announces';
    if (ui.panel === 'announces' && fresh.some((e) => e.type === 'trick' && e.number >= 2)) ui.panel = null;
    ui.annFaceDown = motion && fresh.some((e) => e.type === 'announces');
    // bulle « Belote ! » / « Rebelote ! » : jusqu'à la fin du pli
    const bel = fresh.filter((e) => e.type === 'play' && e.belote).at(-1);
    if (bel) ui.beloteBubble = { playerId: bel.playerId, step: bel.belote };
    if (fresh.some((e) => e.type === 'trick')) ui.beloteBubble = null;
    ui.turnedDown = motion && fresh.some((e) => e.type === 'deal');
    const ended = (s) => s?.phase === 'dealEnd' || s?.phase === 'gameOver';
    if (!ended(next)) ui.view = null;
    else if (!prev) ui.view = next.phase === 'gameOver' ? 'end' : 'summary';
    else if (!ended(prev)) ui.view = 'summary';
  }

  // ================================================================ rendu

  const q = (sel) => zone?.querySelector(sel) ?? null;
  const qa = (sel) => (zone ? [...zone.querySelectorAll(sel)] : []);
  const seatEl = (pid) => q(`.tp-seat[data-seat="${CSS.escape(pid)}"]`);
  const handCard = (id) => q(`.tp-hand [data-card-id="${CSS.escape(id)}"]`);
  const meTarget = () => [seatEl(me), q('.tp-hand')].find(visible) ?? null;
  /** Boîte relative à la zone, pour Tapis.anim.play({ from }) (un DOMRect ne convient pas). */
  const boxIn = (el) => {
    const z = zone.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const b = { x: r.left - z.left, y: r.top - z.top, w: r.width, h: r.height };
    b.cx = b.x + b.w / 2;
    b.cy = b.y + b.h / 2;
    return b;
  };
  /** D'où part la carte d'un adversaire : son éventail (PC), sinon son avatar. */
  const fromSeat = (pid) => {
    const seat = seatEl(pid);
    const fan = seat?.querySelector('.tp-fan');
    if (visible(fan)) return fan;
    const avatar = seat?.querySelector('.tp-avatar');
    return visible(avatar) ? avatar : visible(seat) ? seat : null;
  };
  /** Où va une carte destinée à un joueur : son siège (moi : mon siège, sinon ma main). */
  const toSeat = (pid) => {
    if (pid === me) return meTarget();
    const seat = seatEl(pid);
    return visible(seat) ? seat : null;
  };
  const view = (s = state) => viewContext(T, s, { me, room: ctx.getRoom(), ui });
  const nameOf = (pid) => view(state ?? latest).nameOf(pid);

  function render() {
    if (!T || !state || disposed) return;
    shown = state;
    renderTable(true);
    renderView();
    renderDrawers();
  }

  function renderTable(force = false) {
    if (!T || !state || disposed || !zone) return;
    if (animating && !force) {
      dirty = true;
      return;
    }
    roomSig = roomSignature();
    shown = state;
    const old = q('.tp-table');
    const scroll = old?.scrollTop ?? 0;
    const focus = focusKey(document.activeElement);
    const fresh = T.node(tableHtml(view()));
    old.replaceWith(fresh);
    if (scroll) fresh.scrollTop = scroll;
    // sur téléphone la table défile en hauteur seulement
    fresh.addEventListener('scroll', () => {
      if (fresh.scrollLeft) fresh.scrollLeft = 0;
    });
    wireHand(fresh);
    if (focus) fresh.querySelector(focus)?.focus({ preventScroll: true });
  }

  /** Retrouve après un rendu le contrôle qui avait le focus (clavier). */
  function focusKey(el) {
    if (!el || !zone?.contains(el) || !el.closest('.tp-table')) return null;
    for (const attr of ['data-card-id', 'data-suit', 'data-act', 'data-open']) {
      if (el.hasAttribute(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    }
    return null;
  }

  function renderView() {
    const v = view();
    let html = '';
    if (ui.view === 'summary' && state.summary) html = summaryDialog(v);
    else if (ui.view === 'end' && state.phase === 'gameOver') html = endScreen(v);
    if (html === viewHtml) return;
    viewHtml = html;
    layers.view.innerHTML = html;
    if (html) layers.view.querySelector('.tp-dialog [data-close], .tp-end .tp-btn')?.focus({ preventScroll: true });
  }

  function renderDrawers() {
    const v = view();
    setDrawerBody('journal', journalHtml(v));
    setDrawerBody('scores', scoreSheet(v));
  }

  const drawerHtml = new Map();
  function setDrawerBody(id, html) {
    const body = q(`#${id}.tp-drawer .tp-drawer__b`);
    if (!body || drawerHtml.get(id) === html) return;
    drawerHtml.set(id, html);
    body.innerHTML = html;
  }

  function renderRules() {
    const s = state ?? latest;
    layers.rules.innerHTML = ui.rules ? rulesDialog(T, { tab: ui.rulesTab, target: s?.target, announces: s?.announcesOn !== false }) : '';
    if (!ui.rules) return;
    T.interact.tabs(layers.rules);
    layers.rules.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  // ================================================================ main (souris + clavier)

  function wireHand(table) {
    const hand = table.querySelector('.tp-hand');
    if (!hand || !hand.querySelector('button.tp-card')) return;
    // un clic joue la carte : pas de sélection qui resterait collée (un second clic la désélectionnerait sans jouer)
    T.interact.hand(hand, {
      multi: false,
      onChange: (ids, card) => {
        const id = card?.dataset.cardId ?? ids[0];
        if (card) {
          card.setAttribute('aria-pressed', 'false');
          card.setAttribute('data-state', (card.dataset.state || '').split(' ').filter((x) => x && x !== 'selected').join(' '));
        }
        if (id) playCard(id);
      },
    });
  }

  function playCard(id) {
    if (busy || animating || !state?.isMyTurn || state.phase !== 'playing' || !state.legalCardIds.includes(id)) return;
    send('play', { cardId: id });
  }

  // ================================================================ actions

  async function send(type, payload = {}) {
    if (busy) return false;
    busy = true;
    host.toggleAttribute('data-busy', true);
    try {
      await ctx.sendAction(type, payload);
      return true;
    } catch (err) {
      // « Donne suivante » cliqué en même temps qu'un autre joueur : sa demande est passée, la nouvelle donne est déjà reçue
      if (type === 'next' && latest?.phase !== 'dealEnd') return false;
      notify({ tone: 'error', text: err.message });
      chain = chain.then(() => render()); // on efface ce que l'interface avait anticipé
      return false;
    } finally {
      busy = false;
      host.toggleAttribute('data-busy', false);
    }
  }

  function notify(o) {
    if (T && zone) T.notify(zone, o);
    else ctx.toast(o.text, o.tone === 'error' ? 'error' : 'info');
  }

  function openRanking() {
    ui.view = 'end';
    renderView();
    renderTable();
    local(async (motion) => {
      const end = q('.tp-end');
      if (motion && end) await go(T.anim.ranking(end));
    });
  }

  function onClick(e) {
    if (!T || !state || !zone) return;
    const t = e.target;
    if (t.closest('[data-motion-toggle]')) return; // géré par Tapis
    const open = t.closest('[data-open]:not(.tp-drawer)');
    if (open && zone.contains(open)) {
      openTool(open.dataset.open, open);
      return;
    }
    const close = t.closest('[data-close]');
    if (close && zone.contains(close)) {
      closeTool(close.dataset.close);
      return;
    }
    const tab = t.closest('#regles [role="tab"]');
    if (tab) {
      ui.rulesTab = tab.dataset.tab;
      return;
    }
    const act = t.closest('[data-act]');
    if (!act || !zone.contains(act) || act.getAttribute('aria-disabled') === 'true') return;
    const a = act.dataset.act;
    // ---- interface locale (permise pendant une animation)
    switch (a) {
      case 'close-panel':
        ui.panel = null;
        renderTable();
        return;
      case 'toggle-announces':
        ui.panel = ui.panel === 'announces' ? null : 'announces';
        renderTable();
        return;
      case 'summary':
        ui.view = 'summary';
        renderView();
        renderTable();
        return;
      case 'close-end':
        ui.view = null;
        renderView();
        renderTable();
        return;
      case 'ranking':
        openRanking();
        return;
      case 'next':
        if (state.phase === 'dealEnd') send('next');
        return;
      case 'no-announce':
        ui.announceDismissed = ui.dealKey;
        renderTable();
        q('.tp-hand button.tp-card[data-state~="playable"]')?.focus({ preventScroll: true });
        return;
      default:
    }
    // ---- actions de jeu : pas pendant une transition ni une requête en cours
    if (animating || busy) return;
    switch (a) {
      case 'pass':
        if (state.phase === 'bidding' && state.isMyTurn) send('pass');
        break;
      case 'take': {
        const suit = act.dataset.suit;
        if (state.phase === 'bidding' && state.isMyTurn && SUITS.includes(suit)) send('take', { suit });
        break;
      }
      case 'announce':
        if (state.canAnnounce) {
          ui.announceSent = true;
          send('announce', {}).then((ok) => {
            if (!ok) ui.announceSent = false;
          });
        }
        break;
      default:
    }
  }

  function openTool(id, button) {
    const drawer = q(`#${CSS.escape(id)}.tp-drawer`);
    if (drawer) {
      const on = !drawer.hasAttribute('data-open');
      if (on) closeDrawers();
      drawer.toggleAttribute('data-open', on);
      drawer.setAttribute('aria-hidden', String(!on));
      qa(`[data-open="${id}"]:not(.tp-drawer)`).forEach((b) => b.setAttribute('aria-expanded', String(on)));
      if (on && ui.view) {
        // la feuille de scores s'ouvre depuis le résumé ou la fin : la fenêtre se ferme (la barre d'actions la rouvre)
        ui.view = null;
        renderView();
        renderTable();
      }
      if (on) drawer.querySelector('[data-close]')?.focus({ preventScroll: true });
      else button?.focus({ preventScroll: true });
      return;
    }
    if (id === 'regles') {
      ui.rules = true;
      renderRules();
    } else if (id === 'dernier-pli') {
      ui.panel = ui.panel === 'last' ? null : 'last';
      renderTable();
    }
  }

  function closeDrawers() {
    for (const d of qa('.tp-drawer[data-open]')) {
      d.removeAttribute('data-open');
      d.setAttribute('aria-hidden', 'true');
      qa(`[data-open="${d.id}"]:not(.tp-drawer)`).forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
  }

  function closeTool(id) {
    const drawer = q(`#${CSS.escape(id)}.tp-drawer`);
    if (drawer) {
      closeDrawers();
      q(`.tp-tools [data-open="${id}"]`)?.focus({ preventScroll: true });
    } else if (id === 'regles') {
      ui.rules = false;
      renderRules();
      q('.tp-tools [data-open="regles"]')?.focus({ preventScroll: true });
    } else if (id === 'resume') {
      ui.view = null;
      renderView();
      renderTable();
    }
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !state || e.target.closest?.('.tp-hand')) return;
    if (ui.rules) closeTool('regles');
    else if (ui.view === 'summary') closeTool('resume');
    else if (q('.tp-drawer[data-open]')) closeDrawers();
    else if (ui.panel) {
      ui.panel = null;
      renderTable();
    }
  }

  // ================================================================ petites animations maison (Tapis.Timeline)

  function fxLayer(tl) {
    const l = document.createElement('div');
    l.className = 'tp-fx';
    l.setAttribute('aria-hidden', 'true');
    zone.append(l);
    return tl.node(l);
  }

  /** Une bulle qui éclot au-dessus d'un siège (posée à la main sur l'écran affiché). */
  function popBubble(pid, b) {
    const seat = seatEl(pid);
    if (!visible(seat) || !b) return null;
    seat.querySelector(':scope > .tp-bubble')?.remove();
    seat.insertAdjacentHTML('afterbegin', T.Bubble(b));
    return T.anim.bubble(seat.querySelector(':scope > .tp-bubble'));
  }

  /** La coupe : la moitié haute du talon se soulève, glisse de côté et passe dessous. */
  function cutAnim(stack) {
    const tl = new T.Timeline({});
    if (!tl.on || !visible(stack)) return tl.start();
    const lay = fxLayer(tl);
    const b = boxIn(stack);
    const ghost = (k) => {
      const g = T.node(T.Back({ size: 'md' }));
      g.classList.add('tp-ghost');
      g.style.cssText = `position:absolute;left:${b.x}px;top:${b.y - k * 2}px;width:${b.w}px;height:${b.h}px;--ch:${b.h}px;margin:0;`;
      lay.append(g);
      return g;
    };
    const bottom = ghost(0);
    const top = ghost(1);
    const ease = T.motion.ease;
    tl.add(stack, [{ opacity: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 1 }], { duration: 760, easing: 'linear' });
    tl.add(top, [
      { transform: 'none', zIndex: 2 },
      { transform: `translate(${b.w * 0.7}px, -18px) rotate(8deg)`, zIndex: 2, offset: 0.4 },
      { transform: `translate(${b.w * 0.7}px, -6px) rotate(4deg)`, zIndex: 0, offset: 0.6 },
      { transform: 'none', zIndex: 0 },
    ], { duration: 760, easing: ease.inOut });
    tl.add(bottom, [
      { transform: 'none', zIndex: 1 },
      { transform: 'translate(-8px, 0)', zIndex: 1, offset: 0.5 },
      { transform: 'translate(0, -3px)', zIndex: 3 },
    ], { duration: 760, easing: ease.inOut });
    return tl.start();
  }

  // ================================================================ animations : avant le rendu (écran affiché)

  async function before(prev, next, fresh, motion) {
    const has = (type) => fresh.some((e) => e.type === type);
    ui.fromBox = {};
    for (const e of fresh) {
      if (e.type !== 'play' || e.playerId !== me) continue;
      const c = handCard(e.card.id);
      if (visible(c)) ui.fromBox[e.card.id] = boxIn(c);
    }
    if (!motion && !has('trick')) return;

    // fin d'un tour d'enchères : la dernière parole n'aura plus de bulle sur l'écran suivant
    const take = fresh.find((e) => e.type === 'take');
    const lastPass = fresh.filter((e) => e.type === 'bid').at(-1);
    if (motion && lastPass && !take && (has('secondRound') || has('allPass'))) {
      const tl = popBubble(lastPass.playerId, { text: 'Passe', tone: 'pass' });
      if (tl) {
        await go(tl);
        await hold(450);
      }
    }

    // prise : bulle, la retournée part chez le preneur, puis le talon est distribué
    if (motion && take && prev.phase === 'bidding') {
      q('.tp-overpanel')?.remove();
      const tl = popBubble(take.playerId, { text: `Prend ${glyph(take.suit)}` });
      if (tl) await go(tl);
      const turned = q('.blt-turned');
      const target = toSeat(take.playerId);
      if (turned && target) await go(T.anim.collect(turned, target, { hold: 260 }));
      const pile = q('[data-pile="pioche"]');
      if (pile) {
        const di = next.players.findIndex((p) => p.id === next.dealerId);
        const order = [1, 2, 3, 4].map((k) => next.players[(di + k) % 4].id);
        const jobs = order.map((pid, i) => {
          const to = toSeat(pid);
          return to ? go(T.anim.drawTo(pile, to, { count: pid === take.playerId ? 2 : 3, delay: i * 200 })) : null;
        }).filter(Boolean);
        await Promise.all(jobs);
      }
    }

    const tr = fresh.find((e) => e.type === 'trick');
    if (tr) await trickBefore(prev, fresh, tr, motion);
  }

  /** Pli complet : la dernière carte se pose, le pli reste visible, puis file vers le gagnant. */
  async function trickBefore(prev, fresh, tr, motion) {
    const old = q('.tp-trick');
    if (!old) return;
    const play = fresh.filter((e) => e.type === 'play').at(-1);
    let from = null;
    if (play) {
      const mine = play.playerId === me;
      const src = mine ? handCard(play.card.id) : fromSeat(play.playerId);
      if (motion && visible(src)) from = mine ? boxIn(src) : src;
      if (mine && src) src.style.visibility = 'hidden';
    }
    ui.heldTrick = { cards: tr.cards, winnerId: tr.winnerId, number: tr.number, points: tr.points };
    try {
      await holdTrick(prev, tr, play, from, motion);
    } finally {
      ui.heldTrick = null; // l'écran suivant montre le nouveau pli
    }
  }

  async function holdTrick(prev, tr, play, from, motion) {
    const old = q('.tp-trick');
    if (!old) return;
    const v = view(prev);
    const full = T.node(trickHtml(v, tr.cards, tr.winnerId));
    old.replaceWith(full);
    const st = q('[data-area="status"]');
    if (st) st.innerHTML = T.Status(statusFor(v));
    q('.tp-overpanel')?.remove();
    const actions = q('[data-area="actions"]');
    if (actions) actions.innerHTML = '';
    for (const seat of qa('.tp-seat[data-state="active"]')) {
      seat.setAttribute('data-state', 'waiting');
      seat.querySelector('.tp-avatar')?.setAttribute('data-state', 'waiting');
      seat.querySelector('.tp-seat__turn')?.remove();
    }
    const card = (id) => full.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
    if (!motion) {
      await hold(HOLD);
      return;
    }
    const jobs = [];
    if (from && play) jobs.push(go(T.anim.play(card(play.card.id), { from, flip: play.playerId !== me })));
    if (play?.belote) {
      const tl = popBubble(play.playerId, { text: play.belote === 'belote' ? 'Belote !' : 'Rebelote !' });
      if (tl) jobs.push(go(tl));
    }
    await Promise.all(jobs);
    const winner = tr.winnerId === me ? meTarget() : seatEl(tr.winnerId);
    const target = visible(winner) ? winner : meTarget();
    if (target) await go(T.anim.collect(full, target, { hold: HOLD }));
  }

  // ================================================================ animations : après le rendu (nouvel écran)

  async function after(prev, next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    const jobs = [];
    if (has('deal')) await dealAnim(next);

    // enchères : les bulles éclosent sur les sièges
    let k = 0;
    for (const e of fresh) {
      if (e.type !== 'bid' && e.type !== 'announce') continue;
      const bubble = seatEl(e.playerId)?.querySelector(':scope > .tp-bubble');
      if (visible(bubble)) jobs.push(go(T.anim.bubble(bubble, { delay: 90 * k++ })));
    }
    const contract = q('.tp-contract');
    if (contract && (has('secondRound') || has('take'))) jobs.push(go(T.anim.bubble(contract)));

    // prise : mes nouvelles cartes se retournent dans ma main
    if (has('take')) {
      const before = new Set(prev.myHand.map((c) => c.id));
      const fresh8 = next.myHand.filter((c) => !before.has(c.id)).map((c) => handCard(c.id)).filter(visible);
      fresh8.forEach((el, i) => jobs.push(go(T.anim.flip(el, { up: true, delay: 80 * i }))));
    }

    // carte posée (le pli complet est joué avant le rendu)
    if (!has('trick')) {
      for (const e of fresh) {
        if (e.type !== 'play') continue;
        const el = q(`.tp-trick [data-card-id="${CSS.escape(e.card.id)}"]`);
        const from = e.playerId === me ? ui.fromBox[e.card.id] : fromSeat(e.playerId);
        if (el && from) jobs.push(go(T.anim.play(el, { from, flip: e.playerId !== me })));
        if (e.belote) {
          const bubble = seatEl(e.playerId)?.querySelector(':scope > .tp-bubble');
          if (visible(bubble)) jobs.push(go(T.anim.bubble(bubble, { delay: 300 })));
        }
      }
    }

    // annonces montrées au deuxième pli : les cartes se retournent une à une
    if (has('announces')) {
      const panel = q('.blt-annshow');
      if (panel) {
        jobs.push(go(T.anim.bubble(panel)));
        qa('.blt-annshow .tp-card').forEach((c, i) => jobs.push(go(T.anim.flip(c, { up: true, delay: 200 + i * 70 }))));
      }
    }

    // le halo du tour passe au joueur suivant (sans attendre)
    if (!has('deal') && prev.currentPlayerId && next.currentPlayerId && prev.currentPlayerId !== next.currentPlayerId) {
      const a = seatEl(prev.currentPlayerId);
      const b = seatEl(next.currentPlayerId);
      if (visible(a) && visible(b) && b.dataset.state === 'active') T.anim.run('turn', () => T.anim.turn(a, b));
    }

    await Promise.all(jobs);
    if (has('dealEnd') && ui.view === 'summary') {
      const deal = q('.tp-deal');
      if (deal) await go(T.anim.summary(deal));
    }
  }

  /** Donne : le talon est coupé, puis part en paquets de 3 et 2 vers chaque siège ; la retournée se retourne. */
  async function dealAnim(s) {
    const pile = q('[data-pile="pioche"]');
    const stack = pile?.querySelector('.tp-pile__stack');
    const hand = q('.tp-hand');
    const turned = q('.blt-turned .tp-card');
    if (!visible(stack) || !hand) return;
    if (turned) turned.style.visibility = 'hidden';
    host.toggleAttribute('data-dealing', true); // pas de panneau d'enchères pendant la donne
    try {
      await go(cutAnim(stack));
      const targets = s.players.filter((p) => p.id !== me).map((p) => {
        const seat = seatEl(p.id);
        const el = visible(seat?.querySelector('.tp-fan')) ? seat : seat?.querySelector('.tp-avatar');
        return visible(el) ? { el, n: p.cardCount } : null;
      }).filter(Boolean);
      await go(T.anim.deal(pile, targets, { hand, packet: 3 }));
    } finally {
      if (turned) turned.style.visibility = '';
    }
    try {
      if (turned && turned.isConnected) await go(T.anim.flip(turned, { up: true }));
    } finally {
      host.toggleAttribute('data-dealing', false);
    }
  }

  // ================================================================ notifications de table

  function notices(prev, next, fresh) {
    for (const e of fresh) {
      if (e.type === 'allPass') notify({ tone: 'info', text: 'Tout le monde passe : on ramasse, le joueur suivant distribue' });
      if (e.type === 'secondRound') notify({ tone: 'info', text: `Personne ne prend à ${glyph(next.turned.suit)} : second tour, chacun peut choisir une autre couleur` });
      if (e.type === 'take' && e.playerId !== me) {
        const team = view(next).teamName(next.players.find((p) => p.id === e.playerId)?.team);
        notify({ tone: 'info', text: `${nameOf(e.playerId)} (${team}) prend à ${glyph(e.suit)}` });
      }
      if (e.type === 'dealEnd' && next.summary?.capot !== null && next.summary?.capot !== undefined) {
        notify({ tone: 'success', title: 'Capot', text: `${view(next).teamName(next.summary.capot)} : les 8 plis, 252 points` });
      }
    }
  }

  // ================================================================ cycle de vie

  return {
    update(next) {
      latest = next;
      if (T && zone) enqueue(next);
    },
    unmount() {
      disposed = true;
      clearInterval(poll);
      wake?.();
      window.removeEventListener('resize', fit);
      document.removeEventListener('tapis:motion', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      T?.anim.finishAll();
      css.forEach((c) => c.link.remove());
      host.remove();
    },
  };
}
