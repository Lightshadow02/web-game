import { lab } from './cards.js';
import {
  viewContext, tableHtml, statusFor, previewFor, actionsHtml, playInfo, summaryDialog, endScreen, scoreSheet, journalHtml,
} from './view.js';
import { rulesDialog } from './rules.js';

/* =====================================================================
 * Interface du Rami, dessinée avec le design system Claude Design « Tapis »
 * (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD), table « salon ».
 * Le système est importé dans public/vendor/tapis/ (bundle.js -> window.Tapis, tapis.css).
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 *   draw, lay, add, swap, cancel, discard, next.
 *
 * Mouvement : chaque nouvel état est d'abord joué sur l'écran affiché (ce qui part : carte
 * prise à la défausse, Joker repris par un adversaire…), puis la table est redessinée depuis
 * l'état reçu, puis ce qui arrive est animé (pioche, combinaisons qui glissent sur la table,
 * ajouts, défausse, fin de donne). Les états reçus pendant une animation attendent leur tour ;
 * s'ils s'accumulent, les animations en cours sont terminées d'un coup (Tapis : .finish()).
 * ===================================================================== */

const TAPIS_JS = '/vendor/tapis/bundle.js';
const TAPIS_CSS = '/vendor/tapis/tapis.css';
const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'tapis.motion'; // partagé par les jeux de cartes
const SORT_KEY = 'rami.sort';

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

function readStore(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* stockage indisponible */ }
}

const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

