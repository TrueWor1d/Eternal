import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, getArea, getMonster } from '../src/game/areas.ts';
import { adventureComplete, areaBossStatus, challengeBoss, currentMonster, initialAdventure, recordMonsterVictory, selectArea } from '../src/game/adventure.ts';
import { attackEnemy, createMonsterEnemy, respawnNormalEnemy } from '../src/game/combat.ts';
import { initialPlayer } from '../src/game/model.ts';
import { cultivationRequirement, playerStatsForStage } from '../src/game/balance.ts';
import { retreatConfig, settleSuccessfulBreakthrough } from '../src/game/progression.ts';
import { cultivationAfterFailedRetreat, resolveRetreat } from '../src/game/rules.ts';
import { transitionKind } from '../src/game/realms.ts';

test('初始只开放第一个大关，不能越级或在进度不足时挑战首领', () => {
  const progress = initialAdventure();
  assert.equal(progress.currentAreaIndex, 0);
  assert.equal(progress.mode, 'normal');
  assert.equal(progress.areas.filter((area) => area.unlocked).length, 1);
  for (const index of [-1, 0.5, 10]) assert.throws(() => getArea(index));
  for (const id of [0, 1.5, 51]) assert.throws(() => getMonster(id));
  for (const index of [1, 5, 9]) assert.throws(() => selectArea(progress, index));
  assert.equal(areaBossStatus(progress), 'locked');
  assert.throws(() => challengeBoss(progress));
  assert.throws(() => recordMonsterVictory(progress, AREAS[1].normalMonsters[0].id));
  assert.equal(progress.areas[0].normalKills, 0);
});

test('四种普通怪无限轮换，进度满后继续刷怪，首领必须手动挑战', () => {
  let progress = initialAdventure();
  const original = progress;
  const seen = new Set<number>();
  for (let i = 0; i < AREAS[0].killsRequired * 3; i++) {
    const monster = currentMonster(progress);
    seen.add(monster.id);
    assert.equal(monster.kind, 'normal');
    progress = recordMonsterVictory(progress, monster.id);
    assert.equal(progress.mode, 'normal');
  }
  assert.equal(seen.size, 4);
  assert.equal(progress.areas[0].normalKills, 24);
  assert.equal(areaBossStatus(progress), 'ready');
  assert.equal(progress.areas[1].unlocked, false);
  assert.equal(original.areas[0].normalKills, 0);
  progress = challengeBoss(progress);
  assert.equal(currentMonster(progress).id, AREAS[0].boss.id);
  assert.throws(() => challengeBoss(progress));
  progress = recordMonsterVictory(progress, AREAS[0].boss.id);
  assert.equal(progress.mode, 'normal');
  assert.equal(progress.areas[0].normalKills, 24);
  assert.equal(areaBossStatus(progress), 'defeated');
  assert.equal(progress.areas[1].unlocked, true);
  assert.equal(progress.areas[2].unlocked, false);
  assert.equal(currentMonster(progress).kind, 'normal');
  assert.throws(() => challengeBoss(progress));
  assert.throws(() => recordMonsterVictory(progress, AREAS[0].boss.id));
});

test('区域切换保留各自进度和已击败首领，不能通过切换清除或绕过门槛', () => {
  let progress = initialAdventure();
  for (let i = 0; i < AREAS[0].killsRequired; i++) progress = recordMonsterVictory(progress, currentMonster(progress).id);
  progress = recordMonsterVictory(challengeBoss(progress), AREAS[0].boss.id);
  progress = selectArea(progress, 1);
  for (let i = 0; i < 3; i++) progress = recordMonsterVictory(progress, currentMonster(progress).id);
  const expected = currentMonster(progress).id;
  progress = selectArea(progress, 0);
  assert.equal(areaBossStatus(progress), 'defeated');
  progress = recordMonsterVictory(progress, currentMonster(progress).id);
  progress = selectArea(progress, 1);
  assert.equal(progress.areas[1].normalKills, 3);
  assert.equal(currentMonster(progress).id, expected);
  assert.throws(() => challengeBoss(progress));
  assert.throws(() => selectArea(progress, 2));
});

