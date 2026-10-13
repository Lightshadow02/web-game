'use strict';

const { BOSS_STATS, cardValue, shuffle, buildTavern, buildCastle } = require('./cards');

const HAND_SIZE = { 1: 8, 2: 7, 3: 6, 4: 5 };
const SOLO_RENEWALS = 2;
const COMBO_MAX_TOTAL = 10;
const LOG_SIZE = 40;
const EVENT_SIZE = 40;
// Nom des pouvoirs (« annulé » s'accorde : la Pioche).
const POWER_OFF = { H: 'Soin annulé', D: 'Pioche annulée', C: 'Double annulé', S: 'Bouclier annulé' };
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const SUIT_NAMES = { H: 'Cœur', D: 'Carreau', C: 'Trèfle', S: 'Pique' };
const BOSS_NAMES = { 11: 'Valet', 12: 'Dame', 13: 'Roi' };
/** « Valet de Pique » ; avec l'article : « Le Valet de Pique », « La Dame de Carreau » (journal). */
const bossLabel = (card) => `${BOSS_NAMES[card.rank]} de ${SUIT_NAMES[card.suit]}`;
const bossName = (card) => `${card.rank === 12 ? 'La' : 'Le'} ${bossLabel(card)}`;
const fem = (card, word) => (card.rank === 12 ? `${word}e` : word);

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true; // message affichable au joueur
  }
}

/**
 * Moteur de "La Chute des Rois" — jeu coopératif de 1 à 4 joueurs.
 *
 * Phases :
 *   'attack'  le joueur actif joue une carte (ou un combo) ou passe son tour
 *   'defend'  le joueur actif défausse des cartes pour absorber l'attaque du boss
 *   'victory' / 'defeat'
 *
 * Résolution d'une attaque :
 *   1. Pouvoirs des couleurs jouées (sauf la couleur du boss, qui y est immunisé) :
 *        ♥ Cœur    : remet N cartes de la défausse sous la pioche
 *        ♦ Carreau : les joueurs piochent N cartes (à tour de rôle)
 *        ♣ Trèfle  : dégâts doublés
 *        ♠ Pique   : bouclier, réduit l'attaque du boss de N (cumulatif)
 *   2. Dégâts au boss. PV <= 0 -> vaincu (pile exacte : il rejoint la pioche !).
 *   3. Sinon, le boss riposte : attaque - bouclier, à absorber en défaussant.
 */
class ChuteDesRois {
  constructor({ players, rng = Math.random }) {
    if (players.length < 1 || players.length > 4) throw new GameError('1 à 4 joueurs requis.');
    this.rng = rng;
    // damage / kos : contribution publique de chaque joueur (écran de fin).
    this.players = players.map((p) => ({ id: p.id, name: p.name, hand: [], lastAction: null, damage: 0, kos: 0 }));
    this.handSize = HAND_SIZE[players.length];
    this.solo = players.length === 1;
    this.renewalsLeft = this.solo ? SOLO_RENEWALS : 0;

    this.tavern = buildTavern(rng);
    this.castle = buildCastle(rng);
    this.discard = [];
    this.table = []; // cartes jouées contre le boss actuel
    this.plays = []; // mêmes cartes, groupées par coup : [{ playerId, cards }] (affichées devant chaque joueur)
    // Événements publics (attaque, riposte, pioche...) que l'interface rejoue en animations.
    this.events = [];
    this.eventSeq = 0;
    this.boss = null;
    this.fallen = []; // souverains vaincus, dans l'ordre : [{ card, exact }] (public)
    this.currentIndex = 0;
    this.phase = 'attack';
    this.pendingDamage = 0;
    this.consecutiveYields = 0;
    this.lastAttack = null;
    this.log = [];
    this.turn = 1;

    for (let round = 0; round < this.handSize; round++) {
      for (const player of this.players) player.hand.push(this.tavern.pop());
    }
    this.revealNextBoss();
    this.addLog(`La partie commence. Premier boss : ${bossLabel(this.boss.card)}.`);
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload) {
    if (this.isOver()) throw new GameError('La partie est terminée.');
    switch (type) {
      case 'play':
        return this.play(playerId, payload.cardIds);
      case 'yield':
        return this.yieldTurn(playerId);
      case 'defend':
        return this.defend(playerId, payload.cardIds);
      case 'renew':
        return this.renew(playerId);
      default:
        throw new GameError(`Action inconnue : ${type}`);
    }
  }

  isOver() {
    return this.phase === 'victory' || this.phase === 'defeat';
  }

