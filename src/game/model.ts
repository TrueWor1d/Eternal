import type { Stage } from './realms.ts';
import { playerStatsForStage } from './balance.ts';
import { emptyEquipment, testEquipment, type EquipmentLoadout, type EquipmentPart } from './equipment.ts';
import type { ItemRarity } from './rarity.ts';

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

// 铜钱支持堆叠；每件装备使用独立ID，包括两个戒指。
export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  rarity: ItemRarity;
  equipmentPart?: EquipmentPart;
}

export interface Player {
  stage: Stage;
  cultivation: number;
  health: number | null;
  stats: PlayerStats | null;
  inventory: InventoryItem[];
  equipment: EquipmentLoadout;
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
  killsRequired: number | null;
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
    inventory: testEquipment(),
    equipment: emptyEquipment(),
  };
}
