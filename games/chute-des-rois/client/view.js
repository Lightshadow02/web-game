/* =====================================================================
 * La Chute des Rois : vue de la table « cour » du design system Tapis.
 * Fonctions pures : un état serveur (ou une vue intermédiaire pendant une
 * animation) devient du HTML Tapis. Tous les textes passent par un composant
 * Tapis, Tapis.esc ou Tapis.rich (les pseudos viennent de Discord).
 * ===================================================================== */

export const SUIT = { H: 'coeur', D: 'carreau', C: 'trefle', S: 'pique' };
const SUIT_NAME = { H: 'Cœur', D: 'Carreau', C: 'Trèfle', S: 'Pique' };
const RANK = { 1: 'A', 11: 'V', 12: 'D', 13: 'R' };
const RANK_WORD = { 1: 'As', 11: 'Valet', 12: 'Dame', 13: 'Roi' };
const POWER_OFF = { H: 'Soin annulé', D: 'Pioche annulée', C: 'Double annulé', S: 'Bouclier annulé' };
const GLYPH = { '♠': 'pique', '♥': 'coeur', '♦': 'carreau', '♣': 'trefle' };

export const value = (c) => (c.rank <= 10 ? c.rank : { 11: 10, 12: 15, 13: 20 }[c.rank]);
export const total = (cards) => cards.reduce((sum, c) => sum + value(c), 0);
/** Carte du moteur ({ suit: 'H', rank: 12, id: '12H' }) vers Tapis ({ suit: 'coeur', rank: 'D', id }). */
export const tp = (c, extra = {}) => ({ suit: SUIT[c.suit], rank: RANK[c.rank] ?? c.rank, id: c.id, ...extra });
/** Identifiant Tapis d'un souverain : 'D-carreau'. */
export const sovId = (c) => `${RANK[c.rank]}-${SUIT[c.suit]}`;
export const pl = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
/** « 7 {trefle} », « As {coeur} », « Dame {pique} » (glyphes posés par Tapis.rich). */
export const lab = (c) => `${RANK_WORD[c.rank] ?? c.rank} {${SUIT[c.suit]}}`;
export const atkTxt = (atk, shield) => (shield ? `${atk} − ${shield} = ${Math.max(0, atk - shield)}` : String(atk));
export const isOver = (s) => s.phase === 'victory' || s.phase === 'defeat';

const fem = (c) => c.rank === 12;
const bossLabel = (c) => `${RANK_WORD[c.rank]} de ${SUIT_NAME[c.suit]}`;
/** « la Dame de Carreau » / « Le Roi de Trèfle ». */
export const theBoss = (c, cap = false) => `${fem(c) ? (cap ? 'La' : 'la') : cap ? 'Le' : 'le'} ${bossLabel(c)}`;
const toBoss = (c) => (fem(c) ? `à la ${RANK_WORD[c.rank]}` : `au ${RANK_WORD[c.rank]}`);
const immuneWord = (c) => (fem(c) ? 'immunisée' : 'immunisé');

/** Pourquoi une sélection n'est pas un combo (miroir de validateCombo côté serveur), ou null. */
export function comboError(cards) {
  if (cards.length <= 1) return null;
  if (cards.length === 2 && cards.some((c) => c.rank === 1)) return null;
  const same = cards.every((c) => c.rank === cards[0].rank);
  const sum = total(cards);
  if (same && sum <= 10) return null;
  if (same) return `${cards.map(value).join(' + ')} = ${sum} : des cartes de même valeur font 10 au plus`;
  if (cards.some((c) => c.rank === 1)) return 'Un As ne s’accompagne que d’une seule carte';
  return 'Valeurs différentes : il faut un As ou des cartes de même valeur';
}