export function mount(root, ctx) {
  const me = ctx.me.id;
  // tapis.css d'abord, puis nos réglages (qui gagnent aussi par leur spécificité)
  const css = [addCss(TAPIS_CSS), addCss(`${BASE}style.css`)];

  // .tp-scope porte les tokens du système, la table « salon » et l'interrupteur d'animations.
  const host = document.createElement('div');
  host.className = 'tp-scope rm';
  host.dataset.table = 'salon';
  host.dataset.theme = 'salon';
  host.setAttribute('data-motion-host', '');
  const saved = readStore(MOTION_KEY);
  if (saved === 'on' || saved === 'off') host.dataset.motion = saved; // sinon : prefers-reduced-motion décide
  host.innerHTML = '<p class="rm-loading">Ouverture de la table…</p>';
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
  let roomSig = '';
  let viewHtml = '';
  let shape = 'wide';
  const running = new Set(); // animations maison (fantômes), terminées avec celles de Tapis
  const ui = {
    lastEvent: 0,
    dealKey: null,
    sel: [], // cartes choisies dans ma main
    staged: [], // ouverture en préparation : [[ids], …]
    target: null, // combinaison de la table visée (ajout, échange du Joker)
    sort: readStore(SORT_KEY) === 'rank' ? 'rank' : 'suit',
    view: null, // 'summary' | 'end'
    rules: false,
    rulesTab: 'but',
    boxes: {},
  };

  // ================================================================ hauteur et forme : la table tient dans la fenêtre

  function fit() {
    const top = host.getBoundingClientRect().top + window.scrollY;
    const layout = host.closest('.room-layout');
    const pad = layout ? parseFloat(getComputedStyle(layout).paddingBottom) || 0 : 16;
    host.style.height = `${Math.max(320, Math.floor(window.innerHeight - top - pad))}px`;
    const w = (zone ?? host).getBoundingClientRect().width;
    const next = w < 640 ? 'tall' : w < 1100 ? 'square' : 'wide';
    if (next !== shape) {
      shape = next;
      if (state) renderTable();
    }
  }
  fit();
  window.addEventListener('resize', fit);

  const onMotion = (e) => writeStore(MOTION_KEY, e.detail.on ? 'on' : 'off');
  document.addEventListener('tapis:motion', onMotion);

  const onVisibility = () => {
    if (document.hidden && T) finishAll();
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
    host.innerHTML = `<div class="tp-app"><main class="tp-zone" data-zone="game" aria-label="Table de Rami">${decor()}`
      + '<div class="tp-table rm-table"></div>'
      + T.Tools({ buttons: ['journal', 'scores', 'regles', 'animations'] })
      + '<div class="tp-toasts" aria-live="polite"></div>'
      + T.Drawer({ id: 'journal', title: 'Journal', body: '' })
      + T.Drawer({ id: 'scores', title: 'Feuille de scores', className: 'tp-drawer--wide', body: '' })
      + '<div class="rm-layer" data-layer="view"></div><div class="rm-layer" data-layer="rules"></div></main></div>';
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
    if (queued > 1 && T) finishAll(); // les états s'accumulent : on termine tout de suite ce qui est en cours
    // une tâche d'attente : les messages déjà reçus du serveur passent d'abord, et un état dépassé n'est pas dessiné
    chain = chain.then(tick).then(() => step(next)).catch((err) => console.error(err));
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  function finishAll() {
    T?.anim.finishAll();
    for (const a of [...running]) a.finish();
  }

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
    const superseded = queued > 0; // un état déjà dépassé par un plus récent n'est pas dessiné
    const live = !!prev && prev === shown && !gap && fresh.length <= 8;
    const motion = live && !superseded && T.motion.enabled() && !document.hidden;
    setAnimating(true);
    try {
      if (motion) await before(prev, next, fresh).catch((err) => console.error(err));
      if (disposed) return;
      prepare(prev, next, fresh, motion);
      state = next;
      if (superseded) return;
      render();
      if (live) notices(prev, next, fresh);
      if (motion) await after(prev, next, fresh).catch((err) => console.error(err));
      else if (!prev && freshDeal(next) && T.motion.enabled() && !document.hidden) await dealAnim(next).catch((err) => console.error(err));
    } finally {
      if (ui.view === 'pending') {
        ui.view = 'summary';
        if (!disposed && state) renderView();
      }
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

  /** Première donne, rien encore joué : on la distribue en animation. */
  const freshDeal = (s) => s.roundNumber === 1 && s.phase === 'draw' && s.events.length <= 2 && s.events.some((e) => e.type === 'deal');

  /** Met à jour l'état local de l'interface quand la situation change. */
  function prepare(prev, next, fresh, motion = false) {
    const key = `${next.roundNumber}`;
    if (key !== ui.dealKey) Object.assign(ui, { dealKey: key, sel: [], staged: [], target: null });
    const inHand = new Set(next.myHand.map((c) => c.id));
    const myPlay = next.isMyTurn && next.phase === 'play';
    // pose préparée : seulement pendant mon tour, et tant que toutes ses cartes sont en main
    ui.staged = next.isMyTurn ? ui.staged.filter((ids) => ids.every((id) => inHand.has(id))) : [];
    const staged = new Set(ui.staged.flat());
    ui.sel = ui.sel.filter((id) => inHand.has(id) && !staged.has(id));
    const me0 = next.players.find((p) => p.id === me);
    if (!myPlay || !me0?.opened || !next.melds.some((m) => m.id === ui.target)) ui.target = null;
    if (fresh.some((e) => e.playerId === me && ['lay', 'add', 'swap', 'discard'].includes(e.type))) ui.target = null;
    const ended = (s) => s?.phase === 'roundEnd' || s?.phase === 'gameOver';
    if (!ended(next)) ui.view = null;
    else if (!prev) ui.view = next.phase === 'gameOver' ? 'end' : 'summary';
    else if (!ended(prev)) ui.view = motion ? 'pending' : 'summary'; // la sortie se joue d'abord sur la table
  }

  // ================================================================ rendu

  const q = (sel) => zone?.querySelector(sel) ?? null;
  const qa = (sel) => (zone ? [...zone.querySelectorAll(sel)] : []);
  const seatEl = (pid) => q(`.tp-seat[data-seat="${CSS.escape(pid)}"]`);
  const handCard = (id) => q(`.tp-hand [data-card-id="${CSS.escape(id)}"]`);
  const meldCard = (id) => q(`.rm-board [data-card-id="${CSS.escape(id)}"]`);
  const discardTop = () => q('[data-pick="discard"] .tp-pile__stack > .tp-card');
  const stockPile = () => q('[data-pick="stock"] .tp-pile');
  const stockCard = () => q('[data-pick="stock"] .tp-pile__stack > .tp-card');
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
  const view = (s = state) => viewContext(T, s, { me, room: ctx.getRoom(), ui, shape });
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
    const boardScroll = old?.querySelector('.rm-board')?.scrollTop ?? 0;
    const focus = focusKey(document.activeElement);
    const fresh = T.node(tableHtml(view()));
    old.replaceWith(fresh);
    if (scroll) fresh.scrollTop = scroll;
    const board = fresh.querySelector('.rm-board');
    if (board && boardScroll) board.scrollTop = boardScroll;
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
    for (const attr of ['data-card-id', 'data-meld', 'data-act', 'data-pick', 'data-open']) {
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
    layers.rules.innerHTML = ui.rules ? rulesDialog(T, { tab: ui.rulesTab, opening: state?.opening ?? 51 }) : '';
    if (!ui.rules) return;
    T.interact.tabs(layers.rules);
    layers.rules.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  /** Mise à jour sans redessiner la main (le focus clavier y reste) : statut, aperçu et actions. */
  function updateSelectionUi() {
    const v = view();
    const st = q('[data-area="status"]');
    if (st) {
      const p = previewFor(v);
      st.innerHTML = T.Status(statusFor(v)) + (p ? T.ComboPreview(p) : '');
    }
    const ac = q('[data-area="actions"]');
    if (ac) ac.innerHTML = actionsHtml(v);
  }

  // ================================================================ main (souris + clavier)

  function wireHand(table) {
    const hand = table.querySelector('.tp-hand');
    if (!hand || !hand.querySelector('button.tp-card')) return;
    const api = T.interact.hand(hand, {
      multi: true,
      onChange: (ids) => {
        ui.sel = ids;
        updateSelectionUi();
      },
    });
    // Échap vide la sélection sans prévenir : on se resynchronise ; Entrée lance l'action principale
    hand.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        queueMicrotask(() => {
          ui.sel = api.selected();
          updateSelectionUi();
        });
      }
    });
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
      // « Donne suivante » cliqué en même temps qu'un autre joueur : sa demande est passée
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

  function openRanking() {
    ui.view = 'end';
    renderView();
    renderTable();
    local(async (motion) => {
      const end = q('.tp-end');
      if (motion && end) await go(T.anim.ranking(end));
    });
  }

  function draw(from) {
    const s = state;
    if (!s?.isMyTurn || s.phase !== 'draw') return;
    if (from === 'discard' && (!s.discardTop || s.turn.noDiscard)) return;
    send('draw', { from });
  }

  /** Action de jeu de mon tour, d'après la sélection et la combinaison visée. */
  function playAction(a, el) {
    const v = view();
    const info = playInfo(v);
    switch (a) {
      case 'draw-stock': return draw('stock');
      case 'draw-discard': return draw('discard');
      case 'lay':
        if (info.res?.ok) send('lay', { melds: [info.sel.map((c) => c.id)] });
        return undefined;
      case 'stage':
        if (!info.res?.ok) return undefined;
        ui.staged.push(info.sel.map((c) => c.id));
        ui.sel = [];
        renderTable();
        return undefined;
      case 'open': {
        const melds = info.staged.map((cs) => cs.map((c) => c.id));
        if (info.res?.ok) melds.push(info.sel.map((c) => c.id));
        if (!melds.length) return undefined;
        send('lay', { melds }).then((ok) => {
          if (ok) ui.staged = [];
        });
        return undefined;
      }
      case 'add':
        if (info.target && info.sel.length) send('add', { meldId: info.target.id, cardIds: info.sel.map((c) => c.id) });
        return undefined;
      case 'swap':
        if (info.target && info.sel.length === 1) send('swap', { meldId: info.target.id, cardId: info.sel[0].id });
        return undefined;
      case 'discard':
        if (info.sel.length === 1) send('discard', { cardId: info.sel[0].id });
        return undefined;
      case 'cancel':
        if (el.dataset.card) send('cancel', { cardId: el.dataset.card });
        return undefined;
      default:
        return undefined;
    }
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
    const pick = t.closest('[data-pick]');
    if (pick && zone.contains(pick)) {
      if (!animating && !busy && pick.getAttribute('aria-disabled') !== 'true') draw(pick.dataset.pick);
      return;
    }
    const meld = t.closest('button.rm-meld');
    if (meld && zone.contains(meld)) {
      if (animating) return;
      ui.target = ui.target === meld.dataset.meld ? null : meld.dataset.meld;
      renderTable();
      q(`button.rm-meld[data-meld="${CSS.escape(meld.dataset.meld)}"]`)?.focus({ preventScroll: true });
      return;
    }
    const act = t.closest('[data-act]');
    if (!act || !zone.contains(act) || act.getAttribute('aria-disabled') === 'true') return;
    const a = act.dataset.act;
    // ---- interface locale (permise pendant une animation)
    switch (a) {
      case 'sort-suit':
      case 'sort-rank': {
        const mode = a === 'sort-rank' ? 'rank' : 'suit';
        if (ui.sort === mode) return;
        ui.sort = mode;
        writeStore(SORT_KEY, mode);
        sortHandAnimated();
        return;
      }
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
      case 'untarget':
        ui.target = null;
        renderTable();
        return;
      case 'unstage': {
        const i = Number(act.dataset.i);
        ui.staged.splice(i, 1);
        renderTable();
        return;
      }
      default:
    }
    // ---- actions de jeu : pas pendant une transition ni une requête en cours
    if (animating || busy) return;
    playAction(a, act);
  }

  /** Changement de tri : les cartes glissent vers leur nouvelle place. */
  function sortHandAnimated() {
    const before = qa('.tp-hand [data-card-id]').map((c) => c.dataset.cardId);
    if (animating) {
      renderTable();
      return;
    }
    local(async (motion) => {
      renderTable(true);
      const hand = q('.tp-hand');
      if (motion && hand && before.length) await go(T.anim.sort(hand, { order: before }));
    });
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
    if (e.key === 'Enter' && e.target.closest?.('[data-pick]')) {
      e.preventDefault();
      e.target.closest('[data-pick]').click();
      return;
    }
    if (e.key === ' ' && e.target.closest?.('[data-pick]')) {
      e.preventDefault();
      e.target.closest('[data-pick]').click();
      return;
    }
    if (e.key !== 'Escape' || !state || e.target.closest?.('.tp-hand')) return;
    if (ui.rules) closeTool('regles');
    else if (ui.view === 'summary') closeTool('resume');
    else if (q('.tp-drawer[data-open]')) closeDrawers();
    else if (ui.target) {
      ui.target = null;
      renderTable();
    }
  }

  // ================================================================ animations maison (fantômes)

  /** Un fantôme de la carte el file vers la cible (adversaire qui prend une carte de la table). */
  function fly(el, to, { delay = 0 } = {}) {
    if (!visible(el) || !visible(to)) return Promise.resolve();
    const z = zone.getBoundingClientRect();
    const a = el.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const ghost = el.cloneNode(true);
    ghost.classList.add('rm-ghost');
    Object.assign(ghost.style, {
      position: 'absolute', left: `${a.left - z.left}px`, top: `${a.top - z.top}px`, width: `${a.width}px`, height: `${a.height}px`, margin: '0',
    });
    ghost.style.setProperty('--ch', `${a.height}px`);
    zone.append(ghost);
    el.style.visibility = 'hidden';
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const anim = ghost.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(.9) rotate(-4deg)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(.45) rotate(6deg)`, opacity: 0 },
    ], { duration: 560, delay, easing: 'cubic-bezier(.65, 0, .35, 1)', fill: 'forwards' });
    running.add(anim);
    return anim.finished.catch(() => {}).then(() => {
      running.delete(anim);
      ghost.remove();
    });
  }

  // ================================================================ animations : avant le rendu (écran affiché)

  async function before(prev, next, fresh) {
    // où était chaque carte visible (main, combinaisons, défausse, pose préparée) : les vols partent de là
    ui.boxes = {};
    for (const el of qa('.tp-table [data-card-id]')) {
      const id = el.dataset.cardId;
      if (!ui.boxes[id] && visible(el)) ui.boxes[id] = boxIn(el);
    }
    const jobs = [];
    for (const e of fresh) {
      if (e.playerId === me) continue;
      // un adversaire prend la carte de la défausse, ou reprend un Joker : elle file vers lui
      if (e.type === 'draw' && e.from === 'discard') {
        const top = discardTop();
        const to = fromSeat(e.playerId);
        if (top && to) jobs.push(fly(top, to));
      }
      if (e.type === 'swap') {
        const j = meldCard(e.joker.id);
        const to = fromSeat(e.playerId);
        if (j && to) jobs.push(fly(j, to, { delay: 380 })); // après l'arrivée de la vraie carte
      }
    }
    await Promise.all(jobs);
  }

  // ================================================================ animations : après le rendu (nouvel écran)

  async function after(prev, next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    if (has('deal')) {
      await dealAnim(next);
      return;
    }
    if (has('reshuffle')) {
      const pile = stockPile();
      if (visible(pile)) await go(T.anim.shuffle(pile));
    }
    const jobs = [];
    const from = (pid, id) => (pid === me ? ui.boxes[id] : null) ?? fromSeat(pid);
    const land = (el, pid, id, delay = 0, flip = pid !== me) => {
      const src = from(pid, id);
      if (visible(el) && src) jobs.push(go(T.anim.play(el, { from: src, flip, delay })));
    };
    for (const e of fresh) {
      switch (e.type) {
        case 'draw': {
          if (e.playerId === me) {
            const gained = next.myHand.filter((c) => !prev.myHand.some((x) => x.id === c.id));
            const els = gained.map((c) => handCard(c.id)).filter(visible);
            if (e.from === 'discard') els.forEach((el) => land(el, me, el.dataset.cardId));
            else if (els.length && visible(stockPile())) jobs.push(go(T.anim.draw(stockPile(), els, { from: prev.stockCount, to: next.stockCount })));
          } else if (e.from === 'stock') {
            const src = stockCard();
            const seat = fromSeat(e.playerId);
            if (visible(src) && seat) jobs.push(go(T.anim.drawTo(src, seat)));
          }
          break;
        }
        case 'lay': {
          let k = 0;
          for (const m of e.melds) for (const c of m.cards) land(meldCard(c.id), e.playerId, c.id, 70 * k++);
          break;
        }
        case 'add':
          e.cards.forEach((c, k) => land(meldCard(c.id), e.playerId, c.id, 90 * k));
          break;
        case 'swap':
          land(meldCard(e.card.id), e.playerId, e.card.id);
          if (e.playerId === me) {
            const j = handCard(e.joker.id);
            if (visible(j) && ui.boxes[e.joker.id]) jobs.push(go(T.anim.play(j, { from: ui.boxes[e.joker.id], delay: 200 })));
          }
          break;
        case 'cancel':
          if (e.kind === 'discard') land(discardTop(), e.playerId, e.card.id, 0, false);
          else {
            // échange annulé : le Joker retourne sur la table, la carte dans la main
            const j = next.melds.find((m) => m.id === e.meldId)?.cards.find((c) => c.joker);
            if (j) land(meldCard(j.id), e.playerId, j.id, 0, false);
            if (e.playerId === me) {
              const c = handCard(e.card.id);
              if (visible(c) && ui.boxes[e.card.id]) jobs.push(go(T.anim.play(c, { from: ui.boxes[e.card.id] })));
            }
          }
          break;
        case 'discard':
          land(discardTop(), e.playerId, e.card.id);
          break;
        default:
      }
    }
    // le halo du tour passe au joueur suivant (sans attendre)
    if (prev.currentPlayerId && next.currentPlayerId && prev.currentPlayerId !== next.currentPlayerId) {
      const a = seatEl(prev.currentPlayerId);
      const b = seatEl(next.currentPlayerId);
      if (visible(a) && visible(b) && b.dataset.state === 'active') T.anim.run('turn', () => T.anim.turn(a, b));
    }
    await Promise.all(jobs);
    // sortie : une bulle sur le siège du gagnant, puis le résumé de la donne
    const out = fresh.find((e) => e.type === 'out');
    if (out) {
      const seat = seatEl(out.playerId);
      if (visible(seat)) {
        seat.querySelector(':scope > .tp-bubble')?.remove();
        seat.insertAdjacentHTML('afterbegin', T.Bubble({ text: out.rami ? 'Rami !' : 'Fini !' }));
        await go(T.anim.bubble(seat.querySelector(':scope > .tp-bubble')));
        await pause(700);
      }
    }
    if (ui.view === 'pending') {
      ui.view = 'summary';
      renderView();
      renderTable(true);
      const deal = q('.tp-deal');
      if (deal) await go(T.anim.summary(deal));
    }
  }

  /** Courte pause (écourtée si des états s'accumulent). */
  function pause(ms) {
    if (queued > 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Donne : le talon se mélange, puis part en paquets de 3 vers chaque siège ; ma main se retourne, puis la défausse. */
  async function dealAnim(s) {
    const pile = stockPile();
    const src = stockCard();
    const hand = q('.tp-hand');
    const top = discardTop();
    if (!visible(src) || !hand) return;
    hand.style.visibility = 'hidden';
    if (top) top.style.visibility = 'hidden';
    try {
      await go(T.anim.shuffle(pile));
      const targets = s.players.filter((p) => p.id !== me).map((p) => {
        const seat = seatEl(p.id);
        const el = visible(seat?.querySelector('.tp-fan')) ? seat : seat?.querySelector('.tp-avatar');
        return visible(el) ? { el, n: p.cardCount } : null;
      }).filter(Boolean);
      const tl = T.anim.deal(src, targets, { hand, packet: 3 });
      hand.style.visibility = '';
      await go(tl);
      if (top) {
        top.style.visibility = '';
        await go(T.anim.play(top, { from: src, flip: true }));
      }
    } finally {
      hand.style.visibility = '';
      if (top) top.style.visibility = '';
    }
  }

  // ================================================================ notifications de table

  function notices(prev, next, fresh) {
    for (const e of fresh) {
      const who = e.playerId === me ? 'Tu' : nameOf(e.playerId);
      if (e.type === 'lay' && e.opened) {
        notify({ tone: e.playerId === me ? 'success' : 'info', title: 'Ouverture', text: `${who} ${e.playerId === me ? 'ouvres' : 'ouvre'} avec ${e.value} points` });
      }
      if (e.type === 'draw' && e.from === 'discard' && e.playerId !== me) {
        notify({ tone: 'info', text: `${who} prend ${lab(e.card)} à la défausse` });
      }
      if (e.type === 'swap' && e.playerId !== me) {
        notify({ tone: 'info', text: `${who} échange un Joker contre ${lab(e.card)}` });
      }
      if (e.type === 'reshuffle') notify({ tone: 'info', title: 'Talon épuisé', text: `La défausse est mélangée : ${e.count} cartes` });
      if (e.type === 'out') {
        const text = e.playerId === me ? 'Tu n’as plus de cartes' : `${who} n’a plus de cartes`;
        notify(e.rami ? { tone: 'success', title: 'Rami !', text: `${text} : pénalités doublées` } : { tone: 'success', title: 'Fin de la donne', text });
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
      window.removeEventListener('resize', fit);
      document.removeEventListener('tapis:motion', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      finishAll();
      css.forEach((c) => c.link.remove());
      host.remove();
    },
  };
}
