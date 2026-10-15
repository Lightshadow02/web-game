import { tp, comboName, placeText, makeOrder, sortForOrder } from './cards.js';
import {
  viewContext, tableHtml, pileHtml, statusFor, actionsHtml, handMode, summaryDialog, lastTrickDialog, endScreen,
  scoreSheet, journalHtml,
} from './view.js';
import { rulesDialog } from './rules.js';

/* =====================================================================
 * Interface du Président, dessinée avec le design system Claude Design « Tapis »
 * (https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD), table « salon ».
 * Le système est importé dans public/vendor/tapis/ (bundle.js -> window.Tapis, tapis.css).
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 *   play { cardIds }, pass, give { cardIds }, next.
 *
 * Mouvement : chaque nouvel état est d'abord joué sur l'écran affiché (ce qui part : pli
 * complet gardé un instant puis balayé vers la défausse, cartes rendues au Trouduc…), puis
 * la table est redessinée depuis l'état reçu, puis ce qui arrive est animé (donne, cartes
 * posées sur la pile, échange, « Passe », joueur qui sort, révolution, halo du tour).
 * Les états reçus pendant une animation attendent leur tour ; s'ils s'accumulent,
 * les animations en cours sont terminées d'un coup (Tapis : .finish()).
 * ===================================================================== */

const TAPIS_JS = '/vendor/tapis/bundle.js';
const TAPIS_CSS = '/vendor/tapis/tapis.css';
const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'tapis.motion'; // partagé par les jeux de cartes
const HOLD = 900; // pli complet gardé à l'écran avant d'être balayé

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
const REASON = { two: 'Le 2 ferme le pli', top: 'Personne ne peut faire mieux', passes: 'Tous les autres ont passé' };

