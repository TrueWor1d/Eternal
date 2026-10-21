import { AREAS, getArea, type MonsterDefinition } from './areas.ts';
import type { MonsterKind } from './balance.ts';
import type { AreaProgress } from './model.ts';
import { bossStatus, defeatBoss, recordNormalKill } from './rules.ts';

export interface AdventureProgress {
  readonly currentAreaIndex: number;
  readonly mode: MonsterKind;
  readonly areas: readonly AreaProgress[];
}

export function initialAdventure(): AdventureProgress {
  return {
    currentAreaIndex: 0,
    mode: 'normal',
    areas: AREAS.map((area, index) => ({ id: area.id, unlocked: index === 0, normalKills: 0, bossDefeated: false })),
  };
}

export function selectArea(progress: AdventureProgress, index: number): AdventureProgress {
  getArea(index);
  if (!progress.areas[index]?.unlocked) throw new Error('该关卡尚未解锁');
  return { ...progress, currentAreaIndex: index, mode: 'normal' };
}

export function areaBossStatus(progress: AdventureProgress, index = progress.currentAreaIndex) {
  const area = getArea(index);
  return bossStatus(progress.areas[index], area.killsRequired);
}

export function challengeBoss(progress: AdventureProgress): AdventureProgress {
  if (progress.mode === 'boss' || areaBossStatus(progress) !== 'ready') throw new Error('首领当前不可挑战');
  return { ...progress, mode: 'boss' };
}

/** 普通怪按该关累计击杀数轮换；满进度后仍会无限刷新。 */
export function currentMonster(progress: AdventureProgress): MonsterDefinition {
  const area = getArea(progress.currentAreaIndex);
  const state = progress.areas[progress.currentAreaIndex];
  if (!state?.unlocked) throw new Error('该关卡尚未解锁');
  return progress.mode === 'boss' ? area.boss : area.normalMonsters[state.normalKills % area.normalMonsters.length];
}

export function recordMonsterVictory(progress: AdventureProgress, monsterId: number): AdventureProgress {
  if (currentMonster(progress).id !== monsterId) throw new Error('击杀怪物与当前挑战不一致');
  const index = progress.currentAreaIndex;
  if (progress.mode === 'boss') {
    return { ...progress, mode: 'normal', areas: defeatBoss(progress.areas, index, getArea(index).killsRequired) };
  }
  return { ...progress, areas: progress.areas.map((area, i) => i === index ? recordNormalKill(area) : area) };
}

export function adventureComplete(progress: AdventureProgress): boolean {
  return progress.areas.every((area) => area.bossDefeated);
}