  /** Résultat pour les statistiques du Hub (coopératif : tout le monde gagne ou perd). */
  getResult() {
    if (!this.isOver()) return null;
    const victory = this.phase === 'victory';
    const defeated = 12 - this.castle.length - (this.boss ? 1 : 0);
    return {
      summary: `${victory ? 'Victoire' : 'Défaite'} — ${defeated}/12 souverains`,
      players: this.players.map((p) => ({ playerId: p.id, result: victory ? 'win' : 'loss', score: defeated })),
    };
  }

  getStateFor(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    const current = this.currentPlayer();
    return {
      phase: this.phase,
      turn: this.turn,
      currentPlayerId: current.id,
      isMyTurn: current.id === playerId,
      handSize: this.handSize,
      myHand: me ? sortHand(me.hand) : [],
      players: this.players.map((p) => ({
        id: p.id, name: p.name, cardCount: p.hand.length, lastAction: p.lastAction, damage: p.damage, kos: p.kos,
      })),
      boss: this.boss && {
        card: this.boss.card,
        hp: this.boss.hp,
        maxHp: this.boss.maxHp,
        attack: this.boss.attack,
        shield: this.boss.shield,
        effectiveAttack: Math.max(0, this.boss.attack - this.boss.shield),
        immuneSuit: this.boss.card.suit,
      },
      table: this.table,
      plays: this.plays,
      events: this.events,
      tavernCount: this.tavern.length,
      discardCount: this.discard.length,
      discardTop: this.discard.at(-1) ?? null, // la défausse est face visible
      fallen: this.fallen,
      castleCount: this.castle.length,
      bossesDefeated: 12 - this.castle.length - (this.boss ? 1 : 0),
      pendingDamage: this.pendingDamage,
      canYield: this.canYield(),
      solo: this.solo,
      renewalsLeft: this.renewalsLeft,
      lastAttack: this.lastAttack,
      log: this.log,
    };
  }

  // ================================================================ actions

  play(playerId, cardIds) {
    this.assertTurn(playerId, 'attack');
    const player = this.currentPlayer();
    const cards = this.takeFromHand(player, cardIds, { dryRun: true });
    validateCombo(cards);
    this.takeFromHand(player, cardIds);
    this.table.push(...cards);
    this.plays.push({ playerId, cards });
    this.consecutiveYields = 0;

    const boss = this.boss;
    const attack = cards.reduce((sum, c) => sum + cardValue(c), 0);
    const suits = [...new Set(cards.map((c) => c.suit))];
    const active = suits.filter((s) => s !== boss.card.suit);
    const blocked = suits.filter((s) => s === boss.card.suit);
    const effects = [];
    const event = { playerId, cards, attack, healed: 0, drawn: {}, shield: 0, doubled: false, blockedSuit: blocked[0] ?? null };

    // Ordre de résolution : Cœur avant Carreau (on soigne la Taverne avant de piocher).
    if (active.includes('H')) {
      const healed = this.heal(attack);
      event.healed = healed;
      effects.push(healed ? `soigne ${healed}` : 'défausse vide : aucun soin');
    }
    if (active.includes('D')) {
      const { total, perPlayer } = this.drawForPlayers(attack);
      event.drawn = perPlayer;
      effects.push(total ? `pioche ${total}` : 'aucune carte piochée');
    }
    if (active.includes('S')) {
      boss.shield += attack;
      event.shield = attack;
      effects.push(`bouclier +${attack}`);
    }
    const damage = active.includes('C') ? attack * 2 : attack;
    if (active.includes('C')) effects.push('dégâts doublés');
    if (blocked.length) effects.push(`${POWER_OFF[blocked[0]]} (immunité)`);

    player.damage += Math.min(damage, boss.hp);
    boss.hp -= damage;
    event.doubled = active.includes('C');
    this.lastAttack = { playerId, cards, attack, damage, effects };
    player.lastAction = { type: 'attack', cards, damage };
    this.emit('attack', { ...event, damage, bossHp: Math.max(0, boss.hp), bossMaxHp: boss.maxHp });
    this.addLog(
      `${player.name} joue ${cards.map(describe).join(' + ')} : ${plural(damage, 'dégât')}` +
        (effects.length ? `, ${effects.join(', ')}` : '') + '.',
    );

    if (boss.hp <= 0) {
      this.defeatBoss();
      return;
    }
    this.startDefense();
  }

  yieldTurn(playerId) {
    this.assertTurn(playerId, 'attack');
    if (!this.canYield()) {
      throw new GameError(
        this.solo ? 'Impossible de passer en solo.' : 'Tous les autres joueurs viennent de passer : tu dois jouer.',
      );
    }
    this.consecutiveYields++;
    this.lastAttack = null;
    this.currentPlayer().lastAction = { type: 'yield' };
    this.emit('yield', { playerId });
    this.addLog(`${this.currentPlayer().name} passe son tour.`);
    this.startDefense();
  }

