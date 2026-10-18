import { monsterMaxHealth, normalMonsterCultivation } from './balance.ts';
import type { Player } from './model.ts';
import type { Stage } from './realms.ts';
import { applyResolvedDamage } from './rules.ts';

export const ENEMY_PLACEHOLDER_NAME = '[待编辑]';

export interface NormalEnemy {
  readonly name: typeof ENEMY_PLACEHOLDER_NAME;
  readonly kind: 'normal';
  readonly stage: Stage;
  readonly maxHealth: number;
  readonly cultivationReward: number;
  readonly health: number;
}

export function createNormalEnemy(stage: Stage): NormalEnemy {
  const maxHealth = monsterMaxHealth(stage, 'normal');
  return {
    name: ENEMY_PLACEHOLDER_NAME,
    kind: 'normal',
    stage: { ...stage },
    maxHealth,
    health: maxHealth,
    cultivationReward: normalMonsterCultivation(stage),
  };
}

/** 当前没有怪物防御配置，单次伤害直接使用角色攻击；怪物没有攻击属性或反击。 */
export function attackEnemy(player: Player, enemy: NormalEnemy) {
  if (player.stats === null || player.health === null || player.health <= 0) throw new Error('角色当前无法攻击');
  if (enemy.health === 0) return { player, enemy, damage: 0, defeated: false, cultivationGained: 0 };
  const health = applyResolvedDamage(enemy.health, player.stats.attack);
  const defeated = health === 0;
  const cultivationGained = defeated ? enemy.cultivationReward : 0;
  return {
    player: { ...player, cultivation: player.cultivation + cultivationGained },
    enemy: { ...enemy, health },
    damage: enemy.health - health,
    defeated,
    cultivationGained,
  };
}

/** 刷新相同实力的普通怪，不读取玩家境界。 */
export function respawnNormalEnemy(enemy: NormalEnemy): NormalEnemy {
  if (enemy.health > 0) throw new Error('当前敌怪尚未被击败');
  return createNormalEnemy(enemy.stage);
}