/** Journal du moteur : glyphes ♠♥♦♣ vers les jetons Tapis, « A » vers « As ». */
export function glyphs(text) {
  return String(text)
    .replace(/︎/g, '')
    .replace(/[♠♥♦♣]/g, (g) => ` {${GLYPH[g]}}`)
    .replace(/(^|[\s(])A \{/g, '$1As {')
    .replace(/ {2,}/g, ' ');
}

export function createView(T, { me, room }) {
  const roomPlayer = (id) => room()?.players?.find((p) => p.id === id);
  const avatarOf = (id) => roomPlayer(id)?.avatarUrl || undefined;
  const offline = (id) => roomPlayer(id)?.connected === false;
  const nameIn = (v, id) => v.players.find((p) => p.id === id)?.name ?? '?';
  const area = (name, html) => `<div class="tp-area" data-area="${name}" style="grid-area:${name}">${html}</div>`;
  const selectedOf = (v) => v.myHand.filter((c) => v.sel.includes(c.id));
  const others = (v) => {
    const i = v.players.findIndex((p) => p.id === me);
    return i < 0 ? v.players : [...v.players.slice(i + 1), ...v.players.slice(0, i)];
  };
  const playsOf = (v, pid) => v.plays.filter((x) => x.playerId === pid).flatMap((x) => x.cards);
  const view = { throne: '' };

  // ---------------------------------------------------------------- textes

  /** Ce que fera la sélection (aperçu « 7 {trefle} + As {coeur} : 16 dégâts, soigne 8 »). */
  function preview(v, sel) {
    const label = sel.map(lab).join(' + ');
    const reason = comboError(sel);
    if (reason) return { ok: false, valid: false, reason, text: `${label} : combo invalide`, detail: reason };
    const boss = v.boss;
    const atk = total(sel);
    const active = [...new Set(sel.map((c) => c.suit))].filter((s) => s !== boss.card.suit);
    const blocked = sel.some((c) => c.suit === boss.card.suit) ? boss.card.suit : null;
    const dmg = active.includes('C') ? atk * 2 : atk;
    const effects = [];
    const healed = active.includes('H') ? Math.min(atk, v.discardCount) : 0;
    if (active.includes('H')) effects.push(healed ? `soigne ${healed}` : 'aucun soin');
    // ♦ : simulation exacte et publique de la pioche à tour de rôle (mains pleines sautées)
    let drawn = 0;
    let myDraw = 0;
    let tavern = v.tavernCount + healed;
    if (active.includes('D')) {
      const n = v.players.length;
      const start = Math.max(0, v.players.findIndex((p) => p.id === me));
      const free = v.players.map((p) => (p.id === me ? v.handSize - (v.myHand.length - sel.length) : v.handSize - p.cardCount));
      let i = start;
      let skipped = 0;
      while (drawn < atk && tavern > 0 && skipped < n) {
        if (free[i] > 0) {
          free[i]--;
          tavern--;
          drawn++;
          skipped = 0;
          if (i === start) myDraw++;
        } else skipped++;
        i = (i + 1) % n;
      }
      effects.push(!drawn ? 'aucune pioche' : v.solo ? `pioche ${drawn}` : `l’équipe pioche ${drawn}`);
    }
    if (active.includes('S')) effects.push(`bouclier +${atk}`);
    if (blocked) effects.push(POWER_OFF[blocked]);
    const text = `${label} : ${pl(dmg, 'dégât')}${effects.length ? `, ${effects.join(', ')}` : ''}`;

    const left = boss.hp - dmg;
    const eff = Math.max(0, boss.attack - boss.shield - (active.includes('S') ? atk : 0));
    const rest = total(v.myHand) - atk;
    const details = [];
    if (blocked) details.push(`${theBoss(boss.card, true)} est ${immuneWord(boss.card)} au {${SUIT[blocked]}}`);
    const warn = left > 0 && eff > 0 && myDraw === 0 && rest < eff;
    if (warn) {
      details.push(`Attention : il te restera ${rest} points pour une riposte de ${eff}${v.solo && v.renewalsLeft > 0 ? ' (Renouveau possible)' : ''}`);
    }
    if (left <= 0 && v.castleCount === 0) details.push('Dernier souverain : victoire');
    else if (left === 0) details.push(`K.O. pile : ${fem(boss.card) ? 'la' : 'le'} ${RANK_WORD[boss.card.rank]} rejoint la Taverne, tu rejoues`);
    else if (left < 0) details.push(`${fem(boss.card) ? 'La' : 'Le'} ${RANK_WORD[boss.card.rank]} tombe, tu rejoues`);
    else details.push(`Il restera ${left} PV ${toBoss(boss.card)}${eff > 0 ? `, puis riposte de ${eff}` : ', riposte bloquée par le bouclier'}`);
    if (active.includes('H') && v.discardCount < atk) {
      details.push(v.discardCount === 0 ? 'Défausse vide : aucun soin'
        : `Seulement ${pl(healed, 'carte')} dans la défausse`);
    }
    if (active.includes('D') && drawn < atk) {
      const why = tavern === 0 ? 'Taverne vide' : 'mains pleines';
      details.push(drawn ? `Seulement ${pl(drawn, 'carte')} ${drawn > 1 ? 'piochées' : 'piochée'} (${why})` : `Aucune carte piochée (${why})`);
    }
    return { ok: true, valid: !blocked && !warn, dmg, text, detail: details.slice(0, 2).join(' · ') };
  }

  /** Détail « Bouclier cumulé : 4 + 5 » (contribution de chaque coup ♠ contre ce boss). */
  function shieldDetail(v) {
    if (!v.boss?.shield || v.boss.card.suit === 'S') return null;
    const parts = v.plays.filter((x) => x.cards.some((c) => c.suit === 'S')).map((x) => total(x.cards));
    if (parts.length < 2 || parts.reduce((a, b) => a + b, 0) !== v.boss.shield) return null;
    return `Bouclier cumulé : ${parts.join(' + ')}`;
  }

  function statusFor(v) {
    if (v.phase === 'victory') return { tone: 'win', text: 'Victoire', detail: '12/12 souverains' };
    if (v.phase === 'defeat') return { tone: 'alert', text: 'Défaite', detail: `${v.bossesDefeated}/12 souverains` };
    const cur = v.currentPlayerId;
    if (v.acting) return v.acting === me ? { tone: 'turn', text: 'Tu attaques…' } : { tone: 'wait', text: `${nameIn(v, v.acting)} attaque…` };
    const atk = v.boss ? `Attaque ${atkTxt(v.boss.attack, v.boss.shield)}` : undefined;
    const off = offline(cur) ? 'Déconnecté' : null;
    if (v.phase === 'defend') {
      if (cur === me) return { tone: 'alert', text: 'Riposte sur toi', detail: atk };
      return { tone: 'wait', text: `${nameIn(v, cur)} encaisse ${pl(v.pendingDamage, 'dégât')}…`, detail: off ?? atk };
    }
    if (cur === me) {
      const text = v.replay === me && v.boss ? `Tu rejoues contre ${theBoss(v.boss.card)}` : 'À toi de jouer';
      return { tone: 'turn', text, detail: shieldDetail(v) ?? (v.solo ? `Solo · Tour ${v.turn}` : `Tour ${v.turn}`) };
    }
    const text = v.replay === cur ? `${nameIn(v, cur)} rejoue…` : `${nameIn(v, cur)} joue…`;
    const i = v.players.findIndex((p) => p.id === me);
    let detail = off;
    if (!detail && i >= 0) {
      const before = v.players[(i - 1 + v.players.length) % v.players.length];
      detail = before.id === cur ? 'Tu joues ensuite' : `Tu joues après ${before.name}`;
    }
    return { tone: 'wait', text, detail: detail ?? undefined };
  }

  function statusArea(v) {
    let html = T.Status(statusFor(v));
    const mine = !v.locked && !v.acting && v.isMyTurn && !isOver(v);
    if (mine && v.phase === 'attack') {
      const sel = selectedOf(v);
      if (sel.length && v.boss) {
        const p = preview(v, sel);
        html += T.ComboPreview({ text: p.text, detail: p.detail, valid: p.valid });
      }
    }
    if (mine && v.phase === 'defend' && v.boss) {
      html += T.Ripost({ need: v.pendingDamage, paid: total(selectedOf(v)), text: `${theBoss(v.boss.card, true)} riposte : encaisse ${v.pendingDamage}` });
    }
    return html;
  }

  function actionsFor(v) {
    if (isOver(v)) {
      return v.endHidden ? { primary: { label: 'Voir le résultat', icon: 'trophy', attrs: { 'data-act': 'show-end' } } } : {};
    }
    const renew = v.solo && v.renewalsLeft > 0
      ? { label: 'Renouveau', icon: 'renew', count: v.renewalsLeft, attrs: { 'data-act': 'renew' } } : null;
    const pass = (extra = {}) => (v.solo ? [] : [{ label: 'Passer', icon: 'pass', attrs: { 'data-act': 'yield' }, ...extra }]);
    if (!v.isMyTurn || v.locked || v.acting) {
      return {
        primary: { label: 'Attaquer', icon: 'sword', disabled: true, reason: v.locked || v.acting ? null : 'Ce n’est pas ton tour', attrs: { 'data-act': 'play' } },
        secondary: pass({ disabled: true }),
      };
    }
    const sel = selectedOf(v);
    const paid = total(sel);
    if (v.phase === 'defend') {
      const need = v.pendingDamage;
      const handSum = total(v.myHand);
      if (renew && handSum < need) {
        return { primary: renew, note: `Ta main ne couvre pas ${need} (${handSum}) : utilise un Renouveau` };
      }
      const short = paid < need;
      return {
        primary: {
          label: 'Encaisser', icon: 'shield', disabled: short, kbd: short ? undefined : 'Entrée',
          reason: short ? `Il manque ${pl(need - paid, 'point')} (${paid}/${need})` : null, attrs: { 'data-act': 'defend' },
        },
        secondary: renew ? [renew] : [],
        note: `Sélectionne des cartes dont le total couvre ${need}.`,
      };
    }
    const yieldBtn = pass(v.canYield ? {} : { disabled: true, reason: 'Tous les autres viennent de passer : tu dois jouer' });
    if (!v.myHand.length) {
      if (renew) return { primary: renew, secondary: [], note: 'Ta main est vide : utilise un Renouveau' };
      return { primary: { label: 'Passer', icon: 'pass', attrs: { 'data-act': 'yield' } }, note: 'Ta main est vide : passe ton tour' };
    }
    let primary;
    if (!sel.length) primary = { label: 'Attaquer', icon: 'sword', disabled: true, reason: 'Choisis une carte ou un combo' };
    else {
      const p = v.boss ? preview(v, sel) : { ok: false, reason: 'Aucun boss' };
      primary = p.ok ? { label: `Attaquer · ${p.dmg}`, icon: 'sword', kbd: 'Entrée' }
        : { label: 'Attaquer', icon: 'sword', disabled: true, reason: p.reason };
    }
    primary.attrs = { 'data-act': 'play' };
    return { primary, secondary: [...yieldBtn, ...(renew ? [renew] : [])] };
  }

  const actionsArea = (v) => T.ActionBar(actionsFor(v));

  function lastText(a) {
    if (!a) return undefined;
    if (a.type === 'attack') return `A joué ${a.cards.map(lab).join(' + ')} : ${pl(a.damage, 'dégât')}`;
    if (a.type === 'defend') return `A encaissé ${a.damage}`;
    return 'A passé';
  }

  /** Bulle d'un joueur qui vient d'agir (lot d'événements affiché). */
  function bubbleFor(e) {
    if (e.type === 'yield') return { text: 'Passe', tone: 'pass' };
    if (e.type === 'defend') return { text: `Encaisse ${e.damage}` };
    if (e.type === 'renew') return { text: 'Renouveau' };
    if (e.type !== 'attack') return null;
    const drawn = Object.values(e.drawn ?? {}).reduce((a, b) => a + b, 0);
    const parts = [];
    if (e.doubled || (!e.healed && !drawn && !e.shield)) parts.push(pl(e.damage, 'dégât'));
    if (e.healed) parts.push(`soigne ${e.healed}`);
    if (drawn) parts.push(`pioche ${drawn}`);
    if (e.shield) parts.push(`bouclier +${e.shield}`);
    return { text: `Joue ${e.cards.map(lab).join(' + ')} : ${parts.join(', ')}` };
  }

  // ---------------------------------------------------------------- table

  function seatState(v, id) {
    if (offline(id)) return 'offline';
    return !isOver(v) && id === v.currentPlayerId ? 'active' : 'waiting';
  }

  function bossArea(v) {
    const fallen = (v.fallen ?? []).map((f) => ({ id: sovId(f.card), ko: f.exact }));
    if (!v.boss) return T.Sovereigns({ fallen }) + T.Slot({ size: 'lg', label: 'Trône vide' });
    const b = v.boss;
    let boss = T.Boss({ card: tp(b.card, { id: undefined }), hp: b.hp, hpMax: b.maxHp, atk: b.attack, shield: b.shield, size: 'lg' })
      .replace('Bouclier {pique}', T.rich('Bouclier {pique}'));
    if (b.card.suit === 'D') boss = boss.replace('Pioche annulé', 'Pioche annulée');
    if (fem(b.card)) boss = boss.replace('Immunisé à', 'Immunisée à');
    return view.throne + T.Sovereigns({ fallen, current: sovId(b.card) }) + boss;
  }

  function legend(v) {
    const immune = v.boss ? SUIT[v.boss.card.suit] : undefined;
    let html = T.PowerLegend({ immune });
    if (immune === 'carreau') html = html.replace('annulé</span>', 'annulée</span>');
    return html;
  }

  function table(v) {
    const meP = v.players.find((p) => p.id === me);
    const team = others(v).map((p) => {
      const bubble = v.bubbles[p.id];
      return T.Seat({
        seat: p.id, name: p.name, avatar: avatarOf(p.id), state: seatState(v, p.id), count: p.cardCount,
        played: playsOf(v, p.id).map((c) => tp(c)), playedLabel: 'Contre ce boss',
        last: bubble ? undefined : lastText(p.lastAction), bubble,
      });
    }).join('');
    const mine = playsOf(v, me);
    const mineHtml = `<div class="tp-mine" data-zone="mine"><span class="tp-mine__l label">Mes cartes posées</span><div class="tp-mine__c">${
      mine.length ? mine.map((c) => T.Card({ ...tp(c), size: 'sm' })).join('') : '<span class="tp-mine__empty caption">Aucune contre ce boss</span>'}</div></div>`;
    const meSeat = meP ? T.Seat({
      seat: me, name: meP.name, avatar: avatarOf(me), me: true, compact: true, state: seatState(v, me), count: v.myHand.length,
    }) : '';
    const canSelect = !v.locked && !v.acting && v.isMyTurn && (v.phase === 'attack' || v.phase === 'defend');
    const hand = meP ? T.Hand({
      cards: v.myHand.map((c) => tp(c, { selected: v.sel.includes(c.id) })), size: 'md', multi: true, groups: false,
      interactive: canSelect, label: 'Ta main', hint: v.myHand.length ? undefined : 'Ta main est vide',
    }) : '';
    const top = v.discardTop ? tp(v.discardTop, { id: `top-${v.discardTop.id}` }) : undefined;
    return `<div class="tp-table tp-table--cour" data-players="${v.players.length}">${
      area('team', team)}${
      area('castle', T.Pile({ pile: 'chateau', count: v.castleCount, size: 'sm' }) + legend(v))}${
      area('boss', bossArea(v))}${
      area('piles', T.Pile({ pile: 'taverne', count: v.tavernCount, size: 'sm' }) + T.Pile({ pile: 'defausse', count: v.discardCount, top, size: 'sm' }))}${
      area('mine', (meP ? mineHtml : '') + meSeat)}${
      area('status', statusArea(v))}${
      area('hand', hand)}${
      area('actions', meP ? actionsArea(v) : '')}</div>`;
  }

  // ---------------------------------------------------------------- journal et fin

  function journal(s) {
    const tone = (t) => (/vaincu|victoire/i.test(t) ? 'good' : /riposte|Nouveau boss|Défaite/.test(t) ? 'alert' : undefined);
    return T.Log({ entries: [...s.log].reverse().map((e) => ({ at: String(e.turn), text: glyphs(e.text), tone: tone(e.text) })) });
  }

  function end(s) {
    const host = room()?.hostId === me;
    const fallen = (s.fallen ?? []).map((f) => ({ id: sovId(f.card), ko: f.exact }));
    const kos = (s.fallen ?? []).filter((f) => f.exact).length;
    const actions = `<p class="caption cdr-end__note">${T.rich(host
      ? 'Utilise « Retour au salon » en haut pour rejouer ou changer de jeu.'
      : 'En attente de l’hôte pour revenir au salon.')}</p>${
      T.Button({ variant: 'secondary', icon: 'eye', label: 'Voir la table', attrs: { 'data-act': 'hide-end' } })}`;
    if (s.phase === 'victory') {
      const ranking = s.players.length > 1
        ? [...s.players].sort((a, b) => (b.damage ?? 0) - (a.damage ?? 0)).map((p) => ({
          name: p.name, avatar: avatarOf(p.id), me: p.id === me, score: pl(p.damage ?? 0, 'dégât'), note: p.kos ? `${p.kos} K.O.` : undefined,
        }))
        : undefined;
      return T.EndScreen({
        result: 'victoire', title: 'Victoire',
        subtitle: `Les 12 souverains sont tombés. La cour est à ${s.solo ? 'toi' : 'vous'}.`,
        extra: T.Sovereigns({ fallen }),
        recap: [['Souverains', '12/12'], ['K.O. pile', String(kos)], ['Tours', String(s.turn)]],
        ranking, actions,
      });
    }
    const ev = [...s.events].reverse().find((e) => e.type === 'defeat');
    const loser = ev?.playerId ?? s.currentPlayerId;
    const need = ev?.need ?? s.pendingDamage;
    const mineLoss = loser === me;
    const who = nameIn(s, loser);
    let subtitle;
    if (need > 0 && s.boss) {
      const tail = ev?.total != null
        ? (mineLoss ? `tu n’avais plus que ${ev.total} points en main` : `${who} n’avait plus que ${ev.total} points en main`)
        : (mineLoss ? 'tu ne pouvais plus encaisser' : `${who} ne pouvait plus encaisser`);
      subtitle = `${theBoss(s.boss.card, true)} frappait ${need} : ${tail}.`;
    } else {
      subtitle = mineLoss ? 'Tu n’avais plus de carte et ne pouvais pas passer.' : `${who} n’avait plus de carte et ne pouvait pas passer.`;
    }
    const recap = [['Souverains', `${s.bossesDefeated}/12`], ['Tours', String(s.turn)]];
    if (kos) recap.splice(1, 0, ['K.O. pile', String(kos)]);
    return T.EndScreen({ result: 'defaite', title: 'Défaite', subtitle, recap, actions });
  }

  return Object.assign(view, { table, statusArea, actionsArea, journal, end, bubbleFor, preview });
}
