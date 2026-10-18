import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlayer } from '../src/game/model.ts';
import type { AreaProgress, Player, Retreat } from '../src/game/model.ts';
import { caveUnlocked, nextStage, stageLabel, transitionKind } from '../src/game/realms.ts';
import type { Stage } from '../src/game/realms.ts';
import { applyResolvedDamage, bossStatus, cultivationAfterFailedRetreat, cultivationReady, defeatBoss, recordNormalKill, regeneratePlayer, resolveRetreat, validateAreaOrder } from '../src/game/rules.ts';

// 数值均为隔离测试输入，不进入正式游戏配置。
test('完整凡界路径：炼气九层、其余四阶段，保持指定顺序与终点', () => {
  let stage: Stage | null = { realmId: 'qi', stageIndex: 0 };
  const labels: string[] = [];
  let major = 0;
  while (stage) {
    labels.push(stageLabel(stage));
    if (transitionKind(stage) === 'major') major++;
    stage = nextStage(stage);
  }
  assert.equal(labels.length, 33);
  assert.equal(major, 6);
  assert.equal(labels[8], '炼气期 · 九层');
  assert.equal(labels[9], '筑基期 · 初期');
  assert.equal(labels[28], '渡劫期 · 圆满');
  assert.equal(labels[29], '大乘期 · 初期');
  assert.equal(labels[32], '大乘期 · 圆满');
  assert.equal(transitionKind({ realmId: 'qi', stageIndex: 3 }), 'minor');
  assert.equal(transitionKind({ realmId: 'mahayana', stageIndex: 3 }), 'end');
});

test('洞府在筑基解锁，无效境界不能绕过门槛', () => {
  assert.equal(caveUnlocked({ realmId: 'qi', stageIndex: 8 }), false);
  assert.equal(caveUnlocked({ realmId: 'foundation', stageIndex: 0 }), true);
  assert.equal(caveUnlocked({ realmId: 'soul', stageIndex: 0 }), true);
  assert.throws(() => caveUnlocked({ realmId: 'qi', stageIndex: 9 }));
});

test('缺失数据仍保持未配置状态，不允许无门槛突破', () => {
  const player: Player = { ...initialPlayer(), health: null, stats: null };
  assert.equal(player.stats, null);
  assert.equal(player.health, null);
  assert.equal(regeneratePlayer(player, 100), player);
  assert.equal(cultivationReady(100_000, null), false);
  assert.equal(cultivationReady(9, 10), false);
  assert.equal(cultivationReady(10, 10), true);
  assert.throws(() => cultivationReady(0, 0));
});

test('玩家持续回复生命，不越过上限；分片时间与连续时间结果一致', () => {
  const player: Player = { ...initialPlayer(), health: 20, stats: { maxHealth: 100, attack: 5, defense: 1, attackSpeed: 1, healthRegen: 3 } };
  const half = regeneratePlayer(player, .5);
  assert.equal(regeneratePlayer(half, .5).health, regeneratePlayer(player, 1).health);
  assert.equal(regeneratePlayer(player, 100).health, 100);
  assert.equal(player.health, 20);
  assert.throws(() => regeneratePlayer(player, -1));
  assert.equal(applyResolvedDamage(20, 100), 0);
  assert.throws(() => applyResolvedDamage(20, Number.NaN));
});

test('首领需要清怪解锁，击败后只开放下一区域且无法重打', () => {
  const areas: AreaProgress[] = [
    { id: 'a', unlocked: true, normalKills: 0, bossDefeated: false },
    { id: 'b', unlocked: false, normalKills: 0, bossDefeated: false },
    { id: 'c', unlocked: false, normalKills: 0, bossDefeated: false },
  ];
  assert.equal(bossStatus(areas[0], null), 'unconfigured');
  assert.equal(bossStatus(areas[0], 2), 'locked');
  assert.throws(() => defeatBoss(areas, 0, 2));
  areas[0] = recordNormalKill(recordNormalKill(areas[0]));
  assert.equal(bossStatus(areas[0], 2), 'ready');
  const after = defeatBoss(areas, 0, 2);
  assert.equal(after[0].bossDefeated, true);
  assert.equal(after[1].unlocked, true);
  assert.equal(after[2].unlocked, false);
  assert.equal(areas[1].unlocked, false);
  assert.equal(bossStatus(after[0], 2), 'defeated');
  assert.throws(() => defeatBoss(after, 0, 2));
  assert.equal(recordNormalKill(after[0]).normalKills, 3);
  assert.throws(() => recordNormalKill(areas[1]));
});

test('区域清怪目标必须随难度递增，不接受持平或非法目标', () => {
  const area = (n: number, id: string) => ({ id, name: id, killsRequired: n });
  assert.equal(validateAreaOrder([area(2, 'a'), area(3, 'b')]), true);
  assert.equal(validateAreaOrder([area(3, 'a'), area(3, 'b')]), false);
  assert.equal(validateAreaOrder([area(3, 'a'), area(2, 'b')]), false);
  assert.equal(validateAreaOrder([area(-1, 'a')]), false);
});

test('闭关读条结束才抽取一次结果；完成后不能再次结算', () => {
  const retreat: Retreat = { startedAt: 1000, durationMs: 2000, successRate: .5, resolved: false };
  let draws = 0;
  const random = () => { draws++; return .25; };
  assert.equal(resolveRetreat(retreat, 2999, random).outcome, 'waiting');
  assert.equal(draws, 0);
  const result = resolveRetreat(retreat, 3000, random);
  assert.equal(result.outcome, 'success');
  assert.equal(draws, 1);
  assert.equal(retreat.resolved, false);
  assert.throws(() => resolveRetreat(result.retreat, 4000, random));
  assert.equal(resolveRetreat(retreat, 3000, () => .75).outcome, 'failure');
  assert.equal(resolveRetreat({ ...retreat, successRate: 0 }, 3000, () => 0).outcome, 'failure');
  assert.equal(resolveRetreat({ ...retreat, successRate: 1 }, 3000, () => .99).outcome, 'success');
  assert.throws(() => resolveRetreat({ ...retreat, successRate: Number.NaN }, 3000, random));
  assert.throws(() => resolveRetreat(retreat, 3000, () => 1));
});

test('闭关失败只按明确提供的数值扣修为，修为补足后可再次达标', () => {
  const current = cultivationAfterFailedRetreat(100, 20);
  assert.equal(current, 80);
  assert.equal(cultivationReady(current, 100), false);
  assert.equal(cultivationReady(current + 20, 100), true);
  assert.equal(cultivationAfterFailedRetreat(10, 20), 0);
  assert.throws(() => cultivationAfterFailedRetreat(10, -1));
});
