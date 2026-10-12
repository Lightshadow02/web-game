/* Règles illustrées (fenêtre à onglets du design system « Torche »), fidèles au moteur. */

export function rulesTabs(T, mobile) {
  const sz = mobile ? 'sm' : 'md';
  const fig = (html, cap) => `<figure class="t-rule__fig">${html}<figcaption class="caption">${cap}</figcaption></figure>`;
  const ico = (name, cls = '', label) => T.icon(name, { className: `${cls} t-ico--inline`, label });
  return [
    { id: 'but', label: 'But', icon: 'crown', content:
      `<div class="t-rule"><div class="t-rule__txt"><h3 class="title-sm">Descendre trois étages</h3>
        <p class="body">De 1 à 4 joueurs, chacun son héros. À chaque étage, le groupe ouvre des portes et franchit des salles, puis affronte le gardien. Au troisième étage, c’est le boss du donjon, combattu en plusieurs rounds.</p>
        <p class="body">Le groupe gagne en battant le boss. Il perd si tous les héros sont à terre.</p></div>
        <div class="t-rule__figs">${fig(T.CardBack({ size: 'sm' }), 'Une porte')}${fig(T.MonsterCard({ monster: { name: 'Gobelin chapardeur', emblem: 'goblin-head', xp: 1, loot: 'item', slots: [
          { kind: 'single', color: 'agilite', need: 5, pen: { torch: 1 } }, { kind: 'sum', color: 'force', need: 7, pen: { hp: 1 } }] } }), 'Une salle')}</div></div>` },
    { id: 'des', label: 'Dés', icon: 'die', content:
      `<div class="t-rule"><div class="t-rule__txt"><h3 class="title-sm">Quatre couleurs, une lettre chacune</h3>
        <p class="body">Force <b>F</b>, Agilité <b>A</b>, Magie <b>M</b> : ton héros lance autant de dés que ses caractéristiques. L’Or ${ico('star', 't-ink-gold', 'étoile')} est un joker : il va sur n’importe quelle case. Chaque niveau du groupe donne un dé d’Or de plus à chaque héros.</p>
        <p class="body"><b>Fusionner</b> : deux de tes dés non placés deviennent un dé d’Or qui garde la plus forte valeur.</p></div>
        <div class="t-rule__figs t-rule__dice">${['force', 'agilite', 'magie', 'or'].map((c, i) => fig(T.Die({ color: c, value: [5, 3, 6, 4][i], interactive: false }), T.data.colors[c].name)).join('')}</div></div>` },
    { id: 'cases', label: 'Cases', icon: 'sigma', content:
      `<div class="t-rule"><div class="t-rule__txt"><h3 class="title-sm">Couvrir les cases de la salle</h3>
        <p class="body"><b>Case unique</b> : un seul dé de la bonne couleur, égal ou supérieur au seuil.</p>
        <p class="body"><b>Case ${ico('sigma', '', 'total')}</b> : plusieurs dés dont la somme atteint le total. Tout le groupe peut y contribuer.</p>
        <p class="body">Une case restée vide inflige sa pénalité : ${ico('heart', 't-ink-hp')} des dégâts ou ${ico('flame', 't-ink-torch')} de la torche. À plusieurs, chaque case unique existe en un exemplaire par héros et les totaux grandissent avec le groupe.</p></div>
        <div class="t-pv-parch t-rule__figs">${fig(T.Slot({ color: 'agilite', need: 5, pen: { hp: 2 }, size: sz, interactive: false }), 'Un dé Agilité de 5 ou plus')}
        ${fig(T.Slot({ kind: 'sum', color: 'force', need: 13, pen: { torch: 1 }, size: sz, interactive: false, dice: [{ color: 'force', value: 6, interactive: false }, { color: 'force', value: 2, owner: { name: 'Allié' } }] }), `${ico('sigma', '', 'total')} 13 en Force : 8 déjà posés`)}
        ${fig(T.Slot({ color: 'toute', need: 4, pen: { hp: 1 }, size: sz, interactive: false }), `Toute couleur ${ico('asterisk', '', 'toute couleur')}`)}</div></div>` },
    { id: 'torche', label: 'Torche', icon: 'flame', content:
      `<div class="t-rule"><div class="t-rule__txt"><h3 class="title-sm">Six flammes par étage</h3>
        <p class="body">Ouvrir des portes coûte une flamme : deux salles se révèlent, le groupe en choisit une. Certaines cases ratées brûlent aussi la torche. La Lanterne du mineur ajoute deux flammes.</p>
        <p class="body">Quand la torche est éteinte, plus moyen d’ouvrir des portes : il faut affronter le gardien.</p></div>
        <div class="t-rule__figs">${fig(T.TorchGauge({ value: 4 }), 'Il reste 4 flammes')}</div></div>` },
    { id: 'combat', label: 'Combat', icon: 'swords', content:
      `<div class="t-rule"><div class="t-rule__txt"><h3 class="title-sm">Lancer, placer, être prêt</h3>
        <p class="body">Tout le monde lance ses dés en même temps puis les place ensemble : clique un dé puis une case, ou glisse-le. Chaque compétence sert une fois par salle. Quand tout le groupe est prêt, les cases sont vérifiées une par une.</p>
        <p class="body">Les dégâts frappent d’abord le héros le plus en forme ; l’armure en retire 1 à chaque résolution. Après une salle : de l’XP pour le groupe, ou un objet ou une compétence pour un héros.</p></div>
        <div class="t-rule__figs">${T.Button({ variant: 'primary', label: 'Prêt', count: '2/3' })}</div></div>` },
    { id: 'boss', label: 'Boss', icon: 'crown', content:
      `<div class="t-rule"><div class="t-rule__txt"><h3 class="title-sm">Plusieurs rounds</h3>
        <p class="body">Chaque case couverte porte ${ico('swords', 't-ink-hit')} des coups au gardien ; chaque case vide inflige sa pénalité. On relance tant qu’il tient debout. Chaque gardien a un pouvoir : lis son bandeau.</p>
        <p class="body">Gardien vaincu : de l’XP, un trésor, puis le camp (+4 PV, les héros à terre se relèvent). Niveaux à 5, 12 et 20 XP : +1 dé d’Or et +2 PV max pour chaque héros.</p></div>
        <div class="t-pv-parch t-rule__figs">${T.Slot({ color: 'toute', need: 6, pen: { hit: 2, torch: 1 }, size: sz, interactive: false })}</div></div>` },
  ];
}
