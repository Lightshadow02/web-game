import { fmt, signed, handText } from './cards.js';
import {
  viewContext, tableHtml, centerHtml, barHtml, endScreen, scoresHtml, journalHtml,
} from './view.js';
import { rulesDialog } from './rules.js';
import { createFx } from './fx.js';

/* =====================================================================
 * Interface du Blackjack, dessinée avec le design system Claude Design « Tapis »
 * (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD), table « salon ».
 * Le système est importé dans public/vendor/tapis/ (bundle.js -> window.Tapis, tapis.css).
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 *   bet, sitout, unbet, insurance, hit, stand, double, split, next.
 *
 * Mouvement (même architecture que le Tarot) : chaque nouvel état est d'abord joué sur
 * l'écran affiché (cartes balayées vers la défausse, assurance perdue…), puis la table est
 * redessinée depuis l'état reçu, puis ce qui arrive est animé (donne depuis le sabot,
 * carte cachée retournée, banque qui tire, jetons payés…). Les états reçus pendant une
 * animation attendent leur tour ; s'ils s'accumulent, les animations sont terminées d'un coup.
 * ===================================================================== */

const TAPIS_JS = '/vendor/tapis/bundle.js';
const TAPIS_CSS = '/vendor/tapis/tapis.css';
const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'tapis.motion'; // partagé par les jeux de cartes
const TURN_PHASES = ['playing'];

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
  host.className = 'tp-scope bj';
  host.dataset.table = 'salon';
  host.dataset.theme = 'salon';
  host.setAttribute('data-motion-host', '');
  const saved = readMotion();
  if (saved === 'on' || saved === 'off') host.dataset.motion = saved; // sinon : prefers-reduced-motion décide
  host.innerHTML = '<p class="bj-loading">Ouverture de la table…</p>';
  root.append(host);

  let T = null;
  let fx = null;
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
  const ui = {
    lastEvent: 0,
    round: 0,
    pending: 0, // mise en préparation (jetons cliqués, pas encore envoyés)
    holeDown: false, // la carte cachée reste de dos le temps d'être retournée
    dealerTurn: false, // la banque joue (statut et actions en attente)
    view: null, // 'end'
    endSeen: false,
    rules: false,
    rulesTab: 'but',
    boxes: new Map(), // position des cartes sur l'écran précédent (séparation)
  };

  // ================================================================ hauteur : la table tient dans la fenêtre

  function fit() {
    const top = host.getBoundingClientRect().top + window.scrollY;
    const layout = host.closest('.room-layout');
    const pad = layout ? parseFloat(getComputedStyle(layout).paddingBottom) || 0 : 16;
    host.style.height = `${Math.max(260, Math.floor(window.innerHeight - top - pad))}px`;
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
    host.innerHTML = `<div class="tp-app"><main class="tp-zone" data-zone="game" aria-label="Table de Blackjack">${decor()}`
      + '<div class="tp-table tp-table--bj"></div>'
      + T.Tools({ buttons: ['journal', 'scores', 'regles', 'animations'] })
      + '<div class="tp-toasts" aria-live="polite"></div>'
      + T.Drawer({ id: 'journal', title: 'Journal', body: '' })
      + T.Drawer({ id: 'scores', title: 'Feuille de scores', className: 'tp-drawer--wide', body: '' })
      + '<div class="bj-layer" data-layer="view"></div><div class="bj-layer" data-layer="rules"></div></main></div>';
    zone = host.querySelector('.tp-zone');
    fx = createFx(T, zone);
    layers = { view: zone.querySelector('[data-layer="view"]'), rules: zone.querySelector('[data-layer="rules"]') };
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onShortcut);
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
    chain = chain.then(tick).then(() => step(next)).catch((err) => console.error(err));
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Attend une animation Tapis ; si des états s'accumulent, elle saute tout de suite à sa fin. */
  function go(tl) {
    if (queued > 1) tl.finish();
    return tl.done();
  }

  /** Pause, écourtée si d'autres états s'accumulent. */
  function hold(ms) {
    if (queued > 1 || !T.motion.enabled()) return Promise.resolve();
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

  async function step(next) {
    queued--;
    if (disposed || !T) return;
    const prev = state;
    const fresh = prev ? next.events.filter((e) => e.id > ui.lastEvent) : [];
    const gap = !!prev && fresh.length > 0 && fresh[0].id > ui.lastEvent + 1; // événements perdus (reconnexion…)
    ui.lastEvent = next.events.reduce((m, e) => Math.max(m, e.id), ui.lastEvent);
    // un état déjà dépassé par un plus récent n'est pas dessiné (rattrapage d'un retard)
    const superseded = queued > 0;
    const live = !!prev && prev === shown && !gap && fresh.length <= 40;
    const motion = live && !superseded && T.motion.enabled() && !document.hidden;
    setAnimating(true);
    try {
      if (motion) await before(prev, next, fresh).catch((err) => console.error(err));
      if (disposed) return;
      prepare(prev, next, fresh, { motion });
      state = next;
      if (superseded) return;
      render();
      if (live) notices(prev, next, fresh);
      if (motion) await after(prev, next, fresh).catch((err) => console.error(err));
      // fin de partie (règlement ou dernière donne passée) : le classement s'ouvre de lui-même
      if (live && next.phase === 'gameOver' && prev.phase !== 'gameOver') autoRanking(next, motion ? 1800 : 2200);
    } finally {
      ui.holeDown = false;
      if (ui.dealerTurn) {
        ui.dealerTurn = false;
        refreshBars();
      }
      host.removeAttribute('data-settling');
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

  /** Met à jour l'état local de l'interface quand la situation change. */
  function prepare(prev, next, fresh, { motion }) {
    if (next.roundNumber !== ui.round) {
      ui.round = next.roundNumber;
      ui.pending = 0;
    }
    const meP = next.players.find((p) => p.id === me);
    if (next.phase !== 'betting' || meP?.state !== 'deciding') ui.pending = 0;
    if (meP) ui.pending = Math.min(ui.pending, meP.chips);
    ui.holeDown = motion && fresh.some((e) => e.type === 'reveal');
    ui.dealerTurn = motion && fresh.some((e) => e.type === 'settle');
    if (next.phase !== 'gameOver') {
      ui.view = null;
      ui.endSeen = false;
    } else if (!prev && !ui.endSeen) {
      ui.view = 'end'; // reprise d'une partie finie : le classement directement
      ui.endSeen = true;
    }
  }

  // ================================================================ rendu

  const q = (sel) => zone?.querySelector(sel) ?? null;
  const qa = (sel) => (zone ? [...zone.querySelectorAll(sel)] : []);
  const seatEl = (pid) => q(`.bj-seat[data-seat="${CSS.escape(pid)}"]`);
  const plateEl = (pid) => seatEl(pid)?.querySelector('.tp-seat') ?? null;
  const handEl = (pid, i) => seatEl(pid)?.querySelector(`.bj-hand[data-hand="${i}"]`) ?? null;
  const cardEl = (id) => q(`.tp-table [data-card-id="${CSS.escape(id)}"]`);
  const shoeEl = () => q('.bj-shoe .tp-pile');
  const rackEl = () => q('.bj-rack');
  const bankEl = (pid) => seatEl(pid)?.querySelector('.bj-bank') ?? null;
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
    if (focus) fresh.querySelector(focus)?.focus({ preventScroll: true });
  }

  /** Retrouve après un rendu le contrôle qui avait le focus (clavier). */
  function focusKey(el) {
    if (!el || !zone?.contains(el) || !el.closest('.tp-table')) return null;
    for (const attr of ['data-chip', 'data-act', 'data-open']) {
      if (el.hasAttribute(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    }
    return null;
  }

  /** Mise en préparation : seuls ma place, les jetons, le statut et les actions changent (les animations des autres continuent). */
  function refreshMine() {
    if (!state || !zone) return;
    if (state !== shown) {
      renderTable();
      return;
    }
    const v = view();
    const focus = focusKey(document.activeElement);
    const fresh = T.node(tableHtml(v));
    const swap = (sel) => {
      const a = q(`.tp-table ${sel}`);
      const b = fresh.querySelector(sel);
      if (a && b) a.replaceWith(b);
    };
    swap(`.bj-seat[data-seat="${CSS.escape(me)}"] .bj-hands`);
    swap('.bj-center');
    swap('[data-area="bar"]');
    if (focus) q(`.tp-table ${focus}`)?.focus({ preventScroll: true });
  }

  /** Statut, panneau et actions (fin du tour de la banque). */
  function refreshBars() {
    if (!state || !zone || state !== shown) return;
    const v = view();
    const center = q('.bj-center');
    if (center) center.innerHTML = centerHtml(v);
    const bar = q('[data-area="bar"]');
    if (bar) bar.innerHTML = barHtml(v);
  }

  let viewHtml = '';
  function renderView() {
    const html = ui.view === 'end' && state.phase === 'gameOver' ? endScreen(view()) : '';
    if (html === viewHtml) return;
    viewHtml = html;
    layers.view.innerHTML = html;
    if (html) layers.view.querySelector('.tp-end .tp-btn')?.focus({ preventScroll: true });
  }

  const drawerHtml = new Map();
  function renderDrawers() {
    const v = view();
    setDrawerBody('journal', journalHtml(v));
    setDrawerBody('scores', scoresHtml(v));
  }
  function setDrawerBody(id, html) {
    const body = q(`#${id}.tp-drawer .tp-drawer__b`);
    if (!body || drawerHtml.get(id) === html) return;
    drawerHtml.set(id, html);
    body.innerHTML = html;
  }

  function renderRules() {
    const s = state ?? latest;
    layers.rules.innerHTML = ui.rules ? rulesDialog(T, { tab: ui.rulesTab, startChips: s?.startChips, totalRounds: s?.totalRounds }) : '';
    if (!ui.rules) return;
    T.interact.tabs(layers.rules);
    layers.rules.querySelector('[data-close]')?.focus({ preventScroll: true });
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
      // « Donne suivante » cliqué en même temps que les autres : la nouvelle donne est déjà là
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

  /** Un jeton cliqué : il file du plateau vers ma case de mise. */
  function addChip(value, button) {
    const s = state;
    const my = s?.my;
    if (!my?.bet) return;
    const left = my.maxBet - ui.pending;
    if (left <= 0) {
      notify({ tone: 'info', text: 'Tu as déjà tout misé' });
      return;
    }
    const add = Math.min(value, left);
    ui.pending += add;
    const from = button && visible(button) ? fx.box(button) : null;
    refreshMine();
    const spot = q(`.bj-seat[data-me] .bj-spot`);
    if (from && visible(spot)) fx.chips(add, from, spot, { duration: 360, lift: 30 });
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
    const chip = t.closest('[data-chip]');
    if (chip && zone.contains(chip)) {
      if (chip.getAttribute('aria-disabled') === 'true') {
        notify({ tone: 'info', text: 'Tu as déjà tout misé' });
        return;
      }
      addChip(Number(chip.dataset.chip), chip);
      return;
    }
    const act = t.closest('[data-act]');
    if (!act || !zone.contains(act)) return;
    if (act.getAttribute('aria-disabled') === 'true') {
      // un bouton désactivé dit pourquoi (utile au toucher, où il n'y a pas de survol)
      const why = act.getAttribute('aria-describedby') && zone.querySelector(`#${CSS.escape(act.getAttribute('aria-describedby'))}`)?.textContent;
      if (why) notify({ tone: 'info', text: why });
      return;
    }
    doAct(act.dataset.act);
  }

  function doAct(a) {
    const s = state;
    const my = s.my;
    switch (a) {
      // ---- interface locale
      case 'clear':
        ui.pending = 0;
        refreshMine();
        q('[data-chip="10"]')?.focus({ preventScroll: true });
        return;
      case 'rebet': {
        const meP = s.players.find((p) => p.id === me);
        if (my?.bet && meP?.lastBet) {
          ui.pending = Math.min(meP.lastBet, my.maxBet);
          refreshMine();
          q('[data-act="bet"]')?.focus({ preventScroll: true });
        }
        return;
      }
      case 'ranking':
        openRanking();
        return;
      case 'close-end':
        ui.view = null;
        renderView();
        renderTable();
        return;
      // ---- décisions simultanées (permises pendant une animation)
      case 'bet':
        if (my?.bet && ui.pending >= my.minBet && ui.pending <= my.maxBet) send('bet', { amount: ui.pending });
        return;
      case 'sitout':
        if (my?.bet) send('sitout');
        return;
      case 'unbet': {
        const meP = s.players.find((p) => p.id === me);
        if (!my?.change) return;
        const back = meP?.state === 'bet' ? meP.bet : 0;
        send('unbet').then((ok) => {
          if (!ok) return;
          // les jetons reviennent dans la case, prêts à être ajustés
          chain = chain.then(() => {
            if (state?.my?.bet && back) {
              ui.pending = Math.min(back, state.my.maxBet);
              refreshMine();
            }
          });
        });
        return;
      }
      case 'insurance':
        if (my?.insurance) send('insurance', { take: true, amount: my.insurance.max });
        return;
      case 'no-insurance':
        if (my?.insurance) send('insurance', { take: false });
        return;
      case 'next':
        if (my?.next) send('next');
        return;
      default:
    }
    // ---- jeu de la main : pas pendant une transition ni une requête en cours
    if (animating || busy || !s.isMyTurn || !TURN_PHASES.includes(s.phase)) return;
    if (['hit', 'stand', 'double', 'split'].includes(a) && my?.[a]?.ok) send(a);
  }

  /** Raccourcis clavier pendant mon tour : T tirer, R rester, D doubler, S séparer. */
  function onShortcut(e) {
    if (!state?.isMyTurn || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]') || ui.rules || ui.view) return;
    if (host.closest('.hidden') || !host.isConnected) return;
    const a = { t: 'hit', r: 'stand', d: 'double', s: 'split' }[e.key.toLowerCase()];
    if (!a) return;
    e.preventDefault();
    if (!state.my?.[a]?.ok) {
      if (state.my?.[a]?.reason) notify({ tone: 'info', text: state.my[a].reason });
      return;
    }
    doAct(a);
  }

  function openRanking() {
    ui.view = 'end';
    ui.endSeen = true;
    renderView();
    renderTable();
    local(async (motion) => {
      const end = q('.tp-end');
      if (motion && end) await go(T.anim.ranking(end));
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
        // la feuille de scores s'ouvre depuis la fin de partie : la fenêtre se ferme (la barre d'actions la rouvre)
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
    }
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !state) return;
    if (ui.rules) closeTool('regles');
    else if (q('.tp-drawer[data-open]')) closeDrawers();
    else if (ui.view === 'end') doAct('close-end');
  }

  // ================================================================ animations : avant le rendu (écran affiché)

  async function before(prev, next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    // positions des cartes, pour les faire glisser à leur nouvelle place (séparation)
    ui.boxes = new Map();
    if (has('split')) {
      for (const c of qa('.bj-seats .tp-card[data-card-id]')) ui.boxes.set(c.dataset.cardId, fx.box(c));
    }
    const jobs = [];

    // assurance réglée par la vérification de la banque : les jetons d'assurance partent
    const peek = fresh.find((e) => e.type === 'peek');
    if (peek) {
      for (const ins of qa('.bj-ins')) {
        const pid = ins.closest('.bj-seat')?.dataset.seat;
        const target = peek.blackjack ? bankEl(pid) : visible(rackEl()) ? rackEl() : q('.bj-cards--dealer');
        const stack = ins.querySelector('.bj-stack');
        if (!stack || !visible(target)) continue;
        const h = fx.holder();
        const amount = Number(stack.dataset.amount) || 0;
        const g = h.stack(amount * (peek.blackjack ? 3 : 1), stack);
        stack.style.visibility = 'hidden';
        jobs.push(go(h.fly(g, target, { duration: 560 })).finally(() => h.clear()));
      }
    }

    // nouvelle donne : les cartes de la table filent vers la défausse, face cachée
    if (has('round') && ['roundEnd', 'gameOver'].includes(prev.phase)) {
      const pile = q('[data-pile="defausse"]');
      q('.bj-overpanel')?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
      if (visible(pile)) {
        let k = 0;
        for (const seat of [...qa('.bj-seat'), q('.bj-dealer')]) {
          const cards = [...(seat?.querySelectorAll('.bj-cards .tp-card[data-card-id]') ?? [])].filter(visible);
          if (!cards.length) continue;
          jobs.push(go(T.anim.ecart(cards, pile, { delay: 90 * k++ })));
        }
        for (const r of qa('.bj-spot, .bj-hand__info, .bj-dealer__id .bj-value, .bj-dealer__note, .bj-ins')) r.style.visibility = 'hidden';
      }
    }
    await Promise.all(jobs);
  }

  // ================================================================ animations : après le rendu (nouvel écran)

  async function after(prev, next, fresh) {
    const shoe = shoeEl();
    let shoeCount = prev.shoe.remaining;
    const hidden = new Set(); // cartes cachées jusqu'à leur tour
    const hide = (el) => {
      if (!el) return;
      el.style.visibility = 'hidden';
      hidden.add(el);
    };
    const show = (el) => {
      if (!el) return;
      el.style.visibility = '';
      hidden.delete(el);
    };
    const steps = [];
    const jobs = [];
    const has = (type) => fresh.some((e) => e.type === type);
    const settle = fresh.find((e) => e.type === 'settle');
    const nPlayers = next.players.filter((p) => p.hands.length).length;
    const dealerValue = q('[data-zone="dealer-value"]');
    const dealerCards = next.dealer.cards;
    /** Valeur de la banque après n cartes : la main finale s'affiche comme le serveur (« 18 », pas « 8 / 18 »). */
    const dealerText = (n) => (n >= dealerCards.length ? next.dealer.text : handText(dealerCards.slice(0, n)));
    let settlement = null;
    // assurance prise par le dernier à répondre : la banque a déjà vérifié dans ce même état, la
    // pile n'est pas dessinée (assurance réglée) ; un fantôme la pose puis la fait partir
    const peekEv = fresh.find((e) => e.type === 'peek');
    const insGhosts = [];
    const payInsurance = () => async () => {
      const rack = visible(rackEl()) ? rackEl() : q('.bj-cards--dealer');
      await Promise.all(insGhosts.map((g, i) => {
        if (!g.node) return null;
        g.node.remove();
        const won = peekEv.blackjack;
        const node = g.h.stack(g.amount * (won ? 3 : 1), g.at);
        const target = won ? bankEl(g.pid) : rack;
        return visible(target) ? go(g.h.fly(node, target, { delay: i * 90, duration: 560 })) : null;
      }));
    };

    /** Fait arriver une carte du sabot. */
    const drawCard = (el, delayBadge) => async () => {
      if (!el) return;
      show(el);
      if (!visible(shoe)) return;
      await go(T.anim.draw(shoe, [el], { from: shoeCount, to: shoeCount - 1 }));
      shoeCount--;
      if (delayBadge) delayBadge();
    };
    const valueOf = (hand) => hand?.querySelector('.bj-value');
    const popValue = (hand) => {
      const b = valueOf(hand);
      if (b) {
        show(b);
        jobs.push(go(fx.pop(b)));
      }
    };

    // ---- jetons misés par les autres (mises simultanées)
    for (const e of fresh) {
      if (e.type !== 'bet' || e.playerId === me) continue;
      const spot = seatEl(e.playerId)?.querySelector('.bj-spot .bj-stack');
      const bank = bankEl(e.playerId);
      if (visible(spot) && visible(bank)) {
        spot.style.visibility = 'hidden';
        hidden.add(spot);
        jobs.push(go(fx.chips(e.amount, bank, spot, { duration: 480 })).finally(() => show(spot)));
      }
    }

    // ---- règlement à venir : les mises restent sur la table pendant que la banque joue
    const dealerTone = dealerValue?.dataset.tone;
    if (settle) {
      host.setAttribute('data-settling', '');
      settlement = prepareSettlement(prev, next);
      if (dealerValue) {
        dealerValue.textContent = prev.dealer.cards.length ? prev.dealer.text : '';
        delete dealerValue.dataset.tone; // le verdict (sautée, blackjack) attend la fin du tour de la banque
      }
    }

    // ---- les événements, dans l'ordre
    for (const e of fresh) {
      switch (e.type) {
        case 'shuffle':
          if (visible(shoe)) steps.push(async () => { await go(T.anim.shuffle(shoe)); });
          // entre deux donnes, tout revient dans le sabot ; sabot vide en pleine donne : la défausse y retourne
          shoeCount = e.reason === 'cut' ? next.shoe.total : shoeCount + prev.discardCount;
          break;
        case 'deal': {
          const els = e.order.map((o) => (o.hole ? q('.bj-dealer [data-hole]') : cardEl(o.cardId))).filter(Boolean);
          const badges = qa('.bj-seats .bj-value, [data-zone="dealer-value"]');
          els.forEach(hide);
          badges.forEach(hide);
          steps.push(async () => {
            els.forEach(show);
            if (visible(shoe)) {
              const stagger = nPlayers >= 4 ? 110 : nPlayers >= 2 ? 140 : 170;
              await go(T.anim.draw(shoe, els, { from: shoeCount, to: shoeCount - els.length, stagger }));
            }
            shoeCount -= els.length;
            if (dealerValue && settle) dealerValue.textContent = handText(dealerCards.slice(0, 1));
            for (const b of badges) {
              show(b);
              jobs.push(go(fx.pop(b)));
            }
          });
          break;
        }
        case 'blackjack': {
          const hand = handEl(e.playerId, 0);
          steps.push(async () => {
            const cards = hand?.querySelector('.bj-cards');
            if (visible(cards)) jobs.push(go(fx.blackjack(cards, { text: e.playerId === me ? 'Blackjack !' : 'Blackjack' })));
            await hold(500);
          });
          break;
        }
        case 'insurance': {
          if (!e.take) break;
          const ins = seatEl(e.playerId)?.querySelector('.bj-ins .bj-stack');
          const bank = bankEl(e.playerId);
          if (visible(ins) && visible(bank)) {
            hide(ins);
            jobs.push(go(fx.chips(e.amount, bank, ins, { duration: 460 })).finally(() => show(ins)));
          } else if (!ins && peekEv && visible(bank)) {
            const hands = seatEl(e.playerId)?.querySelector('.bj-hands');
            if (!visible(hands)) break;
            const b = fx.box(hands);
            const at = { x: b.x + b.w - 34, y: b.y + b.h - 34, w: 28, h: 28 };
            at.cx = at.x + at.w / 2;
            at.cy = at.y + at.h / 2;
            const g = { pid: e.playerId, amount: e.amount, at, h: fx.holder(), node: null };
            insGhosts.push(g);
            steps.push(async () => {
              await go(fx.chips(e.amount, bank, at, { duration: 460 }));
              g.node = g.h.stack(e.amount, at, { small: true });
            });
          }
          break;
        }
        case 'peek': {
          if (e.blackjack) break; // la carte se retourne avec le règlement (l'assurance est payée après)
          steps.push(async () => {
            const hole = q('.bj-dealer [data-hole]');
            if (!visible(hole)) return;
            jobs.push(go(fx.say(hole, 'Pas de blackjack', { delay: 520 })));
            await go(fx.peek(hole));
          });
          if (insGhosts.length) steps.push(payInsurance());
          break;
        }
        case 'split': {
          const seat = seatEl(e.playerId);
          const cards = [...(seat?.querySelectorAll('.bj-cards .tp-card[data-card-id]') ?? [])];
          const moved = cards.filter((c) => ui.boxes.has(c.dataset.cardId));
          const newStack = handEl(e.playerId, e.hand + 1)?.querySelector('.bj-stack');
          const bank = bankEl(e.playerId);
          if (newStack) hide(newStack);
          steps.push(async () => {
            const slides = moved.map((c) => go(fx.slide(c, ui.boxes.get(c.dataset.cardId), { lift: 24 })));
            if (newStack && visible(bank)) {
              show(newStack);
              slides.push(go(fx.chips(Number(newStack.dataset.amount) || 0, bank, newStack, { duration: 460 })));
            }
            await Promise.all(slides);
            if (newStack) show(newStack);
          });
          break;
        }
        case 'hit':
        case 'splitCard':
        case 'double': {
          const el = cardEl(e.card.id);
          const hand = handEl(e.playerId, e.hand);
          const badge = valueOf(hand);
          hide(el);
          if (badge) hide(badge);
          if (e.type === 'double') {
            const stack = hand?.querySelector('.bj-stack');
            const bank = bankEl(e.playerId);
            steps.push(async () => {
              if (visible(stack) && visible(bank)) await go(fx.chips(e.bet / 2, bank, stack, { duration: 420 }));
            });
          }
          steps.push(drawCard(el, () => popValue(hand)));
          break;
        }
        case 'bust': {
          const hand = handEl(e.playerId, e.hand);
          steps.push(async () => {
            const cards = hand?.querySelector('.bj-cards');
            if (visible(cards)) await go(fx.bust(cards, { text: `Sauté · ${e.total}` }));
          });
          break;
        }
        case 'stand': {
          const hand = handEl(e.playerId, e.hand);
          steps.push(async () => {
            const cards = hand?.querySelector('.bj-cards');
            if (visible(cards)) jobs.push(go(fx.say(cards, `Reste sur ${e.total}`)));
          });
          break;
        }
        case 'reveal': {
          steps.push(async () => {
            const hole = q('.bj-dealer [data-hole]');
            if (!hole) return;
            ui.holeDown = false;
            await go(T.anim.flip(hole, { up: true }));
            if (dealerValue) {
              dealerValue.textContent = dealerText(2);
              jobs.push(go(fx.pop(dealerValue)));
            }
            await hold(next.dealer.blackjack ? 200 : 260);
          });
          if (peekEv?.blackjack && insGhosts.length) steps.push(payInsurance());
          break;
        }
        case 'dealerHit': {
          const idx = dealerCards.findIndex((c) => c.id === e.card.id);
          const el = cardEl(e.card.id);
          hide(el);
          steps.push(async () => {
            await drawCard(el)();
            if (dealerValue) {
              dealerValue.textContent = dealerText(idx + 1);
              jobs.push(go(fx.pop(dealerValue)));
            }
            await hold(180);
          });
          break;
        }
        case 'dealerBust':
          steps.push(async () => {
            const cards = q('.bj-cards--dealer');
            if (dealerValue) dealerValue.dataset.tone = 'bust';
            if (visible(cards)) await go(fx.bust(cards, { text: 'La banque saute', center: true }));
          });
          break;
        case 'settle':
          steps.push(async () => {
            if (dealerValue) {
              dealerValue.textContent = next.dealer.blackjack ? 'Blackjack' : next.dealer.text;
              if (dealerTone) dealerValue.dataset.tone = dealerTone;
              if (next.dealer.blackjack && has('reveal')) jobs.push(go(fx.blackjack(q('.bj-cards--dealer'), { text: 'Blackjack de la banque', center: true })));
            }
            await settlement?.run();
          });
          break;
        default:
      }
    }

    // ---- le halo du tour passe au joueur suivant (sans attendre)
    if (prev.currentPlayerId !== next.currentPlayerId && next.currentPlayerId && prev.currentPlayerId) {
      steps.push(async () => {
        const a = plateEl(prev.currentPlayerId);
        const b = plateEl(next.currentPlayerId);
        if (visible(a) && visible(b) && b.dataset.state === 'active') T.anim.run('turn', () => T.anim.turn(a, b));
      });
    }

    try {
      for (const s of steps) {
        if (disposed) return;
        await s();
      }
      await Promise.all(jobs);
    } finally {
      for (const el of hidden) el.style.visibility = '';
      settlement?.cleanup();
      for (const g of insGhosts) g.h.clear();
      const count = shoeEl()?.querySelector('.tp-pile__count');
      if (count) count.textContent = String(next.shoe.remaining);
    }
  }

  /** Fin de partie : le classement s'ouvre de lui-même, après un temps pour lire la table. */
  let rankingTimer = null;
  function autoRanking(s, ms) {
    clearTimeout(rankingTimer);
    rankingTimer = setTimeout(() => {
      if (!disposed && state === s && !ui.view && !ui.endSeen) openRanking();
    }, ms);
  }

  /**
   * Règlement : les mises sont posées (fantômes) sur les cases dès le rendu ; quand la banque
   * a fini, les mises perdues filent vers son râtelier, les gains en viennent, puis tout
   * rejoint la cave de chaque joueur, dont le compteur défile.
   */
  function prepareSettlement(prev, next) {
    const m = next.summary;
    const h = fx.holder();
    const stacks = [];
    const banks = [];
    for (const sp of m.players) {
      if (!sp.played) continue;
      const seat = seatEl(sp.playerId);
      sp.hands.forEach((hand, i) => {
        const spot = seat?.querySelector(`.bj-hand[data-hand="${i}"] .bj-spot`);
        if (!visible(spot)) return;
        stacks.push({ pid: sp.playerId, hand, i, spot, node: h.stack(hand.bet, spot, { doubled: hand.doubled, label: true }) });
      });
      const bank = seat?.querySelector('.bj-bank__n');
      const before = prev.players.find((p) => p.id === sp.playerId)?.chips;
      if (bank && before != null) {
        bank.textContent = fmt(before);
        banks.push({ node: bank, from: before, to: sp.chips, pid: sp.playerId, net: sp.net });
      }
    }
    return {
      async run() {
        const rack = visible(rackEl()) ? rackEl() : q('.bj-cards--dealer');
        const flights = [];
        let k = 0;
        for (const st of stacks) {
          const bank = bankEl(st.pid);
          const d = 110 * k++;
          if (st.hand.result === 'lose' || st.hand.result === 'bust') {
            flights.push(go(h.fly(st.node, rack, { delay: d, duration: 540 })));
          } else {
            const win = st.hand.payout - st.hand.bet;
            if (win > 0 && visible(rack) && visible(bank)) {
              // le gain arrive du râtelier sur la mise, puis la pile entière rejoint la cave
              const paid = h.stack(win, rack);
              flights.push(go(h.fly(paid, st.spot, { delay: d, duration: 460, fade: false })).then(() => {
                st.node.remove();
                const all = h.stack(st.hand.payout, st.spot, { label: true });
                return hold(140).then(() => go(h.fly(all, bank, { duration: 480 })));
              }));
            } else {
              flights.push(go(h.fly(st.node, bank, { delay: d + 200, duration: 500 })));
            }
          }
        }
        await Promise.all(flights);
        // résultats : les badges éclosent, les caves défilent
        host.removeAttribute('data-settling');
        ui.dealerTurn = false;
        refreshBars();
        const pops = qa('.bj-spot--result :is(.tp-badge, .bj-net)').map((b, i) => go(fx.pop(b, { delay: i * 60 })));
        for (const b of banks) {
          if (b.from !== b.to) {
            pops.push(go(T.anim.countUp(b.node, b.from, b.to, { duration: 650 })).then(() => { b.node.textContent = fmt(b.to); }));
            if (b.net && b.pid === me) pops.push(go(fx.gain(bankEl(me), signed(b.net), { tone: b.net > 0 ? 'gold' : 'danger' })));
          }
        }
        const sum = q('.bj-summary');
        if (sum) pops.push(go(fx.pop(sum)));
        await Promise.all(pops);
      },
      cleanup() {
        h.clear();
        for (const b of banks) b.node.textContent = fmt(b.to);
      },
    };
  }

  // ================================================================ notifications de table

  function notices(prev, next, fresh) {
    for (const e of fresh) {
      if (e.type === 'shuffle') {
        notify({ tone: 'info', title: 'Sabot mélangé', text: e.reason === 'cut' ? 'La carte de coupe est sortie : les 312 cartes sont remélangées' : 'Le sabot était vide : la défausse est remélangée' });
      }
      if (e.type === 'skip') notify({ tone: 'info', text: 'Tout le monde passe : donne suivante' });
      if (e.type === 'peek' && !e.blackjack && next.dealer.cards[0]?.rank === 1) {
        const mine = next.players.find((p) => p.id === me)?.insurance;
        notify({ tone: 'info', text: mine?.status === 'lost' ? `La banque n’a pas de blackjack : ton assurance (${fmt(mine.amount)}) est perdue` : 'La banque n’a pas de blackjack' });
      }
      if (e.type === 'peek' && e.blackjack) {
        const mine = next.players.find((p) => p.id === me)?.insurance;
        if (mine?.status === 'won') notify({ tone: 'success', text: `Assurance payée : +${fmt(mine.amount * 2)}` });
      }
      if (e.type === 'broke' && e.playerId === me) notify({ tone: 'error', title: 'Plus de jetons', text: 'Tu regardes la fin de la partie' });
    }
    if (!prev.shoe.cutReached && next.shoe.cutReached && !fresh.some((e) => e.type === 'shuffle')) {
      notify({ tone: 'info', text: 'Carte de coupe sortie : le sabot sera mélangé avant la prochaine donne' });
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
      clearTimeout(rankingTimer);
      wake?.();
      window.removeEventListener('resize', fit);
      document.removeEventListener('tapis:motion', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('keydown', onShortcut);
      T?.anim.finishAll();
      css.forEach((c) => c.link.remove());
      host.remove();
    },
  };
}
