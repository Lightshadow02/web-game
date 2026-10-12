import { COLOR, HERO_EMBLEM, HERO_ARTICLE, FEMININE, SKILL_EMBLEM, ROOM_EMBLEM, DUNGEON, powerOf, slotOf, syncData, itemOf, skillOf, plainText } from './data.js';
import { rulesTabs } from './rules.js';

/* =====================================================================
 * Interface des « Profondeurs », dessinée avec le design system Claude Design
 * « Torche » (https://claude.ai/artifact/JS4y7JDparPPUUDgYJHUFs), importé dans ./torche/.
 *
 * Module monté par le Hub : mount(root, ctx) -> { update(state), unmount() }.
 * Le serveur fait autorité ; ce module affiche l'état et envoie :
 *   pickHero, pickDungeon, start, openDoors, descend, enter, choose,
 *   place, fuse, skill, ready, reward, continue.
 *
 * Mouvement : chaque nouvel état est d'abord joué sur l'écran affiché (Torche.anim
 * pose l'état final puis l'anime), puis l'écran est redessiné depuis l'état reçu.
 * Les composants Torche renvoient du HTML et échappent tous les textes (pseudos compris).
 * ===================================================================== */

const BASE = new URL('./', import.meta.url).href;
const MOTION_KEY = 'prof.motion';
const ICON_OF_FX = { frost: 'snow', curse: 'skull', summon: 'plus', fury: 'flame' };

