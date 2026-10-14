import { tp, fmt, bubbleText } from './cards.js';
import {
  viewContext, tableHtml, raiseLabel, lastHandDialog, endScreen, journalHtml, chipsHtml, potGroups,
} from './view.js';
import { rulesDialog } from './rules.js';

/* =====================================================================
 * Interface du Poker Texas Hold'em, dessinée avec le design system Claude Design
 * « Tapis » (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD), table « salon ».
 * Le système est importé dans public/vendor/tapis/ (bundle.js -> window.Tapis, tapis.css).
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 *   fold, check, call, raise { amount: total "relancer à" }, allin, next.
 *
 * Mouvement : chaque nouvel état est d'abord joué sur l'écran affiché (jetons vers la
 * mise, cartes au rebut, mises vers le pot, tableau qui sort, mains retournées, pot
 * vers le gagnant…), puis la table est redessinée depuis l'état reçu, puis ce qui
 * arrive est animé (distribution, blindes, bouton du donneur, halo du tour).
 * Les états reçus pendant une animation attendent leur tour ; s'ils s'accumulent,
 * les animations en cours sont terminées d'un coup (Tapis : .finish()).
 * ===================================================================== */

const TAPIS_JS = '/vendor/tapis/bundle.js';
const TAPIS_CSS = '/vendor/tapis/tapis.css';
const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'tapis.motion'; // partagé par les jeux de cartes

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
  host.className = 'tp-scope pk';
  host.dataset.table = 'salon';
  host.dataset.theme = 'salon';
  host.setAttribute('data-motion-host', '');
  const saved = readMotion();
  if (saved === 'on' || saved === 'off') host.dataset.motion = saved; // sinon : prefers-reduced-motion décide
  host.innerHTML = '<p class="pk-loading">Ouverture de la table…</p>';
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
  let wake = null; // interrompt une pause
  let roomSig = '';
  let shape = 'wide';
  const ui = {
    lastEvent: 0,
    raiseTo: 0,
    raiseKey: null,
    bubbles: {},
    view: null, // 'end'
    dialog: null, // 'derniere-main'
    rules: false,
    rulesTab: 'tournoi',
    dealerFrom: null,
  };

  // ================================================================ hauteur : la table tient dans la fenêtre

  function fit() {
    const top = host.getBoundingClientRect().top + window.scrollY;
    const layout = host.closest('.room-layout');
    const pad = layout ? parseFloat(getComputedStyle(layout).paddingBottom) || 0 : 16;
    host.style.height = `${Math.max(320, Math.floor(window.innerHeight - top - pad))}px`;
  }
  /** Forme de la zone : large (PC 16:9), carrée (tablette, petite fenêtre) ou haute (téléphone). */
  function measureShape() {
    if (!zone) return shape;
    const r = zone.getBoundingClientRect();
    const ratio = r.width / Math.max(1, r.height);
    return ratio >= 1.32 ? 'wide' : ratio >= 0.86 ? 'square' : 'tall';
  }
  function onResize() {
    fit();
    const next = measureShape();
    if (next !== shape) {
      shape = next;
      renderTable();
    }
  }
  fit();
  window.addEventListener('resize', onResize);

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
    const last = T.Button({ variant: 'icon', icon: 'eye', label: 'Dernière main', attrs: { 'data-open': 'derniere-main' } });
    const tools = T.Tools({ buttons: ['journal', 'regles', 'animations'] }).replace(/(<nav class="tp-tools"[^>]*>)/, `$1${last}`);
    host.innerHTML = `<div class="tp-app"><main class="tp-zone" data-zone="game" aria-label="Table de poker">${decor()}`
      + '<div class="pk-table"></div>'
      + tools
      + '<div class="tp-toasts" aria-live="polite"></div>'
      + T.Drawer({ id: 'journal', title: 'Journal', body: '' })
      + '<div class="pk-layer" data-layer="dialog"></div><div class="pk-layer" data-layer="view"></div><div class="pk-layer" data-layer="rules"></div></main></div>';
    zone = host.querySelector('.tp-zone');
    layers = {
      dialog: zone.querySelector('[data-layer="dialog"]'),
      view: zone.querySelector('[data-layer="view"]'),
      rules: zone.querySelector('[data-layer="rules"]'),
    };
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    host.addEventListener('input', onInput);
    host.addEventListener('change', onChange);
    // la zone ne défile jamais (overflow: hidden) : un focus sur un tiroir en mouvement pourrait la décaler
    for (const el of [zone, host.querySelector('.tp-app')]) {
      el.addEventListener('scroll', () => {
        if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0);
      });
    }
    fit();
    shape = measureShape();
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
    if (!tl) return Promise.resolve();
    if (queued > 0) tl.finish();
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
    const live = !!prev && prev === shown && !gap && fresh.length <= 16;
    const motion = live && !superseded && T.motion.enabled() && !document.hidden;
    setAnimating(true);
    try {
      if (motion) await before(prev, next, fresh).catch((err) => console.error(err));
      if (disposed) return;
      prepare(prev, next, fresh);
      state = next;
      if (superseded) return;
      shape = measureShape();
      render();
      if (live) notices(prev, next, fresh);
      if (motion) await after(prev, next, fresh).catch((err) => console.error(err));
      else if (!prev && next.handNumber === 1 && next.phase === 'betting' && T.motion.enabled() && !document.hidden) {
        await dealAnim(next).catch((err) => console.error(err));
      }
    } finally {
      ui.dealerFrom = null;
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

  /** Pause (lecture d'un abattage), écourtée si d'autres états arrivent. */
  function hold(ms) {
    if (queued > 0 || !T.motion.enabled()) return Promise.resolve();
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

  /** Met à jour l'état local de l'interface quand la situation change. */
  function prepare(prev, next, fresh) {
    // bulles : la dernière action de chacun dans ce lot, si aucune carte n'est sortie depuis
    ui.bubbles = {};
    const lastStreet = fresh.map((e) => e.type).lastIndexOf('street');
    fresh.forEach((e, i) => {
      if (e.type === 'action' && i > lastStreet && next.phase === 'betting') ui.bubbles[e.playerId] = bubbleText(e);
    });
    // montant proposé pour relancer : la relance minimum, à chaque nouvelle situation
    if (next.isMyTurn && next.me) {
      const key = `${next.handNumber}:${next.street}:${next.currentBet}:${next.me.minRaiseTo}:${next.me.maxRaiseTo}`;
      if (key !== ui.raiseKey) {
        ui.raiseKey = key;
        ui.raiseTo = next.me.minRaiseTo;
      }
    }
    if (next.phase !== 'gameOver') ui.view = null;
    else if (!prev || prev.phase !== 'gameOver') ui.view = 'end';
  }

  // ================================================================ rendu

  const q = (sel) => zone?.querySelector(sel) ?? null;
  const qa = (sel) => (zone ? [...zone.querySelectorAll(sel)] : []);
  const plateEl = (pid) => q(`.pk-plate[data-seat="${CSS.escape(pid)}"]`);
  const holeEl = (pid) => q(`.pk-hole[data-hole="${CSS.escape(pid)}"]`);
  const betEl = (pid) => q(`.pk-bet[data-bet="${CSS.escape(pid)}"]`);
  /** Boîte relative à la zone, pour Tapis.anim.play({ from }) (un DOMRect ne convient pas). */
  const boxIn = (el) => {
    const z = zone.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const b = { x: r.left - z.left, y: r.top - z.top, w: r.width, h: r.height };
    b.cx = b.x + b.w / 2;
    b.cy = b.y + b.h / 2;
    return b;
  };
  /** Le croupier : un point au-dessus du tableau, d'où partent les cartes. */
  const dealerBox = () => {
    const z = zone.getBoundingClientRect();
    const board = q('.pk-board');
    const b = board ? boxIn(board) : { cx: z.width / 2, y: z.height * 0.4 };
    const w = Math.max(30, (q('.pk-board .tp-card')?.getBoundingClientRect().width ?? 60) * 0.6);
    const h = w * 1.4;
    const cx = b.cx;
    const cy = Math.max(h, b.y - h * 1.2);
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
  };
  const view = (s = state) => viewContext(T, s, { me, room: ctx.getRoom(), ui, shape });
  const nameOf = (pid) => view(state ?? latest).nameOf(pid);

  function render() {
    if (!T || !state || disposed) return;
    shown = state;
    renderTable(true);
    renderView();
    renderDialog();
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
    const old = q('.pk-table');
    const focus = focusKey(document.activeElement);
    const fresh = T.node(tableHtml(view()));
    old.replaceWith(fresh);
    if (focus) fresh.querySelector(focus)?.focus({ preventScroll: true });
  }

  /** Retrouve après un rendu le contrôle qui avait le focus (clavier). */
  function focusKey(el) {
    if (!el || !zone?.contains(el) || !el.closest('.pk-table')) return null;
    if (el.matches('.pk-range')) return '.pk-range';
    if (el.matches('.pk-amount input')) return '.pk-amount input';
    for (const attr of ['data-act', 'data-q', 'data-step', 'data-open']) {
      if (el.hasAttribute(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    }
    return null;
  }

  let viewHtml = '';
  function renderView() {
    const html = ui.view === 'end' && state.phase === 'gameOver' ? endScreen(view()) : '';
    if (html === viewHtml) return;
    viewHtml = html;
    layers.view.innerHTML = html;
    if (html) layers.view.querySelector('.tp-end .tp-btn')?.focus({ preventScroll: true });
  }

  let dialogHtml = '';
  function renderDialog() {
    const html = ui.dialog === 'derniere-main' ? lastHandDialog(view()) : '';
    if (html === dialogHtml) return;
    dialogHtml = html;
    layers.dialog.innerHTML = html;
    if (html) layers.dialog.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  const drawerHtml = new Map();
  function renderDrawers() {
    const html = journalHtml(view());
    const body = q('#journal.tp-drawer .tp-drawer__b');
    if (!body || drawerHtml.get('journal') === html) return;
    drawerHtml.set('journal', html);
    body.innerHTML = html;
  }

  function renderRules() {
    layers.rules.innerHTML = ui.rules ? rulesDialog(T, { tab: ui.rulesTab }) : '';
    if (!ui.rules) return;
    T.interact.tabs(layers.rules);
    layers.rules.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  // ================================================================ montant de la relance (sans redessiner la table)

  function clampRaise(x) {
    const m = state?.me;
    if (!m) return 0;
    const n = Math.round(Number(x));
    if (!Number.isFinite(n)) return ui.raiseTo;
    return Math.max(m.minRaiseTo, Math.min(m.maxRaiseTo, n));
  }

  function setRaise(x, { fromInput = false } = {}) {
    ui.raiseTo = clampRaise(x);
    const range = q('.pk-range');
    const input = q('.pk-amount input');
    if (range) {
      range.value = String(ui.raiseTo);
      range.setAttribute('aria-valuetext', fmt(ui.raiseTo));
    }
    if (input && !fromInput) input.value = String(ui.raiseTo);
    const label = q('[data-act="raise"] span');
    if (label) label.textContent = raiseLabel(state, ui.raiseTo);
    for (const b of qa('[data-q]')) b.setAttribute('aria-pressed', String(Number(b.dataset.size) === ui.raiseTo));
  }

  function onInput(e) {
    if (!state?.isMyTurn) return;
    if (e.target.matches('.pk-range')) {
      const m = state.me;
      const v = Number(e.target.value);
      // le curseur avance de petite blinde en petite blinde : le haut de la course vaut le tapis
      setRaise(v + Math.max(1, state.blinds.sb) > m.maxRaiseTo ? m.maxRaiseTo : v);
    } else if (e.target.matches('.pk-amount input')) {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v >= state.me.minRaiseTo && v <= state.me.maxRaiseTo) setRaise(v, { fromInput: true });
    }
  }

  function onChange(e) {
    if (state?.isMyTurn && e.target.matches('.pk-amount input')) setRaise(e.target.value);
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
      // « Main suivante » cliqué en même temps qu'un autre joueur : la nouvelle main est déjà là
      if (type === 'next' && latest?.phase !== 'handEnd') return false;
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

  function act(type) {
    if (busy || animating || !state?.isMyTurn || state.phase !== 'betting') return;
    const m = state.me;
    if (type === 'raise') {
      if (!m.canRaise) return;
      const amount = m.minRaiseTo >= m.maxRaiseTo ? m.maxRaiseTo : clampRaise(q('.pk-amount input')?.value ?? ui.raiseTo);
      if (amount >= m.maxRaiseTo) send('allin');
      else send('raise', { amount });
      return;
    }
    send(type);
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
    const ctl = t.closest('[data-act], [data-q], [data-step]');
    if (!ctl || !zone.contains(ctl) || ctl.getAttribute('aria-disabled') === 'true') return;
    if (ctl.dataset.q) {
      setRaise(Number(ctl.dataset.size));
      return;
    }
    if (ctl.dataset.step) {
      setRaise(ui.raiseTo + Number(ctl.dataset.step) * state.blinds.bb);
      return;
    }
    switch (ctl.dataset.act) {
      case 'ranking':
        openRanking();
        return;
      case 'close-end':
        ui.view = null;
        renderView();
        renderTable();
        return;
      case 'next':
        if (state.phase === 'handEnd' && state.canNext && !busy) send('next');
        return;
      case 'fold':
      case 'check':
      case 'call':
      case 'raise':
        act(ctl.dataset.act);
        return;
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
      if (on) drawer.querySelector('[data-close]')?.focus({ preventScroll: true });
      else button?.focus({ preventScroll: true });
      return;
    }
    if (id === 'regles') {
      ui.rules = true;
      renderRules();
    } else if (id === 'derniere-main') {
      ui.dialog = ui.dialog === id ? null : id;
      renderDialog();
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
    } else if (id === 'derniere-main') {
      ui.dialog = null;
      renderDialog();
      q('.tp-tools [data-open="derniere-main"]')?.focus({ preventScroll: true });
    }
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === 'Enter' && e.target.matches?.('.pk-amount input')) {
      e.preventDefault();
      setRaise(e.target.value);
      act('raise');
      return;
    }
    if (e.key !== 'Escape') return;
    if (ui.rules) closeTool('regles');
    else if (ui.dialog) closeTool('derniere-main');
    else if (q('.tp-drawer[data-open]')) closeDrawers();
  }

  // ================================================================ animations maison (Web Animations, via les timelines Tapis)

  /** Une couche d'effets posée sur la zone, retirée avec la timeline. */
  function fxLayer(tl) {
    const l = document.createElement('div');
    l.className = 'tp-fx';
    l.setAttribute('aria-hidden', 'true');
    zone.append(l);
    return tl.node(l);
  }

  /** Des jetons qui glissent d'un élément à un autre (mise, pot, gains). */
  function flyChips(from, to, amount, { delay = 0, duration = 460, hide = null } = {}) {
    const tl = new T.Timeline({ delay });
    if (!tl.on || !visible(from) || !visible(to) || amount <= 0) return tl.start();
    const lay = fxLayer(tl);
    const a = boxIn(from);
    const b = boxIn(to);
    const g = T.node(chipsHtml(amount, { label: false, max: 5 }));
    g.classList.add('pk-ghost');
    g.style.cssText = `position:absolute;left:${b.cx}px;top:${b.cy}px;translate:-50% -50%`;
    lay.append(g);
    const dx = a.cx - b.cx;
    const dy = a.cy - b.cy;
    tl.add(g, [
      { transform: `translate(${dx}px, ${dy}px) scale(.85)`, opacity: 0 },
      { transform: `translate(${dx * 0.85}px, ${dy * 0.85 - 10}px) scale(1)`, opacity: 1, offset: 0.18 },
      { transform: 'translate(0, -6px) scale(1.04)', opacity: 1, offset: 0.85 },
      { transform: 'none', opacity: 0 },
    ], { duration, easing: T.motion.ease.inOut });
    if (hide) tl.add(hide, [{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], { duration, easing: 'linear' });
    return tl.start();
  }

  /** Texte qui s'élève (gain). */
  function floatText(target, text, { delay = 0 } = {}) {
    const tl = new T.Timeline({ delay });
    if (!tl.on || !visible(target)) return tl.start();
    const lay = fxLayer(tl);
    const b = boxIn(target);
    const s = document.createElement('span');
    s.className = 'tp-float tp-float--gold pk-float';
    s.textContent = text;
    s.style.cssText = `left:${b.cx}px;top:${b.y}px`;
    lay.append(s);
    tl.add(s, [
      { transform: 'translate(-50%, 6px) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, -14px) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -26px) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -40px) scale(1)', opacity: 0 },
    ], { duration: 1300, easing: T.motion.ease.out });
    return tl.start();
  }

  /** Cartes jetées au rebut (couché, table débarrassée) : elles glissent vers le croupier et s'effacent. */
  function muck(cards, { delay = 0 } = {}) {
    const tl = new T.Timeline({ delay });
    const list = cards.filter(visible);
    if (!tl.on || !list.length) return tl.start();
    const lay = fxLayer(tl);
    const d = dealerBox();
    list.forEach((c, i) => {
      const a = boxIn(c);
      const g = c.cloneNode(true);
      g.classList.add('tp-ghost');
      g.removeAttribute('id');
      g.style.cssText = `position:absolute;left:${a.x}px;top:${a.y}px;width:${a.w}px;height:${a.h}px;--ch:${a.h}px;margin:0;`;
      lay.append(g);
      c.style.visibility = 'hidden';
      const dx = d.cx - a.cx;
      const dy = d.cy - a.cy;
      tl.add(g, [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6 - 14}px) rotate(${i % 2 ? 14 : -10}deg) scale(.7)`, opacity: 0.9, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${i % 2 ? 24 : -18}deg) scale(.45)`, opacity: 0 },
      ], { duration: 420, delay: i * 40, easing: T.motion.ease.in });
    });
    return tl.start();
  }

  /**
   * Une carte arrive à sa place depuis le croupier : un dos vole jusqu'à elle, puis, si elle doit être vue,
   * elle se retourne sur place. (Contournement : le fantôme de Tapis.anim.play porte toujours la classe
   * is-flipping, qui rend la face visible pendant le vol, même pour une carte de dos ou avec flip: true.)
   */
  function flyIn(card, { from, delay = 0, duration = 400, faceUp = false } = {}) {
    const tl = new T.Timeline({ delay });
    const jobs = [];
    if (tl.on && visible(card)) {
      const lay = fxLayer(tl);
      const b = boxIn(card);
      const g = T.node(T.Back({ size: 'md' }));
      g.classList.add('tp-ghost');
      g.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;--ch:${b.h}px;margin:0;`;
      lay.append(g);
      const s0 = from.w / b.w;
      const dx = from.cx - b.cx;
      const dy = from.cy - b.cy;
      const turn = dx < 0 ? 10 : -10;
      tl.add(g, [
        { transform: `translate(${dx}px, ${dy}px) rotate(${-turn}deg) scale(${s0})`, opacity: 0 },
        { transform: `translate(${dx * 0.85}px, ${dy * 0.85}px) rotate(${-turn}deg) scale(${s0})`, opacity: 1, offset: 0.12 },
        { transform: `translate(${dx * 0.4}px, ${dy * 0.4 - 26}px) rotate(${turn * 0.4}deg) scale(${((s0 + 1) / 2) * 1.06})`, opacity: 1, offset: 0.55 },
        { transform: 'none', opacity: 1 },
      ], { duration, easing: T.motion.ease.out });
      tl.add(card, [{ opacity: 0 }, { opacity: 0, offset: 0.999 }, { opacity: 1 }], { duration, easing: 'linear' });
    }
    jobs.push(go(tl.start()));
    if (faceUp) jobs.push(go(T.anim.flip(card, { up: true, delay: delay + duration, duration: 320 })));
    return Promise.all(jobs);
  }

  /** Une bulle d'annonce qui éclot au-dessus d'une plaque. */
  function popBubble(pid, b) {
    const plate = plateEl(pid);
    if (!visible(plate) || !b) return null;
    plate.querySelector(':scope > .tp-bubble')?.remove();
    plate.insertAdjacentHTML('afterbegin', T.Bubble(b));
    return T.anim.bubble(plate.querySelector(':scope > .tp-bubble'));
  }

  // ================================================================ avant le rendu : on rejoue sur l'écran affiché

  async function before(prev, next, fresh) {
    // pendant que l'écran rejoue ce qui vient d'arriver : plus de boutons ni de halo de tour (l'état suivant les remettra)
    const act = q('.pk-act');
    if (act) act.innerHTML = T.Status(transitionStatus(next, fresh));
    for (const plate of qa('.pk-plate[data-state="active"]')) {
      plate.setAttribute('data-state', 'waiting');
      plate.querySelector('.tp-avatar')?.setAttribute('data-state', 'waiting');
      const turn = plate.querySelector('.tp-seat__turn');
      if (turn) turn.textContent = '';
    }
    if (fresh.some((e) => e.type === 'hand')) {
      // nouvelle main : la table se débarrasse (cartes au rebut, résultat effacé), le bouton glissera
      const d = q('.pk-dealer');
      if (visible(d)) ui.dealerFrom = boxIn(d);
      q('.pk-result')?.remove();
      const cards = qa('.pk-board .tp-card:not(.tp-card--slot), .pk-hole .tp-card');
      await go(muck(cards));
      return;
    }
    const vm = {
      chips: Object.fromEntries(prev.players.map((p) => [p.id, p.chips])),
      bets: Object.fromEntries(prev.players.map((p) => [p.id, prev.phase === 'betting' ? p.bet : 0])),
      revealed: new Set(prev.players.filter((p) => p.cards && (p.shown || p.id === me)).map((p) => p.id)),
    };
    let streets = 0;
    for (const e of fresh) {
      if (disposed) return;
      switch (e.type) {
        case 'action':
          await actionBefore(e, vm);
          break;
        case 'uncalled':
          await uncalledBefore(e, vm);
          break;
        case 'collect':
          await collectBefore(e, vm);
          break;
        case 'reveal':
          await revealBefore(e.hands, vm);
          await hold(380);
          break;
        case 'street':
          if (streets++) await hold(380); // déroulement à tapis : on laisse lire chaque carte
          await streetBefore(e, prev);
          break;
        case 'showdown':
          await showdownBefore(e, next, vm);
          break;
        case 'win':
          await winBefore(e, vm);
          break;
        case 'eliminated':
          for (const x of e.players) plateEl(x.playerId)?.setAttribute('data-out', '');
          break;
        default:
      }
    }
  }

  /** Statut neutre pendant la relecture (sans dévoiler le gagnant avant l'abattage). */
  function transitionStatus(next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    if (has('hand')) return { tone: 'info', text: 'Nouvelle main', detail: `Main ${next.handNumber}` };
    if (has('showdown')) return { tone: 'info', text: 'Abattage', detail: 'Les mains se montrent' };
    if (has('reveal')) return { tone: 'info', text: 'Tapis', detail: 'Les mains se retournent, le tableau sort' };
    if (has('win')) return { tone: 'info', text: 'Fin de la main' };
    const street = fresh.filter((e) => e.type === 'street').at(-1);
    if (street) return { tone: 'info', text: { flop: 'Flop', turn: 'Turn', river: 'River' }[street.street] };
    const a = fresh.find((e) => e.type === 'action');
    if (a) return { tone: 'wait', text: a.playerId === me ? 'C’est noté' : `${nameOf(a.playerId)} a parlé` };
    return { tone: 'info', text: 'Un instant…' };
  }

  function setStack(pid, from, to, delay = 0) {
    const node = plateEl(pid)?.querySelector('.pk-plate__v');
    if (!node) return null;
    return T.anim.swapText(node, fmt(from), fmt(to), { delay });
  }

  function setBet(pid, amount) {
    const el = betEl(pid);
    if (!el) return null;
    el.innerHTML = amount > 0 ? chipsHtml(amount) : '';
    el.toggleAttribute('data-empty', !(amount > 0));
    return el;
  }

  async function actionBefore(e, vm) {
    const plate = plateEl(e.playerId);
    const jobs = [];
    const bub = popBubble(e.playerId, bubbleText(e));
    if (bub) jobs.push(go(bub));
    if (e.action === 'fold') {
      if (e.playerId === me) {
        for (const c of qa(`.pk-hole[data-hole="${CSS.escape(me)}"] .pk-hole__c`)) c.setAttribute('data-dim', '');
      } else {
        jobs.push(go(muck(qa(`.pk-hole[data-hole="${CSS.escape(e.playerId)}"] .tp-card`))));
      }
      plate?.setAttribute('data-folded', '');
    } else if (e.put > 0) {
      const before0 = vm.chips[e.playerId];
      vm.chips[e.playerId] -= e.put;
      vm.bets[e.playerId] = e.amount;
      const el = setBet(e.playerId, e.amount);
      if (el && plate) jobs.push(go(flyChips(plate, el.querySelector('.pk-stack') ?? el, e.put, { hide: el })));
      jobs.push(go(setStack(e.playerId, before0, vm.chips[e.playerId])));
    }
    await Promise.all(jobs);
  }

  async function uncalledBefore(e, vm) {
    const el = betEl(e.playerId);
    const plate = plateEl(e.playerId);
    const from = vm.chips[e.playerId];
    vm.chips[e.playerId] += e.amount;
    vm.bets[e.playerId] -= e.amount;
    const src = el?.querySelector('.pk-stack') ?? el;
    const job = el && plate ? go(flyChips(src, plate, e.amount)) : Promise.resolve();
    setBet(e.playerId, vm.bets[e.playerId]);
    await Promise.all([job, go(setStack(e.playerId, from, vm.chips[e.playerId], 300))]);
  }

  async function collectBefore(e, vm) {
    const pot = q('.pk-pot');
    if (!pot) return;
    const jobs = [];
    const sources = e.bets.map((b) => ({ ...b, el: betEl(b.playerId) })).filter((b) => visible(b.el?.querySelector('.pk-stack')));
    // le pot se redessine (principal + annexes) et apparaît quand les jetons arrivent
    pot.innerHTML = potGroups(view(state), e.pots);
    pot.toggleAttribute('data-empty', !e.pots.length);
    const target = pot.querySelector('.pk-pile') ?? pot;
    sources.forEach((b, i) => {
      jobs.push(go(flyChips(b.el.querySelector('.pk-stack'), target, b.amount, { delay: i * 50, duration: 480 })));
    });
    for (const b of e.bets) {
      vm.bets[b.playerId] = 0;
      setBet(b.playerId, 0);
    }
    if (jobs.length) {
      const tl = new T.Timeline({});
      tl.add(pot, [{ opacity: 0 }, { opacity: 0, offset: 0.75 }, { opacity: 1 }], { duration: 480 + sources.length * 50, easing: 'linear' });
      jobs.push(go(tl.start()));
    }
    await Promise.all(jobs);
  }

  /** Les cartes d'un joueur se retournent (tapis ou abattage). */
  async function revealBefore(hands, vm) {
    const jobs = [];
    let k = 0;
    for (const h of hands) {
      if (vm.revealed.has(h.playerId)) continue;
      vm.revealed.add(h.playerId);
      const hole = holeEl(h.playerId);
      if (!hole) continue;
      hole.setAttribute('data-shown', '');
      const slots = [...hole.querySelectorAll('.pk-hole__c')];
      h.cards.forEach((c, i) => {
        if (!slots[i]) return;
        slots[i].innerHTML = T.Card(tp(c, { size: 'sm', faceDown: true, className: 'pk-card' }));
        const card = slots[i].firstElementChild;
        if (visible(card)) jobs.push(go(T.anim.flip(card, { up: true, delay: k * 110 })));
        else T.Card.flip(card, true);
        k++;
      });
    }
    await Promise.all(jobs);
  }

  async function streetBefore(e, prev) {
    const start = prev.board.length + qa('.pk-board .tp-card[data-new]').length;
    const from = dealerBox();
    const jobs = [];
    e.cards.forEach((c, i) => {
      const slot = q(`.pk-board__s[data-slot="${start + i}"]`);
      if (!slot) return;
      slot.innerHTML = T.Card(tp(c, { size: 'md', attrs: { 'data-new': '' } }));
      const card = slot.firstElementChild;
      if (visible(card)) jobs.push(flyIn(card, { from, faceUp: true, delay: i * 140, duration: 480 }));
    });
    await Promise.all(jobs);
  }

  async function showdownBefore(e, next, vm) {
    await revealBefore(e.hands, vm);
    const lh = next.lastHand;
    if (!lh) return;
    const winners = new Set(Object.keys(lh.awards ?? {}));
    const win = new Set();
    for (const h of lh.hands) if (winners.has(h.playerId)) h.best.forEach((id) => win.add(id));
    // nom de chaque main sur sa plaque, cartes gagnantes en lumière, les autres estompées
    for (const h of e.hands) {
      const st = plateEl(h.playerId)?.querySelector('.pk-plate__t');
      if (st) {
        st.querySelector('.pk-plate__st')?.remove();
        st.insertAdjacentHTML('beforeend', `<span class="pk-plate__st" data-tone="${winners.has(h.playerId) ? 'win' : 'hand'}">${T.esc(h.description)}</span>`);
      }
      const hole = holeEl(h.playerId);
      if (!hole) continue;
      for (const c of hole.querySelectorAll('.tp-card')) {
        const ok = winners.has(h.playerId) && win.has(c.dataset.cardId);
        if (ok) c.setAttribute('data-state', 'winner');
        else c.closest('.pk-hole__c')?.setAttribute('data-dim', '');
      }
    }
    for (const c of qa('.pk-board .tp-card:not(.tp-card--slot)')) {
      if (win.has(c.dataset.cardId)) c.setAttribute('data-state', 'winner');
      else c.closest('.pk-board__s')?.setAttribute('data-dim', '');
    }
    const best = q('[data-zone="best"]');
    if (best && next.me?.best && winners.has(me)) best.classList.add('pk-best--win');
    await hold(1100);
  }

  async function winBefore(e, vm) {
    const groups = qa('.pk-pot__g');
    const jobs = [];
    e.pots.forEach((pot, i) => {
      const src = (groups.length === e.pots.length ? groups[i] : groups[0])?.querySelector('.pk-pile') ?? q('.pk-pot');
      pot.winners.forEach((pid, j) => {
        const plate = plateEl(pid);
        if (!plate) return;
        jobs.push(go(flyChips(src, plate, pot.shares[pid], { delay: i * 260 + j * 90, duration: 620 })));
      });
    });
    for (const g of groups) {
      const tl = new T.Timeline({});
      tl.add(g, [{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 600 });
      tl.then(() => g.remove());
      jobs.push(go(tl.start()));
    }
    for (const [pid, amount] of Object.entries(e.awards)) {
      const from = vm.chips[pid];
      vm.chips[pid] += amount;
      jobs.push(go(setStack(pid, from, vm.chips[pid], 560)));
      jobs.push(go(floatText(plateEl(pid), `+${fmt(amount)}`, { delay: 420 })));
      plateEl(pid)?.setAttribute('data-winner', '');
    }
    await Promise.all(jobs);
    await hold(500);
  }

  // ================================================================ après le rendu : ce qui arrive

  async function after(prev, next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    const jobs = [];
    if (has('hand')) {
      // le bouton du donneur glisse vers sa nouvelle place
      const d = q('.pk-dealer');
      if (ui.dealerFrom && visible(d)) {
        const b = boxIn(d);
        const tl = new T.Timeline({});
        tl.add(d, [{ transform: `translate(${ui.dealerFrom.cx - b.cx}px, ${ui.dealerFrom.cy - b.cy}px)` }, { transform: 'none' }], { duration: 520, easing: T.motion.ease.inOut });
        jobs.push(go(tl.start()));
      }
      const lvl = fresh.find((e) => e.type === 'level');
      const info = q('.pk-info');
      if (lvl && info) {
        const tl = new T.Timeline({});
        tl.add(info, [{ boxShadow: 'none' }, { boxShadow: 'var(--glow-winner)', offset: 0.35 }, { boxShadow: 'none' }], { duration: 1400 });
        jobs.push(go(tl.start()));
      }
      // les blindes glissent devant les deux joueurs, puis la donne
      const hand = fresh.find((e) => e.type === 'hand');
      for (const [pid, amount] of [[hand.sbId, hand.sb], [hand.bbId, hand.bb]]) {
        const el = betEl(pid);
        if (el && !el.hasAttribute('data-empty')) jobs.push(go(flyChips(plateEl(pid), el.querySelector('.pk-stack') ?? el, amount, { hide: el, duration: 420 })));
      }
      await dealAnim(next);
    }
    // le halo du tour passe au joueur suivant (sans attendre)
    if (!has('hand') && prev.currentPlayerId && next.currentPlayerId && prev.currentPlayerId !== next.currentPlayerId) {
      const a = plateEl(prev.currentPlayerId);
      const b = plateEl(next.currentPlayerId);
      if (visible(a) && visible(b) && b.dataset.state === 'active') T.anim.run('turn', () => T.anim.turn(a, b));
    }
    if (has('gameOver')) {
      const end = q('.tp-end');
      if (end) jobs.push(go(next.winnerId === me ? T.anim.victory(end) : T.anim.ranking(end)));
    }
    await Promise.all(jobs);
  }

  /** Donne : deux tours de table, une carte à la fois, depuis le croupier ; mes cartes se retournent. */
  async function dealAnim(s) {
    const from = dealerBox();
    const n = s.players.length;
    const bi = s.players.findIndex((p) => p.id === s.buttonId);
    const order = [];
    for (let i = 1; i <= n; i++) {
      const p = s.players[(bi + i) % n];
      if (p.inHand) order.push(p);
    }
    const jobs = [];
    let k = 0;
    for (let round = 0; round < 2; round++) {
      for (const p of order) {
        const card = holeEl(p.id)?.querySelectorAll('.tp-card')[round];
        if (!visible(card)) continue;
        jobs.push(flyIn(card, { from, faceUp: p.id === me, delay: 160 + k * 90, duration: 380 }));
        k++;
      }
    }
    await Promise.all(jobs);
  }

  // ================================================================ notifications de table

  function notices(prev, next, fresh) {
    for (const e of fresh) {
      if (e.type === 'level') notify({ tone: 'info', title: `Niveau ${e.level}`, text: `Les blindes passent à ${fmt(e.sb)}/${fmt(e.bb)}` });
      if (e.type === 'eliminated') {
        for (const x of e.players) {
          notify({
            tone: x.playerId === me ? 'error' : 'info',
            text: x.playerId === me ? `Tu n’as plus de jetons : ${x.place}e place` : `${nameOf(x.playerId)} quitte la table (${x.place}e place)`,
          });
        }
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
      window.removeEventListener('resize', onResize);
      document.removeEventListener('tapis:motion', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      T?.anim.finishAll();
      css.forEach((c) => c.link.remove());
      host.remove();
    },
  };
}
