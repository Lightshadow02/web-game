'use strict';

/**
 * Contenu original des « Profondeurs » : héros, compétences, objets, salles, gardiens et boss.
 *
 * Cases (« boxes ») d'une rencontre, définies pour 1 joueur à l'étage 1 :
 *   s(couleur, seuil, pénalité, coup)  case à dé unique : un seul dé >= seuil
 *   t(couleur, seuil, pénalité, coup)  case « total » : somme des dés >= seuil
 * Couleurs : F (Force), A (Agilité), M (Magie), X (n'importe laquelle).
 * Pénalité si la case reste vide : 'd2' = 2 dégâts, 't1' = 1 de torche.
 * Coup (boss uniquement) : dégâts infligés au boss si la case est couverte.
 */

const parsePenalty = (code) => ({
  damage: code?.startsWith('d') ? Number(code.slice(1)) : 0,
  time: code?.startsWith('t') ? Number(code.slice(1)) : 0,
});
const s = (color, target, penalty, hit = 0) => ({ color, mode: 'single', target, penalty: parsePenalty(penalty), hit });
const t = (color, target, penalty, hit = 0) => ({ color, mode: 'sum', target, penalty: parsePenalty(penalty), hit });

const COLORS = {
  F: { name: 'Force', short: 'For' },
  A: { name: 'Agilité', short: 'Agi' },
  M: { name: 'Magie', short: 'Mag' },
  X: { name: 'Toute couleur', short: 'Tout' },
  G: { name: 'Or', short: 'Or' },
};

// ------------------------------------------------------------------ compétences
// Utilisables une fois par salle (ou par round de boss) par leur propriétaire.
const SKILLS = {
  coup_puissant: { name: 'Coup puissant', text: '+2 à un de tes dés de Force.', effect: 'boost', color: 'F', amount: 2 },
  visee: { name: 'Visée', text: '+2 à un de tes dés d’Agilité.', effect: 'boost', color: 'A', amount: 2 },
  focalisation: { name: 'Focalisation', text: '+2 à un de tes dés de Magie.', effect: 'boost', color: 'M', amount: 2 },
  coup_bas: { name: 'Coup bas', text: 'Un de tes dés d’Agilité devient un 6.', effect: 'six', color: 'A' },
  frappe_titan: { name: 'Frappe du titan', text: 'Un de tes dés de Force devient un 6.', effect: 'six', color: 'F' },
  eclair: { name: 'Éclair', text: 'Un de tes dés de Magie devient un 6.', effect: 'six', color: 'M' },
  transmutation: { name: 'Transmutation', text: 'Un de tes dés devient un dé d’Or (il va sur toutes les cases).', effect: 'gold' },
  second_souffle: { name: 'Second souffle', text: 'Relance tous tes dés non placés.', effect: 'reroll' },
  ballade: { name: 'Ballade', text: 'Chaque héros relance ses dés non placés qui montrent 1 ou 2.', effect: 'ballad' },
  priere: { name: 'Prière', text: 'Soigne 3 PV au héros le plus blessé (relève un héros à terre).', effect: 'heal', amount: 3 },
  egide: { name: 'Égide', text: 'Le groupe ignore 3 {hp} dans cette salle.', effect: 'shield', amount: 3 },
  raccourci: { name: 'Raccourci', text: 'Cette salle ne coûte aucune {torch}.', effect: 'notime' },
};

// ------------------------------------------------------------------ héros
const HEROES = {
  guerriere: { name: 'Guerrière', icon: '🛡️', stats: { F: 4, A: 2, M: 1 }, pv: 11, skill: 'coup_puissant', text: 'Solide et frappe fort.' },
  voleur: { name: 'Voleur', icon: '🗡️', stats: { F: 2, A: 4, M: 1 }, pv: 8, skill: 'coup_bas', text: 'Rapide et précis.' },
  mage: { name: 'Mage', icon: '🔮', stats: { F: 1, A: 2, M: 4 }, pv: 7, skill: 'transmutation', text: 'Fragile mais polyvalent.' },
  paladin: { name: 'Paladin', icon: '✝️', stats: { F: 3, A: 1, M: 3 }, pv: 10, skill: 'priere', text: 'Soigne le groupe.' },
  rodeuse: { name: 'Rôdeuse', icon: '🏹', stats: { F: 2, A: 3, M: 2 }, pv: 9, skill: 'second_souffle', text: 'Équilibrée et endurante.' },
  barde: { name: 'Barde', icon: '🎻', stats: { F: 2, A: 2, M: 3 }, pv: 8, skill: 'ballade', text: 'Aide toute l’équipe.' },
};

