import { cultivationRequirement, playerStatsForStage } from './balance.ts';
import { nextStage, transitionKind } from './realms.ts';
import type { Stage } from './realms.ts';
import { cultivationReady } from './rules.ts';

/** 只在突破已经成功后结算；大境界的闭关概率与失败损失不在此设置默认值。 */
export function settleSuccessfulBreakthrough(stage: Stage, cultivation: number) {
  const next = nextStage(stage);
  const required = cultivationRequirement(stage);
  if (next === null || required === null) throw new Error('凡界已至圆满，后续世界待扩展');
  if (!cultivationReady(cultivation, required)) throw new Error('修为尚未达到突破要求');
  return {
    stage: next,
    cultivation: cultivation - required,
    consumedCultivation: required,
    stats: playerStatsForStage(next),
  };
}

export function advanceMinorStage(stage: Stage, cultivation: number) {
  if (transitionKind(stage) !== 'minor') throw new Error('当前不是小阶段突破，大境界必须先完成闭关判定');
  return settleSuccessfulBreakthrough(stage, cultivation);
}
