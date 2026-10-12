import { el } from '/js/dom.js';

/* =====================================================================
 * Effets visuels de "La Chute des Rois" (Web Animations API).
 * Les éléments animés vivent dans un calque fixe au-dessus de la page :
 * un nouveau rendu du plateau ne les interrompt pas.
 * Respecte « réduire les animations » (prefers-reduced-motion).
 * ===================================================================== */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

export function createFx({ renderCard }) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const layer = el('div', { class: 'cdr-fx-layer', 'aria-hidden': 'true' });
  document.body.append(layer);

  /** Fait voler des cartes (faces visibles ou dos) d'un rectangle à un autre. */
  async function flyCards({ cards = [], count = cards.length, from, to, size = 'md', stagger = 70, duration = 480, rotate = 8 }) {
    if (!from || !to || !count) return;
    if (reduced) return;
    const start = center(from);
    const end = center(to);
    const flights = [];
    for (let i = 0; i < count; i++) {
      const card = cards[i] ? renderCard(cards[i], { size }) : el('div', { class: `cdr-card size-${size} back` });
      card.classList.add('cdr-flying');
      layer.append(card);
      const { width, height } = card.getBoundingClientRect();
      const spread = (i - (count - 1) / 2) * 14;
      const x0 = start.x - width / 2;
      const y0 = start.y - height / 2;
      const x1 = end.x - width / 2 + spread;
      const y1 = end.y - height / 2;
      const turn = (Math.random() * 2 - 1) * rotate;
      const animation = card.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) scale(1) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 40}px) scale(1.12) rotate(${turn}deg)`, offset: 0.55 },
          { transform: `translate(${x1}px, ${y1}px) scale(1) rotate(${turn / 2}deg)`, opacity: 1 },
        ],
        { duration, delay: i * stagger, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' },
      );
      flights.push(animation.finished.catch(() => {}).then(() => card.remove()));
    }
    await Promise.all(flights);
  }

  /** Texte flottant (dégâts, soins, bouclier...) qui monte puis s'efface. */
  function floatText(rect, text, tone = 'damage', { big = false } = {}) {
    if (!rect) return Promise.resolve();
    const node = el('div', { class: `cdr-float tone-${tone} ${big ? 'big' : ''}` }, text);
    layer.append(node);
    const { x, y } = center(rect);
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    const animation = node.animate(
      reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
            { transform: 'translate(-50%, -90%) scale(1.15)', opacity: 1, offset: 0.2 },
            { transform: 'translate(-50%, -160%) scale(1)', opacity: 1, offset: 0.7 },
            { transform: 'translate(-50%, -210%) scale(0.95)', opacity: 0 },
          ],
      { duration: big ? 1300 : 1100, easing: 'ease-out' },
    );
    return animation.finished.catch(() => {}).then(() => node.remove());
  }

  /** Classe CSS temporaire (secousse, flash...) rejouable. */
  function pulse(target, className, duration = 600) {
    if (!target || reduced) return Promise.resolve();
    target.classList.remove(className);
    void target.offsetWidth; // relance l'animation CSS
    target.classList.add(className);
    return wait(duration).then(() => target.classList.remove(className));
  }

  /** Le boss bondit vers sa cible puis revient. */
  function lunge(source, targetRect) {
    if (!source || !targetRect || reduced) return Promise.resolve();
    const a = center(source.getBoundingClientRect());
    const b = center(targetRect);
    const dx = (b.x - a.x) * 0.18;
    const dy = (b.y - a.y) * 0.18;
    return source
      .animate(
        [
          { transform: 'translate(0, 0) rotate(0deg)' },
          { transform: `translate(${-dx * 0.3}px, ${-dy * 0.3}px) rotate(-3deg)`, offset: 0.25 },
          { transform: `translate(${dx}px, ${dy}px) rotate(4deg) scale(1.06)`, offset: 0.55 },
          { transform: 'translate(0, 0) rotate(0deg)' },
        ],
        { duration: 560, easing: 'ease-in-out' },
      )
      .finished.catch(() => {});
  }

  /** Fantôme d'une carte qui éclate (boss vaincu) ou part vers un autre endroit. */
  async function burstCard(card, rect, { flyTo = null } = {}) {
    if (!rect || reduced) return;
    const ghost = renderCard(card, { size: 'lg' });
    ghost.classList.add('cdr-flying', 'cdr-ghost');
    layer.append(ghost);
    const { width, height } = ghost.getBoundingClientRect();
    const x = rect.left + rect.width / 2 - width / 2;
    const y = rect.top + rect.height / 2 - height / 2;
    const frames = [
      { transform: `translate(${x}px, ${y}px) scale(1) rotate(0deg)`, opacity: 1, filter: 'brightness(1)' },
      { transform: `translate(${x}px, ${y}px) scale(1.12) rotate(-6deg)`, opacity: 1, filter: 'brightness(2.2)', offset: 0.3 },
    ];
    if (flyTo) {
      const t = center(flyTo);
      frames.push({ transform: `translate(${t.x - width / 2}px, ${t.y - height / 2}px) scale(0.55) rotate(12deg)`, opacity: 0.9, filter: 'brightness(1)' });
    } else {
      frames.push({ transform: `translate(${x}px, ${y + 30}px) scale(1.5) rotate(18deg)`, opacity: 0, filter: 'brightness(3)' });
    }
    await ghost.animate(frames, { duration: 900, easing: 'ease-in', fill: 'both' }).finished.catch(() => {});
    ghost.remove();
  }

  /** Carte (déjà rendue) qui se retourne en apparaissant. */
  function flipIn(target, fromRect) {
    if (!target || reduced) return Promise.resolve();
    const to = target.getBoundingClientRect();
    const dx = fromRect ? center(fromRect).x - center(to).x : 0;
    const dy = fromRect ? center(fromRect).y - center(to).y : 0;
    return target
      .animate(
        [
          { transform: `translate(${dx}px, ${dy}px) rotateY(90deg) scale(0.6)`, opacity: 0 },
          { transform: 'translate(0, 0) rotateY(0deg) scale(1.08)', opacity: 1, offset: 0.7 },
          { transform: 'translate(0, 0) rotateY(0deg) scale(1)', opacity: 1 },
        ],
        { duration: 700, easing: 'cubic-bezier(.2,.8,.3,1)' },
      )
      .finished.catch(() => {});
  }

  /** Barre de vie qui descend de l'ancienne valeur à la nouvelle. */
  function drainBar(fill, fromPct, toPct) {
    if (!fill) return Promise.resolve();
    if (reduced) {
      fill.style.width = `${toPct}%`;
      return Promise.resolve();
    }
    return fill
      .animate([{ width: `${fromPct}%` }, { width: `${toPct}%` }], { duration: 650, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' })
      .finished.catch(() => {})
      .then(() => {
        fill.style.width = `${toPct}%`;
      });
  }

  return {
    reduced,
    flyCards,
    floatText,
    pulse,
    lunge,
    burstCard,
    flipIn,
    drainBar,
    wait: (ms) => (reduced ? Promise.resolve() : wait(ms)),
    destroy: () => layer.remove(),
  };
}