test('首领固定奖励只在致命一击发放一次，普通怪仍沿用原铜钱掉率', () => {
  let player = initialPlayer();
  player = { ...player, stats: playerStatsForStage({ realmId: 'mahayana', stageIndex: 3 }) };
  const boss = createMonsterEnemy(AREAS[0].boss.id);
  const unexpected = () => { throw new Error('固定首领奖励不应抽取随机数'); };
  const result = attackEnemy(player, boss, unexpected);
  assert.equal(result.defeated, true);
  assert.equal(result.cultivationGained, AREAS[0].boss.cultivationReward);
  assert.equal(result.loot?.quantity, 10);
  const repeated = attackEnemy(result.player, result.enemy, unexpected);
  assert.equal(repeated.cultivationGained, 0);
  assert.equal(repeated.loot, null);
  assert.deepEqual(repeated.player.inventory, result.player.inventory);
  assert.throws(() => respawnNormalEnemy(result.enemy));
  const normal = createMonsterEnemy(1);
  assert.equal(attackEnemy(player, normal, () => 0.2).loot, null);
  const drop = attackEnemy(player, normal, () => 0);
  assert.equal(drop.loot?.quantity, 2);
  assert.equal(respawnNormalEnemy(drop.enemy).maxHealth, 60);
});

test('完整十关可沿原角色成长通关，修为守恒、首领奖励不重复、末关后继续刷怪', () => {
  let progress = initialAdventure();
  let player = initialPlayer();
  let cultivationEarned = 0;
  let cultivationSpent = 0;
  let attacks = 0;
  let majorBreakthroughs = 0;
  for (const [index, area] of AREAS.entries()) {
    progress = selectArea(progress, index);
    while (!progress.areas[index].bossDefeated) {
      if (areaBossStatus(progress) === 'ready' && progress.mode === 'normal') progress = challengeBoss(progress);
      let enemy = createMonsterEnemy(currentMonster(progress).id);
      while (enemy.health > 0) {
        assert.ok(++attacks < 200_000, '完整通关不应因实力配置而无限停滞');
        const result = attackEnemy(player, enemy, () => 0.5);
        player = result.player;
        enemy = result.enemy;
        cultivationEarned += result.cultivationGained;
        if (result.defeated) progress = recordMonsterVictory(progress, enemy.monsterId!);
        let required = cultivationRequirement(player.stage);
        while (required !== null && player.cultivation >= required) {
          if (transitionKind(player.stage) === 'major') {
            const config = retreatConfig(player.stage);
            assert.equal(resolveRetreat({ startedAt: 0, resolved: false, ...config }, config.durationMs, () => 0).outcome, 'success');
            majorBreakthroughs++;
          }
          const breakthrough = settleSuccessfulBreakthrough(player.stage, player.cultivation);
          cultivationSpent += breakthrough.consumedCultivation;
          player = { ...player, stage: breakthrough.stage, stats: breakthrough.stats, cultivation: breakthrough.cultivation };
          required = cultivationRequirement(player.stage);
        }
      }
    }
    assert.equal(progress.areas[index].normalKills, area.killsRequired);
  }
  assert.equal(adventureComplete(progress), true);
  assert.equal(progress.currentAreaIndex, 9);
  assert.equal(progress.mode, 'normal');
  assert.equal(currentMonster(progress).kind, 'normal');
  assert.ok(majorBreakthroughs >= 5);
  assert.ok(Math.abs(cultivationEarned - cultivationSpent - player.cultivation) < 0.001);
  assert.equal(player.inventory.find((item) => item.id === 'copper_coin')?.quantity, 550);
  assert.equal(selectArea(progress, 0).currentAreaIndex, 0);
  assert.throws(() => challengeBoss(progress));
  const next = recordMonsterVictory(progress, currentMonster(progress).id);
  assert.equal(next.areas[9].normalKills, progress.areas[9].normalKills + 1);
  assert.equal(adventureComplete(next), true);
});

test('六次大境界闭关有完整配置，失败仅扣当前门槛的10%，可再次尝试', () => {
  let previousRate = 1;
  for (const realmId of ['qi', 'foundation', 'core', 'soul', 'spirit', 'tribulation'] as const) {
    const stage = { realmId, stageIndex: realmId === 'qi' ? 8 : 3 };
    const config = retreatConfig(stage);
    assert.ok(config.successRate < previousRate && config.successRate > 0);
    previousRate = config.successRate;
    const retreat = { startedAt: 1000, resolved: false, ...config };
    assert.equal(resolveRetreat(retreat, 1000 + config.durationMs - 1, () => 0).outcome, 'waiting');
    assert.equal(resolveRetreat(retreat, 1000 + config.durationMs, () => 0.99).outcome, 'failure');
    const required = cultivationRequirement(stage)!;
    assert.equal(cultivationAfterFailedRetreat(required, config.failureLoss), required * 0.9);
  }
  assert.throws(() => retreatConfig({ realmId: 'qi', stageIndex: 0 }));
  assert.throws(() => retreatConfig({ realmId: 'mahayana', stageIndex: 3 }));
});
