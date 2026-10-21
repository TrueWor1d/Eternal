import { AREAS, type AreaContent } from './areas.ts';
import { BASE_MONSTER_HEALTH, BASE_PLAYER_STATS, CULTIVATION_REQUIREMENTS } from './balance.ts';

// 正式内容只接收已确认的配置。空值不会被临时数值替代。
export const CONTENT: {
  playerStats: typeof BASE_PLAYER_STATS;
  monsterHealth: typeof BASE_MONSTER_HEALTH;
  areas: readonly AreaContent[];
  cultivationRequirements: typeof CULTIVATION_REQUIREMENTS;
} = {
  playerStats: BASE_PLAYER_STATS,
  monsterHealth: BASE_MONSTER_HEALTH,
  areas: AREAS,
  cultivationRequirements: CULTIVATION_REQUIREMENTS,
};
