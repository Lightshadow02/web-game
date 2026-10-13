import { BID_BACK, BID_LABEL, BID_SHORT, SUIT, tp, cardName, calledDef, calledRankName } from './cards.js';
import {
  viewContext, tableHtml, trickHtml, panelHtml, statusFor, summaryDialog, endScreen, scoreSheet, journalHtml,
} from './view.js';
import { rulesDialog } from './rules.js';

/* =====================================================================
 * Interface du Tarot, dessinée avec le design system Claude Design « Tapis »
 * (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD), table « salon ».
 * Le système est importé dans public/vendor/tapis/ (bundle.js -> window.Tapis, tapis.css).
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 *   bid, call, discard, poignee, play, next.
 *
 * Mouvement : chaque nouvel état est d'abord joué sur l'écran affiché (ce qui part :
 * pli ramassé, chien emporté…), puis la table est redessinée depuis l'état reçu, puis ce
 * qui arrive est animé (carte posée, enchère, chien retourné, Roi appelé…).
 * Les états reçus pendant une animation attendent leur tour ; s'ils s'accumulent,
 * les animations en cours sont terminées d'un coup (Tapis : .finish()).
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
  host.className = 'tp-scope trt';
  host.dataset.table = 'salon';
  host.dataset.theme = 'salon';
  host.setAttribute('data-motion-host', '');
  const saved = readMotion();
  if (saved === 'on' || saved === 'off') host.dataset.motion = saved; // sinon : prefers-reduced-motion décide
  host.innerHTML = '<p class="trt-loading">Ouverture de la table…</p>';
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
    sel: [], // écart choisi (ids)
    callSuit: null, // couleur choisie pour l'appel au Roi (pique, coeur…)
    chienTaken: false, // étape locale « Prendre le chien » du preneur
    keepChienCenter: false, // le chien reste au centre le temps de son vol vers la main
    chienFaceDown: false, // le chien est dessiné de dos, pour être retourné
    handfulDismissed: null, // « Ne rien annoncer » (clé de donne)
    panel: null, // 'last' (dernier pli) | 'poignees'
    poigneeNews: false,
    heldTrick: null, // pli complet gardé à l'écran
    calledInChien: false, // Roi appelé vu dans le chien retourné
    ecartSent: false,
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
    host.innerHTML = `<div class="tp-app"><main class="tp-zone" data-zone="game" aria-label="Table de Tarot">${decor()}`
      + '<div class="tp-table tp-table--salon"></div>'
      + T.Tools({ buttons: ['journal', 'scores', 'regles', 'animations'] })
      + '<div class="tp-toasts" aria-live="polite"></div>'
      + T.Drawer({ id: 'journal', title: 'Journal', body: '' })
      + T.Drawer({ id: 'scores', title: 'Feuille de scores', className: 'tp-drawer--wide', body: '' })
      + '<div class="trt-layer" data-layer="view"></div><div class="trt-layer" data-layer="rules"></div></main></div>';
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
    const live = !!prev && prev === shown && !gap && tricks <= 1 && fresh.length <= 12;
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
      else if (!prev && freshDeal(next) && T.motion.enabled() && !document.hidden) await dealAnim(next).catch((err) => console.error(err));
    } finally {
      ui.heldTrick = null;
      ui.chienFaceDown = false;
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

  const freshDeal = (s) => s.phase === 'bidding' && !s.bids.length && s.roundNumber === 1 && s.events.length <= 2 && s.events.some((e) => e.type === 'deal');

  /** Met à jour l'état local de l'interface quand la situation change. */
  function prepare(prev, next, fresh, { live, motion }) {
    const key = `${next.roundNumber}:${next.dealerId}`;
    if (key !== ui.dealKey) {
      Object.assign(ui, {
        dealKey: key, sel: [], callSuit: null, chienTaken: false, keepChienCenter: false, handfulDismissed: null,
        panel: null, poigneeNews: false, calledInChien: false, ecartSent: false,
      });
    }
    ui.sel = next.phase === 'discard' ? ui.sel.filter((id) => next.myHand.some((c) => c.id === id)) : [];
    if (next.phase !== 'calling') ui.callSuit = null;
    if (next.phase !== 'discard') ui.keepChienCenter = false;
    if (next.chien && next.calledCard && next.chien.some((c) => c.id === next.calledCard.id)) ui.calledInChien = true;
    if (next.phase !== 'playing') {
      ui.panel = null;
      ui.poigneeNews = false;
    }
    if (fresh.some((e) => e.type === 'play' || e.type === 'trick')) ui.poigneeNews = false;
    if (ui.panel === 'poignees' && fresh.some((e) => e.type === 'trick')) ui.panel = null; // fin du premier pli
    if (live && fresh.some((e) => e.type === 'poignee' && e.playerId !== me)) {
      ui.panel = 'poignees';
      ui.poigneeNews = true;
    }
    ui.chienFaceDown = motion && fresh.some((e) => e.type === 'chien');
    const ended = (s) => s?.phase === 'roundEnd' || s?.phase === 'gameOver';
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
  const nameOf = (pid) => viewContext(T, state ?? latest, { me, room: ctx.getRoom(), ui }).nameOf(pid);
  const view = (s = state) => viewContext(T, s, { me, room: ctx.getRoom(), ui });

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
    for (const attr of ['data-card-id', 'data-act', 'data-bid', 'data-call', 'data-handful', 'data-open']) {
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
    layers.rules.innerHTML = ui.rules ? rulesDialog(T, { tab: ui.rulesTab }) : '';
    if (!ui.rules) return;
    T.interact.tabs(layers.rules);
    layers.rules.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  /** Mise à jour sans redessiner la main (le focus clavier y reste) : statut et panneau d'écart. */
  function updateSelectionUi() {
    const v = view();
    const st = q('[data-area="status"]');
    if (st) st.innerHTML = T.Status(statusFor(v));
    const op = q('.tp-overpanel');
    if (op) op.innerHTML = panelHtml(v);
  }

  // ================================================================ main (souris + clavier)

  function wireHand(table) {
    const hand = table.querySelector('.tp-hand');
    if (!hand || !hand.querySelector('button.tp-card')) return;
    const ecart = state.phase === 'discard';
    const api = T.interact.hand(hand, {
      multi: ecart,
      onChange: (ids, card) => (ecart ? onEcartChange(ids, card) : ids[0] && playCard(ids[0])),
    });
    if (ecart) {
      // Échap vide la sélection sans prévenir : on se resynchronise
      hand.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') queueMicrotask(() => {
          ui.sel = api.selected();
          updateSelectionUi();
        });
      });
    }
  }

  function onEcartChange(ids, card) {
    const need = state.discardCount;
    if (ids.length > need && card) {
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('data-state', (card.dataset.state || '').split(' ').filter((x) => x && x !== 'selected').join(' '));
      T.anim.refuse(card, { reason: `Déjà ${need} cartes choisies` });
      ids = ids.filter((id) => id !== card.dataset.cardId);
    }
    ui.sel = ids;
    updateSelectionUi();
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
      if (type === 'next' && latest?.phase !== 'roundEnd') return false;
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

  function takeChien() {
    if (ui.chienTaken) return;
    local(async (motion) => {
      ui.chienTaken = true;
      ui.keepChienCenter = motion;
      renderTable(true);
      if (motion) {
        const centre = qa('.tp-chien .tp-card');
        const hand = q('.tp-hand');
        if (centre.length && hand) await go(T.anim.chienTake(centre, hand));
      }
      ui.keepChienCenter = false;
      renderTable(true);
      q('.tp-hand button.tp-card[tabindex="0"]')?.focus({ preventScroll: true });
    });
  }

  function validateEcart() {
    const need = state.discardCount;
    if (ui.sel.length !== need || busy) return;
    const ids = [...ui.sel];
    local(async (motion) => {
      ui.ecartSent = true;
      const cards = ids.map(handCard).filter(Boolean);
      const pile = q('.tp-chien .tp-card--slot') ?? q('.tp-chien');
      q('.tp-overpanel')?.remove();
      if (motion && cards.length && pile) await go(T.anim.ecart(cards, pile));
    });
    send('discard', { cardIds: ids }).then((ok) => {
      if (!ok) ui.ecartSent = false;
    });
  }

  function callKing() {
    const card = state.callableCards.find((c) => SUIT[c.suit] === ui.callSuit);
    if (card) send('call', { cardId: card.id });
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
    const act = t.closest('[data-act], [data-bid], [data-call], [data-handful]');
    if (!act || !zone.contains(act) || act.getAttribute('aria-disabled') === 'true') return;
    const a = act.dataset.act;
    // ---- interface locale (permise pendant une animation)
    switch (a) {
      case 'close-panel':
        ui.panel = null;
        ui.poigneeNews = false;
        renderTable();
        return;
      case 'toggle-poignees':
        ui.panel = ui.panel === 'poignees' ? null : 'poignees';
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
        if (state.phase === 'roundEnd') send('next');
        return;
      default:
    }
    // ---- actions de jeu : pas pendant une transition ni une requête en cours
    if (animating || busy) return;
    if (act.dataset.bid) {
      const bid = BID_BACK[act.dataset.bid];
      if (state.phase === 'bidding' && state.availableBids.includes(bid)) send('bid', { bid });
      return;
    }
    if (act.dataset.call) {
      ui.callSuit = act.dataset.call;
      renderTable();
      q(`[data-call="${CSS.escape(ui.callSuit)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (act.dataset.handful) {
      const size = act.dataset.handful;
      if (state.poigneeOptions.some((o) => o.id === size)) send('poignee', { size });
      return;
    }
    switch (a) {
      case 'call':
        callKing();
        break;
      case 'ecart':
        validateEcart();
        break;
      case 'take-chien':
        takeChien();
        break;
      case 'no-handful':
        ui.handfulDismissed = ui.dealKey;
        renderTable();
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

  // ================================================================ animations : avant le rendu (écran affiché)

  async function before(prev, next, fresh, motion) {
    const has = (type) => fresh.some((e) => e.type === type);
    ui.fromBox = {};
    for (const e of fresh) {
      if (e.type !== 'play' || e.playerId !== me) continue;
      const c = handCard(e.card.id);
      if (visible(c)) ui.fromBox[e.card.id] = boxIn(c);
    }

    // la dernière enchère clôt les enchères : sa bulle n'existera plus sur l'écran suivant
    const lastBid = fresh.filter((e) => e.type === 'bid').at(-1);
    if (motion && lastBid && (has('allPass') || !['bidding', 'calling'].includes(next.phase))) {
      const seat = seatEl(lastBid.playerId);
      if (visible(seat)) {
        seat.querySelector(':scope > .tp-bubble')?.remove();
        seat.insertAdjacentHTML('afterbegin', T.Bubble({ text: BID_SHORT[lastBid.bid], tone: lastBid.bid === 'passe' ? 'pass' : undefined }));
        await go(T.anim.bubble(seat.querySelector(':scope > .tp-bubble')));
        await hold(450);
      }
    }

    // Garde sans / contre : le chien part sans être retourné
    const blind = has('playStart') && !has('chien') && ['garde_sans', 'garde_contre'].includes(next.contract?.id) && ['bidding', 'calling'].includes(prev.phase);
    if (motion && blind) {
      const chien = q('.tp-chien');
      const ti = next.players.findIndex((p) => p.id === next.takerId);
      const to = next.contract.id === 'garde_sans' ? next.takerId : next.players[(ti + 1) % next.players.length].id;
      const target = seatEl(to);
      if (chien && visible(target)) await go(T.anim.collect(chien, target, { hold: 300 }));
    }

    // écart : le preneur emporte le chien (chez les autres) ; mes cartes filent vers l'écart (si pas déjà fait)
    const ec = fresh.find((e) => e.type === 'ecart');
    if (motion && ec) {
      if (ec.playerId === me) {
        const gone = prev.myHand.filter((c) => !next.myHand.some((x) => x.id === c.id)).map((c) => handCard(c.id)).filter(visible);
        const pile = q('.tp-chien .tp-card--slot') ?? q('.tp-chien');
        if (!ui.ecartSent && gone.length && pile) await go(T.anim.ecart(gone, pile));
      } else {
        const chien = q('.tp-chien');
        const target = seatEl(ec.playerId);
        if (chien && visible(target)) await go(T.anim.collect(chien, target, { hold: 200 }));
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
    ui.heldTrick = { cards: tr.cards, winnerId: tr.winnerId, number: tr.number };
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
    if (from && play) await go(T.anim.play(card(play.card.id), { from, flip: play.playerId !== me }));
    const last = tr.number === prev.totalTricks;
    const ex = tr.cards.find((t) => t.card.suit === 'E');
    if (ex && !last && ex.playerId !== tr.winnerId) {
      // l'Excuse revient à son camp
      const owner = seatEl(ex.playerId);
      if (visible(owner) && card('EX')) await go(T.anim.excuse(card('EX'), owner));
    }
    if (last && card('T1')) await go(T.anim.petit(card('T1'))); // Petit au bout
    const winner = seatEl(tr.winnerId);
    const target = visible(winner) ? winner : meTarget();
    if (target) await go(T.anim.collect(full, target, { hold: HOLD }));
  }

  // ================================================================ animations : après le rendu (nouvel écran)

  async function after(prev, next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    const jobs = [];
    if (has('deal')) await dealAnim(next);

    // enchères : les bulles éclosent sur les sièges ; le bandeau du contrat apparaît
    let k = 0;
    for (const e of fresh) {
      if (e.type !== 'bid') continue;
      const bubble = seatEl(e.playerId)?.querySelector(':scope > .tp-bubble');
      if (visible(bubble)) jobs.push(go(T.anim.bubble(bubble, { delay: 90 * k++ })));
    }
    const contract = q('.tp-contract');
    if (!prev.contract && next.contract && contract && !has('call')) jobs.push(go(T.anim.bubble(contract)));

    // appel au Roi (à 5) puis chien retourné
    const call = fresh.find((e) => e.type === 'call');
    if (call && contract) await go(T.anim.kingCall(tp(call.card), contract));
    if (has('chien')) {
      const cards = qa('.tp-chien .tp-card[data-face="down"]');
      if (cards.length) await go(T.anim.chienReveal(cards));
    }

    // poignée montrée
    const pg = fresh.filter((e) => e.type === 'poignee').at(-1);
    if (pg) {
      const show = qa('.tp-handshow').at(-1);
      if (show) jobs.push(go(T.anim.handful(show)));
      const bubble = seatEl(pg.playerId)?.querySelector(':scope > .tp-bubble');
      if (visible(bubble)) jobs.push(go(T.anim.bubble(bubble)));
    }

    // carte posée (le pli complet est joué avant le rendu)
    if (!has('trick')) {
      for (const e of fresh) {
        if (e.type !== 'play') continue;
        const el = q(`.tp-trick [data-card-id="${CSS.escape(e.card.id)}"]`);
        const from = e.playerId === me ? ui.fromBox[e.card.id] : fromSeat(e.playerId);
        if (el && from) jobs.push(go(T.anim.play(el, { from, flip: e.playerId !== me })));
      }
    }

    // partenaire révélé
    if (fresh.some((e) => e.type === 'play' && e.revealsPartner) && next.partnerId && next.partnerId !== next.takerId) {
      const seat = seatEl(next.partnerId);
      if (visible(seat)) jobs.push(go(T.anim.partner(seat)));
    }

    // le halo du tour passe au joueur suivant (sans attendre)
    if (!has('deal') && prev.currentPlayerId && next.currentPlayerId && prev.currentPlayerId !== next.currentPlayerId) {
      const a = seatEl(prev.currentPlayerId);
      const b = seatEl(next.currentPlayerId);
      if (visible(a) && visible(b) && b.dataset.state === 'active') T.anim.run('turn', () => T.anim.turn(a, b));
    }

    await Promise.all(jobs);
    if (has('roundEnd') && ui.view === 'summary') {
      const deal = q('.tp-deal');
      if (deal) await go(T.anim.summary(deal));
    }
  }

  /** Donne : le paquet se mélange au centre, puis part en paquets de 3 vers chaque siège (le chien carte par carte) ; ma main se retourne. */
  async function dealAnim(s) {
    const chien = q('.tp-chien');
    const row = chien?.querySelector('.tp-chien__c');
    const hand = q('.tp-hand');
    if (!visible(row) || !hand) return;
    const deck = T.node(T.Back({ size: 'sm', className: 'trt-deck' }));
    chien.append(deck);
    row.style.visibility = 'hidden';
    hand.style.visibility = 'hidden'; // ma main se retourne pendant la donne (Tapis la cache dès son départ)
    try {
      await go(T.anim.shuffle(deck));
      const targets = s.players.filter((p) => p.id !== me).map((p) => {
        const seat = seatEl(p.id);
        const el = visible(seat?.querySelector('.tp-fan')) ? seat : seat?.querySelector('.tp-avatar');
        return visible(el) ? { el, n: p.cardCount } : null;
      }).filter(Boolean);
      targets.push({ el: row, n: s.chienCount, chien: true });
      const tl = T.anim.deal(deck, targets, { hand, packet: 3 });
      hand.style.visibility = '';
      await go(tl);
    } finally {
      deck.remove();
      row.style.visibility = '';
      hand.style.visibility = '';
    }
  }

  // ================================================================ notifications de table

  function notices(prev, next, fresh) {
    const who = (pid) => (pid === me ? 'Tu' : nameOf(pid));
    for (const e of fresh) {
      if (e.type === 'allPass') notify({ tone: 'info', text: 'Tout le monde passe : nouvelle donne' });
      if (e.type === 'ecart' && e.shownTrumps?.length) {
        const list = e.shownTrumps.map(cardName);
        const text = list.length > 1 ? `${list.slice(0, -1).join(', ')} et ${list.at(-1)}` : list[0];
        notify({ tone: 'info', title: 'Atouts écartés', text: `${who(e.playerId)} ${e.playerId === me ? 'écartes' : 'écarte'} ${text}, ${list.length > 1 ? 'montrés' : 'montré'} à tous` });
      }
      if (e.type === 'play' && e.revealsPartner) {
        const c = next.calledCard ?? e.card;
        const called = `${calledDef(c.rank)} ${calledRankName(c.rank)}`;
        if (e.playerId === next.takerId) {
          if (e.playerId !== me) notify({ tone: 'info', title: 'Sans partenaire', text: `${nameOf(e.playerId)} avait ${called} appelé${c.rank === 13 ? 'e' : ''} : pas de partenaire, la donne se joue à 1 contre ${next.players.length - 1}` });
        } else if (e.playerId === me) {
          notify({ tone: 'success', title: 'Partenaire révélé', text: `Tout le monde sait maintenant que tu joues avec ${nameOf(next.takerId)}` });
        } else {
          notify({ tone: 'success', title: 'Partenaire révélé', text: `${nameOf(e.playerId)} joue avec ${next.takerId === me ? 'toi' : nameOf(next.takerId)}` });
        }
      }
    }
    if (!prev.contract && next.contract && next.takerId !== me) {
      notify({ tone: 'info', text: `${nameOf(next.takerId)} prend : ${BID_LABEL[next.contract.id]}` });
    }
    if (fresh.some((e) => e.type === 'playStart') && ['bidding', 'calling'].includes(prev.phase) && next.contract) {
      if (next.contract.id === 'garde_sans') notify({ tone: 'info', text: 'Garde sans le chien : il va au preneur sans être retourné' });
      if (next.contract.id === 'garde_contre') notify({ tone: 'info', text: 'Garde contre le chien : il va à la défense sans être retourné' });
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
