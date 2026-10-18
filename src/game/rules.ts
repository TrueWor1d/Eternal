import { transitionKind } from './realms.ts';
import type { Stage } from './realms.ts';
import type { AreaDefinition, AreaProgress, Player, Retreat } from './model.ts';

function nonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name}必须是非负有限数值`);
}

/** 只处理已结算伤害。防御公式尚未确认，此处不计算或假设伤害公式。 */
export function applyResolvedDamage(health: number, damage: number): number {
  nonnegative(health, '生命值');
  nonnegative(damage, '伤害');
  return Math.max(0, health - damage);
}

/** 战斗、脱战、休整均可调用；无怪物回血分支。 */
export function regeneratePlayer(player: Player, elapsedSeconds: number): Player {
  nonnegative(elapsedSeconds, '经过时间');
  if (player.stats === null || player.health === null) return player;
  nonnegative(player.stats.maxHealth, '最大生命');
  nonnegative(player.stats.healthRegen, '生命回复速率');
  nonnegative(player.health, '当前生命');
  return { ...player, health: Math.min(player.stats.maxHealth, player.health + player.stats.healthRegen * elapsedSeconds) };
}

export function bossStatus(progress: AreaProgress, killsRequired: number | null): 'unconfigured' | 'locked' | 'ready' | 'defeated' {
  if (progress.bossDefeated) return 'defeated';
  if (killsRequired === null) return 'unconfigured';
  if (!Number.isSafeInteger(killsRequired) || killsRequired <= 0) throw new RangeError('清怪要求必须是正整数');
  return progress.unlocked && progress.normalKills >= killsRequired ? 'ready' : 'locked';
}

export function recordNormalKill(progress: AreaProgress): AreaProgress {
  if (!progress.unlocked) throw new Error('该区域尚未解锁');
  return { ...progress, normalKills: progress.normalKills + 1 };
}

/** 首领一次性；只开放紧邻的下一区域，无境界门槛。 */
export function defeatBoss(areas: readonly AreaProgress[], index: number, killsRequired: number): AreaProgress[] {
  const area = areas[index];
  if (!area || bossStatus(area, killsRequired) !== 'ready') throw new Error('首领当前不可挑战');
  return areas.map((item, i) => {
    if (i === index) return { ...item, bossDefeated: true };
    if (i === index + 1) return { ...item, unlocked: true };
    return { ...item };
  });
}

export function validateAreaOrder(areas: readonly AreaDefinition[]): boolean {
  return areas.every((area, index) =>
    Number.isSafeInteger(area.killsRequired) && area.killsRequired > 0 &&
    (index === 0 || area.killsRequired > areas[index - 1].killsRequired),
  );
}

export function cultivationReady(current: number, required: number | null): boolean {
  nonnegative(current, '修为');
  if (required === null) return false;
  if (!Number.isFinite(required) || required <= 0) throw new RangeError('所需修为必须大于零');
  return current >= required;
}

/** 已知判定规则；只有上层明确提供全部数值后才可调用。不会改写成功后的修为。 */
export function resolveRetreat(retreat: Retreat, now: number, random: () => number): { retreat: Retreat; outcome: 'waiting' | 'success' | 'failure' } {
  nonnegative(retreat.startedAt, '闭关起始时间');
  nonnegative(now, '当前时间');
  if (!Number.isFinite(retreat.durationMs) || retreat.durationMs <= 0) throw new RangeError('闭关时长必须大于零');
  if (!Number.isFinite(retreat.successRate) || retreat.successRate < 0 || retreat.successRate > 1) throw new RangeError('成功率必须在 0 到 1 之间');
  if (retreat.resolved) throw new Error('闭关已完成判定');
  if (now < retreat.startedAt + retreat.durationMs) return { retreat, outcome: 'waiting' };
  const roll = random();
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('随机值必须在 [0, 1) 内');
  return { retreat: { ...retreat, resolved: true }, outcome: roll < retreat.successRate ? 'success' : 'failure' };
}

export function cultivationAfterFailedRetreat(current: number, confirmedLoss: number): number {
  nonnegative(current, '修为');
  nonnegative(confirmedLoss, '修为损失');
  return Math.max(0, current - confirmedLoss);
}

export function breakthroughSummary(stage: Stage): string {
  const kind = transitionKind(stage);
  if (kind === 'end') return '凡界修为体系的终点，后续世界待扩展';
  return kind === 'minor' ? '修为达标后可直接突破' : '修为达标后需闭关突破';
}