  defend(playerId, cardIds) {
    this.assertTurn(playerId, 'defend');
    const player = this.currentPlayer();
    const cards = this.takeFromHand(player, cardIds, { dryRun: true });
    const total = cards.reduce((sum, c) => sum + cardValue(c), 0);
    if (total < this.pendingDamage) {
      throw new GameError(`Il faut défausser au moins ${this.pendingDamage} points (sélection : ${total}).`);
    }
    this.takeFromHand(player, cardIds);
    this.discard.push(...cards);
    player.lastAction = { type: 'defend', cards, damage: this.pendingDamage };
    this.emit('defend', { playerId, cards, damage: this.pendingDamage });
    this.addLog(`${player.name} encaisse ${this.pendingDamage} en défaussant ${plural(cards.length, 'carte')}.`);
    this.pendingDamage = 0;
    this.nextPlayer();
  }

  /** Solo uniquement : défausse sa main et repioche une main complète. */
  renew(playerId) {
    if (!this.solo) throw new GameError('Le renouveau est réservé au mode solo.');
    if (this.currentPlayer().id !== playerId) throw new GameError('Ce n’est pas ton tour.');
    if (this.renewalsLeft <= 0) throw new GameError('Plus de renouveau disponible.');
    const player = this.currentPlayer();
    this.renewalsLeft--;
    this.discard.push(...player.hand);
    player.hand = [];
    while (player.hand.length < this.handSize && this.tavern.length) player.hand.push(this.tavern.pop());
    this.emit('renew', { playerId, count: player.hand.length });
    this.addLog(`${player.name} utilise un Renouveau et repioche ${plural(player.hand.length, 'carte')}.`);
    this.checkStalemate();
  }

  // ================================================================ mécanique

  heal(amount) {
    this.discard = shuffle(this.discard, this.rng);
    const healed = this.discard.splice(0, Math.min(amount, this.discard.length));
    this.tavern.unshift(...healed); // sous la pioche = début du tableau
    return healed.length;
  }

  /** Distribue jusqu'à `amount` cartes, une par joueur à tour de rôle (en commençant par le joueur actif). */
  drawForPlayers(amount) {
    const perPlayer = {};
    let drawn = 0;
    let index = this.currentIndex;
    let skipped = 0;
    while (drawn < amount && this.tavern.length && skipped < this.players.length) {
      const player = this.players[index];
      if (player.hand.length < this.handSize) {
        player.hand.push(this.tavern.pop());
        perPlayer[player.id] = (perPlayer[player.id] ?? 0) + 1;
        drawn++;
        skipped = 0;
      } else {
        skipped++;
      }
      index = (index + 1) % this.players.length;
    }
    return { total: drawn, perPlayer };
  }

  defeatBoss() {
    const { card, hp } = this.boss;
    this.fallen.push({ card, exact: hp === 0 });
    if (hp === 0) {
      this.tavern.push(card); // pile exacte : le boss rallie la cause, au sommet de la Taverne
      this.currentPlayer().kos++;
      this.addLog(`${bossName(card)} est ${fem(card, 'vaincu')} pile : K.O., ${card.rank === 12 ? 'elle' : 'il'} rejoint la Taverne.`);
    } else {
      this.discard.push(card);
      this.addLog(`${bossName(card)} est ${fem(card, 'vaincu')}.`);
    }
    this.discard.push(...this.table);
    this.table = [];
    this.plays = [];
    this.lastAttack = { ...this.lastAttack, bossDefeated: true };
    this.emit('bossDefeated', { card, exact: hp === 0 });

    if (!this.castle.length) {
      this.boss = null;
      this.phase = 'victory';
      this.emit('victory', {});
      this.addLog('Les 12 souverains sont tombés : victoire !');
      return;
    }
    this.revealNextBoss();
    this.emit('newBoss', { card: this.boss.card });
    this.addLog(`Nouveau boss : ${bossLabel(this.boss.card)}. ${this.currentPlayer().name} rejoue.`);
    // Le joueur qui a vaincu le boss enchaîne directement (pas de riposte).
    this.phase = 'attack';
    this.checkStalemate();
  }

  startDefense() {
    const damage = Math.max(0, this.boss.attack - this.boss.shield);
    if (damage === 0) {
      this.emit('blocked', { playerId: this.currentPlayer().id });
      this.addLog(`Le bouclier absorbe toute l’attaque ${this.boss.card.rank === 12 ? 'de la' : 'du'} ${bossLabel(this.boss.card)}.`);
      this.nextPlayer();
      return;
    }
    this.pendingDamage = damage;
    this.phase = 'defend';
    this.emit('riposte', { playerId: this.currentPlayer().id, damage });
    this.addLog(`${bossName(this.boss.card)} riposte : ${this.currentPlayer().name} doit encaisser ${damage}.`);
    this.checkStalemate();
  }

