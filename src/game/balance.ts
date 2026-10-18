import { REALMS, getRealm } from './realms.ts';
import type { RealmId, Stage } from './realms.ts';
import type { PlayerStats } from './model.ts';

export const BASE_PLAYER_STATS: Readonly<PlayerStats> = Object.freeze({
  maxHealth: 100,
  attack: 10,
  defense: 2,
  attackSpeed: 1,
  healthRegen: 1,
});

// 本轮仅配置怪物生命。攻击等其他战斗属性不补默认值。
export const BASE_MONSTER_HEALTH = Object.freeze({ normal: 60, boss: 300 });
export type MonsterKind = keyof typeof BASE_MONSTER_HEALTH;

export const CULTIVATION_REQUIREMENTS = {
  qi: [100, 200, 350, 550, 800, 1_200, 1_700, 2_400, 3_500],
  foundation: [5_000, 10_000, 20_000, 40_000],
  core: [60_000, 120_000, 240_000, 480_000],
  soul: [700_000, 1_400_000, 2_800_000, 5_600_000],
  spirit: [8_000_000, 16_000_000, 32_000_000, 64_000_000],
  tribulation: [90_000_000, 180_000_000, 360_000_000, 720_000_000],
  mahayana: [1_000_000_000, 2_000_000_000, 4_000_000_000, null],
} as const satisfies Record<RealmId, readonly (number | null)[]>;

/** 每个境界内部累计 ×3，跨境界再 ×3；从初始属性直接计算，不逐级取整。 */
export function growthMultiplier(stage: Stage): number {
  const realm = getRealm(stage);
  const realmIndex = REALMS.findIndex((item) => item.id === realm.id);
  return 9 ** realmIndex * 3 ** (stage.stageIndex / (realm.stages.length - 1));
}

export function playerStatsForStage(stage: Stage): PlayerStats {
  const multiplier = growthMultiplier(stage);
  const realmIndex = REALMS.findIndex((item) => item.id === stage.realmId);
  return {
    maxHealth: BASE_PLAYER_STATS.maxHealth * multiplier,
    attack: BASE_PLAYER_STATS.attack * multiplier,
    defense: BASE_PLAYER_STATS.defense * multiplier,
    attackSpeed: (10 + realmIndex) / 10,
    healthRegen: BASE_PLAYER_STATS.healthRegen * multiplier,
  };
}

export function cultivationRequirement(stage: Stage): number | null {
  getRealm(stage);
  return CULTIVATION_REQUIREMENTS[stage.realmId][stage.stageIndex];
}

/** 给怪物资料配置用的奖励参考，输入是怪物自身实力，不读取玩家境界。 */
export function normalMonsterCultivation(monsterStage: Stage): number {
  return 10 * growthMultiplier(monsterStage);
}

/** 使用怪物资料自身的实力阶段，配置后的生命不会随玩家成长而改变。 */
export function monsterMaxHealth(monsterStage: Stage, kind: MonsterKind): number {
  return BASE_MONSTER_HEALTH[kind] * growthMultiplier(monsterStage);
}