// ------------------------------------------------------------------ objets
const ITEMS = {
  epee_batarde: { name: 'Épée bâtarde', text: '+1 dé de Force', bonus: { F: 1 } },
  dague_ombre: { name: 'Dague de l’ombre', text: '+1 dé d’Agilité', bonus: { A: 1 } },
  baton_runique: { name: 'Bâton runique', text: '+1 dé de Magie', bonus: { M: 1 } },
  bouclier_chene: { name: 'Bouclier de chêne', text: 'Armure 1 : −1 {hp} à chaque résolution', bonus: { armor: 1 } },
  cotte_mailles: { name: 'Cotte de mailles', text: 'Armure 1 et +2 PV', bonus: { armor: 1, pv: 2 } },
  amulette_doree: { name: 'Amulette dorée', text: '+1 dé d’or', bonus: { gold: 1 } },
  cape_elfique: { name: 'Cape elfique', text: '+1 dé d’Agilité, +1 PV', bonus: { A: 1, pv: 1 } },
  gantelets: { name: 'Gantelets cloutés', text: '+1 dé de Force, +1 PV', bonus: { F: 1, pv: 1 } },
  grimoire: { name: 'Grimoire ancien', text: '+1 dé de Magie, +1 PV', bonus: { M: 1, pv: 1 } },
  lanterne: { name: 'Lanterne du mineur', text: '+2 {torch} à chaque étage pour le groupe', bonus: { torch: 2 } },
  anneau_vigueur: { name: 'Anneau de vigueur', text: '+4 PV', bonus: { pv: 4 } },
};

// ------------------------------------------------------------------ salles
const MONSTERS = [
  { id: 'rat', name: 'Rat géant', xp: 1, boxes: [s('A', 3, 'd1'), s('F', 3, 'd1')] },
  { id: 'gobelin', name: 'Gobelin chapardeur', xp: 1, boxes: [s('A', 4, 't1'), t('F', 5, 'd1')] },
  { id: 'squelette', name: 'Squelette archer', xp: 2, boxes: [s('A', 4, 'd2'), s('F', 4, 'd1')] },
  { id: 'gelee', name: 'Gelée acide', xp: 2, boxes: [t('M', 6, 'd2'), s('F', 3, 'd1')] },
  { id: 'loup', name: 'Loup des cavernes', xp: 2, boxes: [s('A', 5, 'd2'), s('F', 4, 'd1')] },
  { id: 'cultiste', name: 'Cultiste masqué', xp: 2, boxes: [t('M', 7, 'd2'), s('A', 3, 't1')] },
  { id: 'golem', name: 'Golem de pierre', xp: 3, boxes: [t('F', 9, 'd3'), s('M', 4, 'd1')] },
  { id: 'spectre', name: 'Spectre gémissant', xp: 2, boxes: [s('M', 5, 'd2'), t('M', 5, 'd1')] },
  { id: 'ogre', name: 'Ogre des tunnels', xp: 3, boxes: [t('F', 10, 'd3'), s('A', 4, 'd1')] },
  { id: 'araignee', name: 'Araignée géante', xp: 3, boxes: [s('A', 5, 'd2'), t('A', 6, 'd1'), s('F', 3, 'd1')] },
  { id: 'mimique', name: 'Mimique', xp: 2, boxes: [s('X', 6, 'd2'), t('F', 5, 'd1')] },
  { id: 'chevalier', name: 'Chevalier déchu', xp: 3, boxes: [s('F', 5, 'd2'), s('M', 4, 'd1'), t('A', 5, 't1')] },
];

// Périls : le groupe choisit l'une des deux façons de s'en sortir.
const PERILS = [
  { id: 'fosse', name: 'Fosse à pointes', xp: 1, options: [{ label: 'Sauter par-dessus', box: t('A', 7, 'd2') }, { label: 'Descendre en force', box: t('F', 8, 't2') }] },
  { id: 'pont', name: 'Pont branlant', xp: 1, options: [{ label: 'Traverser en équilibre', box: t('A', 8, 'd2') }, { label: 'Le consolider par magie', box: t('M', 6, 't2') }] },
  { id: 'runes', name: 'Runes piégées', xp: 1, options: [{ label: 'Désamorcer les runes', box: t('M', 7, 'd2') }, { label: 'Passer en roulade', box: t('A', 9, 'd1') }] },
  { id: 'eboulement', name: 'Éboulement', xp: 1, options: [{ label: 'Dégager les rochers', box: t('F', 9, 'd2') }, { label: 'Se faufiler', box: t('A', 8, 't2') }] },
  { id: 'gaz', name: 'Gaz toxique', xp: 1, options: [{ label: 'Purifier l’air', box: t('M', 6, 'd3') }, { label: 'Retenir son souffle et courir', box: t('F', 7, 'd2') }] },
  { id: 'porte', name: 'Porte scellée', xp: 1, options: [{ label: 'L’enfoncer', box: t('F', 8, 't2') }, { label: 'Briser le sceau', box: t('M', 7, 't1') }] },
  { id: 'riviere', name: 'Rivière souterraine', xp: 1, options: [{ label: 'Sauter de pierre en pierre', box: t('A', 7, 't2') }, { label: 'Nager à contre-courant', box: t('F', 8, 'd2') }] },
  { id: 'statue', name: 'Statue énigmatique', xp: 2, options: [{ label: 'Résoudre l’énigme', box: t('M', 8, 't2') }, { label: 'Tout tenter', box: t('X', 10, 'd2') }] },
];

