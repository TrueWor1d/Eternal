import type { AreaDefinition } from './model.ts';
import { BASE_MONSTER_HEALTH, growthMultiplier, type MonsterKind } from './balance.ts';
import { REALMS, type Stage } from './realms.ts';

export interface MonsterDefinition {
  readonly id: number;
  readonly name: string;
  readonly kind: MonsterKind;
  readonly areaId: string;
  readonly stage: Stage;
  readonly strengthMultiplier: number;
  readonly maxHealth: number;
  readonly cultivationReward: number;
  readonly copperReward: number;
}

export interface AreaContent extends AreaDefinition {
  readonly killsRequired: number;
  readonly normalMonsters: readonly MonsterDefinition[];
  readonly boss: MonsterDefinition;
}

// 沿用33个境界阶段的成长曲线，为10个大关卡配置固定强度。
const STAGES: Stage[] = REALMS.flatMap((realm) => realm.stages.map((_, stageIndex) => ({ realmId: realm.id, stageIndex })));

function areaStrength(index: number) {
  const position = index * (STAGES.length - 1) / (AREA_NAMES.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  const start = growthMultiplier(STAGES[lower]);
  const end = growthMultiplier(STAGES[upper]);
  return { stage: STAGES[lower], multiplier: start * (end / start) ** fraction };
}

// 每关有四种轮换普通怪与一名一次性首领，不再拆成小关卡。
const AREA_NAMES = [
  ['wild-path', '山野小径', ['尖牙野鼠', '赤眼野兔', '灰背野狼', '獠牙野猪', '黑鬃山熊']],
  ['miasma-forest', '瘴气密林', ['青鳞毒蛇', '铁爪山魈', '赤尾妖狐', '碧甲毒蛛', '双首妖蟒']],
  ['cold-valley', '寒潭幽谷', ['寒潭水鬼', '雾隐怨灵', '冰甲妖蟹', '噬魂妖蝠', '玄冰巨鳄']],
  ['abandoned-mine', '废弃古矿', ['赤铜石怪', '铁骨尸兵', '地火蜈蚣', '金甲尸将', '吞金石魔']],
  ['flame-ridge', '赤焰山岭', ['血羽妖鹰', '赤焰妖狼', '裂地魔猿', '噬血妖虎', '炎角蛟王']],
  ['nether-tomb', '幽冥古墓', ['幽冥鬼卒', '拘魂鬼使', '白骨魔将', '千年尸王', '镇墓鬼君']],
  ['demon-city', '万妖古城', ['幻月狐妖', '雷翼鹏妖', '玄甲龙龟', '九首蛇妖', '撼山妖王']],
  ['nine-nether', '九幽禁地', ['蚀骨魔将', '吞灵魔魇', '千面魔君', '烬天魔凰', '九幽魔尊']],
  ['fallen-stars', '星陨古域', ['巡天雷灵', '摘星巨灵', '吞月天蟒', '裂空古龙', '葬星帝君']],
  ['chaos-abyss', '混沌天渊', ['虚空魇皇', '蚀日天魔', '太初古兽', '混沌祖龙', '终劫道主']],
] as const;

export const AREAS: readonly AreaContent[] = AREA_NAMES.map(([id, name, names], areaIndex) => {
  const strength = areaStrength(areaIndex);
  const monsters: MonsterDefinition[] = names.map((name, monsterIndex) => {
    const kind = monsterIndex === 4 ? 'boss' : 'normal';
    return {
      id: areaIndex * 5 + monsterIndex + 1,
      name,
      kind,
      areaId: id,
      stage: { ...strength.stage },
      strengthMultiplier: strength.multiplier,
      maxHealth: BASE_MONSTER_HEALTH[kind] * strength.multiplier,
      cultivationReward: 10 * strength.multiplier * (kind === 'boss' ? 5 : 1),
      copperReward: kind === 'boss' ? 10 * (areaIndex + 1) : 0,
    };
  });
  return { id, name, killsRequired: 4 * (areaIndex + 2), normalMonsters: monsters.slice(0, 4), boss: monsters[4] };
});

export const MONSTERS: readonly MonsterDefinition[] = AREAS.flatMap((area) => [...area.normalMonsters, area.boss]);
export const INITIAL_MONSTER = MONSTERS[0];

export function getMonster(id: number): MonsterDefinition {
  const monster = MONSTERS[id - 1];
  if (!Number.isInteger(id) || !monster) throw new RangeError('无效的怪物编号');
  return monster;
}

export function getArea(index: number): AreaContent {
  const area = AREAS[index];
  if (!Number.isInteger(index) || !area) throw new RangeError('无效的关卡编号');
  return area;
}