let torcheLoading = null;
function loadTorche() {
  if (window.Torche) return Promise.resolve(window.Torche);
  torcheLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${BASE}torche/bundle.js`;
    script.onload = () => resolve(window.Torche);
    script.onerror = () => {
      torcheLoading = null; // on retentera au prochain montage
      script.remove();
      reject(new Error('Design system introuvable.'));
    };
    document.head.append(script);
  });
  return torcheLoading;
}

/** Choix explicite du joueur ('on' | 'off'), sinon null : on suit prefers-reduced-motion. */
function readMotion() {
  try {
    return localStorage.getItem(MOTION_KEY);
  } catch {
    return null;
  }
}

/** Typographie française dans les textes affichés : espace fine insécable avant « : ; ! ? » et dans les guillemets. */
function frenchSpacing(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    if (!/[:;!?«»]/.test(t)) continue;
    const fixed = t.replace(/ ([:;!?»])/g, '\u202F$1').replace(/« /g, '«\u202F');
    if (fixed !== t) n.nodeValue = fixed;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function mount(root, ctx) {
  const me = ctx.me.id;
  const links = ['torche/torche.css', 'style.css'].map((href) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = BASE + href;
    document.head.append(link);
    return link;
  });

  // .prof porte les tokens du design system et l'interrupteur d'animations.
  const host = document.createElement('div');
  host.className = 'prof';
  host.setAttribute('data-motion-host', '');
  const motionPref = readMotion();
  if (motionPref === 'on' || motionPref === 'off') host.setAttribute('data-motion', motionPref);
  const view = document.createElement('div'); // l'écran du jeu
  view.className = 'prof-view';
  const rulesLayer = document.createElement('div'); // la fenêtre des règles, hors de l'écran redessiné
  rulesLayer.className = 'prof-rules';
  const live = document.createElement('div'); // annonces pour les lecteurs d'écran
  live.className = 't-sr';
  live.setAttribute('aria-live', 'polite');
  host.append(view, rulesLayer, live);
  root.append(host);

  let T = null;
  let esc = (s) => String(s);
  let state = null; // état affiché
  let latest = null; // dernier état reçu
  let chain = Promise.resolve();
  let animating = false; // transition lourde en cours : les clics de jeu attendent
  let disposed = false;
  let busy = false;
  let queued = 0; // états en attente dans la file
  const ui = {
    lastEvent: 0, sel: null, fuse: false, fuseFirst: null,
    rules: false, tab: 'but', pick: null, receiver: null, rewardKey: null,
    resultSeen: 0, doorsOpen: null, campFrom: null, drag: null, lastDrag: 0,
  };

  const onMotion = (e) => {
    try { localStorage.setItem(MOTION_KEY, e.detail.on ? 'on' : 'off'); } catch { /* stockage indisponible */ }
  };
  document.addEventListener('torche:motion', onMotion);

  loadTorche().then((t) => {
    if (disposed) return;
    T = t;
    esc = T.util.esc;
    if (latest) enqueue(latest);
  }).catch((err) => ctx.toast(err.message, 'error'));

  // ================================================================ file des états

  function enqueue(next) {
    queued += 1;
    chain = chain.then(() => step(next)).catch((err) => console.error(err)).finally(() => { queued -= 1; });
  }

  /** Événements qui changent l'écran : pendant leur animation, les clics de jeu attendent. */
  const HEAVY = new Set(['floor', 'doors', 'enter', 'encounter', 'roll', 'resolve', 'bossDefeated', 'defeat', 'loot', 'levelUp']);

  async function step(next) {
    if (disposed || !T) return;
    const prev = state;
    const events = prev ? next.events.filter((e) => e.id > ui.lastEvent) : [];
    ui.lastEvent = next.events.reduce((m, e) => Math.max(m, e.id), ui.lastEvent);
    syncData(T, next);
    // Rattrapage (onglet caché, reconnexion, rafale d'états) : on affiche directement le dernier état.
    const catchingUp = queued > 1 || document.hidden;
    const motion = !!prev && !catchingUp && T.motion.enabled();
    const heavy = motion && (prev.phase !== next.phase || events.some((e) => HEAVY.has(e.type)));
    setAnimating(heavy);
    try {
      host.dataset.stage = 'before';
      if (motion) await before(prev, next, events).catch((err) => console.error(err));
      if (disposed) return;
      prepare(prev, next, motion);
      noticeReward(prev, next, events);
      state = next;
      host.dataset.stage = 'render';
      const floor = motion ? events.find((e) => e.type === 'floor') : null;
      if (floor) await floorTransition(floor, next);
      else render();
      host.dataset.stage = 'after';
      if (motion) await after(prev, next, events).catch((err) => console.error(err));
      announce(prev, next, events);
      // la fenêtre a pu passer de PC à mobile pendant l'animation
      if (screenEl() && screenEl().dataset.vp !== (mobile() ? 'mobile' : 'pc')) render();
    } finally {
      host.dataset.stage = 'idle';
      setAnimating(false);
    }
  }

  /** Pendant une transition lourde, les clics de jeu sont ignorés (l'écran va changer). */
  function setAnimating(on) {
    animating = on;
    host.toggleAttribute('data-animating', on);
  }

  /** Un coéquipier a pris le butin pendant que je regardais le résultat : je le dis. */
  function noticeReward(prev, next, events) {
    if (!prev || prev.phase !== 'reward' || next.phase === 'reward') return;
    if (!prev.lastResolution || ui.resultSeen >= prev.lastResolution.seq) return;
    const loot = events.find((e) => e.type === 'loot');
    if (loot) ctx.toast(`Butin : ${loot.name} pour ${heroNameOf(next, loot.heroOf)}.`);
    else if (next.xp > prev.xp) ctx.toast(`Le groupe prend ${next.xp - prev.xp} XP.`);
    else ctx.toast('Le groupe laisse le butin.');
    ui.resultSeen = prev.lastResolution.seq;
  }

  /** Ce qui vient de se passer, pour les lecteurs d'écran. */
  function announce(prev, next, events) {
    if (!prev) return;
    const parts = [];
    for (const pid of next.phase === 'dice' ? next.ready : []) {
      if (!prev.ready?.includes(pid) && pid !== me) parts.push(`${heroNameOf(next, pid)} est prêt.`);
    }
    const res = events.find((e) => e.type === 'resolve');
    if (res) parts.push(`Résolution : ${res.results.filter((r) => r.covered).length} cases couvertes sur ${res.results.length}.`);
    if (prev.phase !== next.phase) {
      const label = { explore: 'Exploration', doors: 'Choix des portes', peril: 'Péril', dice: 'Combat', reward: 'Récompense', camp: 'Camp', victory: 'Victoire', defeat: 'Défaite' }[next.phase];
      if (label) parts.push(label);
    }
    if (parts.length) live.textContent = parts.join(' ');
  }

  const heroNameOf = (s, pid) => {
    const h = s.heroes.find((x) => x.playerId === pid);
    return h ? `${HERO_ARTICLE[h.heroId] ?? ''}${h.name} (${h.playerName})` : 'un héros';
  };

  /** Ajuste l'état local de l'interface quand la situation change. */
  function prepare(prev, next, motion) {
    if (!prev || encKey(prev) !== encKey(next) || prev.phase !== next.phase) {
      ui.sel = null;
      ui.fuse = false;
      ui.fuseFirst = null;
    }
    const rk = next.reward ? JSON.stringify(next.reward.loots) + next.reward.xp : null;
    if (rk !== ui.rewardKey) {
      ui.rewardKey = rk;
      ui.pick = next.reward?.xp ? 'xp' : null;
      ui.receiver = null;
    }
    if (motion && next.phase === 'camp' && prev.phase !== 'camp') {
      ui.campFrom = Object.fromEntries(prev.heroes.map((h) => [h.playerId, h.pv]));
    }
    if (!motion && next.phase === 'doors') ui.doorsOpen = doorsKey(next);
    if (ui.sel && !next.dice.some((d) => d.id === ui.sel && d.owner === me)) ui.sel = null;
  }

  const encKey = (s) => (s.encounter ? `${s.floor}:${s.encounter.kind}:${s.encounter.id}:${s.encounter.round ?? 1}:${s.encounter.chosen ?? ''}` : `${s.phase}`);
  const doorsKey = (s) => `${s.floor}:${s.torch}:${s.roomsLeft}:${s.doors.map((d) => d.id).join(',')}`;

  // ================================================================ rendu

  const q = (sel) => view.querySelector(sel);
  const qa = (sel) => [...view.querySelectorAll(sel)];
  const screenEl = () => q('.t-screen');
  const mobile = () => (view.clientWidth || 1200) <= 640; // même seuil que les container queries (max-width: 640px)
  const heroOf = (pid) => state?.heroes.find((h) => h.playerId === pid) ?? null;
  const heroEl = (pid) => {
    const h = (state ?? latest)?.heroes.find((x) => x.playerId === pid);
    return h ? q(`.t-party .t-hero[data-hero="${h.heroId}"]`) : null;
  };
  const dieEl = (id) => q(`.t-die[data-id="${id}"]`);
  const slotEl = (id) => q(`.t-slot[data-id="${id}"]`);
  const playerName = (pid) => ctx.getRoom()?.players.find((p) => p.id === pid)?.name ?? heroOf(pid)?.playerName ?? '?';
  const avatarOf = (pid) => ctx.getRoom()?.players.find((p) => p.id === pid)?.avatarUrl ?? undefined;
  const ground = (s) => DUNGEON[s.dungeon?.id ?? s.dungeonId]?.ground ?? 'crypte';

  /** Clé stable de l'élément qui a le focus, pour le lui rendre après un nouveau rendu. */
  const FOCUS_ATTRS = ['data-id', 'data-act', 'data-index', 'data-skill', 'data-pick', 'data-receiver', 'data-pick-dungeon', 'data-hero', 'data-fuse', 'data-ready', 'data-open-rules', 'data-motion-toggle'];
  function focusKey(el) {
    if (!el || el === document.body || !view.contains(el)) return null;
    const target = el.closest(FOCUS_ATTRS.map((a) => `[${a}]`).join(','));
    if (!target) return null;
    const attrs = FOCUS_ATTRS.filter((a) => target.hasAttribute(a)).map((a) => `[${a}="${CSS.escape(target.getAttribute(a))}"]`).join('');
    const zone = target.closest('.t-pool') ? '.t-pool ' : target.closest('.t-slot') ? '.t-slot ' : '';
    return zone + target.tagName.toLowerCase() + attrs;
  }

  function render() {
    if (!state || !T || disposed) return;
    const key = focusKey(document.activeElement);
    view.innerHTML = screen(state);
    afterRender();
    if (key) view.querySelector(key)?.focus({ preventScroll: true });
  }

  /** Fenêtre des règles : couche à part, l'écran dessous devient inerte. */
  function renderRules({ focus = false } = {}) {
    if (!T) return;
    view.inert = ui.rules;
    if (!ui.rules) {
      rulesLayer.innerHTML = '';
      return;
    }
    const scroll = rulesLayer.querySelector('.t-dialog__body')?.scrollTop ?? 0;
    rulesLayer.innerHTML = rulesOverlay();
    frenchSpacing(rulesLayer);
    const body = rulesLayer.querySelector('.t-dialog__body');
    if (body && !focus) body.scrollTop = scroll;
    if (focus) rulesLayer.querySelector(`[data-tab="${ui.tab}"]`)?.focus();
  }

  function openRules() {
    ui.rules = true;
    renderRules({ focus: true });
  }

  function closeRules() {
    ui.rules = false;
    renderRules();
    view.querySelector('[data-open-rules]')?.focus();
  }

  function afterRender() {
    markTargets();
    const enc = state.encounter;
    if (state.phase === 'dice' && enc?.shield > 0) {
      const party = q('.t-party');
      if (party && !party.querySelector(':scope > .t-aegis')) {
        party.style.position = 'relative';
        party.insertAdjacentHTML('beforeend', `<span class="t-aegis"><span class="t-aegis__sheen"></span><span class="t-aegis__badge">${T.icon('shield')}</span></span>`);
      }
    }
    if (ui.fuse) screenEl()?.classList.add('is-fusing');
    // chaque emplacement vide de la réserve sait à quel dé il appartient (retour à sa place)
    const ghosts = qa('.t-pool .t-die-ghost');
    const placed = state.dice?.filter((d) => d.owner === me && d.box) ?? [];
    ghosts.forEach((g, i) => { if (placed[i]) g.dataset.ghostFor = placed[i].id; });
    frenchSpacing(view);
  }

  function screen(s) {
    switch (s.phase) {
      case 'setup': return screenPreparation(s);
      case 'explore': return screenExploration(s);
      case 'doors': return screenDoors(s);
      case 'peril': return screenPeril(s);
      case 'dice': return screenCombat(s);
      case 'reward': return s.lastResolution && ui.resultSeen < s.lastResolution.seq ? screenResult(s) : screenReward(s);
      case 'camp': return screenCamp(s);
      default: return screenEnding(s);
    }
  }

  function screenOpen(name, s, extra = '') {
    return `<div class="t-screen t-ground" data-screen="${name}" data-vp="${mobile() ? 'mobile' : 'pc'}" data-dungeon="${ground(s)}"${extra}>`;
  }

  function header(s, { rooms = true } = {}) {
    const xpMax = s.xpNext ?? s.xp;
    const protect = s.phase === 'dice' && s.encounter?.noTime && s.torch > 0 ? s.torch - 1 : undefined;
    return `<header class="t-header">
      <div class="t-header__floor">${T.icon('stairs', { className: 't-header__stairs' })}
        <div><span class="label">Étage</span> <b class="stat">${s.floor}<small>/${s.floors}</small></b>
        <span class="t-header__dungeon caption">${esc(s.dungeon?.name ?? '')}</span></div></div>
      ${T.TorchGauge({ value: s.torch, max: s.torchMax, protect, className: 't-header__torch' })}
      ${T.XpBar({ level: s.level, xp: s.xp, max: xpMax || 1, className: 't-header__xp' })}
      ${rooms ? `<div class="t-header__rooms" title="Salles encore dans l’étage">${T.icon('door')}<b class="stat">${s.roomsLeft}</b><span class="caption">${s.roomsLeft > 1 ? 'salles<br>restantes' : 'salle<br>restante'}</span></div>` : ''}
      <div class="t-header__tools">${T.Button({ variant: 'icon', icon: 'book', label: 'Règles', attrs: { 'data-open-rules': '' } })}${T.Button.motionToggle(T.motion.enabled())}</div>
    </header>`;
  }

  function dieProps(d, s, extra = {}) {
    return { id: d.id, color: COLOR[d.color], value: d.value, curse: d.cursed && !d.box ? -1 : 0, ...extra };
  }

  /** Portraits du groupe ; en combat, les dés restants des autres joueurs. */
  function party(s, { className = '', dice = false, override = {} } = {}) {
    const compact = mobile();
    return `<section class="t-party ${className}" aria-label="Le groupe">${s.heroes.map((h) => {
      const mine = h.playerId === me;
      const st = h.pv <= 0 ? 'down' : s.phase === 'dice' && s.ready.includes(h.playerId) ? 'ready' : 'idle';
      const o = {
        hero: h.heroId, player: h.playerName, me: mine, hp: h.pv, maxHp: h.pvMax, armor: h.stats.armor,
        skills: h.skills.map((x) => x.id), used: h.skills.filter((x) => x.used).map((x) => x.id), items: h.items.map((x) => x.id),
        state: st, variant: compact ? 'compact' : 'full', ...(override[h.playerId] ?? {}),
      };
      if (dice && !mine && h.pv > 0) {
        o.dice = s.dice.filter((d) => d.owner === h.playerId).map((d) => (d.box ? { ghost: true } : dieProps(d, s)));
      }
      return T.HeroPortrait(o);
    }).join('')}</section>`;
  }

  // ---------------------------------------------------------------- 1. préparation

  function screenPreparation(s) {
    const players = ctx.getRoom()?.players ?? [];
    const owner = (heroId) => Object.entries(s.picks).find(([, h]) => h === heroId)?.[0];
    const heroes = Object.keys(s.catalog.heroes).map((id) => {
      const by = owner(id);
      if (by === me) return T.HeroCard({ hero: id, state: 'mine' });
      if (by) return T.HeroCard({ hero: id, state: 'taken', takenBy: { name: playerName(by) } });
      return T.HeroCard({ hero: id });
    }).join('');
    const seats = players.map((p) => {
      const h = s.picks[p.id] ? s.catalog.heroes[s.picks[p.id]] : null;
      return `<li class="t-seat ${h ? '' : 'is-choosing'}">${T.Avatar({ name: p.name, src: p.avatarUrl, size: 'md', me: p.id === me })}
        <span class="t-seat__who"><b class="button">${esc(p.name)}${p.id === me ? ' <span class="caption">(toi)</span>' : ''}</b>
        <span class="caption">${h ? esc(h.name) : 'choisit son héros<span class="t-typing" aria-hidden="true"><i></i><i></i><i></i></span>'}</span></span>
        ${h ? `<span class="t-seat__hero">${T.icon(HERO_EMBLEM[s.picks[p.id]])}</span>` : `<span class="t-seat__hero is-empty">${T.icon('user')}</span>`}
        ${h ? `<span class="t-seat__ok" title="Prêt">${T.icon('check')}</span>` : `<span class="t-seat__ok is-wait" title="En attente">${T.icon('hourglass')}</span>`}</li>`;
    }).join('');
    const dungeons = s.catalog.dungeons.map((d) => {
      const on = d.id === s.dungeonId;
      return `<button type="button" class="t-dgn ${on ? 'is-selected' : ''}" data-pick-dungeon="${esc(d.id)}" aria-pressed="${on}">
        <span class="t-dgn__emb">${T.icon(DUNGEON[d.id]?.emblem ?? 'dungeon-gate')}</span>
        <span class="t-dgn__txt"><b class="title-sm">${esc(d.name)}</b><span class="caption">Boss : ${esc(d.boss.split(',')[0])}</span></span></button>`;
    }).join('');
    const missing = players.filter((p) => !s.picks[p.id]).map((p) => p.name);
    const ready = missing.length === 0;
    const waiting = ready ? 'Tout le monde est prêt.' : `En attente de ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} et ${missing.at(-1)}` : missing[0]}…`;
    const chosen = s.catalog.dungeons.find((d) => d.id === s.dungeonId);
    return `${screenOpen('preparation', s)}
      <header class="t-prep__top"><span class="label">Hub · Les Profondeurs</span><h1 class="title-lg">Choisis ton héros</h1>
        <p class="body">Chaque joueur prend un héros différent. Le groupe descend quand tout le monde a choisi.</p></header>
      <main class="t-prep">
        <section class="t-prep__heroes" aria-label="Héros">${heroes}</section>
        <aside class="t-prep__side">
          <section class="t-panel"><h2 class="t-panel__title label">Le groupe <span class="gauge">${players.length - missing.length}/${players.length}</span></h2><ul class="t-seats">${seats}</ul></section>
          <section class="t-panel"><h2 class="t-panel__title label">Donjon</h2><div class="t-dgns">${dungeons}</div>
            <p class="t-dgn__tag caption">« ${esc(DUNGEON[s.dungeonId]?.tagline ?? chosen?.text ?? '')} »</p></section>
          <div class="t-prep__go">${T.Button({ variant: 'primary', label: 'Descendre', icon: 'stairs', size: 'lg', block: true, disabled: !ready || busy, attrs: { 'data-act': 'start' } })}
            <span class="caption">${esc(waiting)}</span></div>
        </aside>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 2. exploration

  function screenExploration(s) {
    const g = s.guardian;
    const can = s.torch > 0 && s.roomsLeft > 0;
    const steps = [
      ...s.cleared.slice(-5).map((c) => ({ kind: 'done', label: c.name, icon: ROOM_EMBLEM[c.id] ?? 'door' })),
      { kind: 'here', label: 'Vous êtes ici', icon: 'torch' },
      ...Array.from({ length: Math.min(s.torch, s.roomsLeft, 4) }, () => ({ kind: 'unknown' })),
      { kind: 'boss', label: g.name, icon: ROOM_EMBLEM[g.id] ?? 'crown' },
    ];
    const track = `<ol class="t-track" aria-label="Progression de l’étage">${steps.map((st) => {
      const inner = st.kind === 'unknown' ? T.icon('door') : T.icon(st.icon);
      const cap = st.kind === 'unknown' ? 'Salle' : st.label;
      return `<li class="t-track__step" data-k="${st.kind}"><span class="t-track__node">${inner}${st.kind === 'done' ? `<span class="t-track__ok">${T.icon('check')}</span>` : ''}</span><span class="t-track__cap caption">${esc(cap)}</span></li>`;
    }).join('')}</ol>`;
    const foe = g.kind === 'boss' ? 'le boss' : 'le gardien';
    const power = powerOf(g.ability, g.id);
    return `${screenOpen('exploration', s)}${header(s)}
      <main class="t-explore">
        <div class="t-explore__intro"><span class="label">Étage ${s.floor} · ${esc(s.dungeon.name)}</span>
          <h1 class="title-lg">${s.cleared.length ? 'Le couloir se divise' : 'L’étage s’ouvre devant vous'}</h1>
          <p class="body">${can
            ? `${plural(s.torch, 'flamme')} : chaque porte ouverte en consume une. Avance ou affronte ${foe} maintenant.`
            : `La torche ne permet plus d’ouvrir de porte : il faut affronter ${foe}.`}</p></div>
        <section class="t-panel t-explore__track">${track}</section>
        <div class="t-explore__actions">
          <div class="t-choice"><span class="t-choice__emb">${T.icon('wooden-door')}</span>
            <div class="t-choice__txt"><h2 class="title-md">Ouvrir des portes</h2><p class="card-text">Deux salles se révèlent, le groupe en choisit une.</p></div>
            ${T.Button({ variant: 'primary', label: 'Ouvrir', icon: 'door', cost: { torch: 1 }, size: 'lg', disabled: !can || busy, attrs: { 'data-act': 'openDoors' } })}</div>
          <div class="t-choice t-choice--boss"><span class="t-choice__emb">${T.icon(ROOM_EMBLEM[g.id] ?? 'crown')}</span>
            <div class="t-choice__txt"><h2 class="title-md">Affronter ${foe}</h2><p class="card-text">${esc(g.name)} · ${g.pv} PV${power ? ` · ${esc(power.name)}` : ''}</p></div>
            ${T.Button({ variant: 'boss', label: 'Affronter', icon: 'crown', size: 'lg', disabled: busy, attrs: { 'data-act': 'descend' } })}</div>
        </div>
        ${party(s, { className: 't-explore__party' })}
      </main></div>`;
  }

  // ---------------------------------------------------------------- 3. portes

  const monsterOf = (d) => ({ name: d.name, emblem: ROOM_EMBLEM[d.id] ?? 'skull', xp: d.xp, loot: d.loot?.type ?? 'item', slots: (d.boxes ?? []).map((b) => slotOf(b)) });
  const perilOf = (d) => ({ name: d.name, emblem: ROOM_EMBLEM[d.id] ?? 'skull', xp: d.xp, ways: d.options.map((o) => ({ name: o.label, slot: slotOf(o.box) })) });

  /** La carte de péril n'affiche que l'XP : on ajoute son butin au pied de carte. */
  function withLoot(html, loot) {
    if (!loot) return html;
    const tag = loot.type === 'skill'
      ? `<span class="t-reward" data-r="skill">${T.icon('sparkle')}Compétence</span>`
      : `<span class="t-reward" data-r="item">${T.icon('bag')}Objet</span>`;
    const i = html.lastIndexOf('</footer>');
    return i < 0 ? html : html.slice(0, i) + tag + html.slice(i);
  }

  function screenDoors(s) {
    const m = mobile();
    const open = ui.doorsOpen === doorsKey(s);
    const doors = s.doors.map((d, i) => {
      const card = d.kind === 'peril' ? withLoot(T.PerilCard({ peril: perilOf(d), className: 't-door__card' }), d.loot) : T.MonsterCard({ monster: monsterOf(d), className: 't-door__card' });
      return `<div class="t-door ${open ? 'is-open' : ''}" data-door="${i}"><span class="t-door__arch" aria-hidden="true"></span>
        <div class="t-flip"><div class="t-flip__front">${card}</div><div class="t-flip__back">${T.CardBack({ dungeon: ground(s) })}</div></div>
        ${T.Button({ variant: i === 0 ? 'primary' : 'secondary', label: d.kind === 'peril' ? 'Affronter le péril' : 'Entrer', size: m ? 'md' : 'lg', block: true, iconRight: 'chevron-right', disabled: busy, attrs: { 'data-act': 'enter', 'data-index': i } })}</div>`;
    }).join('<span class="t-doors__or label" aria-hidden="true">ou</span>');
    return `${screenOpen('doors', s)}${header(s)}
      <main class="t-doors">
        <div class="t-doors__intro"><span class="label">Une flamme pour voir plus loin</span><h1 class="title-lg">${s.doors.length > 1 ? 'Deux portes s’ouvrent' : 'Une dernière porte'}</h1>
          <p class="body">${s.doors.length > 1 ? 'Choisis la salle où le groupe entre. L’autre retourne dans l’ombre de l’étage.' : 'C’est la dernière salle de l’étage.'}</p></div>
        <div class="t-doors__pair">${doors}</div>
        <p class="t-doors__votes caption">Le premier qui choisit décide pour le groupe : parlez-en sur Discord.</p>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 4. péril

  function screenPeril(s) {
    const enc = s.encounter;
    const m = mobile();
    const ways = enc.options.map((o, i) => {
      const slot = slotOf(o.box);
      const pen = slot.pen.hp
        ? `${T.icon('heart')} ${plural(slot.pen.hp, 'dégât')} pour le groupe`
        : `${T.icon('flame')} la torche perd ${plural(slot.pen.torch, 'flamme')}`;
      return `<article class="t-way-card">
        <header><span class="label">Voie ${i + 1}</span><h2 class="title-md">${esc(o.label)}</h2></header>
        <p class="card-text">${slot.kind === 'sum' ? `Le groupe doit réunir un total de ${slot.need}.` : `Il faut un dé de ${slot.need} ou plus.`}</p>
        <div class="t-way-card__slot">${T.Slot({ ...slot, size: m ? 'sm' : 'md', interactive: false })}<span class="t-way-card__pen caption">Si la case reste vide : ${pen}</span></div>
        ${T.Button({ variant: i === 0 ? 'primary' : 'secondary', label: 'Choisir cette voie', block: true, disabled: busy, attrs: { 'data-act': 'choose', 'data-index': i } })}</article>`;
    }).join('<span class="t-ways__or label" aria-hidden="true">ou</span>');
    return `${screenOpen('peril', s)}${header(s)}
      <main class="t-perilscr">
        <div class="t-perilscr__card">${withLoot(T.PerilCard({ peril: perilOf({ ...enc, options: enc.options }) }), enc.loot)}
          <p class="t-perilscr__flavor body">Pas de monstre ici, mais le passage ne se laissera pas franchir sans effort.</p></div>
        <section class="t-ways"><div class="t-ways__intro"><span class="label">Péril</span><h1 class="title-lg">Deux voies</h1>
          <p class="body">Le groupe choisit une voie, puis tout le monde place ses dés sur sa case ${T.icon('sigma', { className: 't-ico--inline', label: 'total' })}.</p></div>
          <div class="t-ways__pair">${ways}</div></section>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 5. combat et boss

  function roomCard(s, enc, boxes, dice, { interactive, sub, results } = {}) {
    const m = mobile();
    const n = s.heroes.length;
    const enraged = enc.ability?.type === 'enrage' && enc.bossPv > 0 && enc.bossPv <= enc.bossPvMax / 2;
    const summoned = enc.ability?.type === 'summon' ? (enc.ability.box.mode === 'single' ? n : 1) : 0;
    const slots = boxes.map((b, i) => {
      const inBox = dice.filter((d) => d.box === b.id).map((d) => ({
        id: d.id, color: COLOR[d.color], value: d.value, interactive: interactive && d.owner === me,
        ...(d.owner !== me ? { owner: { id: d.owner, name: playerName(d.owner) } } : {}),
      }));
      const slot = slotOf(b, { dice: inBox, interactive });
      if (enraged && b.fury) Object.assign(slot, { need: slot.need - 1, mod: 1 });
      if (summoned && i >= boxes.length - summoned) slot.summoned = true;
      const res = results?.find((r) => r.boxId === b.id);
      if (res) slot.state = res.covered ? 'covered' : 'failed';
      return slot;
    });
    const slotSize = m ? 'sm' : 'md';
    if (enc.kind === 'guardian' || enc.kind === 'boss') {
      const foe = {
        name: enc.name, emblem: ROOM_EMBLEM[enc.id] ?? 'crown', rank: enc.kind === 'boss' ? 'boss' : 'guardian',
        hp: enc.bossPvMax, floor: s.floor, dungeon: { id: ground(s) }, power: powerOf(enc.ability, enc.id) ?? { name: '', text: '' },
      };
      return T.BossCard({ foe, layout: 'room', hp: enc.bossPv, trail: enc.bossPv, round: enc.round, slots, slotSize, className: 't-stage__room' });
    }
    const monster = { name: enc.name, emblem: ROOM_EMBLEM[enc.id] ?? 'skull', xp: enc.xp, loot: enc.loot?.type ?? 'item' };
    return T.MonsterCard({
      monster, layout: 'room', slots, slotSize, className: enc.kind === 'peril' ? 't-stage__room t-card--peril' : 't-stage__room',
      kicker: enc.kind === 'peril' ? 'Péril' : `Monstre · étage ${s.floor}`,
      sub: sub ?? (enc.kind === 'peril' ? `Voie : ${enc.chosen}` : `${plural(slots.length, 'case')} pour ${n} héros`),
    });
  }

  function powerBanner(enc) {
    const p = powerOf(enc.ability, enc.id);
    if (!p) return '';
    const badge = enc.ability.type === 'enrage' && enc.bossPv <= enc.bossPvMax / 2 ? 'Mi-vie atteinte' : undefined;
    return T.Banner({ kind: 'power', title: p.name, text: p.text, icon: ICON_OF_FX[p.fx] ?? 'flame', active: true, badge, className: 't-stage__power' });
  }

  function tray(s) {
    const m = mobile();
    const hero = heroOf(me);
    const alive = s.heroes.filter((h) => h.pv > 0).length;
    if (!hero || hero.pv <= 0) {
      return `<div class="t-tray">${T.DicePool({ dice: [], size: m ? 'md' : 'lg', hint: 'Ton héros est à terre : il se relèvera au camp.', className: 't-tray__pool',
        actions: `<div class="t-tray__main">${T.Button({ variant: 'primary', label: 'Les autres jouent', count: `${s.ready.length}/${alive}`, size: 'lg', disabled: true, className: 't-tray__ready' })}</div>` })}</div>`;
    }
    const mine = s.dice.filter((d) => d.owner === me);
    if (!mine.length) {
      return `<div class="t-tray">${T.DicePool({ dice: [], size: m ? 'md' : 'lg', hint: 'Relevé en plein combat : tu lanceras tes dés au prochain round. Dis « Prêt » pour ne pas bloquer le groupe.', className: 't-tray__pool',
        actions: `<div class="t-tray__main">${T.Button({ variant: 'primary', label: 'Prêt', icon: s.ready.includes(me) ? 'check' : undefined, pressed: s.ready.includes(me), count: `${s.ready.length}/${alive}`, size: 'lg', state: s.ready.includes(me) ? 'waiting' : 'idle', className: 't-tray__ready', attrs: { 'data-ready': '' } })}</div>` })}</div>`;
    }
    const dice = mine.map((d) => (d.box ? { ghost: true } : dieProps(d, s, { state: ui.sel === d.id || ui.fuseFirst === d.id ? 'selected' : 'idle' })));
    const free = mine.filter((d) => !d.box).length;
    const amReady = s.ready.includes(me);
    const perRound = s.encounter?.kind === 'guardian' || s.encounter?.kind === 'boss';
    const skills = hero.skills.map((sk) => T.Button({
      variant: 'skill', label: sk.name, emblem: SKILL_EMBLEM[sk.id] ?? 'sparkle', uses: sk.used ? 'Utilisée' : perRound ? '1× par round' : '1× par salle',
      state: sk.used ? 'used' : 'idle', disabled: sk.used, title: plainText(sk.text), attrs: { 'data-skill': sk.id },
    })).join('');
    const actions = `<div class="t-tray__skills">${skills}</div><div class="t-tray__main">
      ${T.Button({ variant: 'secondary', label: ui.fuse ? 'Annuler la fusion' : 'Fusionner', icon: 'merge', pressed: ui.fuse, disabled: free < 2 && !ui.fuse, attrs: { 'data-fuse': '' } })}
      ${T.Button({ variant: 'primary', label: 'Prêt', icon: amReady ? 'check' : undefined, pressed: amReady, count: `${s.ready.length}/${alive}`, size: 'lg', state: amReady ? 'waiting' : 'idle', className: 't-tray__ready', attrs: { 'data-ready': '' } })}</div>`;
    const hint = ui.fuse ? 'Fusion : choisis deux de tes dés non placés.' : amReady ? 'Tu es prêt. Clique encore « Prêt » pour modifier tes dés.' : m ? 'Touche un dé puis une case.' : 'Clique un dé puis une case, ou glisse-le.';
    return `<div class="t-tray">${T.DicePool({ dice, size: m ? 'md' : 'lg', hint, className: 't-tray__pool', actions })}</div>`;
  }

  function screenCombat(s) {
    const enc = s.encounter;
    const boss = enc.kind === 'guardian' || enc.kind === 'boss';
    const alive = heroOf(me)?.pv > 0;
    return `${screenOpen(boss ? 'boss' : 'combat', s, boss ? ` data-boss="${esc(enc.id)}"` : '')}${header(s, { rooms: !boss })}
      <main class="t-combat">
        ${party(s, { dice: true, className: 't-combat__party' })}
        <section class="t-stage">${powerBanner(enc)}${roomCard(s, enc, enc.boxes, s.dice, { interactive: alive })}${tray(s)}</section>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 6. résultat

  const vaincu = (id) => (FEMININE.has(id) ? 'est vaincue' : 'est vaincu');

  function screenResult(s) {
    const r = s.lastResolution;
    const boss = r.kind === 'guardian' || r.kind === 'boss';
    const enc = { kind: r.kind, id: r.id, name: r.name, chosen: r.chosen, round: r.round, bossPv: r.bossPv, bossPvMax: r.bossPvMax, ability: r.ability, xp: s.reward?.xp, loot: s.reward?.loots?.[0] };
    const covered = r.results.filter((x) => x.covered).length;
    const hurt = Object.entries(r.taken).filter(([, n]) => n > 0);
    const dmg = hurt.length
      ? hurt.map(([pid, n]) => `<span class="t-dmg">${T.Avatar({ name: playerName(pid), src: avatarOf(pid), size: 'xs', decorative: true })}${esc(heroOf(pid)?.name ?? '')} <b>−${n}</b></span>`).join('')
      : '<b class="stat">0</b><span class="caption">personne n’est touché</span>';
    const lines = [
      ['Cases couvertes', `<b class="stat">${covered}</b><span class="caption">/${r.results.length}</span>`, 'check'],
      ['Dégâts', dmg, 'heart'],
      ['Torche', `<b class="stat">${r.time ? `−${r.time}` : '0'}</b><span class="caption">reste ${s.torch}/${s.torchMax}</span>`, 'flame'],
      boss
        ? ['Coups portés', `<b class="stat">${r.hits}</b><span class="caption">${esc(r.name)} ${vaincu(r.id)}</span>`, 'swords']
        : ['Expérience', `<b class="stat">+${s.reward?.xp ?? 0}</b><span class="caption">XP à prendre</span>`, 'star'],
    ].map((l) => `<li class="t-sum__line" data-k="${l[2]}">${T.icon(l[2])}<span class="label">${l[0]}</span><span class="t-sum__val">${l[1]}</span></li>`).join('');
    const failed = r.results.length - covered;
    const title = boss ? `${r.name} ${vaincu(r.id)}` : r.kind === 'peril' ? 'Le péril est franchi' : `${r.name} : salle franchie`;
    const note = failed
      ? `${failed} ${failed > 1 ? 'cases ratées' : 'case ratée'}${hurt.length ? ' : le groupe encaisse' : ''}${r.time ? ', la torche faiblit' : ''}.`
      : 'Aucune case ratée : du travail propre.';
    const override = Object.fromEntries(hurt.map(([pid, n]) => [pid, { state: heroOf(pid)?.pv > 0 ? 'hit' : 'down', dmg: n }]));
    return `${screenOpen('result', s)}${header(s, { rooms: !boss })}
      <main class="t-combat">
        ${party(s, { className: 't-combat__party', override })}
        <section class="t-stage">${roomCard(s, enc, r.boxes, r.dice, { interactive: false, sub: 'Résolution terminée', results: r.results })}
          <section class="t-sum" aria-label="Résultat"><header><h2 class="title-md">${esc(title)}</h2><span class="caption">${esc(note)}</span></header>
          <ul class="t-sum__list">${lines}</ul>${T.Button({ variant: 'primary', label: 'Voir le butin', iconRight: 'chevron-right', size: 'lg', className: 't-sum__go', attrs: { 'data-act': 'seeReward' } })}</section>
        </section>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 7. récompense

  function screenReward(s) {
    const offer = s.reward;
    const slotsCount = (offer.xp ? 1 : 0) + offer.loots.length;
    const tilt = slotsCount === 3 ? [[-9, 14], [0, -14], [9, 14]] : slotsCount === 2 ? [[-5, 6], [5, 6]] : [[0, 0]];
    const cards = [];
    if (offer.xp) {
      const next = s.xpNext ? ` Niveau ${s.level + 1} à ${s.xpNext} XP.` : '';
      cards.push({ pick: 'xp', html: T.XpCard({ value: offer.xp, note: next, selected: ui.pick === 'xp' }), cap: 'Prendre l’XP' });
    }
    offer.loots.forEach((l, i) => {
      const sel = ui.pick === String(i);
      const html = l.type === 'item' ? T.ItemCard({ item: itemOf(l), selected: sel }) : T.SkillCard({ skill: skillOf(l), selected: sel, showOwner: false });
      cards.push({ pick: String(i), html, cap: l.type === 'item' ? 'Objet' : 'Compétence', name: l.name });
    });
    const fan = `<div class="t-fan">${cards.map((c, i) => `<div role="button" tabindex="0" class="t-fan__slot prof-pick" data-pick="${c.pick}" aria-pressed="${ui.pick === c.pick}" style="--r:${tilt[i][0]}deg;--y:${tilt[i][1]}px">${c.html}<span class="t-fan__cap caption">${esc(c.cap)}</span></div>`).join('')}</div>`;
    const loot = ui.pick !== null && ui.pick !== 'xp' ? offer.loots[Number(ui.pick)] : null;
    const recv = s.heroes.map((h) => {
      const knows = loot?.type === 'skill' && h.skills.some((x) => x.id === loot.id);
      const on = ui.receiver === h.playerId && !!loot;
      return `<button type="button" class="t-recv ${on ? 'is-selected' : ''}" data-receiver="${esc(h.playerId)}" aria-pressed="${on}" ${!loot || knows ? 'disabled' : ''}>
        <span class="t-recv__medal">${T.icon(HERO_EMBLEM[h.heroId])}</span><span class="t-recv__txt"><b class="button">${esc(h.name)}</b><span class="caption">${esc(knows ? 'la connaît déjà' : h.playerName)}</span></span>
        ${on ? `<span class="t-recv__check">${T.icon('check')}</span>` : ''}</button>`;
    }).join('');
    const receiverHero = s.heroes.find((h) => h.playerId === ui.receiver);
    const go = ui.pick === 'xp'
      ? T.Button({ variant: 'primary', label: `Prendre ${offer.xp} XP`, size: 'lg', iconRight: 'chevron-right', disabled: busy, attrs: { 'data-act': 'takeReward' } })
      : T.Button({ variant: 'primary', label: receiverHero ? `Donner à ${HERO_ARTICLE[receiverHero.heroId] ?? ''}${receiverHero.name}` : 'Choisis qui le reçoit', size: 'lg', iconRight: 'chevron-right', disabled: busy || !loot || !receiverHero, attrs: { 'data-act': 'takeReward' } });
    const title = offer.guardian ? 'Le trésor du gardien' : 'Choisis une récompense';
    const body = offer.guardian
      ? 'Le gardien laisse deux trésors : un seul héros en reçoit un. Ensuite, le groupe se repose au camp.'
      : 'L’XP va à tout le groupe. Un objet ou une compétence va à un seul héros.';
    return `${screenOpen('reward', s)}${header(s)}
      <main class="t-reward-scr">
        <div class="t-reward-scr__intro"><span class="label">Butin · ${esc(s.lastResolution?.name ?? '')}</span><h1 class="title-lg">${title}</h1><p class="body">${body}</p></div>
        ${fan}
        <section class="t-panel t-recvs"><h2 class="t-panel__title label">${loot ? `Qui reçoit ${esc(loot.name)} ?` : 'Choisis un trésor pour l’offrir à un héros'}</h2><div class="t-recvs__row">${recv}</div></section>
        <div class="t-reward-scr__go">${T.Button({ variant: 'ghost', label: 'Laisser le butin', disabled: busy, attrs: { 'data-act': 'skipReward' } })}${go}</div>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 8. camp

  function screenCamp(s) {
    // ui.campFrom : PV d'avant le repos, le temps de l'animation ; le bilan vient du serveur (s.camp)
    const from = ui.campFrom;
    const report = s.camp ?? { healed: {}, revived: [] };
    const heroes = s.heroes.map((h, i) => {
      const was = from?.[h.playerId];
      const revived = report.revived.includes(h.playerId);
      const gain = report.healed[h.playerId] ?? 0;
      const o = {
        hero: h.heroId, player: h.playerName, me: h.playerId === me, hp: was ?? h.pv, maxHp: h.pvMax, armor: h.stats.armor,
        skills: h.skills.map((x) => x.id), items: h.items.map((x) => x.id), state: was !== undefined && was <= 0 ? 'down' : 'idle', variant: mobile() ? 'compact' : 'full',
      };
      const label = revived ? `${h.heroId === 'guerriere' || h.heroId === 'rodeuse' ? 'Relevée' : 'Relevé'} · +${gain} PV` : gain > 0 ? `+${gain} PV` : 'En pleine forme';
      return `<div class="t-camp__hero ${revived ? 'is-revived' : ''}" style="--k:${i}" data-camp="${esc(h.playerId)}">${T.HeroPortrait(o)}
        <span class="t-camp__gain gauge">${label}</span></div>`;
    }).join('');
    const g = s.lastResolution;
    return `${screenOpen('camp', s)}${header(s, { rooms: false })}
      <main class="t-camp">
        <div class="t-camp__intro"><span class="label">Étage ${s.floor} terminé${g ? ` · ${esc(g.name)} ${vaincu(g.id)}` : ''}</span><h1 class="title-lg">Le camp</h1>
          <p class="body">Le groupe souffle autour du feu : +4 PV pour chaque héros, les héros à terre se relèvent.</p></div>
        <div class="t-camp__fire" aria-hidden="true"><span class="t-camp__glow"></span>${T.icon('campfire', { className: 't-camp__ico' })}</div>
        <div class="t-camp__party" style="--n:${s.heroes.length}">${heroes}</div>
        <div class="t-camp__foot"><ul class="t-camp__stats">
          <li><b class="stat">${s.cleared.length}</b><span class="caption">${s.cleared.length > 1 ? 'salles cet étage' : 'salle cet étage'}</span></li>
          <li><b class="stat">${s.stats.guardians}</b><span class="caption">${s.stats.guardians > 1 ? 'gardiens vaincus' : 'gardien vaincu'}</span></li>
          <li><b class="stat">${s.level}</b><span class="caption">niveau</span></li></ul>
          ${T.Button({ variant: 'primary', label: 'Étage suivant', icon: 'stairs', size: 'lg', disabled: busy, attrs: { 'data-act': 'continue' } })}</div>
      </main></div>`;
  }

  // ---------------------------------------------------------------- 9. fin

  function screenEnding(s) {
    const win = s.phase === 'victory';
    const r = s.lastResolution;
    const host = ctx.getRoom()?.hostId === me;
    const stats = [
      [String(s.stats.rooms), 'salles franchies'],
      [`${s.stats.guardians}/3`, 'gardiens et boss'],
      [`${s.floor}/${s.floors}`, 'étage atteint'],
      [String(s.level), 'niveau atteint'],
    ];
    const emblem = win ? T.icon(ROOM_EMBLEM[r?.id] ?? 'crown') : `${T.icon('torch')}<svg class="t-end__smoke" viewBox="0 0 40 60" aria-hidden="true"><path d="M20 58c-6-6 6-10 0-17s6-11 0-18 4-10 0-16"/><path d="M27 52c-4-4 4-7 0-12s4-7 0-11"/></svg>`;
    return `${screenOpen(win ? 'victory' : 'defeat', s, ` data-outcome="${win ? 'victory' : 'defeat'}"`)}
      <div class="t-end__fx" aria-hidden="true"><span class="t-end__rays"></span><span class="t-end__glow"></span></div>
      <main class="t-end">
        <div class="t-end__emb">${emblem}</div>
        <span class="label">${esc(s.dungeon?.name ?? '')} · ${win ? `${esc(r?.name ?? 'le boss')} ${FEMININE.has(r?.id) ? 'est tombée' : 'est tombé'}` : `étage ${s.floor}`}</span>
        <h1 class="title-xl">${win ? 'Victoire' : 'Défaite'}</h1>
        <p class="body">${win ? 'Le donjon se tait. Le groupe remonte vers la lumière, chargé d’or.' : 'Le dernier héros s’effondre. Dans le noir, les profondeurs reprennent leur silence.'}</p>
        <ul class="t-end__stats">${stats.map((x) => `<li><b class="stat">${x[0]}</b><span class="caption">${x[1]}</span></li>`).join('')}</ul>
        <div class="t-end__party">${s.heroes.map((h) => `<span class="t-end__hero">${T.icon(HERO_EMBLEM[h.heroId])}<span class="caption">${esc(h.playerName)}</span></span>`).join('')}</div>
        <p class="caption prof-end-note">${host ? 'Pour rejouer, utilise « Retour au salon » en haut de l’écran.' : 'L’hôte peut relancer une partie depuis le salon.'}</p>
        <p class="caption prof-credit">Emblèmes : game-icons.net (Lorc, Delapouite et contributeurs), CC BY 3.0</p>
      </main></div>`;
  }

  // ---------------------------------------------------------------- règles

  function rulesOverlay() {
    const tabs = rulesTabs(T, mobile());
    const i = Math.max(0, tabs.findIndex((t) => t.id === ui.tab));
    const footer = `${T.Button({ variant: 'ghost', label: 'Précédent', icon: 'chevron-left', size: 'sm', disabled: i === 0, attrs: { 'data-rules-step': -1 } })}
      <span class="caption prof-credit">Emblèmes : game-icons.net (Lorc, Delapouite et contributeurs), CC BY 3.0</span>
      ${T.Button({ variant: 'secondary', label: i === tabs.length - 1 ? 'Fermer' : 'Suivant', iconRight: i === tabs.length - 1 ? undefined : 'chevron-right', size: 'sm', attrs: { 'data-rules-step': 1 } })}`;
    // .t-rules-host est un conteneur : sous 640 px, la fenêtre prend sa mise en page mobile
    return `<div class="t-rules-host prof-rules-host"><div class="t-scrim" data-close-rules>${T.Dialog({ id: 'prof-regles', title: 'Règles', icon: 'book', tabs, active: ui.tab, size: 'lg', footer })}</div></div>`;
  }

  // ================================================================ animations

  /** Sur l'écran encore affiché : ce qui mène de prev à next. */
  async function before(prev, next, events) {
    const root = screenEl();
    if (!root) return;
    const tls = [];
    if (prev.phase === 'dice' && next.phase === 'dice' && encKey(prev) === encKey(next)) {
      // dés posés par les autres joueurs : ils volent depuis leur portrait
      for (const d of next.dice) {
        if (d.owner === me || !d.box) continue;
        const old = prev.dice.find((x) => x.id === d.id);
        if (!old || old.box === d.box) continue;
        const slot = slotEl(d.box);
        const from = dieEl(d.id) ?? heroEl(d.owner);
        if (!slot || !from) continue;
        tls.push(T.anim.flyIn(dieProps(d, next, { curse: 0, owner: { id: d.owner, name: playerName(d.owner) } }), from, slot, { root }));
        if (from.classList.contains('t-die')) from.style.visibility = 'hidden';
      }
      for (const pid of next.ready) {
        if (prev.ready.includes(pid)) continue;
        const h = heroEl(pid);
        if (h) tls.push(T.anim.ready(h, { root }));
      }
    }
    await Promise.all(tls.map((t) => t.done()));

    const levelUp = events.find((e) => e.type === 'levelUp');
    for (const e of events) {
      if (e.type === 'doors') {
        const torch = q('.t-header .t-torch');
        if (torch) await T.anim.flameOut(torch, { root }).done();
      } else if (e.type === 'enter') await chooseDoorAnim(e.index, root);
      else if (e.type === 'skill') await skillAnim(e, prev, next, root);
      else if (e.type === 'resolve') await resolveAnim(e, prev, next, root);
      else if (e.type === 'loot') await lootAnim(e, prev);
    }
    const xp = q('.t-header .t-xp');
    if (xp && levelUp) {
      const target = q('.t-party') ?? q('.t-recvs') ?? root;
      await T.anim.levelUp(xp, target, { root, rest: next.xp, nextMax: next.xpNext ?? next.xp, goldValue: 6 }).done();
    } else if (xp && next.xp > prev.xp) {
      await T.anim.xp(xp, next.xp, { root }).done();
    }
  }

  async function skillAnim(e, prev, next, root) {
    const sk = prev.heroes.find((h) => h.playerId === e.owner)?.skills.find((x) => x.id === e.skillId);
    if (!sk) return;
    const die = e.dieId ? dieEl(e.dieId) : null;
    switch (sk.effect) {
      case 'boost': if (die) await T.anim.plus(die, sk.amount, { root }).done(); break;
      case 'six': if (die) await T.anim.flip(die, 6, { root }).done(); break;
      case 'gold': if (die) await T.anim.transmute(die, { root }).done(); break;
      case 'reroll':
      case 'ballad': {
        const els = [];
        const values = [];
        for (const d of next.dice) {
          const o = prev.dice.find((x) => x.id === d.id);
          if (!o || d.box || (sk.effect === 'ballad' ? o.value > 2 : d.owner !== e.owner)) continue;
          const el = dieEl(d.id);
          if (el) { els.push(el); values.push(d.value); }
        }
        if (els.length) await T.anim.reroll(els, { root, values }).done();
        break;
      }
      case 'heal':
        for (const h of next.heroes) {
          const o = prev.heroes.find((x) => x.playerId === h.playerId);
          const el = heroEl(h.playerId);
          if (!o || !el || h.pv <= o.pv) continue;
          if (o.pv <= 0) await T.anim.revive(el, { root }).done();
          await T.anim.heal(el, h.pv - o.pv, { root }).done();
        }
        break;
      case 'shield': { const p = q('.t-party'); if (p) await T.anim.aegis(p, { root }).done(); break; }
      case 'notime': { const t = q('.t-header .t-torch'); if (t) await T.anim.shortcut(t, { root }).done(); break; }
      default: break;
    }
  }

  async function resolveAnim(e, prev, next, root) {
    const enc = prev.encounter;
    if (!enc) return;
    // les dégâts de la vague de froid sont joués à part, sur les seuls héros qu'elle a frappés
    const frozen = e.aoeTargets ?? [];
    const queue = Object.entries(e.taken)
      .map(([pid, n]) => [pid, frozen.includes(pid) ? n - e.aoe : n])
      .filter(([, n]) => n > 0);
    let time = e.time;
    const plan = [];
    for (const r of e.results) {
      const slot = slotEl(r.boxId);
      if (!slot) continue;
      const box = enc.boxes.find((b) => b.id === r.boxId);
      const st = { slot, ok: r.covered };
      if (!r.covered && box) {
        if (box.penalty.damage && queue.length) {
          const head = queue[0];
          const take = Math.min(box.penalty.damage, head[1]);
          st.hero = heroEl(head[0]);
          st.hp = take;
          head[1] -= take;
          if (!head[1]) queue.shift();
        }
        if (box.penalty.time && time > 0) {
          st.torch = Math.min(box.penalty.time, time);
          time -= st.torch;
        }
      }
      plan.push(st);
    }
    if (plan.length) await T.anim.resolve(plan, { root, torch: q('.t-header .t-torch') }).done();
    for (const [pid, n] of queue) {
      const el = heroEl(pid);
      if (el && n > 0) await T.anim.hit(el, n, { root }).done();
    }
    if (e.aoe && frozen.length) {
      const p = q('.t-party');
      const all = prev.heroes.filter((h) => h.pv > 0).every((h) => frozen.includes(h.playerId)) && prev.heroes.every((h) => h.pv > 0);
      if (p && all) await T.anim.frost(p, { root, n: e.aoe }).done();
      else await Promise.all(frozen.map((pid) => heroEl(pid)).filter(Boolean).map((el) => T.anim.hit(el, e.aoe, { root }).done()));
    }
    const card = q('.t-stage__room');
    if (card && e.hits && (enc.kind === 'guardian' || enc.kind === 'boss')) {
      await T.anim.bossHit(card, e.hits, { root }).done();
      if (e.bossPv === 0) await T.anim.shatter(card, { root }).done();
      else if (enc.ability?.type === 'enrage' && enc.bossPv > enc.bossPvMax / 2 && e.bossPv <= enc.bossPvMax / 2) {
        await furyAnim(card, next, root);
      }
    }
    await wait(next.phase === 'dice' ? 600 : 250);
  }

  async function lootAnim(e, prev) {
    const offer = prev.reward;
    if (!offer || !q('.t-fan')) return;
    const i = Number.isInteger(e.index) ? e.index : offer.loots.findIndex((l) => l.name === e.name);
    const card = q(`.t-fan__slot[data-pick="${i}"] .t-card`);
    const target = q(`.t-recv[data-receiver="${e.heroOf}"]`);
    if (card && target) await T.anim.give(card, target, { root: screenEl() }).done();
  }

  /** Sur le nouvel écran : entrées en scène. */
  async function after(prev, next, events) {
    const root = screenEl();
    if (!root) return;
    if (next.phase === 'doors' && ui.doorsOpen !== doorsKey(next)) {
      ui.doorsOpen = doorsKey(next);
      await T.anim.doors(qa('.t-door'), null, { root }).done();
    }
    const roll = events.filter((e) => e.type === 'roll').at(-1);
    if (roll && next.phase === 'dice') {
      const dice = qa('.t-pool .t-die, .t-hero__dice .t-die');
      const stage = q('.t-stage');
      // dés maudits : ils roulent sur leur valeur d'avant, puis la malédiction les assombrit (−1)
      const cursed = dice.filter((el) => el.classList.contains('is-cursed'));
      for (const el of cursed) {
        el.querySelector('.t-die__curse')?.remove();
        el.classList.remove('is-cursed');
        const v = Number(el.dataset.v);
        el.dataset.v = String(Math.min(6, v + 1));
        const num = el.querySelector('.t-die__face > .t-die__num');
        if (num) num.textContent = el.dataset.v;
      }
      const summoned = qa('.t-stage .t-slot.is-summoned');
      if (roll.round > 1 && stage) await T.anim.round(stage, roll.round, { root, dice }).done();
      else if (dice.length) await T.anim.roll(dice, { root }).done();
      if (summoned.length) await summonAnim(summoned, root);
      if (cursed.length) await T.anim.curse(cursed, { root }).done();
    }
    if (next.phase === 'reward' && prev.phase !== 'reward' && q('.t-fan')) await fanIn();
    if (next.phase === 'camp' && ui.campFrom) {
      const from = ui.campFrom;
      ui.campFrom = null;
      await Promise.all(next.heroes.map(async (h) => {
        const el = q(`[data-camp="${h.playerId}"] .t-hero`);
        const was = from[h.playerId] ?? h.pv;
        if (!el) return;
        if (was <= 0) await T.anim.revive(el, { root }).done();
        if (h.pv > Math.max(was, 0)) await T.anim.heal(el, h.pv - Math.max(was, 0), { root }).done();
      }));
      render(); // état définitif : PV et étiquettes à jour
    }
    if ((next.phase === 'victory' || next.phase === 'defeat') && prev.phase !== next.phase) {
      await T.anim.ending(root, { root }).done();
    }
  }

  const fanIn = () => T.anim.fan(qa('.t-fan__slot'), { root: screenEl() }).done();

  /** La porte choisie avance, l'autre recule et s'estompe (Mouvement : « Portes »). */
  async function chooseDoorAnim(index, root) {
    const doors = qa('.t-door');
    if (!doors.length) return;
    const tl = new T.Timeline({ root });
    doors.forEach((d, i) => {
      const chosen = i === index;
      tl.add(d, chosen
        ? [{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.06)' }]
        : [{ transform: 'none', opacity: 1, filter: 'none' }, { transform: 'translateY(26px) scale(.9)', opacity: 0.38, filter: 'saturate(.4)' }],
      { duration: 420, easing: T.motion.ease.out });
    });
    await tl.start().done();
  }

  /** Fureur : seules les cases dont le seuil a vraiment monté clignotent ; la salle rougeoie. */
  async function furyAnim(card, next, root) {
    const raised = new Set((next.encounter?.boxes ?? []).filter((b) => b.fury).map((b) => b.id));
    const tl = new T.Timeline({ root });
    let k = 0;
    for (const slot of card.querySelectorAll('.t-slot')) {
      if (!raised.has(slot.dataset.id)) continue;
      const nb = slot.querySelector('.t-slot__need > b, .t-slot__target');
      if (!nb) continue;
      const was = Number(nb.textContent);
      T.anim.swapText(nb, String(was), String(was + 1), { tl, delay: 100 + k * 40 });
      tl.add(nb, [{ transform: 'none' }, { transform: 'scale(1.35)', offset: 0.25 }, { transform: 'none', offset: 0.5 }, { transform: 'scale(1.35)', offset: 0.75 }, { transform: 'none' }], { duration: 800, delay: 120 + k * 40, easing: 'linear' });
      k += 1;
    }
    const base = getComputedStyle(card).boxShadow;
    const glow = `${base}, 0 0 0 2px #c8402f, 0 0 34px 6px rgba(224, 89, 42, .55)`;
    tl.add(card, [{ boxShadow: base }, { boxShadow: glow, offset: 0.2 }, { boxShadow: base, offset: 0.45 }, { boxShadow: glow, offset: 0.7 }, { boxShadow: base }], { duration: T.motion.dur.fury, easing: 'linear' });
    await tl.start().done();
  }

  /** Case invoquée (Ver de lave, Ysh'ka) : elle surgit avec une onde de braise ou de toile. */
  async function summonAnim(slots, root) {
    const tl = new T.Timeline({ root });
    slots.forEach((slot, i) => {
      tl.add(slot, [{ transform: 'scale(.3) rotate(-12deg)', opacity: 0 }, { transform: 'scale(1.1) rotate(3deg)', opacity: 1, offset: 0.62 }, { transform: 'none', opacity: 1 }], { duration: T.motion.dur.summon, delay: i * 80, easing: T.motion.ease.out });
    });
    await tl.start().done();
  }

  /** Changement d'étage : l'écran change pendant le noir. */
  async function floorTransition(e, next) {
    const dungeon = next.dungeon?.name ?? '';
    host.style.position = 'relative';
    const tl = T.anim.floor(host, e.floor, { root: host, text: dungeon });
    await wait(720);
    render();
    await tl.done();
  }

  // ================================================================ interactions

  async function send(type, payload = {}) {
    if (busy) return false;
    busy = true;
    try {
      await ctx.sendAction(type, payload);
      return true;
    } catch (err) {
      ctx.toast(err.message, 'error');
      return false;
    } finally {
      busy = false;
      chain = chain.then(() => render()); // boutons réactivés
    }
  }

  /** Action sur les dés : l'animation locale passe dans la file pour ne pas être coupée. */
  function diceAction(animate, type, payload) {
    const tl = animate();
    chain = chain.then(() => tl?.done());
    ctx.sendAction(type, payload).catch((err) => {
      ctx.toast(err.message, 'error');
      chain = chain.then(() => render());
    });
  }

  function markTargets() {
    const sel = ui.sel ? q(`.t-pool .t-die[data-id="${ui.sel}"]`) : null;
    for (const s of qa('.t-stage .t-slot[role="button"]')) {
      const ok = !!sel && T.interact.fits(sel, s);
      s.classList.toggle('is-target', ok);
      s.classList.toggle('is-dim', !!sel && !ok);
    }
  }

  function select(id) {
    const old = ui.sel ? q(`.t-pool .t-die[data-id="${ui.sel}"]`) : null;
    if (old) T.anim.select(old, false);
    ui.sel = id;
    const el = id ? q(`.t-pool .t-die[data-id="${id}"]`) : null;
    if (el) T.anim.select(el, true);
    markTargets();
  }

  function nope(node, msg) {
    node.classList.add('is-invalid');
    setTimeout(() => node.classList.remove('is-invalid'), 340);
    if (msg) ctx.toast(msg, 'error');
  }

  function placeOn(die, slot, from) {
    if (!T.interact.fits(die, slot)) return nope(slot, 'Ce dé ne va pas sur cette case.');
    const dieId = die.dataset.id;
    ui.sel = null;
    markTargets();
    diceAction(() => T.anim.place(die, slot, { root: screenEl(), from }), 'place', { dieId, boxId: slot.dataset.id });
  }

  function onDiceClick(e) {
    const die = e.target.closest('.t-die');
    const slot = e.target.closest('.t-slot[role="button"]');
    if (e.target.closest('[data-fuse]')) {
      ui.fuse = !ui.fuse;
      ui.fuseFirst = null;
      ui.sel = null;
      render();
      return true;
    }
    if (e.target.closest('[data-ready]')) {
      send('ready', { ready: !state.ready.includes(me) });
      return true;
    }
    const skill = e.target.closest('[data-skill]');
    if (skill) {
      const sk = heroOf(me)?.skills.find((x) => x.id === skill.dataset.skill);
      if (!sk || sk.used) return true;
      const needDie = ['boost', 'six', 'gold'].includes(sk.effect);
      if (needDie && !ui.sel) { ctx.toast(`${sk.name} : choisis d’abord un de tes dés.`, 'error'); return true; }
      send('skill', { skillId: sk.id, dieId: needDie ? ui.sel : undefined });
      return true;
    }
    if (die && !die.classList.contains('is-foreign') && die.closest('.t-stage') && !die.closest('.t-hero')) {
      const id = die.dataset.id;
      const inSlot = die.closest('.t-slot');
      // un dé est choisi et on clique une case (même sur un dé déjà posé) : on pose le dé choisi
      if (inSlot && ui.sel && ui.sel !== id) {
        const sel = q(`.t-pool .t-die[data-id="${ui.sel}"]`);
        if (sel && T.interact.fits(sel, inSlot)) { placeOn(sel, inSlot); return true; }
      }
      if (inSlot) {
        die._ghost = q(`.t-pool .t-die-ghost[data-ghost-for="${id}"]`); // son propre emplacement
        diceAction(() => T.anim.unplace(die, { root: screenEl(), pool: q('.t-pool') }), 'place', { dieId: id, boxId: null });
        return true;
      }
      if (ui.fuse) {
        if (!ui.fuseFirst) { ui.fuseFirst = id; T.anim.select(die, true); return true; }
        if (ui.fuseFirst === id) { ui.fuseFirst = null; T.anim.select(die, false); return true; }
        const first = dieEl(ui.fuseFirst);
        const ids = [ui.fuseFirst, id];
        ui.fuse = false;
        ui.fuseFirst = null;
        screenEl()?.classList.remove('is-fusing');
        if (first) T.anim.select(first, false);
        diceAction(() => (first ? T.anim.fuse(first, die, { root: screenEl() }) : null), 'fuse', { dieIds: ids });
        return true;
      }
      select(ui.sel === id ? null : id);
      return true;
    }
    if (slot && ui.sel) {
      const sel = q(`.t-pool .t-die[data-id="${ui.sel}"]`);
      if (sel) placeOn(sel, slot);
      return true;
    }
    return false;
  }

  function onClick(e) {
    if (!state || !T) return;
    if (e.target.closest('[data-motion-toggle]')) return; // géré par Torche (document)
    // règles
    if (e.target.closest('[data-open-rules]')) { openRules(); return; }
    if (animating || Date.now() - ui.lastDrag < 80) return;

    const hero = e.target.closest('.t-card--hero[role="button"]');
    if (hero && state.phase === 'setup') { send('pickHero', { heroId: hero.dataset.hero }); return; }
    const dg = e.target.closest('[data-pick-dungeon]');
    if (dg) { send('pickDungeon', { dungeonId: dg.dataset.pickDungeon }); return; }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      ui.pick = pick.dataset.pick;
      if (ui.pick === 'xp') ui.receiver = null;
      render();
      return;
    }
    const recv = e.target.closest('[data-receiver]');
    if (recv && !recv.disabled) { ui.receiver = recv.dataset.receiver; render(); return; }

    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) {
      const index = Number(act.dataset.index);
      switch (act.dataset.act) {
        case 'start': send('start'); break;
        case 'openDoors': send('openDoors'); break;
        case 'descend': send('descend'); break;
        case 'enter': send('enter', { index }); break;
        case 'choose': send('choose', { index }); break;
        case 'continue': send('continue'); break;
        case 'skipReward': send('reward', { choice: 'skip' }); break;
        case 'takeReward':
          if (ui.pick === 'xp') send('reward', { choice: 'xp' });
          else if (ui.pick !== null && ui.receiver) send('reward', { choice: ui.pick, heroOf: ui.receiver });
          break;
        case 'seeReward':
          ui.resultSeen = state.lastResolution?.seq ?? 0;
          render();
          if (T.motion.enabled()) fanIn();
          break;
        default: break;
      }
      return;
    }
    if (state.phase === 'dice') onDiceClick(e);
  }

  /** Clics dans la fenêtre des règles. */
  function onRulesClick(e) {
    const tab = e.target.closest('[data-tab]');
    const stepBtn = e.target.closest('[data-rules-step]');
    if (tab) { ui.tab = tab.dataset.tab; renderRules({ focus: true }); return; }
    if (stepBtn) {
      const ids = rulesTabs(T, false).map((t) => t.id);
      const i = ids.indexOf(ui.tab) + Number(stepBtn.dataset.rulesStep);
      if (i >= ids.length) closeRules();
      else { ui.tab = ids[Math.max(0, i)]; renderRules({ focus: true }); }
      return;
    }
    if (e.target.closest('.t-dialog__close') || e.target.matches('[data-close-rules]')) closeRules();
  }

  function onKey(e) {
    if (!host.isConnected || (!host.contains(e.target) && e.target !== document.body)) return;
    if (ui.rules) {
      if (e.key === 'Escape') { e.preventDefault(); closeRules(); return; }
      const tab = e.target.closest?.('[data-tab]');
      if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const ids = rulesTabs(T, false).map((t) => t.id);
        const i = (ids.indexOf(ui.tab) + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
        ui.tab = ids[i];
        renderRules({ focus: true });
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (ui.sel || ui.fuse) { ui.fuse = false; ui.fuseFirst = null; select(null); render(); }
      return;
    }
    if (!view.contains(e.target)) return;
    const slot = e.target.closest?.('.t-slot[role="button"]');
    if (slot && (e.key === 'Enter' || e.key === ' ') && ui.sel && !animating) {
      e.preventDefault();
      const sel = q(`.t-pool .t-die[data-id="${ui.sel}"]`);
      if (sel) placeOn(sel, slot);
    }
    const card = e.target.closest?.('.t-card--hero[role="button"], .prof-pick');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.click(); }
  }

  // glisser-déposer (souris, doigt, stylet)
  function onPointerDown(e) {
    const die = e.target.closest('.t-pool .t-die');
    if (!die || die.classList.contains('is-foreign') || ui.fuse || animating || e.button > 0) return;
    if (ui.drag) cancelDrag(); // un seul glisser à la fois (multi-touch)
    ui.drag = { die, x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null, id: e.pointerId };
  }
  function cancelDrag() {
    const dr = ui.drag;
    ui.drag = null;
    if (!dr) return;
    dr.ghost?.remove();
    dr.die.classList.remove('is-dragging');
    dr.over?.classList.remove('is-drop');
  }
  function onPointerMove(e) {
    const dr = ui.drag;
    if (!dr || e.pointerId !== dr.id) return;
    if (!dr.moved && Math.abs(e.clientX - dr.x) + Math.abs(e.clientY - dr.y) < 6) return;
    if (!dr.moved) {
      dr.moved = true;
      select(dr.die.dataset.id);
      const r = dr.die.getBoundingClientRect();
      dr.ox = dr.x - r.left;
      dr.oy = dr.y - r.top;
      const g = dr.die.cloneNode(true);
      g.classList.remove('is-selected');
      g.classList.add('t-die--drag');
      Object.assign(g.style, { width: `${r.width}px`, height: `${r.height}px`, position: 'fixed', left: '0', top: '0', zIndex: 90, pointerEvents: 'none' });
      host.append(g);
      dr.ghost = g;
      dr.die.classList.add('is-dragging');
      try { view.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    }
    dr.ghost.style.transform = `translate(${e.clientX - dr.ox}px,${e.clientY - dr.oy}px) rotate(-6deg) scale(1.08)`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const s = under?.closest?.('.t-stage .t-slot[role="button"]') ?? null;
    if (dr.over && dr.over !== s) dr.over.classList.remove('is-drop');
    dr.over = s && T.interact.fits(dr.die, s) ? s : null;
    dr.over?.classList.add('is-drop');
  }
  function onPointerUp(e) {
    const dr = ui.drag;
    if (!dr || e.pointerId !== dr.id) return;
    if (!dr.moved) { ui.drag = null; return; }
    const from = dr.ghost.getBoundingClientRect();
    const over = dr.over;
    cancelDrag();
    ui.lastDrag = Date.now(); // le clic qui suit le lâcher est ignoré
    // lâcher pendant une transition, ou dé disparu entre-temps : rien ne se passe
    if (over && !animating && dr.die.isConnected && over.isConnected) placeOn(dr.die, over, from);
  }
  function onPointerCancel(e) {
    if (ui.drag && e.pointerId === ui.drag.id) cancelDrag();
  }

  view.addEventListener('click', onClick);
  rulesLayer.addEventListener('click', onRulesClick);
  document.addEventListener('keydown', onKey); // Échap doit marcher même quand le focus est sur la page
  view.addEventListener('pointerdown', onPointerDown);
  view.addEventListener('pointermove', onPointerMove);
  view.addEventListener('pointerup', onPointerUp);
  view.addEventListener('pointercancel', onPointerCancel);
  const onResize = () => { if (!animating) render(); };
  let resizeTimer = null;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const vp = mobile() ? 'mobile' : 'pc';
      if (screenEl()?.dataset.vp !== vp) onResize();
    }, 150);
  });
  resizeObserver.observe(view);

  return {
    update(next) {
      latest = next;
      if (T) enqueue(next);
    },
    unmount() {
      disposed = true;
      resizeObserver.disconnect();
      cancelDrag();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('torche:motion', onMotion);
      links.forEach((l) => l.remove());
      host.remove();
    },
  };
}
