import { cultivationRequirement, playerStatsForStage } from './balance.ts';
import { nextStage, REALMS, transitionKind } from './realms.ts';
import type { Stage } from './realms.ts';
import { cultivationReady } from './rules.ts';

export function retreatConfig(stage: Stage) {
  if (transitionKind(stage) !== 'major') throw new Error('当前阶段无需闭关');
  const index = REALMS.findIndex((realm) => realm.id === stage.realmId);
  return {
    durationMs: 5000 + index * 1000,
    successRate: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3][index],
    failureLoss: cultivationRequirement(stage)! * 0.1,
  };
}

/** 只在突破已经成功后结算；闭关判定由上层使用retreatConfig和规则函数完成。 */
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
