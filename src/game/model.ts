import type { Stage } from './realms.ts';
import { playerStatsForStage } from './balance.ts';

export interface CombatStats {
  maxHealth: number;
  attack: number;
  defense: number;
  attackSpeed: number;
}

// 玩家使用完整战斗属性；怪物本轮仅配置生命，其他属性暂不实例化。
export interface PlayerStats extends CombatStats {
  healthRegen: number;
}

// 当前铜钱支持掉落和堆叠，其他物品规则在确认后补充。
export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
}

export interface Player {
  stage: Stage;
  cultivation: number;
  health: number | null;
  stats: PlayerStats | null;
  inventory: InventoryItem[];
}

export interface AreaProgress {
  id: string;
  unlocked: boolean;
  normalKills: number;
  bossDefeated: boolean;
}

export interface AreaDefinition {
  id: string;
  name: string;
  killsRequired: number;
}

export interface Retreat {
  startedAt: number;
  durationMs: number;
  successRate: number;
  resolved: boolean;
}

export function initialPlayer(): Player {
  const stage: Stage = { realmId: 'qi', stageIndex: 0 };
  const stats = playerStatsForStage(stage);
  return {
    stage,
    cultivation: 0,
    health: stats.maxHealth,
    stats,
    inventory: [],
  };
}
