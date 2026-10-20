import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cultivationRequirement, growthMultiplier, monsterMaxHealth, normalMonsterCultivation, playerStatsForStage } from '../src/game/balance.ts';
import { CONTENT } from '../src/game/content.ts';
import { initialPlayer } from '../src/game/model.ts';
import { advanceMinorStage, settleSuccessfulBreakthrough } from '../src/game/progression.ts';
import { REALMS, nextStage } from '../src/game/realms.ts';
import type { Stage } from '../src/game/realms.ts';

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${actual} ≠ ${expected}`);
}

test('初始角色使用已批准数值并以满生命开始', () => {
  const player = initialPlayer();
  assert.equal(player.health, 100);
  assert.equal(player.cultivation, 0);
  assert.deepEqual(player.stats, { maxHealth: 100, attack: 10, defense: 2, attackSpeed: 1, healthRegen: 1 });
  assert.equal(cultivationRequirement(player.stage), 100);
});

test('所有境界的小阶段均匀增长，境内累计三倍、跨境三倍，空手攻速固定每秒一次', () => {
  for (const [realmIndex, realm] of REALMS.entries()) {
    const first = playerStatsForStage({ realmId: realm.id, stageIndex: 0 });
    const last = playerStatsForStage({ realmId: realm.id, stageIndex: realm.stages.length - 1 });
    near(last.maxHealth / first.maxHealth, 3);
    for (let i = 0; i < realm.stages.length; i++) {
      const stats = playerStatsForStage({ realmId: realm.id, stageIndex: i });
      near(stats.healthRegen / stats.maxHealth, .01);
      near(stats.attack / stats.maxHealth, .1);
      near(stats.defense / stats.maxHealth, .02);
      assert.equal(stats.attackSpeed, 1);
      if (i > 0) {
        const previous = playerStatsForStage({ realmId: realm.id, stageIndex: i - 1 });
        near(stats.maxHealth / previous.maxHealth, 3 ** (1 / (realm.stages.length - 1)));
      }
    }
    const nextRealm = REALMS[realmIndex + 1];
    if (nextRealm) near(playerStatsForStage({ realmId: nextRealm.id, stageIndex: 0 }).maxHealth / last.maxHealth, 3);
  }
  assert.ok(!Number.isInteger(playerStatsForStage({ realmId: 'qi', stageIndex: 1 }).attack));
  assert.throws(() => growthMultiplier({ realmId: 'qi', stageIndex: -1 }));
});

test('凡界恰有32个递增门槛，圆满终点不填下一世界数值', () => {
  let stage: Stage | null = { realmId: 'qi', stageIndex: 0 };
  const requirements: number[] = [];
  while (stage) {
    const required = cultivationRequirement(stage);
    if (required !== null) {
      assert.ok(Number.isSafeInteger(required) && required > 0);
      if (requirements.length) assert.ok(required > requirements.at(-1)!);
      requirements.push(required);
    } else assert.deepEqual(stage, { realmId: 'mahayana', stageIndex: 3 });
    stage = nextStage(stage);
  }
  assert.equal(requirements.length, 32);
  assert.equal(cultivationRequirement({ realmId: 'qi', stageIndex: 8 }), 3_500);
  assert.equal(cultivationRequirement({ realmId: 'foundation', stageIndex: 0 }), 5_000);
  assert.equal(cultivationRequirement({ realmId: 'spirit', stageIndex: 2 }), 32_000_000);
  assert.equal(cultivationRequirement({ realmId: 'tribulation', stageIndex: 3 }), 720_000_000);
  assert.equal(cultivationRequirement({ realmId: 'mahayana', stageIndex: 2 }), 4_000_000_000);
});

test('一次小突破只前进一阶段，扣除门槛并保留溢出修为', () => {
  const start: Stage = { realmId: 'qi', stageIndex: 0 };
  assert.throws(() => advanceMinorStage(start, 99));
  assert.throws(() => advanceMinorStage(start, Number.NaN));
  assert.throws(() => advanceMinorStage(start, -1));
  const first = advanceMinorStage(start, 350.75);
  assert.deepEqual(first.stage, { realmId: 'qi', stageIndex: 1 });
  assert.equal(first.cultivation, 250.75);
  assert.equal(first.consumedCultivation, 100);
  assert.deepEqual(start, { realmId: 'qi', stageIndex: 0 });
  const second = advanceMinorStage(first.stage, first.cultivation);
  assert.equal(second.cultivation, 50.75);
  assert.throws(() => advanceMinorStage(second.stage, second.cultivation));
});

test('大境界不能借小阶段接口绕过闭关，成功后结算仍保留溢出', () => {
  const qiNine: Stage = { realmId: 'qi', stageIndex: 8 };
  assert.throws(() => advanceMinorStage(qiNine, 100_000));
  const successfulRetreat = settleSuccessfulBreakthrough(qiNine, 3_510.5);
  assert.deepEqual(successfulRetreat.stage, { realmId: 'foundation', stageIndex: 0 });
  assert.equal(successfulRetreat.cultivation, 10.5);
  assert.equal(successfulRetreat.stats.maxHealth, 900);
  assert.throws(() => advanceMinorStage({ realmId: 'foundation', stageIndex: 3 }, 100_000));
});

test('整条凡界成功结算后余额守恒，终点属性符合批准的累计倍率', () => {
  let stage: Stage = { realmId: 'qi', stageIndex: 0 };
  let scan: Stage | null = stage;
  let total = 0;
  while (scan) {
    total += cultivationRequirement(scan) ?? 0;
    scan = nextStage(scan);
  }
  let balance = total + 7.25;
  let transitions = 0;
  while (nextStage(stage)) {
    // 此测试假定每次闭关已判定成功，只验证成功结算，不赋予游戏默认成功率。
    const result = settleSuccessfulBreakthrough(stage, balance);
    stage = result.stage;
    balance = result.cultivation;
    transitions++;
  }
  assert.equal(transitions, 32);
  assert.equal(balance, 7.25);
  const stats = playerStatsForStage(stage);
  assert.equal(stats.maxHealth, 159_432_300);
  assert.equal(stats.attack, 15_943_230);
  assert.equal(stats.defense, 3_188_646);
  assert.equal(stats.healthRegen, 1_594_323);
  assert.equal(stats.attackSpeed, 1);
  assert.throws(() => settleSuccessfulBreakthrough(stage, balance));
});

test('普通怪奖励参考取决于怪物自身实力', () => {
  const initialMonster: Stage = { realmId: 'qi', stageIndex: 0 };
  assert.equal(normalMonsterCultivation(initialMonster), 10);
  assert.equal(normalMonsterCultivation({ realmId: 'foundation', stageIndex: 0 }), 90);
  assert.equal(normalMonsterCultivation({ realmId: 'core', stageIndex: 0 }), 810);
  assert.equal(normalMonsterCultivation({ realmId: 'mahayana', stageIndex: 0 }), 5_314_410);
  const player = initialPlayer();
  player.stage = { realmId: 'mahayana', stageIndex: 3 };
  assert.equal(normalMonsterCultivation(initialMonster), 10);
});

test('普通怪和首领生命按自身实力增长，所有阶段保持6次和30次基础攻击的参考血量', () => {
  for (const realm of REALMS) {
    for (let stageIndex = 0; stageIndex < realm.stages.length; stageIndex++) {
      const stage = { realmId: realm.id, stageIndex };
      const attack = playerStatsForStage(stage).attack;
      near(monsterMaxHealth(stage, 'normal'), attack * 6);
      near(monsterMaxHealth(stage, 'boss'), attack * 30);
    }
  }
  assert.equal(monsterMaxHealth({ realmId: 'qi', stageIndex: 0 }, 'normal'), 60);
  assert.equal(monsterMaxHealth({ realmId: 'qi', stageIndex: 0 }, 'boss'), 300);
  assert.equal(monsterMaxHealth({ realmId: 'foundation', stageIndex: 0 }, 'normal'), 540);
  assert.equal(monsterMaxHealth({ realmId: 'mahayana', stageIndex: 3 }, 'boss'), 478_296_900);
  assert.throws(() => monsterMaxHealth({ realmId: 'qi', stageIndex: 9 }, 'normal'));
});

test('怪物当前只配置生命，不补攻击等默认属性，也不创建未知区域', () => {
  assert.deepEqual(CONTENT.monsterHealth, { normal: 60, boss: 300 });
  assert.equal(Object.hasOwn(CONTENT.monsterHealth, 'attack'), false);
  assert.equal(Object.hasOwn(CONTENT.monsterHealth, 'defense'), false);
  assert.equal(Object.hasOwn(CONTENT.monsterHealth, 'healthRegen'), false);
  assert.deepEqual(CONTENT.areas, []);
});