export function mount(root, ctx) {
  const me = ctx.me.id;
  // tapis.css d'abord, puis nos réglages (qui gagnent aussi par leur spécificité)
  const css = [addCss(TAPIS_CSS), addCss(`${BASE}style.css`)];

  // .tp-scope porte les tokens du système, la table « salon » et l'interrupteur d'animations.
  const host = document.createElement('div');
  host.className = 'tp-scope pr';
  host.dataset.table = 'salon';
  host.dataset.theme = 'salon';
  host.setAttribute('data-motion-host', '');
  const saved = readMotion();
  if (saved === 'on' || saved === 'off') host.dataset.motion = saved; // sinon : prefers-reduced-motion décide
  host.innerHTML = '<p class="pr-loading">Ouverture de la table…</p>';
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
    roundKey: null,
    sel: [], // cartes choisies (ids)
    bubbles: {},
    held: null, // pli complet gardé à l'écran (avant d'être balayé)
    heldWinner: null,
    heldReason: '',
    view: null, // 'summary' | 'end'
    dialog: null, // 'dernier-pli'
    rules: false,
    rulesTab: 'but',
    fromBox: {},
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
    if (r.width < 640) return 'tall';
    const ratio = r.width / Math.max(1, r.height);
    return ratio >= 1.4 ? 'wide' : ratio >= 0.8 ? 'square' : 'tall';
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
    if (roomSignature() !== roomSig) {
      renderTable();
      if (!animating) renderView(); // l'hôte a pu changer : « Manche suivante » change de main
    }
  }, 1500);

  function roomSignature() {
    const room = ctx.getRoom();
    return JSON.stringify([room?.hostId, (room?.players ?? []).map((p) => [p.id, p.connected, p.avatarUrl])]);
  }

  // ================================================================ squelette (une fois)

  function decor() {
    const t = document.createElement('template');
    t.innerHTML = T.screens.app({ table: 'salon', body: '' });
    return t.content.querySelector('.tp-zone > .tp-decor')?.outerHTML ?? '';
  }

  function build() {
    const last = T.Button({ variant: 'icon', icon: 'eye', label: 'Dernier pli', attrs: { 'data-open': 'dernier-pli' } });
    const tools = T.Tools({ buttons: ['journal', 'scores', 'regles', 'animations'] }).replace(/(<nav class="tp-tools"[^>]*>)/, `$1${last}`);
    host.innerHTML = `<div class="tp-app"><main class="tp-zone" data-zone="game" aria-label="Table du Président">${decor()}`
      + '<div class="pr-table"></div>'
      + tools
      + '<div class="tp-toasts" aria-live="polite"></div>'
      + T.Drawer({ id: 'journal', title: 'Journal', body: '' })
      + T.Drawer({ id: 'scores', title: 'Feuille de scores', className: 'tp-drawer--wide', body: '' })
      + '<div class="pr-layer" data-layer="dialog"></div><div class="pr-layer" data-layer="view"></div><div class="pr-layer" data-layer="rules"></div></main></div>';
    zone = host.querySelector('.tp-zone');
    layers = {
      dialog: zone.querySelector('[data-layer="dialog"]'),
      view: zone.querySelector('[data-layer="view"]'),
      rules: zone.querySelector('[data-layer="rules"]'),
    };
    host.addEventListener('click', onClick);
    host.addEventListener('keydown', onKey);
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
    const live = !!prev && prev === shown && !gap && fresh.length <= 12;
    const motion = live && !superseded && T.motion.enabled() && !document.hidden;
    setAnimating(true);
    try {
      if (live && !superseded) await before(prev, next, fresh, motion).catch((err) => console.error(err));
      if (disposed) return;
      prepare(prev, next, fresh);
      state = next;
      if (superseded) return;
      shape = measureShape();
      render();
      if (live) notices(prev, next, fresh);
      if (motion) await after(prev, next, fresh).catch((err) => console.error(err));
      else if (!prev && freshDeal(next) && T.motion.enabled() && !document.hidden) await dealAnim(next).catch((err) => console.error(err));
    } finally {
      ui.held = null;
      ui.bubbles = {};
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

  /** Pause (pli complet), écourtée si d'autres états arrivent. */
  function hold(ms) {
    if (queued > 0) return Promise.resolve();
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

  const freshDeal = (s) => s.round === 1 && s.phase === 'playing' && !s.pile.length && s.trickNumber === 1
    && !s.events.some((e) => e.type === 'play' || e.type === 'pass');

  /** Met à jour l'état local de l'interface quand la situation change. */
  function prepare(prev, next) {
    if (String(next.round) !== ui.roundKey) {
      ui.roundKey = String(next.round);
      ui.sel = [];
    }
    // la sélection ne survit pas à un changement de tour ou de pli (sauf l'échange en cours)
    const keep = (next.phase === 'exchange' && prev?.phase === 'exchange')
      || (next.isMyTurn && prev?.isMyTurn && prev.pile.length === next.pile.length && prev.trickNumber === next.trickNumber);
    ui.sel = keep ? ui.sel.filter((id) => next.myHand.some((c) => c.id === id)) : [];
    const ended = (s) => s?.phase === 'roundEnd' || s?.phase === 'gameOver';
    if (!ended(next)) ui.view = null;
    else if (!prev) ui.view = next.phase === 'gameOver' ? 'end' : 'summary';
    else if (!ended(prev)) ui.view = 'summary';
    if (next.phase !== prev?.phase && ui.dialog === 'dernier-pli' && !next.lastTrick) ui.dialog = null;
  }

  // ================================================================ rendu

  const q = (sel) => zone?.querySelector(sel) ?? null;
  const qa = (sel) => (zone ? [...zone.querySelectorAll(sel)] : []);
  const plateEl = (pid) => q(`.pr-plate[data-seat="${CSS.escape(pid)}"]`);
  const handCard = (id) => q(`.pr-hand [data-card-id="${CSS.escape(id)}"]`);
  /** Boîte relative à la zone, pour Tapis.anim.play({ from }) (un DOMRect ne convient pas). */
  const boxIn = (el) => {
    const z = zone.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const b = { x: r.left - z.left, y: r.top - z.top, w: r.width, h: r.height };
    b.cx = b.x + b.w / 2;
    b.cy = b.y + b.h / 2;
    return b;
  };
  /** D'où partent (où arrivent) les cartes d'un joueur : son éventail, sinon son avatar ; moi : ma main. */
  const seatSource = (pid) => {
    if (pid === me) return [q('.pr-hand .tp-hand'), plateEl(me)?.querySelector('.tp-avatar')].find(visible) ?? null;
    const fan = q(`.pr-spot[data-pid="${CSS.escape(pid)}"] .tp-fan`);
    if (visible(fan)) return fan;
    const plate = plateEl(pid);
    const av = plate?.querySelector('.tp-avatar');
    return visible(av) ? av : visible(plate) ? plate : null;
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
    const old = q('.pr-table');
    const scroll = old?.scrollTop ?? 0;
    const focus = focusKey(document.activeElement);
    const fresh = T.node(tableHtml(view()));
    old.replaceWith(fresh);
    if (scroll) fresh.scrollTop = scroll;
    wireHand(fresh);
    if (focus) fresh.querySelector(focus)?.focus({ preventScroll: true });
    revealHand(fresh);
  }

  /** Téléphone : quand vient mon tour (ou mon choix de cartes à rendre), la table défile jusqu'à ma main entière. */
  let revealed = null;
  function revealHand(table) {
    const mode = shape === 'tall' ? handMode(view()) : null;
    const was = revealed;
    revealed = mode;
    if (!mode || mode === was) return;
    const hand = table.querySelector('.pr-hand');
    if (!hand) return;
    const bar = table.querySelector('.pr-actions');
    const limit = bar?.offsetHeight ? bar.getBoundingClientRect().top : table.getBoundingClientRect().bottom;
    const over = hand.getBoundingClientRect().bottom - limit;
    if (over > 0) table.scrollTop += Math.ceil(over) + 4;
  }

  /** Retrouve après un rendu le contrôle qui avait le focus (clavier). */
  function focusKey(el) {
    if (!el || !zone?.contains(el) || !el.closest('.pr-table')) return null;
    for (const attr of ['data-card-id', 'data-act', 'data-open']) {
      if (el.hasAttribute(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
    }
    return null;
  }

  let viewHtml = '';
  function renderView() {
    const v = view();
    let html = '';
    if (ui.view === 'summary' && state.summary) html = summaryDialog(v);
    else if (ui.view === 'end' && state.phase === 'gameOver') html = endScreen(v);
    if (html === viewHtml) return;
    viewHtml = html;
    layers.view.innerHTML = html;
    if (html) layers.view.querySelector('.tp-dialog [data-act], .tp-end .tp-btn')?.focus({ preventScroll: true });
  }

  let dialogHtml = '';
  function renderDialog() {
    const html = ui.dialog === 'dernier-pli' ? lastTrickDialog(view()) : '';
    if (html === dialogHtml) return;
    dialogHtml = html;
    layers.dialog.innerHTML = html;
    if (html) layers.dialog.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  const drawerHtml = new Map();
  function renderDrawers() {
    const v = view();
    setDrawerBody('journal', journalHtml(v));
    setDrawerBody('scores', scoreSheet(v));
  }
  function setDrawerBody(id, html) {
    const body = q(`#${id}.tp-drawer .tp-drawer__b`);
    if (!body || drawerHtml.get(id) === html) return;
    drawerHtml.set(id, html);
    body.innerHTML = html;
  }

  function renderRules() {
    const s = state ?? latest;
    layers.rules.innerHTML = ui.rules ? rulesDialog(T, { tab: ui.rulesTab, options: s?.options, players: s?.playerCount, rounds: s?.totalRounds }) : '';
    if (!ui.rules) return;
    T.interact.tabs(layers.rules);
    layers.rules.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  /** Statut et actions seulement (la main garde le focus clavier). */
  function updateSelectionUi() {
    const v = view();
    const st = q('.pr-status');
    if (st) st.innerHTML = T.Status(statusFor(v));
    const ac = q('.pr-actions');
    if (ac) ac.innerHTML = actionsHtml(v);
  }

  // ================================================================ main (souris + clavier)

  function wireHand(table) {
    const hand = table.querySelector('.pr-hand .tp-hand');
    if (!hand || !hand.querySelector('button.tp-card')) return;
    const api = T.interact.hand(hand, { multi: true, onChange: onSelect });
    // Échap vide la sélection sans prévenir : on se resynchronise
    hand.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        queueMicrotask(() => {
          ui.sel = api.selected();
          updateSelectionUi();
        });
      }
    });
  }

  function setSel(card, on) {
    card.setAttribute('aria-pressed', String(on));
    const st = (card.dataset.state || '').split(' ').filter((x) => x && x !== 'selected');
    if (on) st.push('selected');
    card.setAttribute('data-state', st.join(' '));
  }

  /** Sélection : une seule valeur à la fois, autant de cartes que l'entame ; une carte choisie complète la paire. */
  function onSelect(ids, card) {
    if (!state) return;
    const mode = handMode(view());
    const byId = new Map(state.myHand.map((c) => [c.id, c]));
    const id = card?.dataset.cardId;
    let sel = ids.filter((x) => byId.has(x));
    if (mode === 'give') {
      const need = state.exchange.me.count;
      if (sel.length > need && card) {
        setSel(card, false);
        T.anim.refuse(card, { reason: `Déjà ${need === 1 ? '1 carte choisie' : `${need} cartes choisies`}` });
        sel = sel.filter((x) => x !== id);
      }
    } else if (mode === 'play' && id && sel.includes(id)) {
      const rank = byId.get(id).rank;
      const top = state.pile.at(-1);
      // une autre valeur était choisie : elle laisse la place
      for (const other of sel.filter((x) => byId.get(x).rank !== rank)) {
        const el = handCard(other);
        if (el) setSel(el, false);
      }
      sel = sel.filter((x) => byId.get(x).rank === rank);
      if (top && sel.length > top.count) {
        setSel(card, false);
        T.anim.refuse(card, { reason: top.count === 1 ? 'Une seule carte, comme l’entame' : `${top.count} cartes, comme l’entame` });
        sel = sel.filter((x) => x !== id);
      } else if (top && top.count > 1 && sel.length === 1) {
        // suivre une paire, un brelan : on complète avec les cartes de même valeur
        const mates = sortForOrder(state.myHand.filter((c) => c.rank === rank && c.id !== id), makeOrder()).slice(0, top.count - 1);
        if (mates.length === top.count - 1) {
          for (const m of mates) {
            const el = handCard(m.id);
            if (el) setSel(el, true);
            sel.push(m.id);
          }
        }
      }
    }
    ui.sel = sel;
    updateSelectionUi();
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
      // « Manche suivante » cliqué en même temps qu'un autre joueur : la nouvelle manche est déjà là
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

  function playSelection() {
    if (busy || animating || !state?.isMyTurn || state.phase !== 'playing' || !ui.sel.length) return;
    send('play', { cardIds: [...ui.sel] });
  }

  function giveSelection() {
    const x = state?.exchange?.me;
    if (busy || animating || state.phase !== 'exchange' || x?.role !== 'receiver' || x.gave || ui.sel.length !== x.count) return;
    send('give', { cardIds: [...ui.sel] });
  }

  function openRanking() {
    ui.view = 'end';
    renderView();
    renderTable();
    local(async (motion) => {
      const end = q('.tp-end');
      if (!motion || !end) return;
      const best = Math.max(...state.players.map((p) => p.score));
      await go(state.players.find((p) => p.id === me)?.score === best ? T.anim.victory(end) : T.anim.ranking(end));
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
    switch (act.dataset.act) {
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
        if (state.phase === 'roundEnd' && view().isHost) send('next');
        return;
      default:
    }
    // ---- actions de jeu : pas pendant une transition ni une requête en cours
    if (animating || busy) return;
    if (act.dataset.act === 'play') playSelection();
    else if (act.dataset.act === 'pass' && state.canPass) send('pass');
    else if (act.dataset.act === 'give') giveSelection();
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
    } else if (id === 'dernier-pli') {
      ui.dialog = null;
      renderDialog();
      q('.tp-tools [data-open="dernier-pli"]')?.focus({ preventScroll: true });
    } else if (id === 'resume') {
      ui.view = null;
      renderView();
      renderTable();
    }
  }

  function onKey(e) {
    if (!state) return;
    if (e.key === 'Enter' && e.target.closest?.('.pr-hand .tp-hand')) {
      // Entrée dans la main : joue (ou rend) la sélection si le bouton principal est actif
      const btn = q('.pr-actions .tp-btn--primary');
      if (btn && btn.getAttribute('aria-disabled') !== 'true') {
        e.preventDefault();
        btn.click();
      }
      return;
    }
    if (e.key !== 'Escape' || e.target.closest?.('.tp-hand')) return;
    if (ui.rules) closeTool('regles');
    else if (ui.dialog) closeTool('dernier-pli');
    else if (ui.view === 'summary') closeTool('resume');
    else if (q('.tp-drawer[data-open]')) closeDrawers();
  }

  // ================================================================ animations maison (Web Animations, via les timelines Tapis)

  function fxLayer(tl) {
    const l = document.createElement('div');
    l.className = 'tp-fx';
    l.setAttribute('aria-hidden', 'true');
    zone.append(l);
    return tl.node(l);
  }

  /**
   * Des cartes qui volent d'un point à un autre (échange) : de dos pour ceux qui ne doivent pas les voir,
   * de face pour les deux joueurs concernés. Elles s'effacent à l'arrivée (la vraie carte est déjà en place, ou cachée).
   */
  function flyCards(from, to, { cards = null, count = 1, delay = 0, duration = 560 } = {}) {
    const tl = new T.Timeline({ delay });
    if (!tl.on || !from || !to) return tl.start();
    const lay = fxLayer(tl);
    const a = from.x != null ? from : boxIn(from);
    const b = to.x != null ? to : boxIn(to);
    const h = Math.max(48, Math.min(120, (q('.pr-hand .tp-card')?.getBoundingClientRect().height ?? 120) * 0.7));
    const w = h * 5 / 7;
    const list = cards ? cards.map((c) => T.Card(tp(c, { size: 'sm' }))) : Array.from({ length: count }, () => T.Back({ size: 'sm' }));
    list.forEach((html, i) => {
      const g = T.node(html);
      g.classList.add('tp-ghost', 'pr-ghost');
      g.style.cssText = `position:absolute;left:${b.cx - w / 2}px;top:${b.cy - h / 2}px;width:${w}px;height:${h}px;--ch:${h}px;margin:0;`;
      lay.append(g);
      const dx = a.cx - b.cx;
      const dy = a.cy - b.cy;
      const spread = (i - (list.length - 1) / 2) * 16;
      tl.add(g, [
        { transform: `translate(${dx}px, ${dy}px) rotate(-8deg) scale(.7)`, opacity: 0 },
        { transform: `translate(${dx * 0.85 + spread}px, ${dy * 0.85}px) rotate(-6deg) scale(.85)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${dx * 0.45 + spread}px, ${dy * 0.45 - 40}px) rotate(${spread / 3}deg) scale(1.05)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${spread * 0.4}px, 0) rotate(${spread / 4}deg) scale(.9)`, opacity: 1, offset: 0.9 },
        { transform: `translate(${spread * 0.4}px, 0) scale(.8)`, opacity: 0 },
      ], { duration, delay: i * 110, easing: T.motion.ease.inOut });
    });
    return tl.start();
  }

  /** Révolution : le mot éclate au centre, le feutre rougeoie un instant. */
  function revolutionFx(on, center) {
    const tl = new T.Timeline({});
    if (!tl.on) return tl.start();
    const lay = fxLayer(tl);
    const z = zone.getBoundingClientRect();
    const b = center ? boxIn(center) : { cx: z.width / 2, cy: z.height * 0.4 };
    const s = document.createElement('span');
    s.className = 'pr-revfx title-xl';
    s.textContent = on ? 'Révolution' : 'Contre-révolution';
    s.style.cssText = `left:${b.cx}px;top:${b.cy}px`;
    lay.append(s);
    tl.add(s, [
      { transform: 'translate(-50%, -50%) scale(.4) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.18) rotate(3deg)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -50%) scale(1) rotate(0)', opacity: 1, offset: 0.7 },
      { transform: 'translate(-50%, -60%) scale(1.05)', opacity: 0 },
    ], { duration: 1500, easing: T.motion.ease.out });
    const felt = q('.pr-felt__cloth');
    if (felt) tl.add(felt, [{ filter: 'none' }, { filter: 'hue-rotate(-70deg) saturate(1.6) brightness(1.15)', offset: 0.3 }, { filter: 'none' }], { duration: 1500, easing: T.motion.ease.inOut });
    const pile = q('.pr-pile');
    if (pile) tl.add(pile, [{ transform: 'none' }, { transform: 'rotate(180deg) scale(.9)', offset: 0.5 }, { transform: 'rotate(360deg)' }], { duration: 900, delay: 200, easing: T.motion.ease.inOut });
    return tl.start();
  }

  /** Une bulle qui éclot sur la plaque d'un joueur (sur l'écran affiché). */
  function popBubble(pid, b) {
    const plate = plateEl(pid);
    if (!visible(plate) || !b) return null;
    plate.querySelector(':scope > .tp-bubble')?.remove();
    plate.insertAdjacentHTML('afterbegin', T.Bubble(b));
    return T.anim.bubble(plate.querySelector(':scope > .tp-bubble'));
  }

  /** Les cartes d'un coup arrivent sur la pile, depuis ma main ou l'éventail du joueur. */
  function landPlay(e, layer) {
    const jobs = [];
    if (!layer) return jobs;
    const mine = e.playerId === me;
    const src = mine ? null : seatSource(e.playerId);
    [...layer.querySelectorAll('.tp-card')].forEach((card, i) => {
      const from = mine ? ui.fromBox[card.dataset.cardId] : src;
      if (from && visible(card)) jobs.push(go(T.anim.play(card, { from, flip: !mine, delay: i * 80 })));
    });
    return jobs;
  }

  // ================================================================ avant le rendu : on rejoue sur l'écran affiché

  async function before(prev, next, fresh, motion) {
    const has = (type) => fresh.some((e) => e.type === type);
    ui.fromBox = {};
    for (const e of fresh) {
      if (e.type !== 'play' || e.playerId !== me) continue;
      for (const c of e.cards) {
        const el = handCard(c.id);
        if (visible(el)) ui.fromBox[c.id] = boxIn(el);
      }
    }

    // je rends des cartes au Trouduc : elles quittent ma main vers son siège
    const ret = fresh.find((e) => e.type === 'return' && e.from === me);
    if (motion && ret?.cards) {
      const target = seatSource(ret.to);
      const els = ret.cards.map((c) => handCard(c.id)).filter(visible);
      if (els.length && target) {
        const from = boxIn(els[0]);
        els.forEach((el) => { el.style.visibility = 'hidden'; });
        await go(flyCards(from, target, { cards: ret.cards }));
      }
    }

    // pli fini (ou manche finie) : la dernière combinaison se pose, le pli reste un instant, puis part à la défausse
    const trick = fresh.find((e) => e.type === 'trick');
    const roundEnd = has('roundEnd');
    if (!trick && !roundEnd) return;
    const play = fresh.filter((e) => e.type === 'play').at(-1);
    const passEv = fresh.filter((e) => e.type === 'pass').at(-1);
    if (!play && !passEv) return;
    const plays = [...prev.pile, ...(play ? [{ playerId: play.playerId, cards: play.cards, rank: play.rank, count: play.count }] : [])];
    if (!plays.length) return;
    const v = view(prev);
    ui.held = plays;
    ui.heldWinner = trick?.winnerId ?? null;
    ui.heldReason = trick ? REASON[trick.reason] ?? '' : 'Dernières cartes de la manche';
    try {
      // l'écran affiché garde le pli complet : statut, plus de boutons, plus de halo
      const pile = q('.pr-pile');
      if (pile) pile.replaceWith(T.node(pileHtml(v, plays)));
      const st = q('.pr-status');
      if (st) st.innerHTML = T.Status(statusFor(view(prev)));
      const ac = q('.pr-actions');
      if (ac) ac.innerHTML = '';
      q('.pr-need')?.remove();
      for (const plate of qa('.pr-plate[data-state="active"]')) {
        plate.setAttribute('data-state', 'waiting');
        plate.querySelector('.tp-avatar')?.setAttribute('data-state', 'waiting');
        plate.querySelector('.tp-seat__turn')?.remove();
      }
      const cap = q('.pr-cap');
      const top = plays.at(-1);
      if (cap && play) {
        cap.removeAttribute('data-empty');
        cap.innerHTML = `${T.Avatar({ name: nameOf(top.playerId), src: v.avatarOf(top.playerId), size: 'sm' })}<b class="body-strong">${T.esc(v.label(top.playerId))}</b><span class="caption">${T.esc(comboName(top.rank, top.count, { article: false }))}</span>`;
      }
      if (play && play.playerId === me) for (const c of play.cards) { const el = handCard(c.id); if (el) el.style.visibility = 'hidden'; }
      if (motion && play) {
        const layer = qa('.pr-pile .pr-play').at(-1);
        await Promise.all(landPlay(play, layer));
        if (has('revolution')) await go(revolutionFx(fresh.filter((e) => e.type === 'revolution').at(-1).on, q('.pr-pile')));
      }
      if (motion && passEv && !play) await go(popBubble(passEv.playerId, { text: 'Passe', tone: 'pass' }));
      if (trick) {
        const winner = plateEl(trick.winnerId);
        if (motion && visible(winner)) {
          const tl = new T.Timeline({});
          tl.add(winner, [{ boxShadow: 'none' }, { boxShadow: 'var(--glow-winner)', offset: 0.4 }, { boxShadow: 'none' }], { duration: HOLD });
          go(tl.start());
        }
        await hold(motion ? HOLD : HOLD + 300);
        const pileEl = q('.pr-pile');
        const discard = q('.pr-discard .tp-pile');
        if (motion && pileEl && visible(discard)) await go(T.anim.collect(pileEl, discard, { hold: 0 }));
      } else {
        await hold(motion ? 500 : 700);
      }
    } finally {
      ui.held = null;
    }
  }

  // ================================================================ après le rendu : ce qui arrive

  async function after(prev, next, fresh) {
    const has = (type) => fresh.some((e) => e.type === type);
    const jobs = [];
    if (has('deal')) await dealAnim(next);

    // échange : les meilleures cartes du Trouduc (et du Vice-trouduc) partent, les cartes rendues reviennent
    let k = 0;
    for (const e of fresh) {
      if (e.type !== 'tribute' && e.type !== 'return') continue;
      if (e.type === 'return' && e.from === me) continue; // déjà joué avant le rendu
      if (e.to === me && e.cards) {
        // cartes reçues : elles arrivent dans ma main, retournées
        const src = seatSource(e.from);
        e.cards.forEach((c, i) => {
          const el = handCard(c.id);
          if (src && visible(el)) jobs.push(go(T.anim.play(el, { from: src, flip: true, delay: k * 300 + i * 110 })));
        });
      } else {
        const src = seatSource(e.from);
        const dst = seatSource(e.to);
        if (src && dst) jobs.push(go(flyCards(src, dst, { cards: e.from === me ? e.cards : null, count: e.count, delay: k * 300 })));
      }
      k++;
    }

    // coup joué (le pli continue) : les cartes arrivent sur la pile
    if (!has('trick') && !has('roundEnd')) {
      const play = fresh.filter((e) => e.type === 'play').at(-1);
      if (play) {
        const layer = qa('.pr-pile .pr-play').at(-1);
        await Promise.all(landPlay(play, layer));
        const rev = fresh.filter((e) => e.type === 'revolution').at(-1);
        if (rev) {
          const hand = q('.pr-hand .tp-hand');
          const order = sortForOrder(prev.myHand.filter((c) => next.myHand.some((x) => x.id === c.id)), makeOrder({ revolution: prev.revolution, twoCloses: prev.options.twoCloses })).map((c) => c.id);
          jobs.push(go(revolutionFx(rev.on, q('.pr-pile'))));
          if (hand && order.length > 1) jobs.push(go(T.anim.sort(hand, { order, delay: 500 })));
        }
      }
      // « Passe »
      const passEv = fresh.filter((e) => e.type === 'pass').at(-1);
      const bubble = passEv && plateEl(passEv.playerId)?.querySelector(':scope > .tp-bubble');
      if (visible(bubble)) jobs.push(go(T.anim.bubble(bubble)));
    }

    // un joueur pose sa dernière carte : son badge de place éclot
    for (const e of fresh) {
      if (e.type !== 'finish') continue;
      const plate = plateEl(e.playerId);
      if (visible(plate) && plate.querySelector('.pr-plate__b .tp-badge:last-child')) jobs.push(go(T.anim.partner(plate)));
    }

    // le halo du tour passe au joueur suivant (sans attendre)
    if (!has('deal') && prev.currentPlayerId && next.currentPlayerId && prev.currentPlayerId !== next.currentPlayerId) {
      const a = plateEl(prev.currentPlayerId);
      const b = plateEl(next.currentPlayerId);
      if (visible(a) && visible(b) && b.dataset.state === 'active') T.anim.run('turn', () => T.anim.turn(a, b));
    }

    await Promise.all(jobs);
    if (has('roundEnd') && ui.view === 'summary') {
      const deal = q('.tp-deal');
      if (deal) await go(T.anim.summary(deal));
    }
  }

  /** Donne : le paquet se mélange au centre, puis part vers chaque siège ; ma main se retourne. */
  async function dealAnim(s) {
    const center = q('.pr-pile') ?? q('.pr-x');
    const hand = q('.pr-hand .tp-hand');
    if (!visible(center) || !hand) return;
    const deck = T.node(T.Back({ size: 'sm', className: 'pr-deck' }));
    const z = boxIn(center);
    deck.style.cssText = `position:absolute;left:${z.cx}px;top:${z.cy}px;translate:-50% -50%;z-index:20;`;
    zone.append(deck);
    hand.style.visibility = 'hidden'; // ma main se retourne pendant la donne (Tapis la cache dès son départ)
    try {
      await go(T.anim.shuffle(deck));
      const targets = s.players.filter((p) => p.id !== me).map((p) => {
        const el = seatSource(p.id);
        const n = s.events.find((e) => e.type === 'deal' && e.round === s.round)?.counts?.[p.id] ?? p.cardCount;
        return el ? { el, n } : null;
      }).filter(Boolean);
      const tl = T.anim.deal(deck, targets, { hand, packet: 3, maxRounds: 3 });
      hand.style.visibility = '';
      await go(tl);
    } finally {
      deck.remove();
      hand.style.visibility = '';
    }
  }

  // ================================================================ notifications de table

  function notices(prev, next, fresh) {
    for (const e of fresh) {
      if (e.type === 'revolution') {
        const who = e.playerId === me ? 'Ton carré' : `Le carré de ${nameOf(e.playerId)}`;
        notify({
          tone: 'info', title: e.on ? 'Révolution' : 'Contre-révolution',
          text: e.on ? `${who} inverse l’ordre jusqu’à la fin de la manche : il faut jouer plus bas.` : `${who} rétablit l’ordre normal.`,
        });
      }
      if (e.type === 'finish' && e.playerId === me) notify({ tone: 'success', text: `Tu n’as plus de cartes : ${placeText(e.place)} !` });
      else if (e.type === 'finish' && next.phase === 'playing') notify({ tone: 'info', text: `${nameOf(e.playerId)} n’a plus de cartes : ${placeText(e.place)}` });
      if (e.type === 'playStart' && !e.first && next.round > 1 && e.leaderId === me) notify({ tone: 'info', text: 'Trouduc, c’est toi qui entames' });
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