// ------------------------------------------------------------------ donjons, gardiens et boss
// ability : 'aoe' (dégâts à chaque héros à chaque round), 'curse' (une couleur -1),
//           'summon' (case supplémentaire), 'enrage' (seuils +1 sous la moitié des PV).
const DUNGEONS = [
  {
    id: 'crypte',
    name: 'La Crypte oubliée',
    text: 'Des morts qui ne dorment plus, gardés par un roi glacé.',
    guardians: [
      { id: 'gardien_os', name: 'Le Gardien d’os', pv: 4, xp: 4, boxes: [s('F', 4, 'd2', 2), s('A', 4, 'd1', 1), t('M', 6, 'd2', 2)] },
      { id: 'dame_voilee', name: 'La Dame Voilée', pv: 6, xp: 5, ability: { type: 'curse', color: 'F', text: 'Malédiction : tes dés de Force perdent 1.' },
        boxes: [s('M', 5, 'd2', 2), t('A', 7, 'd2', 2), s('F', 4, 'd1', 1)] },
    ],
    boss: { id: 'morvhal', name: 'Morvhal, le Roi-Liche', pv: 10, ability: { type: 'aoe', amount: 1, text: 'Vague de froid : chaque héros perd 1 PV par round.' },
      boxes: [s('M', 5, 'd2', 2), t('F', 9, 'd3', 3), s('A', 5, 'd2', 2), t('M', 7, 'd1', 2)] },
  },
  {
    id: 'mines',
    name: 'Les Mines de braise',
    text: 'Des galeries brûlantes où sommeille un dragon.',
    guardians: [
      { id: 'contremaitre', name: 'Le Contremaître orc', pv: 5, xp: 4, boxes: [t('F', 8, 'd2', 2), s('A', 4, 'd1', 1), s('F', 4, 'd1', 1)] },
      { id: 'ver_lave', name: 'Le Ver de lave', pv: 6, xp: 5, ability: { type: 'summon', text: 'Jets de lave : une case de plus à chaque round.', box: s('X', 5, 'd2') },
        boxes: [t('M', 7, 'd2', 2), s('A', 5, 'd2', 2), s('F', 4, 'd1', 1)] },
    ],
    boss: { id: 'ignar', name: 'Ignar, le Dragon de braise', pv: 11, ability: { type: 'enrage', text: 'Fureur : sous la moitié de ses PV, tous les seuils +1.' },
      boxes: [t('F', 10, 'd3', 3), s('A', 5, 'd2', 2), t('M', 8, 'd2', 3), s('X', 6, 'd1', 2)] },
  },
  {
    id: 'bois_noir',
    name: 'Le Bois-Noir souterrain',
    text: 'Des racines géantes, des crocs, et une reine tisseuse.',
    guardians: [
      { id: 'meute', name: 'La Meute de Crocs-Gris', pv: 5, xp: 4, boxes: [s('A', 4, 'd1', 1), s('A', 4, 'd1', 1), t('F', 7, 'd2', 2)] },
      { id: 'sorciere', name: 'La Sorcière des racines', pv: 6, xp: 5, ability: { type: 'curse', color: 'A', text: 'Ronces : tes dés d’Agilité perdent 1.' },
        boxes: [t('M', 8, 'd2', 3), s('A', 4, 'd1', 1), s('F', 4, 'd2', 1)] },
    ],
    boss: { id: 'yshka', name: 'Ysh’ka, la Reine Araignée', pv: 10, ability: { type: 'summon', text: 'Toiles : une case de plus à chaque round.', box: s('A', 5, 'd2') },
      boxes: [s('A', 5, 'd2', 2), t('A', 8, 'd2', 2), t('M', 7, 'd2', 2), s('F', 5, 'd1', 2)] },
  },
];

module.exports = { COLORS, SKILLS, HEROES, ITEMS, MONSTERS, PERILS, DUNGEONS, s, t };
