import { el } from '/js/dom.js';

/* =====================================================================
 * Effets visuels de "La Chute des Rois" (Web Animations API).
 * Les éléments animés vivent dans un calque fixe au-dessus de la page :
 * un nouveau rendu du plateau ne les interrompt pas.
 * Activées par défaut ; le joueur peut les couper (bouton ✨, mémorisé dans le navigateur).
 * ===================================================================== */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

export function createFx({ renderCard, isEnabled = () => true }) {
  // Lu à chaque animation : le réglage peut changer en cours de partie.
  const off = () => !isEnabled();
  const layer = el('div', { class: 'cdr-fx-layer', 'aria-hidden': 'true' });
  document.body.append(layer);

  /** Fait voler des cartes (faces visibles ou dos) d'un rectangle à un autre. */
  async function flyCards({ cards = [], count = cards.length, from, to, size = 'md', stagger = 70, duration = 480, rotate = 8 }) {
    if (!from || !to || !count) return;
    if (off()) return;
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
      off()
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
    if (!target || off()) return Promise.resolve();
    target.classList.remove(className);
    void target.offsetWidth; // relance l'animation CSS
    target.classList.add(className);
    return wait(duration).then(() => target.classList.remove(className));
  }

  /** Le boss bondit vers sa cible puis revient. */
  function lunge(source, targetRect) {
    if (!source || !targetRect || off()) return Promise.resolve();
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

  /** Pose une carte « fantôme » (non interactive) exactement sur un rectangle. */
  function ghostAt(card, rect) {
    const ghost = renderCard(card, { size: 'lg' });
    ghost.classList.add('cdr-flying', 'cdr-ghost');
    layer.append(ghost);
    const { width, height } = ghost.getBoundingClientRect();
    return { ghost, x: rect.left + rect.width / 2 - width / 2, y: rect.top + rect.height / 2 - height / 2, width, height };
  }

  /**
   * K.O. (boss tombé pile à 0) : tampon « K.O. ! » sur la carte, puis la carte
   * rétrécit et file dans la pioche, qui la reçoit.
   */
  async function knockOut(card, rect, pileRect, pileEl) {
    if (!rect || off()) return;
    const { ghost, x, y, width, height } = ghostAt(card, rect);
    const stamp = el('div', { class: 'cdr-ko-stamp' }, 'K.O. !');
    ghost.append(stamp);
    const at = (dx = 0, dy = 0, extra = '') => `translate(${x + dx}px, ${y + dy}px) ${extra}`;

    // 1. Le coup : la carte encaisse, le tampon s'abat.
    stamp.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(-14deg) scale(3)', opacity: 0 },
        { transform: 'translate(-50%, -50%) rotate(-14deg) scale(0.9)', opacity: 1, offset: 0.6 },
        { transform: 'translate(-50%, -50%) rotate(-14deg) scale(1)', opacity: 1 },
      ],
      { duration: 380, easing: 'cubic-bezier(.5,0,.7,1.4)', fill: 'forwards' },
    );
    await ghost.animate(
      [
        { transform: at(), filter: 'brightness(1)' },
        { transform: at(-10, 0, 'rotate(-4deg)'), filter: 'brightness(1.6)', offset: 0.55 },
        { transform: at(6, 0, 'rotate(2deg)'), offset: 0.75 },
        { transform: at(), filter: 'brightness(1)' },
      ],
      { duration: 420, delay: 120, fill: 'forwards' },
    ).finished.catch(() => {});
    await wait(550); // le temps de lire « K.O. »

    // 2. La carte vaincue rejoint la pioche, sous les yeux des joueurs.
    if (pileRect) {
      const tx = pileRect.left + pileRect.width / 2 - width / 2;
      const ty = pileRect.top + pileRect.height / 2 - height / 2;
      const scale = Math.min(pileRect.width / width, 1);
      await ghost.animate(
        [
          { transform: at(0, 0), opacity: 1 },
          { transform: `translate(${(x + tx) / 2}px, ${Math.min(y, ty) - 60}px) rotate(10deg) scale(0.8)`, opacity: 1, offset: 0.5 },
          { transform: `translate(${tx}px, ${ty}px) rotate(0deg) scale(${scale})`, opacity: 1 },
        ],
        { duration: 750, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' },
      ).finished.catch(() => {});
      pulse(pileEl, 'cdr-pile-receive', 600);
    }
    ghost.remove();
  }

  /** Boss vaincu (dégâts en trop) : la carte se déchire en deux moitiés qui tombent. */
  async function tearCard(card, rect) {
    if (!rect || off()) return;
    // Ligne de déchirure en zigzag, partagée par les deux moitiés.
    const zig = [[52, 0], [46, 12], [56, 24], [44, 37], [55, 50], [45, 63], [57, 76], [47, 88], [53, 100]];
    const line = zig.map(([px, py]) => `${px}% ${py}%`);
    const halves = [
      { clip: `polygon(0 0, ${line.join(', ')}, 0 100%)`, dx: -70, dy: 140, rot: -24 },
      { clip: `polygon(${line.join(', ')}, 100% 100%, 100% 0)`, dx: 80, dy: 170, rot: 22 },
    ];
    const pieces = halves.map((h) => {
      const g = ghostAt(card, rect);
      g.ghost.style.clipPath = h.clip;
      return { ...g, ...h };
    });
    // Tension : la carte tremble, puis craque.
    await Promise.all(pieces.map(({ ghost, x, y }) =>
      ghost.animate(
        [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: `translate(${x - 3}px, ${y}px) rotate(-1deg)`, offset: 0.25 },
          { transform: `translate(${x + 3}px, ${y}px) rotate(1deg)`, offset: 0.5 },
          { transform: `translate(${x - 2}px, ${y}px)`, offset: 0.75 },
          { transform: `translate(${x}px, ${y}px)` },
        ],
        { duration: 300, fill: 'forwards' },
      ).finished.catch(() => {})));
    await Promise.all(pieces.map(({ ghost, x, y, dx, dy, rot }) =>
      ghost.animate(
        [
          { transform: `translate(${x}px, ${y}px) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${x + dx * 0.25}px, ${y - 12}px) rotate(${rot * 0.3}deg)`, opacity: 1, offset: 0.25 },
          { transform: `translate(${x + dx}px, ${y + dy}px) rotate(${rot}deg)`, opacity: 0 },
        ],
        { duration: 950, easing: 'cubic-bezier(.3,0,.8,.6)', fill: 'forwards' },
      ).finished.catch(() => {})));
    pieces.forEach(({ ghost }) => ghost.remove());
  }

  /** Carte (déjà rendue) qui se retourne en apparaissant. */
  function flipIn(target, fromRect) {
    if (!target || off()) return Promise.resolve();
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
    if (off()) {
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
    enabled: isEnabled,
    flyCards,
    floatText,
    pulse,
    lunge,
    knockOut,
    tearCard,
    flipIn,
    drainBar,
    wait: (ms) => (off() ? Promise.resolve() : wait(ms)),
    destroy: () => layer.remove(),
  };
}
