import { createView, SUIT, tp, total, pl, atkTxt, theBoss, isOver } from './view.js';
import { rulesDialog } from './rules.js';

/* =====================================================================
 * Interface de « La Chute des Rois », dessinée avec le design system Claude Design
 * « Tapis » (table « cour », https://claude.ai/artifact/M8sPJm4BwpyyvVesz23YyD),
 * importé dans public/vendor/tapis/ et partagé par les jeux de cartes.
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie
 * 'play', 'yield', 'defend' et 'renew'.
 *
 * Mouvement : chaque nouvel état est joué événement par événement. Les animations
 * qui retirent quelque chose (pose, dégâts, K.O., encaissement) jouent sur l'écran
 * affiché ou sur une vue intermédiaire ; celles qui font entrer quelque chose
 * (nouveau boss, pioche, riposte) jouent sur la vue finale. La dernière image est
 * toujours l'état reçu du serveur. Toujours attendre timeline.done(), jamais la timeline.
 * ===================================================================== */

const TAPIS_JS = '/vendor/tapis/bundle.js';
const TAPIS_CSS = '/vendor/tapis/tapis.css';
const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'tapis.motion'; // partagé par les jeux de cartes
const LEGACY_MOTION_KEY = 'cdr.animations'; // ancien réglage de ce jeu, repris s'il existe
const RULES_SEEN_KEY = 'cdr.rulesSeen';

