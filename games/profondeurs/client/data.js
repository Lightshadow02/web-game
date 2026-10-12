/* =====================================================================
 * Passerelle entre le moteur (games/profondeurs/server/content.js) et le
 * design system « Torche » : emblèmes game-icons.net, couleurs, cases.
 * Les valeurs de jeu viennent toujours de l'état envoyé par le serveur.
 * ===================================================================== */

/** Couleurs du moteur -> couleurs Torche. */
export const COLOR = { F: 'force', A: 'agilite', M: 'magie', X: 'toute', G: 'or' };

export const HERO_EMBLEM = {
  guerriere: 'sword-brandish', voleur: 'cloak-dagger', mage: 'pointy-hat',
  paladin: 'templar-shield', rodeuse: 'high-shot', barde: 'lyre',
};

/** Article devant le nom du héros (« Donner à la Guerrière »). */
export const HERO_ARTICLE = { guerriere: 'la ', voleur: 'le ', mage: 'le ', paladin: 'le ', rodeuse: 'la ', barde: 'le ' };

/** Adversaires au féminin (« La Dame Voilée est vaincue »). */
export const FEMININE = new Set(['gelee', 'araignee', 'mimique', 'dame_voilee', 'meute', 'sorciere', 'yshka']);

/** Texte de carte sans balisage de glyphes (infobulles). */
export const plainText = (t) => String(t ?? '').replace(/\{(hp)\}/g, 'dégâts').replace(/\{(torch)\}/g, 'torche').replace(/\{(hit)\}/g, 'coups').replace(/\{(or)\}/g, 'Or').replace(/\{(sigma)\}/g, 'total');

export const SKILL_EMBLEM = {
  coup_puissant: 'fist', visee: 'bullseye', focalisation: 'crystal-wand', coup_bas: 'dodging',
  frappe_titan: 'enrage', eclair: 'inspiration', transmutation: 'gold-bar', second_souffle: 'lungs',
  ballade: 'musical-notes', priere: 'prayer', egide: 'magic-shield', raccourci: 'footsteps',
};

export const ITEM_EMBLEM = {
  epee_batarde: 'rune-sword', dague_ombre: 'cloak-dagger', baton_runique: 'crystal-wand',
  bouclier_chene: 'round-shield', cotte_mailles: 'templar-shield', amulette_doree: 'gem-pendant',
  cape_elfique: 'cloak', gantelets: 'fist', grimoire: 'rune-stone', lanterne: 'old-lantern',
  anneau_vigueur: 'health-potion',
};

export const ROOM_EMBLEM = {
  // monstres
  rat: 'rat', gobelin: 'goblin-head', squelette: 'raise-skeleton', gelee: 'slime', loup: 'wolf-head',
  cultiste: 'cultist', golem: 'golem-head', spectre: 'spectre', ogre: 'ogre', araignee: 'spider-alt',
  mimique: 'mimic-chest', chevalier: 'black-knight-helm',
  // périls
  fosse: 'spiky-pit', pont: 'rope-bridge', runes: 'rune-stone', eboulement: 'falling-rocks',
  gaz: 'poison-gas', porte: 'locked-door', riviere: 'river', statue: 'egyptian-sphinx',
  // gardiens et boss
  gardien_os: 'skull-shield', dame_voilee: 'nun-face', morvhal: 'crowned-skull',
  contremaitre: 'orc-head', ver_lave: 'worm-mouth', ignar: 'spiked-dragon-head',
  meute: 'wolf-howl', sorciere: 'witch-face', yshka: 'spider-face',
};

export const DUNGEON = {
  crypte: { emblem: 'crypt-entrance', ground: 'crypte', tagline: 'Les morts n’aiment pas qu’on les dérange.' },
  mines: { emblem: 'mine-wagon', ground: 'mines', tagline: 'Ici, même la roche brûle.' },
  bois_noir: { emblem: 'evil-tree', ground: 'bois', tagline: 'Les racines écoutent.' },
};

/** Pouvoir de boss (moteur) -> bandeau Torche { name, text, fx }. */
export function powerOf(ability, foeId) {
  if (!ability) return null;
  const [name, ...rest] = ability.text.split(' : ');
  const text = rest.join(' : ');
  const fx = { aoe: 'frost', curse: 'curse', summon: 'summon', enrage: 'fury' }[ability.type] ?? null;
  return {
    name: rest.length ? name : 'Pouvoir',
    text: rest.length ? text.charAt(0).toUpperCase() + text.slice(1) : ability.text,
    fx,
    web: foeId === 'yshka',
  };
}

/** Case du moteur -> props de Torche.Slot. */
export function slotOf(box, extra = {}) {
  return {
    id: box.id,
    kind: box.mode === 'sum' ? 'sum' : 'single',
    color: COLOR[box.color] ?? 'toute',
    need: box.target,
    pen: { hp: box.penalty?.damage || 0, torch: box.penalty?.time || 0, hit: box.hit || 0 },
    ...extra,
  };
}

/** Recopie dans Torche.data les héros et compétences du moteur (cartes et portraits lisent ces tables). */
export function syncData(T, state) {
  const upsert = (list, entry) => {
    const i = list.findIndex((x) => x.id === entry.id);
    if (i >= 0) list[i] = { ...list[i], ...entry };
    else list.push(entry);
  };
  const skills = state.catalog?.skills ?? {};
  for (const [id, sk] of Object.entries(skills)) {
    upsert(T.data.skills, { id, name: sk.name, emblem: SKILL_EMBLEM[id] ?? 'sparkle', text: sk.text, uses: '1× par salle' });
  }
  for (const [id, h] of Object.entries(state.catalog?.heroes ?? {})) {
    upsert(T.data.heroes, {
      id, name: h.name, emblem: HERO_EMBLEM[id], hp: h.pv, armor: 0, skill: h.skill,
      dice: { force: h.stats.F, agilite: h.stats.A, magie: h.stats.M },
    });
  }
  for (const h of state.heroes ?? []) {
    for (const sk of h.skills) upsert(T.data.skills, { id: sk.id, name: sk.name, emblem: SKILL_EMBLEM[sk.id] ?? 'sparkle', text: sk.text, uses: '1× par salle' });
    for (const it of h.items) upsert(T.data.items, itemOf(it));
  }
}

export const itemOf = (it) => ({ id: it.id, name: it.name, emblem: ITEM_EMBLEM[it.id] ?? 'bag', text: it.text, kind: 'Équipement' });
export const skillOf = (sk) => ({ id: sk.id, name: sk.name, emblem: SKILL_EMBLEM[sk.id] ?? 'sparkle', text: sk.text, uses: '1× par salle' });
