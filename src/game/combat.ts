import { monsterMaxHealth, normalMonsterCultivation, type MonsterKind } from './balance.ts';
import type { Player } from './model.ts';
import type { Stage } from './realms.ts';
import { applyResolvedDamage } from './rules.ts';
import { addCopperCoins, COPPER_COIN, rollCopperCoinDrop } from './loot.ts';
import { getMonster, INITIAL_MONSTER } from './areas.ts';

export interface Enemy {
  readonly name: string;
  readonly kind: MonsterKind;
  readonly monsterId: number | null;
  readonly stage: Stage;
  readonly maxHealth: number;
  readonly cultivationReward: number;
  readonly health: number;
  readonly copperReward: number;
}

export interface NormalEnemy extends Enemy { readonly kind: 'normal' }

export function createNormalEnemy(stage: Stage, name: string = INITIAL_MONSTER.name): NormalEnemy {
  const maxHealth = monsterMaxHealth(stage, 'normal');
  return {
    name,
    kind: 'normal',
    monsterId: null,
    stage: { ...stage },
    maxHealth,
    health: maxHealth,
    cultivationReward: normalMonsterCultivation(stage),
    copperReward: 0,
  };
}

export function createMonsterEnemy(id: number): Enemy {
  const monster = getMonster(id);
  return {
    name: monster.name, kind: monster.kind, monsterId: id, stage: { ...monster.stage },
    maxHealth: monster.maxHealth, health: monster.maxHealth,
    cultivationReward: monster.cultivationReward, copperReward: monster.copperReward,
  };
}

/** 当前没有怪物防御配置，单次伤害直接使用角色攻击；怪物没有攻击属性或反击。 */
export function attackEnemy<T extends Enemy>(player: Player, enemy: T, random: () => number = Math.random) {
  if (player.stats === null || player.health === null || player.health <= 0) throw new Error('角色当前无法攻击');
  if (enemy.health === 0) return { player, enemy, damage: 0, defeated: false, cultivationGained: 0, loot: null };
  const health = applyResolvedDamage(enemy.health, player.stats.attack);
  const defeated = health === 0;
  const cultivationGained = defeated ? enemy.cultivationReward : 0;
  const loot = defeated ? enemy.kind === 'boss'
    ? { id: COPPER_COIN.id, name: COPPER_COIN.name, quantity: enemy.copperReward }
    : rollCopperCoinDrop(random) : null;
  return {
    player: { ...player, cultivation: player.cultivation + cultivationGained, inventory: loot ? addCopperCoins(player.inventory, loot.quantity) : player.inventory },
    enemy: { ...enemy, health },
    damage: enemy.health - health,
    defeated,
    cultivationGained,
    loot,
  };
}

/** 刷新相同实力的普通怪，不读取玩家境界。 */
export function respawnNormalEnemy<T extends Enemy>(enemy: T): T {
  if (enemy.kind !== 'normal') throw new Error('首领不能重复刷新');
  if (enemy.health > 0) throw new Error('当前敌怪尚未被击败');
  return { ...enemy, health: enemy.maxHealth };
}
