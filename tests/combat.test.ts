import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackEnemy, createNormalEnemy, respawnNormalEnemy } from '../src/game/combat.ts';
import { initialPlayer } from '../src/game/model.ts';
import { advanceMinorStage } from '../src/game/progression.ts';
import { playerStatsForStage } from '../src/game/balance.ts';

test('初始敌怪使用第1关尖牙野鼠，生命和奖励固定，未添加攻击属性', () => {
  const enemy = createNormalEnemy({ realmId: 'qi', stageIndex: 0 });
  assert.equal(enemy.name, '尖牙野鼠');
  assert.equal(enemy.health, 60);
  assert.equal(enemy.maxHealth, 60);
  assert.equal(enemy.cultivationReward, 10);
  assert.equal(Object.hasOwn(enemy, 'attack'), false);
  assert.equal(Object.hasOwn(enemy, 'healthRegen'), false);
});

test('每次自动攻击沿用角色攻击值，普通攻击不提前发放击杀奖励', () => {
  const player = initialPlayer();
  const enemy = createNormalEnemy(player.stage);
  const result = attackEnemy(player, enemy);
  assert.equal(result.enemy.health, 50);
  assert.equal(result.player.cultivation, 0);
  assert.equal(result.player.health, 100);
  assert.equal(result.defeated, false);
  assert.equal(enemy.health, 60);
  assert.equal(player.cultivation, 0);
  assert.throws(() => respawnNormalEnemy(result.enemy));
});

test('第六次攻击击杀初始普通怪，奖励只结算一次', () => {
  let player = initialPlayer();
  let enemy = createNormalEnemy(player.stage);
  for (let i = 0; i < 6; i++) {
    const result = attackEnemy(player, enemy);
    player = result.player;
    enemy = result.enemy;
    assert.equal(result.defeated, i === 5);
    assert.equal(player.cultivation, i === 5 ? 10 : 0);
  }
  const repeated = attackEnemy(player, enemy);
  assert.equal(repeated.defeated, false);
  assert.equal(repeated.cultivationGained, 0);
  assert.equal(repeated.player.cultivation, 10);
  const next = respawnNormalEnemy(enemy);
  assert.equal(next.health, 60);
  assert.equal(next.cultivationReward, 10);
  assert.equal(next.name, '尖牙野鼠');
});

test('重复刷怪保留选定名称与固定配置，不退回初始名称', () => {
  const enemy = { ...createNormalEnemy({ realmId: 'qi', stageIndex: 1 }, '赤眼野兔'), health: 0 };
  const next = respawnNormalEnemy(enemy);
  assert.equal(next.name, '赤眼野兔');
  assert.equal(next.health, enemy.maxHealth);
  assert.equal(next.maxHealth, enemy.maxHealth);
  assert.equal(next.cultivationReward, enemy.cultivationReward);
  assert.deepEqual(next.stage, enemy.stage);
  assert.equal(enemy.health, 0);
});

test('连续刷怪十只后可突破，旧怪的实力、血量和奖励不随玩家升级改变', () => {
  let player = initialPlayer();
  let enemy = createNormalEnemy(player.stage);
  for (let kills = 0; kills < 10; kills++) {
    for (let hits = 0; hits < 6; hits++) {
      const result = attackEnemy(player, enemy);
      player = result.player;
      enemy = result.enemy;
    }
    enemy = respawnNormalEnemy(enemy);
  }
  assert.equal(player.cultivation, 100);
  const breakthrough = advanceMinorStage(player.stage, player.cultivation);
  player = { ...player, stage: breakthrough.stage, cultivation: breakthrough.cultivation, stats: breakthrough.stats };
  assert.equal(player.stage.stageIndex, 1);
  assert.equal(player.cultivation, 0);
  const result = attackEnemy(player, enemy);
  assert.ok(result.damage > 10);
  assert.equal(result.enemy.maxHealth, 60);
  assert.equal(result.enemy.stage.stageIndex, 0);
  assert.equal(result.enemy.cultivationReward, 10);
});

test('过量伤害不会造成负生命，击杀奖励不受过量伤害影响', () => {
  const player = initialPlayer();
  player.stage = { realmId: 'foundation', stageIndex: 0 };
  player.stats = playerStatsForStage(player.stage);
  const result = attackEnemy(player, createNormalEnemy({ realmId: 'qi', stageIndex: 0 }));
  assert.equal(result.enemy.health, 0);
  assert.equal(result.damage, 60);
  assert.equal(result.cultivationGained, 10);
  assert.equal(result.player.health, 100);
});

test('无生命或属性缺失的角色不能攻击，非法伤害不会污染战斗状态', () => {
  const player = initialPlayer();
  const enemy = createNormalEnemy(player.stage);
  assert.throws(() => attackEnemy({ ...player, health: 0 }, enemy));
  assert.throws(() => attackEnemy({ ...player, stats: null }, enemy));
  assert.throws(() => attackEnemy({ ...player, stats: { ...player.stats!, attack: Number.NaN } }, enemy));
  assert.equal(enemy.health, 60);
});