let tapisLoading = null;
function loadTapis() {
  if (window.Tapis) return Promise.resolve(window.Tapis);
  tapisLoading ??= new Promise((resolve, reject) => {
    // un seul <script> : un second chargement doublerait l'interrupteur d'animations
    let script = document.querySelector(`script[src="${TAPIS_JS}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = TAPIS_JS;
      document.head.append(script);
    }
    script.addEventListener('load', () => resolve(window.Tapis), { once: true });
    script.addEventListener('error', () => {
      tapisLoading = null;
      script.remove(); // le prochain montage insère un <script> neuf (celui-ci ne déclenchera plus rien)
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

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
  },
};

/** 'on' | 'off' | null (sans réglage : Tapis suit prefers-reduced-motion). */
function readMotion() {
  const v = storage.get(MOTION_KEY);
  if (v === 'on' || v === 'off') return v;
  const legacy = storage.get(LEGACY_MOTION_KEY);
  return legacy === 'on' || legacy === 'off' ? legacy : null;
}

/** Décors privés du bundle (château de la zone, trône du boss), extraits d'un écran de référence. */
function decorOf(T) {
  const t = document.createElement('template');
  t.innerHTML = T.screens.app({ table: 'cour', body: T.screens.courTable({ boss: { card: { suit: 'coeur', rank: 'R' } } }) });
  return {
    zone: t.content.querySelector('.tp-zone > .tp-decor')?.outerHTML ?? '',
    throne: t.content.querySelector('.tp-decor--boss')?.outerHTML ?? '',
  };
}

export function mount(root, ctx) {
  const me = ctx.me.id;
  const css = [addCss(TAPIS_CSS), addCss(`${BASE}style.css`)]; // tapis.css d'abord, nos réglages ensuite

  // .tp-scope porte les tokens Tapis, la table « cour » et l'interrupteur d'animations.
  const host = document.createElement('div');
  host.className = 'tp-scope cdr';
  host.dataset.table = 'cour';
  host.dataset.theme = 'cour';
  host.setAttribute('data-motion-host', '');
  const pref = readMotion();
  if (pref) host.dataset.motion = pref;
  host.innerHTML = '<p class="cdr-loading">Préparation de la table…</p>';
  root.append(host);

  let T = null;
  let V = null;
  let zone = null;
  let state = null; // état serveur affiché
  let latest = null; // dernier état reçu
  let chain = Promise.resolve();
  let queued = 0;
  let lastEvent = 0;
  let animating = false;
  let busy = false;
  let disposed = false;
  let endHtml = '';
  const timers = new Set();
  const ui = {
    sel: [], selKey: '', bubbles: {}, replay: null, endHidden: false,
    dialog: null, rulesTab: 'base', opener: null, roomKey: '',
  };

  const later = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!disposed) fn();
    }, ms);
    timers.add(id);
  };

  // ---------------------------------------------------------------- hauteur : la table tient dans la fenêtre

  /**
   * Tapis a deux mises en page : la table PC (il lui faut ~1100 px de large) et la colonne mobile (sous 640 px).
   * Entre les deux (tablette, petite fenêtre), la table est dessinée à l'une de ces largeurs puis mise à l'échelle :
   * PC légèrement réduit de 900 à 1100 px, colonne mobile agrandie de 640 à 900 px.
   */
  let scale = 1;
  function fit() {
    const top = host.getBoundingClientRect().top + window.scrollY;
    const layout = host.closest('.room-layout');
    const pad = layout ? parseFloat(getComputedStyle(layout).paddingBottom) || 0 : 16;
    const h = Math.max(320, Math.floor(window.innerHeight - top - pad));
    host.style.height = `${h}px`;
    const app = host.querySelector('.tp-app');
    if (!app) return;
    // largeur fractionnaire, comme la requête de conteneur Tapis (max-width: 639px) ; clientWidth est arrondi
    const w = host.getBoundingClientRect().width;
    const base = w > 639 && w < 900 ? 639 : w >= 900 && w < 1100 ? 1100 : 0;
    scale = base ? w / base : 1;
    Object.assign(app.style, base
      ? { width: `${base}px`, height: `${h / scale}px`, transform: `scale(${scale})`, transformOrigin: '0 0' }
      : { width: '', height: '', transform: '', transformOrigin: '' });
  }
  fit();
  window.addEventListener('resize', fit);

  const onMotion = (e) => storage.set(MOTION_KEY, e.detail.on ? 'on' : 'off');
  document.addEventListener('tapis:motion', onMotion);

  Promise.all([loadTapis(), ...css.map((c) => c.ready)]).then(([t]) => {
    if (disposed) return;
    T = t;
    V = createView(T, { me, room: () => ctx.getRoom() });
    buildShell();
    if (latest) enqueue(latest);
    if (!storage.get(RULES_SEEN_KEY)) {
      storage.set(RULES_SEEN_KEY, '1');
      later(400, () => openRules('base'));
    }
  }).catch((err) => {
    host.innerHTML = '<p class="cdr-loading">Impossible de charger la table.</p>';
    ctx.toast(err.message, 'error');
  });

  function buildShell() {
    const decor = decorOf(T);
    V.throne = decor.throne;
    host.innerHTML = `<div class="tp-app"><section class="tp-zone" data-zone="game" aria-label="Table de jeu">${decor.zone}
      <div class="tp-table tp-table--cour"></div>
      ${T.Tools({ buttons: ['journal', 'regles', 'animations'] })}
      <div class="tp-toasts" aria-live="polite"></div>
      ${T.Drawer({ id: 'journal', title: 'Journal', body: '' })}
      <div class="cdr-layer" data-layer="end"></div><div class="cdr-layer" data-layer="dialog"></div>
    </section></div>`;
    zone = host.querySelector('.tp-zone');
    fit();
  }

  // ================================================================ file des états

  const live = () => !disposed && queued === 0 && T.motion.enabled();

  function enqueue(next) {
    queued++;
    if (queued > 1) T.anim.finishAll(); // plusieurs états en attente : on rattrape le serveur
    chain = chain.then(() => step(next)).catch((err) => console.error('[cdr]', err));
  }

  async function step(next) {
    queued--;
    if (disposed || !T) return;
    const prev = state;
    const fresh = prev ? next.events.filter((e) => e.id > lastEvent) : [];
    lastEvent = next.events.reduce((m, e) => Math.max(m, e.id), lastEvent);
    prepare(prev, next, fresh);
    state = next;
    const animate = !!prev && fresh.length > 0 && fresh.length <= 8 && live();
    const deal = !prev && next.turn === 1 && next.events.length === 0 && next.myHand.length > 0; // début de partie
    setAnimating(true);
    try {
      let shown = false;
      if (animate) shown = await play(prev, next, fresh).catch((err) => { console.error('[cdr] animation', err); return false; });
      if (disposed) return;
      if (!animate) notices(fresh);
      renderFinal({ table: !shown });
      if (deal && live()) await animDeal(next).catch((err) => console.error('[cdr] animation', err));
      if (animate && live() && isOver(next) && !isOver(prev)) await endAnimation(next);
    } finally {
      setAnimating(false);
    }
  }

  function setAnimating(on) {
    animating = on;
    host.toggleAttribute('data-animating', on);
  }

  /** Réglages de l'interface quand un nouvel état arrive. */
  function prepare(prev, next, fresh) {
    const key = `${next.phase}|${next.currentPlayerId}|${next.turn}`;
    if (key !== ui.selKey) {
      ui.selKey = key;
      ui.sel = [];
    }
    const inHand = new Set(next.myHand.map((c) => c.id));
    ui.sel = ui.sel.filter((id) => inHand.has(id));
    if (fresh.length) {
      ui.bubbles = {};
      for (const e of fresh) {
        const b = V.bubbleFor(e);
        if (b && e.playerId !== me) ui.bubbles[e.playerId] = b;
      }
      // « Tu rejoues contre… » : seulement contre le boss qui vient d'arriver
      ui.replay = fresh.some((e) => e.type === 'newBoss') && next.boss ? { pid: next.currentPlayerId, boss: next.boss.card.id } : null;
    }
    if (isOver(next) && (!prev || !isOver(prev))) ui.endHidden = false;
    if (ui.dialog === 'renew' && (isOver(next) || !next.isMyTurn || !next.renewalsLeft)) closeDialog();
  }

  const viewOf = (s, extra = {}) => ({
    ...s, sel: ui.sel, bubbles: ui.bubbles, endHidden: ui.endHidden, locked: false, acting: null,
    replay: ui.replay && s.boss?.card.id === ui.replay.boss ? ui.replay.pid : null,
    ...extra,
  });

  // ================================================================ rendu

  const q = (sel) => zone.querySelector(sel);
  const qa = (sel) => [...zone.querySelectorAll(sel)];
  const roomKey = () => {
    const room = ctx.getRoom();
    return `${room?.hostId}|${(room?.players ?? []).map((p) => `${p.id}:${p.connected}:${p.avatarUrl ?? ''}`).join(',')}`;
  };

  function renderFinal({ table = true } = {}) {
    if (!state || !zone) return;
    fit();
    if (table) renderTable(viewOf(state));
    const log = q('#journal .tp-drawer__b');
    if (log) log.innerHTML = V.journal(state);
    renderEnd();
  }

  /** Remplace seulement .tp-table : outils, tiroirs, notifications et effets en cours restent en place. */
  function renderTable(v) {
    const old = q('.tp-table');
    if (!old) return;
    const scroll = old.scrollTop;
    const active = document.activeElement;
    const focus = old.contains(active)
      ? (active.dataset.cardId ? `.tp-hand [data-card-id="${CSS.escape(active.dataset.cardId)}"]`
        : active.dataset.act ? `[data-act="${CSS.escape(active.dataset.act)}"]` : null)
      : null;
    ui.roomKey = roomKey(); // sièges dessinés avec le salon actuel (le relevé du salon compare à cette clé)
    const node = T.node(V.table(v));
    old.replaceWith(node);
    if (scroll) node.scrollTop = scroll;
    wireTable(node);
    if (focus) {
      const target = node.querySelector(focus);
      if (target) {
        if (target.matches('.tp-card')) node.querySelectorAll('.tp-hand button.tp-card').forEach((c) => c.setAttribute('tabindex', c === target ? '0' : '-1'));
        target.focus({ preventScroll: true });
      }
    }
  }

  /** Aperçu tronqué sur les petits écrans : le texte complet reste au survol. */
  const titlePreview = (root) => root.querySelectorAll('.tp-preview').forEach((p) => { p.title = p.textContent.trim(); });

  function wireTable(node) {
    titlePreview(node);
    const hand = node.querySelector('.tp-hand');
    if (hand?.querySelector('button.tp-card')) T.interact.hand(hand, { multi: true, onChange: onSelect });
    node.querySelectorAll('.tp-power').forEach((p) => { p.title = 'Voir les pouvoirs dans les règles'; });
  }

  function renderEnd() {
    const layer = q('[data-layer="end"]');
    if (!layer) return;
    const html = state && isOver(state) && !ui.endHidden ? V.end(state) : '';
    if (html === endHtml) return;
    const opening = !endHtml && html;
    endHtml = html;
    layer.innerHTML = html;
    if (opening) layer.querySelector('[data-act="hide-end"]')?.focus({ preventScroll: true });
  }

  /** Sélection modifiée dans la main : seuls le statut et les actions sont redessinés (le focus reste sur la carte). */
  function onSelect(ids) {
    ui.sel = ids;
    updateSelectionUi();
  }

  function updateSelectionUi() {
    if (!state) return;
    const v = viewOf(state);
    const st = q('.tp-table [data-area="status"]');
    const ac = q('.tp-table [data-area="actions"]');
    if (st) {
      st.innerHTML = V.statusArea(v);
      titlePreview(st);
    }
    if (ac && state.players.some((p) => p.id === me)) ac.innerHTML = V.actionsArea(v);
  }

  function resyncSelection() {
    const hand = q('.tp-table .tp-hand');
    ui.sel = hand ? [...hand.querySelectorAll('button.tp-card[aria-pressed="true"]')].map((c) => c.dataset.cardId) : [];
    updateSelectionUi();
  }

  function notify(o) {
    if (T && zone) T.notify(zone, o);
    else ctx.toast(o.text, o.tone === 'error' ? 'error' : 'success');
  }

  /** Annonces d'un lot non animé (rattrapage, animations coupées). */
  function notices(events) {
    if (!events.length || events.length > 8) return;
    for (const e of events) {
      if (e.type === 'bossDefeated' && e.exact) notify({ tone: 'success', title: 'K.O. pile', text: `${theBoss(e.card, true)} rejoint la Taverne.` });
      if (e.type === 'newBoss') notify({ tone: 'info', title: 'Immunité', text: `${theBoss(e.card, true)} annule le pouvoir {${SUIT[e.card.suit]}}.` });
      if (e.type === 'blocked') notify({ tone: 'info', title: 'Riposte bloquée', text: 'Le bouclier absorbe toute l’attaque.' });
    }
  }

  // ================================================================ animations

  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const seatEl = (pid) => q(`.tp-table .tp-seat[data-seat="${CSS.escape(pid)}"]`);
  const pileEl = (name) => q(`.tp-table [data-pile="${name}"]`);
  const countOf = (pile) => pile?.querySelector('.tp-pile__count') ?? null;
  const handCard = (id) => q(`.tp-table .tp-hand [data-card-id="${CSS.escape(id)}"]`);
  const nameOf = (id) => (state ?? latest)?.players.find((p) => p.id === id)?.name ?? '?';
  /** Boîte relative à la zone, en px de la zone (format attendu par Tapis.anim.play ; un DOMRect ne marche pas). */
  const boxIn = (el) => {
    const z = zone.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const x = (r.left - z.left) / scale;
    const y = (r.top - z.top) / scale;
    const w = r.width / scale;
    const h = r.height / scale;
    return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
  };
  /** Origine des cartes d'un coéquipier : son avatar (ses cartes en main restent secrètes). */
  const fromSeat = (pid) => {
    const seat = seatEl(pid);
    const av = seat?.querySelector('.tp-avatar');
    return visible(av) ? av : visible(seat) ? seat : null;
  };
  /** Ma cible visible : mon siège (caché sur mobile), sinon ma main. */
  const meTarget = () => [seatEl(me), q('.tp-table .tp-hand')].find(visible) ?? null;
  const allDone = (tls) => Promise.all(tls.filter(Boolean).map((tl) => tl.done()));
  const swap = (tls, node, from, to, delay = 0) => {
    if (node && String(from) !== String(to)) tls.push(T.anim.swapText(node, String(from), String(to), { delay: Math.max(0, delay) }));
  };

  /** Joue un lot d'événements ; renvoie true si la vue finale est affichée et à jour. */
  async function play(prev, next, events) {
    let cv = viewOf(prev);
    let shown = false;
    // Lot qui finit en défaite : la table reste « avant la défaite » jusqu'à l'écran de fin
    const defeat = events.find((e) => e.type === 'defeat');
    const target = defeat ? { ...next, phase: defeat.need > 0 ? 'defend' : 'attack', pendingDamage: defeat.need ?? next.pendingDamage } : next;
    const showFinal = () => {
      if (!shown) renderTable(viewOf(target));
      shown = true;
    };
    for (const e of events) {
      if (!live()) return false;
      switch (e.type) {
        case 'attack': cv = await animAttack(e, cv, next, events); shown = false; break;
        case 'bossDefeated': cv = await animFall(e, cv); break;
        case 'newBoss': showFinal(); await animNewBoss(e, cv, next); break;
        case 'yield': showFinal(); await animBubble(e.playerId); break;
        case 'riposte': showFinal(); await animRiposte(e); break;
        case 'blocked': showFinal(); await animBlocked(e, next); break;
        case 'defend': await animDefend(e, cv); shown = false; showFinal(); await animAfterDefend(e, next); break;
        case 'renew': await animRenew(cv, next, showFinal); break;
        default: break; // victory / defeat : l'écran de fin vient après le lot
      }
      if (disposed) return false;
    }
    return shown && target === next;
  }

  /** Attaque : les cartes se posent, le boss encaisse, puis soin, pioche et bouclier. */
  async function animAttack(e, cv, next, events) {
    const mine = e.playerId === me;
    const lethal = events.some((x) => x.type === 'bossDefeated' && x.id > e.id);
    const from = {};
    if (mine) {
      for (const c of e.cards) {
        const el = handCard(c.id);
        if (visible(el)) from[c.id] = boxIn(el);
      }
    }
    const boss0 = cv.boss;
    if (!boss0) return cv;
    const active = [...new Set(e.cards.map((c) => c.suit))].filter((s) => s !== boss0.card.suit);
    const drawn = Object.values(e.drawn ?? {}).reduce((a, b) => a + b, 0);
    const shield1 = lethal ? boss0.shield : boss0.shield + e.shield;
    const vA = {
      ...cv, locked: true, acting: e.playerId, myHand: next.myHand, players: next.players,
      plays: [...cv.plays, { playerId: e.playerId, cards: e.cards }],
      boss: { ...boss0, shield: shield1 },
    };
    renderTable(vA);

    // tout est créé dans ce même tour : les cartes à venir sont cachées dès la première image
    const tls = [];
    let t = 0;
    e.cards.forEach((c, i) => {
      const sel = `[data-card-id="${CSS.escape(c.id)}"]`;
      const el = mine ? q(`.tp-table .tp-mine__c ${sel}`) : seatEl(e.playerId)?.querySelector(`.tp-seat__pcards ${sel}`);
      const src = mine ? from[c.id] : fromSeat(e.playerId);
      if (!visible(el) || !src) return;
      const tl = T.anim.play(el, { from: src, flip: !mine, delay: i * 90 });
      tls.push(tl);
      t = Math.max(t, tl.end);
    });
    const bubble = mine ? null : seatEl(e.playerId)?.querySelector('.tp-bubble');
    if (visible(bubble)) tls.push(T.anim.bubble(bubble));

    const bossEl = q('.tp-table .tp-boss');
    if (!bossEl) {
      await allDone(tls);
      return cv;
    }
    t = Math.max(0, t - 60);
    if (e.blockedSuit) {
      const power = q(`.tp-table .tp-power[data-suit="${SUIT[e.blockedSuit]}"]`);
      if (visible(power)) tls.push(T.anim.immune(power, { delay: t }));
    }
    const impact = T.anim.impact(bossEl, e.damage, { double: e.doubled, from: boss0.hp, delay: t + (e.blockedSuit ? 250 : 0) });
    tls.push(impact);
    const t2 = Math.max(t, impact.end - 250);

    if (e.shield && !lethal) {
      const block = q('.tp-table .tp-boss__shield');
      if (!boss0.shield && block) { // le bloc « Bouclier » apparaît avec l'animation
        const tl = new T.Timeline({ delay: t2 });
        tl.add(block, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: T.motion.ease.back });
        tls.push(tl.start());
      }
      tls.push(T.anim.shield(bossEl, {
        atk: [atkTxt(boss0.attack, boss0.shield), atkTxt(boss0.attack, shield1)], shield: [boss0.shield, shield1], delay: t2,
      }));
    }

    const tavern = pileEl('taverne');
    const discard = pileEl('defausse');
    let t3 = t2;
    if (active.includes('H') && tavern && discard) {
      if (e.healed) {
        const heal = T.anim.heal(discard, tavern, e.healed, { delay: t2 });
        tls.push(heal);
        swap(tls, countOf(discard), cv.discardCount, cv.discardCount - e.healed, t2 + 200);
        t3 = Math.max(t2, heal.end - 350);
      } else tls.push(T.anim.drawEmpty(discard, { text: 'Défausse vide', delay: t2 }));
    }
    const tavernAfter = cv.tavernCount + e.healed - drawn;
    if (active.includes('D') && tavern) {
      if (drawn) {
        const targets = drawTargets(e, cv, next);
        if (targets.length) tls.push(T.anim.drawRound(tavern, targets, { delay: t3 }));
      } else {
        tls.push(T.anim.drawEmpty(tavern, { text: cv.tavernCount + e.healed ? 'Mains pleines' : 'Taverne vide', delay: t3 }));
      }
    }
    swap(tls, countOf(tavern), cv.tavernCount, tavernAfter, drawn ? t3 + 120 : t3);
    await allDone(tls);
    return {
      ...vA, boss: { ...vA.boss, hp: Math.max(0, boss0.hp - e.damage) }, tavernCount: tavernAfter, discardCount: cv.discardCount - e.healed,
    };
  }

  /** Cibles de la pioche ♦, dans l'ordre du moteur : une carte par joueur à tour de rôle depuis l'attaquant. */
  function drawTargets(e, cv, next) {
    const order = next.players.map((p) => p.id);
    const start = Math.max(0, order.indexOf(e.playerId));
    const before = new Set(cv.myHand.map((c) => c.id));
    const mineNew = next.myHand.filter((c) => !before.has(c.id)).map((c) => handCard(c.id)).filter(visible);
    const rounds = Math.max(0, ...Object.values(e.drawn ?? {}));
    const out = [];
    let k = 0;
    for (let r = 0; r < rounds; r++) {
      for (let j = 0; j < order.length; j++) {
        const pid = order[(start + j) % order.length];
        if ((e.drawn[pid] ?? 0) <= r) continue;
        if (pid === me) {
          if (mineNew[k]) out.push(mineNew[k]);
          k++;
        } else if (visible(seatEl(pid))) out.push(seatEl(pid));
      }
    }
    return out;
  }

  /** Boss vaincu : K.O. vers la Taverne (pile à 0) ou carte déchirée vers la défausse ; la table se vide. */
  async function animFall(e, cv) {
    const card = q('.tp-table .tp-boss__card .tp-card');
    const tavern = pileEl('taverne');
    const discard = pileEl('defausse');
    const tableCards = cv.plays.reduce((n, x) => n + x.cards.length, 0);
    const discardAfter = cv.discardCount + tableCards + (e.exact ? 0 : 1);
    const tls = [];
    if (card && tavern && discard) {
      tls.push(e.exact
        ? T.anim.ko(card, tavern, { counter: [cv.tavernCount, cv.tavernCount + 1] })
        : T.anim.tear(card, { to: discard }));
    }
    const played = qa('.tp-table .tp-mine__c .tp-card, .tp-table .tp-seat__pcards .tp-card').filter(visible);
    if (discard) {
      const pay = T.anim.pay(played, discard, { delay: 350 });
      tls.push(pay);
      swap(tls, countOf(discard), cv.discardCount, discardAfter, Math.max(pay.end, e.exact ? 0 : 1000) - 80);
    }
    if (e.exact) notify({ tone: 'success', title: 'K.O. pile', text: `${theBoss(e.card, true)} rejoint la Taverne.` });
    await allDone(tls);
    return { ...cv, plays: [], tavernCount: cv.tavernCount + (e.exact ? 1 : 0), discardCount: discardAfter };
  }

  /** Nouveau boss : il quitte le Château, se retourne au centre, puis son immunité s'abat sur la légende. */
  async function animNewBoss(e, cv, next) {
    const bossEl = q('.tp-table .tp-boss');
    const castle = pileEl('chateau');
    if (!bossEl || !castle) return;
    const tls = [];
    const nb = T.anim.newBoss(bossEl, castle);
    tls.push(nb);
    swap(tls, countOf(castle), cv.castleCount, next.castleCount, 250);
    const suit = SUIT[e.card.suit];
    const power = q(`.tp-table .tp-power[data-suit="${suit}"]`);
    const at = Math.max(0, nb.end - 300);
    if (visible(power)) tls.push(T.anim.immune(power, { delay: at }));
    later(at, () => notify({ tone: 'info', title: 'Immunité', text: `${theBoss(e.card, true)} annule le pouvoir {${suit}}.` }));
    await allDone(tls);
  }

  async function animBubble(pid) {
    const bubble = pid === me ? null : seatEl(pid)?.querySelector('.tp-bubble');
    if (visible(bubble)) await T.anim.bubble(bubble).done();
  }

  /** Riposte : le boss charge le joueur visé, « Encaisse 11 » au centre. */
  async function animRiposte(e) {
    const bossEl = q('.tp-table .tp-boss');
    const target = e.playerId === me ? meTarget() : seatEl(e.playerId);
    if (!bossEl || !visible(target)) return;
    const text = e.playerId === me ? `Encaisse ${e.damage}` : `${nameOf(e.playerId)} encaisse ${e.damage}`;
    await T.anim.ripost(bossEl, target, e.damage, { text }).done();
  }

  /** Bouclier qui absorbe toute la riposte : éclat du bouclier, puis la main passe. */
  async function animBlocked(e, next) {
    const bossEl = q('.tp-table .tp-boss');
    const tls = [];
    if (bossEl) tls.push(T.anim.shield(bossEl, {}));
    notify({ tone: 'info', title: 'Riposte bloquée', text: 'Le bouclier absorbe toute l’attaque.' });
    tls.push(animTurn(e.playerId, next.currentPlayerId, 500));
    await allDone(tls);
  }

  function animTurn(fromId, toId, delay = 0) {
    if (!fromId || !toId || fromId === toId) return null;
    const a = seatEl(fromId);
    const b = seatEl(toId);
    // Tapis.anim.turn pose « waiting » / « active » : un siège déconnecté doit le rester
    if ([a, b].some((s) => s?.dataset.state === 'offline')) return null;
    return visible(a) && visible(b) ? T.anim.turn(a, b, { delay }) : null;
  }

  /** Encaissement, sur l'écran encore affiché : les cartes défaussées filent vers la défausse. */
  async function animDefend(e, cv) {
    const discard = pileEl('defausse');
    if (!discard) return;
    const tls = [];
    let temp = null;
    if (e.playerId === me) {
      const els = e.cards.map((c) => handCard(c.id)).filter(visible);
      const gauge = q('.tp-table .tp-ripost .tp-gauge');
      const shown = Number(gauge?.getAttribute('aria-valuenow') ?? 0);
      tls.push(T.anim.pay(els, discard, gauge ? { gauge, paid: [shown, total(e.cards)] } : {}));
    } else {
      // cartes publiques (l'événement les donne) : elles partent de l'avatar du coéquipier
      const anchor = fromSeat(e.playerId);
      if (anchor) {
        const b = boxIn(anchor);
        temp = document.createElement('div');
        temp.className = 'cdr-temp';
        temp.style.left = `${b.cx}px`;
        temp.style.top = `${b.cy}px`;
        temp.innerHTML = e.cards.map((c) => T.Card({ ...tp(c), size: 'sm' })).join('');
        zone.append(temp);
        tls.push(T.anim.pay([...temp.querySelectorAll('.tp-card')], discard));
      }
    }
    const end = tls[0]?.end ?? 0;
    swap(tls, countOf(discard), cv.discardCount, cv.discardCount + e.cards.length, end - 80);
    try {
      await allDone(tls);
    } finally {
      temp?.remove();
    }
  }

  async function animAfterDefend(e, next) {
    const tls = [];
    const bubble = e.playerId === me ? null : seatEl(e.playerId)?.querySelector('.tp-bubble');
    if (visible(bubble)) tls.push(T.anim.bubble(bubble));
    tls.push(animTurn(e.playerId, next.currentPlayerId, 200));
    await allDone(tls);
  }

  /** Renouveau (solo) : la main part à la défausse, une main neuve arrive de la Taverne. */
  async function animRenew(cv, next, showFinal) {
    const discard = pileEl('defausse');
    const tls = [];
    if (discard) {
      const pay = T.anim.pay(qa('.tp-table .tp-hand .tp-card').filter(visible), discard);
      tls.push(pay);
      swap(tls, countOf(discard), cv.discardCount, cv.discardCount + cv.myHand.length, pay.end - 80);
    }
    await allDone(tls);
    if (disposed) return;
    showFinal();
    const tavern = pileEl('taverne');
    const cards = qa('.tp-table .tp-hand .tp-card').filter(visible);
    if (tavern && cards.length) await T.anim.draw(tavern, cards, { from: cv.tavernCount, to: next.tavernCount, stagger: 130 }).done();
  }

  /** Distribution du début de partie : paquets de dos depuis la Taverne vers chaque coéquipier, puis ma main se retourne. */
  async function animDeal(next) {
    const tavern = pileEl('taverne');
    const hand = q('.tp-table .tp-hand');
    if (!tavern || !hand) return;
    const targets = next.players.filter((p) => p.id !== me).map((p) => ({ el: seatEl(p.id), n: p.cardCount })).filter((x) => visible(x.el));
    await T.anim.deal(tavern, targets, { hand, packet: 2, maxRounds: Math.ceil(next.handSize / 2) }).done();
  }

  async function endAnimation(next) {
    const end = q('[data-layer="end"] .tp-end');
    if (!end) return;
    await (next.phase === 'victory' ? T.anim.victory(end) : T.anim.defeat(end)).done();
  }

  // ================================================================ actions

  async function send(type, payload = {}) {
    if (busy) return;
    busy = true;
    try {
      await ctx.sendAction(type, payload); // le nouvel état est déjà dans la file
    } catch (err) {
      notify({ tone: 'error', title: 'Action refusée', text: err.message });
      chain = chain.then(() => { if (!disposed) renderFinal(); });
    } finally {
      busy = false;
    }
  }

  const selectedIds = () => state.myHand.filter((c) => ui.sel.includes(c.id)).map((c) => c.id);

  function act(name) {
    switch (name) {
      case 'play': send('play', { cardIds: selectedIds() }); break;
      case 'yield': send('yield'); break;
      case 'defend': send('defend', { cardIds: selectedIds() }); break;
      case 'renew': openDialog('renew'); break;
      case 'renew-ok': closeDialog(); send('renew'); break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- fenêtres et tiroirs

  function openRules(tab) {
    if (tab) ui.rulesTab = tab;
    openDialog('regles');
  }

  function openDialog(name) {
    if (!zone) return;
    if (!ui.dialog) ui.opener = document.activeElement;
    ui.dialog = name;
    const layer = q('[data-layer="dialog"]');
    layer.innerHTML = name === 'regles' ? rulesDialog(T, ui.rulesTab) : renewDialog();
    T.interact.tabs(layer);
    (layer.querySelector('[role="tab"][aria-selected="true"]') ?? layer.querySelector('.tp-dialog__f .tp-btn--primary') ?? layer.querySelector('[data-close]'))?.focus();
  }

  function closeDialog() {
    if (!ui.dialog) return;
    ui.dialog = null;
    const layer = zone && q('[data-layer="dialog"]');
    if (layer) layer.innerHTML = '';
    const back = ui.opener;
    ui.opener = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    else q('.tp-tools [data-open="regles"]')?.focus({ preventScroll: true });
  }

  function renewDialog() {
    const left = state.renewalsLeft - 1;
    const body = `<p class="body">${T.rich(`Défausse toute ta main et repioche ${pl(state.handSize, 'carte')} dans la Taverne.`)}</p>`
      + `<p class="body cdr-muted">${T.rich(left > 0 ? `Il te restera ${pl(left, 'Renouveau')}.` : 'Ce sera ton dernier Renouveau.')}</p>`;
    return T.Dialog({
      id: 'cdr-renew', kicker: 'Solo', title: 'Renouveau', body,
      actions: T.Button({ variant: 'secondary', label: 'Annuler', attrs: { 'data-close': 'cdr-renew' } })
        + T.Button({ variant: 'primary', icon: 'renew', label: 'Renouveler', attrs: { 'data-act': 'renew-ok' } }),
    });
  }

  function setDrawer(drawer, open) {
    drawer.toggleAttribute('data-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    qa(`.tp-tools [data-open="${drawer.id}"]`).forEach((b) => b.setAttribute('aria-expanded', String(open)));
    if (open) drawer.querySelector('[data-close]')?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- écouteurs

  function onClick(e) {
    if (!T || !zone) return;
    const t = e.target;
    if (t.closest('[data-motion-toggle]')) return; // géré par Tapis (document)
    if (t.classList?.contains('tp-modal')) { closeDialog(); return; } // clic sur le fond
    const open = t.closest('[data-open]:not(.tp-drawer)');
    if (open) {
      const id = open.dataset.open;
      if (id === 'regles') { openRules(); return; }
      const drawer = q(`#${CSS.escape(id)}.tp-drawer`);
      if (drawer) setDrawer(drawer, !drawer.hasAttribute('data-open'));
      return;
    }
    const close = t.closest('[data-close]');
    if (close) {
      const drawer = q(`#${CSS.escape(close.dataset.close)}.tp-drawer`);
      if (drawer) {
        setDrawer(drawer, false);
        q(`.tp-tools [data-open="${drawer.id}"]`)?.focus({ preventScroll: true });
      } else closeDialog();
      return;
    }
    if (t.closest('.tp-table .tp-power')) { openRules('pouvoirs'); return; }
    const button = t.closest('[data-act]');
    if (!button || button.getAttribute('aria-disabled') === 'true') return; // Tapis : désactivé = aria-disabled, le clic passe
    const name = button.dataset.act;
    if (name === 'hide-end' || name === 'show-end') {
      ui.endHidden = name === 'hide-end';
      renderFinal();
      if (ui.endHidden) q('.tp-table [data-act="show-end"]')?.focus({ preventScroll: true });
      return;
    }
    if (animating || busy || !state) return;
    act(name);
  }

  function onKey(e) {
    if (!T || !zone) return;
    if (e.key === 'Escape') {
      if (e.target.closest?.('.tp-hand')) resyncSelection(); // Tapis vide la sélection sans prévenir
      if (ui.dialog) { e.preventDefault(); closeDialog(); return; }
      const drawer = q('.tp-drawer[data-open]');
      if (drawer) {
        setDrawer(drawer, false);
        q(`.tp-tools [data-open="${drawer.id}"]`)?.focus({ preventScroll: true });
      }
      return;
    }
    if (e.key === 'Enter' && e.target.closest?.('.tp-hand button.tp-card')) {
      e.preventDefault(); // sinon Entrée sélectionne la carte
      const primary = q('.tp-table [data-area="actions"] .tp-btn--primary');
      if (primary && primary.getAttribute('aria-disabled') !== 'true') primary.click();
      return;
    }
    if (e.key === 'Tab' && ui.dialog) { // le focus reste dans la fenêtre
      const items = [...q('[data-layer="dialog"]').querySelectorAll('button:not([disabled]), [href], [tabindex="0"]')].filter(visible);
      if (!items.length) return;
      const first = items[0];
      const lastItem = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastItem.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); first.focus(); }
    }
  }

  // onglet des règles mémorisé
  const onTab = (e) => {
    const tab = e.target.closest?.('[data-layer="dialog"] [role="tab"]');
    if (tab) ui.rulesTab = tab.dataset.tab;
  };

  host.addEventListener('click', onClick);
  host.addEventListener('click', onTab);
  host.addEventListener('keydown', onKey);

  // Salon : un joueur déconnecté ou reconnecté change son siège (le Hub n'appelle pas update()).
  const roomTimer = setInterval(() => {
    if (!state || !zone || animating) return;
    if (roomKey() !== ui.roomKey) renderFinal();
  }, 1500);

  return {
    update(next) {
      latest = next;
      if (T && zone) enqueue(next);
    },
    unmount() {
      disposed = true;
      clearInterval(roomTimer);
      timers.forEach((id) => clearTimeout(id));
      window.removeEventListener('resize', fit);
      document.removeEventListener('tapis:motion', onMotion);
      T?.anim.finishAll();
      css.forEach((c) => c.link.remove());
      host.remove();
    },
  };
}
