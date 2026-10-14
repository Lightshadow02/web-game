import { stackHtml } from './view.js';

/* =====================================================================
 * Effets propres au Blackjack (Tapis n'a ni jetons ni pot) : jetons qui glissent
 * vers la mise ou vers la banque, éclat du blackjack, main sautée, glissement d'une
 * carte séparée. Tous passent par Tapis.Timeline : même contrat que Tapis.anim
 * (.done(), .finish(), Tapis.anim.finishAll()) et rien ne bouge quand les animations
 * sont coupées (interrupteur ou « animations réduites » du système).
 * ===================================================================== */

const EASE = {
  out: 'cubic-bezier(.22,.8,.3,1)', inOut: 'cubic-bezier(.65,0,.35,1)', back: 'cubic-bezier(.34,1.56,.64,1)',
  in: 'cubic-bezier(.5,0,.75,0)', std: 'cubic-bezier(.4,0,.2,1)',
};

export function createFx(T, zone) {
  /** Boîte relative à la zone (élément ou boîte déjà calculée). */
  function box(el) {
    if (el && el.x != null && el.w != null) return el;
    const z = zone.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const b = { x: r.left - z.left, y: r.top - z.top, w: r.width, h: r.height };
    b.cx = b.x + b.w / 2;
    b.cy = b.y + b.h / 2;
    return b;
  }

  function layer(tl) {
    const l = document.createElement('div');
    l.className = 'tp-fx';
    l.setAttribute('aria-hidden', 'true');
    zone.append(l);
    return tl.node(l);
  }

  const timeline = (o = {}) => new T.Timeline({ root: zone, ...o });

  /** Pose un nœud absolu centré sur la boîte b. */
  function place(lay, node, b) {
    lay.append(node);
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    node.style.left = `${b.cx - w / 2}px`;
    node.style.top = `${b.cy - h / 2}px`;
    return node;
  }

  function stackNode(amount, o) {
    const n = T.node(stackHtml(amount, { label: false, ...o }));
    n.classList.add('bj-ghost');
    return n;
  }

  /** Une pile de `amount` jetons vole de `from` à `to` (éléments ou boîtes). */
  function chips(amount, from, to, { delay = 0, duration = 520, fade = false, lift = 46 } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !from || !to || !(amount > 0)) return tl.start();
    const lay = layer(tl);
    const a = box(from);
    const b = box(to);
    const g = place(lay, stackNode(amount), b);
    const dx = a.cx - b.cx;
    const dy = a.cy - b.cy;
    tl.add(g, [
      { transform: `translate(${dx}px,${dy}px) scale(.8)`, opacity: 0, offset: 0 },
      { transform: `translate(${dx}px,${dy}px) scale(1)`, opacity: 1, offset: 0.1 },
      { transform: `translate(${dx * 0.45}px,${dy * 0.45 - lift}px) scale(1.08)`, opacity: 1, offset: 0.55 },
      { transform: 'none', opacity: fade ? 0 : 1, offset: 1 },
    ], { duration, easing: EASE.inOut });
    return tl.start();
  }

  /**
   * Piles posées sur la table pendant que la banque joue (le DOM final ne les montre plus) :
   * elles restent jusqu'à ce qu'on les fasse partir (fly) ou qu'on nettoie (clear).
   */
  function holder() {
    const lay = document.createElement('div');
    lay.className = 'tp-fx bj-hold';
    lay.setAttribute('aria-hidden', 'true');
    zone.append(lay);
    return {
      stack(amount, at, o) {
        return at ? place(lay, stackNode(amount, o), box(at)) : null;
      },
      /** Fait voler un nœud posé vers `to` ; il disparaît à l'arrivée. */
      fly(node, to, { delay = 0, duration = 560, fade = true, lift = 40 } = {}) {
        const tl = timeline({ delay });
        if (!node || !to) return tl.start();
        tl.then(() => node.remove());
        if (!tl.on) return tl.start();
        const a = box(node);
        const b = box(to);
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        tl.add(node, [
          { transform: 'none', opacity: 1, offset: 0 },
          { transform: `translate(${dx * 0.5}px,${dy * 0.5 - lift}px) scale(1.06)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${dx}px,${dy}px) scale(.9)`, opacity: fade ? 0 : 1, offset: 1 },
        ], { duration, easing: EASE.inOut });
        return tl.start();
      },
      clear() {
        lay.remove();
      },
    };
  }

  function floatText(tl, lay, text, b, cls = 'tp-float--gold', delay = 0, dur = 1100, center = false) {
    const s = document.createElement('span');
    s.className = `tp-float ${cls}`;
    s.innerHTML = T.rich(text);
    lay.append(s);
    const x = b.cx;
    const y = center ? b.cy : b.y;
    tl.add(s, [
      { transform: `translate(${x}px,${y + 10}px) translate(-50%,-50%) scale(.5)`, opacity: 0 },
      { transform: `translate(${x}px,${y - 8}px) translate(-50%,-50%) scale(1.15)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${x}px,${y - 22}px) translate(-50%,-50%) scale(1)`, opacity: 1, offset: 0.75 },
      { transform: `translate(${x}px,${y - 36}px) translate(-50%,-50%) scale(1)`, opacity: 0 },
    ], { duration: dur, delay, easing: EASE.out });
  }

  function flash(tl, lay, b, cls, size, delay = 0, dur = 480) {
    const f = document.createElement('span');
    f.className = `tp-flash ${cls}`;
    f.style.width = `${size}px`;
    f.style.height = `${size}px`;
    lay.append(f);
    tl.add(f, [
      { transform: `translate(${b.cx}px,${b.cy}px) translate(-50%,-50%) scale(.2)`, opacity: 0 },
      { transform: `translate(${b.cx}px,${b.cy}px) translate(-50%,-50%) scale(1)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${b.cx}px,${b.cy}px) translate(-50%,-50%) scale(1.7)`, opacity: 0 },
    ], { duration: dur, delay, easing: EASE.out });
  }

  function sparks(tl, lay, b, n, radius, delay = 0) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const sp = document.createElement('span');
      sp.className = 'tp-spark';
      sp.innerHTML = T.icon('sparkle');
      lay.append(sp);
      tl.add(sp, [
        { transform: `translate(${b.cx}px,${b.cy}px) translate(-50%,-50%) scale(.2)`, opacity: 0 },
        { transform: `translate(${b.cx + Math.cos(a) * radius * 0.65}px,${b.cy + Math.sin(a) * radius * 0.65}px) translate(-50%,-50%) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${b.cx + Math.cos(a) * radius}px,${b.cy + Math.sin(a) * radius}px) translate(-50%,-50%) scale(.3)`, opacity: 0 },
      ], { duration: 520, delay: delay + i * 16, easing: EASE.out });
    }
  }

  /** Blackjack : éclat doré, étincelles, la main se soulève, « Blackjack ! ». */
  function blackjack(handEl, { delay = 0, text = 'Blackjack !', center = false } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !handEl) return tl.start();
    const lay = layer(tl);
    const b = box(handEl);
    flash(tl, lay, b, 'tp-flash--gold', Math.max(b.w, b.h) * 1.6);
    sparks(tl, lay, b, 12, Math.max(b.w, b.h) * 0.75, 80);
    tl.add(handEl, [{ transform: 'none' }, { transform: 'scale(1.08) rotate(-2deg)', offset: 0.35 }, { transform: 'none' }], { duration: 640, easing: EASE.back });
    floatText(tl, lay, text, b, 'tp-float--gold bj-float', 160, 1300, center);
    return tl.start();
  }

  /** Main sautée (ou banque sautée) : la main tremble, éclat rouge, « Sauté ». */
  function bust(handEl, { delay = 0, text = 'Sauté', center = false } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !handEl) return tl.start();
    const lay = layer(tl);
    const b = box(handEl);
    flash(tl, lay, b, 'tp-flash--danger', Math.max(b.w, b.h) * 1.3, 0, 520);
    tl.add(handEl, [
      { transform: 'none' }, { transform: 'translateX(-7px) rotate(-1deg)' }, { transform: 'translateX(7px) rotate(1deg)' },
      { transform: 'translateX(-4px)' }, { transform: 'translateX(3px)' }, { transform: 'none' },
    ], { duration: 420, easing: EASE.std });
    floatText(tl, lay, text, b, 'tp-float--danger bj-float', 120, 1200, center);
    return tl.start();
  }

  /** Petit texte qui s'élève (« Reste », « Pas de blackjack »). */
  function say(el, text, { delay = 0, cls = 'tp-float--muted' } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !el) return tl.start();
    floatText(tl, layer(tl), text, box(el), cls, 0, 1200);
    return tl.start();
  }

  /** Gain : « +50 » doré qui s'élève au-dessus d'un élément. */
  function gain(el, text, { delay = 0, tone = 'gold' } = {}) {
    return say(el, text, { delay, cls: `tp-float--${tone} bj-float` });
  }

  /** La banque regarde sa carte cachée : la carte se soulève par le coin, puis retombe. */
  function peek(holeEl, { delay = 0 } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !holeEl) return tl.start();
    tl.add(holeEl, [
      { transform: 'none' },
      { transform: 'perspective(700px) translateY(-8%) rotateX(28deg) rotate(-4deg)', offset: 0.35 },
      { transform: 'perspective(700px) translateY(-8%) rotateX(28deg) rotate(-4deg)', offset: 0.65 },
      { transform: 'none' },
    ], { duration: 900, easing: EASE.inOut });
    return tl.start();
  }

  /** Une carte rejoint sa nouvelle place (séparation, cartes qui se resserrent). */
  function slide(el, from, { delay = 0, duration = 420, lift = 0 } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !el || !from) return tl.start();
    const a = box(from);
    const b = box(el);
    const dx = a.cx - b.cx;
    const dy = a.cy - b.cy;
    const s = b.w ? a.w / b.w : 1;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(s - 1) < 0.02) return tl.start();
    tl.add(el, [
      { transform: `translate(${dx}px,${dy}px) scale(${s})`, offset: 0 },
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 - lift}px) scale(${(s + 1) / 2})`, offset: 0.5 },
      { transform: 'none', offset: 1 },
    ], { duration, easing: EASE.inOut });
    return tl.start();
  }

  /** Apparition d'un badge (valeur de main, résultat) : il éclot comme une bulle. */
  function pop(el, { delay = 0 } = {}) {
    const tl = timeline({ delay });
    if (!tl.on || !el) return tl.start();
    tl.add(el, [{ opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1.1, offset: 0.6 }, { opacity: 1, scale: 1 }], { duration: 360, easing: EASE.back });
    return tl.start();
  }

  return { box, chips, holder, blackjack, bust, say, gain, peek, slide, pop };
}