  nextPlayer() {
    this.currentIndex = (this.currentIndex + 1) % this.players.length;
    this.phase = 'attack';
    this.turn++;
    this.checkStalemate();
  }

  /** Défaite si le joueur actif ne peut plus rien faire. */
  checkStalemate() {
    const player = this.currentPlayer();
    const canRenew = this.solo && this.renewalsLeft > 0;
    if (canRenew) return;

    if (this.phase === 'defend') {
      const total = player.hand.reduce((sum, c) => sum + cardValue(c), 0);
      if (total < this.pendingDamage) {
        this.lose(`${player.name} ne peut pas encaisser ${this.pendingDamage} (${total} points en main).`, { total });
      }
    } else if (this.phase === 'attack' && player.hand.length === 0 && !this.canYield()) {
      this.lose(`${player.name} n’a plus de carte et ne peut pas passer.`, { total: 0 });
    }
  }

  /** Défaite : la cause est publique (joueur bloqué, riposte à encaisser, total de sa main, déjà écrit au journal). */
  lose(reason, { total }) {
    const playerId = this.currentPlayer().id;
    const need = this.phase === 'defend' ? this.pendingDamage : 0;
    this.phase = 'defeat';
    this.emit('defeat', { playerId, need, total });
    this.addLog(`${reason} Défaite.`);
  }

  revealNextBoss() {
    const card = this.castle.pop();
    const stats = BOSS_STATS[card.rank];
    this.boss = { card, hp: stats.hp, maxHp: stats.hp, attack: stats.attack, shield: 0 };
  }

  canYield() {
    return this.phase === 'attack' && this.consecutiveYields < this.players.length - 1;
  }

  // ================================================================ utilitaires

  currentPlayer() {
    return this.players[this.currentIndex];
  }

  assertTurn(playerId, phase) {
    if (this.currentPlayer().id !== playerId) throw new GameError('Ce n’est pas ton tour.');
    if (this.phase !== phase) {
      throw new GameError(phase === 'attack' ? 'Tu dois d’abord encaisser la riposte.' : 'Ce n’est pas le moment d’encaisser.');
    }
  }

  takeFromHand(player, cardIds, { dryRun = false } = {}) {
    if (!Array.isArray(cardIds) || cardIds.length === 0) throw new GameError('Choisis au moins une carte.');
    if (new Set(cardIds).size !== cardIds.length) throw new GameError('Carte sélectionnée deux fois.');
    const cards = cardIds.map((id) => {
      const card = player.hand.find((c) => c.id === id);
      if (!card) throw new GameError('Cette carte n’est pas dans ta main.');
      return card;
    });
    if (!dryRun) player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
    return cards;
  }

  /** Événement public numéroté ; le client anime ceux qu'il n'a pas encore vus. */
  emit(type, data) {
    this.events.push({ id: ++this.eventSeq, type, ...data });
    if (this.events.length > EVENT_SIZE) this.events.shift();
  }

  addLog(text) {
    this.log.push({ turn: this.turn, text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }
}

/**
 * Combos autorisés :
 *   - une carte seule ;
 *   - un As (« compagnon ») + une autre carte ;
 *   - plusieurs cartes de même valeur dont le total est <= 10 (ex. 3+3+3, 5+5, 2+2+2+2).
 */
function validateCombo(cards) {
  if (cards.length === 1) return;
  const aces = cards.filter((c) => c.rank === 1);
  if (cards.length === 2 && aces.length >= 1) return;
  const sameRank = cards.every((c) => c.rank === cards[0].rank);
  const total = cards.reduce((sum, c) => sum + cardValue(c), 0);
  if (sameRank && total <= COMBO_MAX_TOTAL) return;
  throw new GameError(
    `Combo invalide : une carte seule, un As et une carte, ou des cartes de même valeur dont le total fait ${COMBO_MAX_TOTAL} au plus.`,
  );
}

const RANK_LABEL = { 1: 'A', 11: 'V', 12: 'D', 13: 'R' };
// \uFE0E force le rendu texte (et non emoji) des symboles.
const SUIT_SYMBOL = { H: '♥\uFE0E', D: '♦\uFE0E', C: '♣\uFE0E', S: '♠\uFE0E' };
function describe(card) {
  return `${RANK_LABEL[card.rank] ?? card.rank}${SUIT_SYMBOL[card.suit]}`;
}

const SUIT_ORDER = { S: 0, H: 1, C: 2, D: 3 };
function sortHand(hand) {
  return [...hand].sort((a, b) => SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.rank - b.rank);
}

module.exports = { ChuteDesRois, GameError, validateCombo, HAND_SIZE };
