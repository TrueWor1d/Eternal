import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPPER_COIN, addCopperCoins, rollCopperCoinDrop } from '../src/game/loot.ts';
import { initialPlayer } from '../src/game/model.ts';
import { attackEnemy, createNormalEnemy, respawnNormalEnemy } from '../src/game/combat.ts';
import { regeneratePlayer } from '../src/game/rules.ts';

function sequence(...values: number[]) {
  let index = 0;
  return () => {
    assert.ok(index < values.length, '不应多抽取随机值');
    return values[index++];
  };
}

test('铜钱掉率为20%，等于0.2时不掉落，未掉落时不抽数量', () => {
  assert.equal(rollCopperCoinDrop(sequence(0.2)), null);
  assert.equal(rollCopperCoinDrop(sequence(0.999999)), null);
  assert.equal(rollCopperCoinDrop(sequence(0.199999, 0))?.quantity, 2);
  let drops = 0;
  for (let i = 0; i < 100; i++) {
    if (rollCopperCoinDrop(sequence(i / 100, 0))) drops++;
  }
  assert.equal(drops, 20);
});

test('成功掉落的数量等概率映射为2、3、4、5，包含两端', () => {
  for (const [roll, quantity] of [[0, 2], [0.249999, 2], [0.25, 3], [0.499999, 3], [0.5, 4], [0.749999, 4], [0.75, 5], [0.999999, 5]]) {
    assert.deepEqual(rollCopperCoinDrop(sequence(0, roll)), { id: COPPER_COIN.id, name: '铜钱', rarity: 'common', quantity });
  }
});

test('非法随机值不能生成异常数量或绕过掉率判定', () => {
  for (const value of [-0.1, 1, Number.NaN, Infinity]) {
    assert.throws(() => rollCopperCoinDrop(sequence(value)));
    assert.throws(() => rollCopperCoinDrop(sequence(0, value)));
  }
});

test('铜钱累计在同一格，不改变其他物品或传入的数据', () => {
  // 仅测试夹具，不作为正式掉落物。
  const other = { id: 'test_other', name: '隔离测试物品', rarity: 'common' as const, quantity: 1 };
  const original = [other];
  const first = addCopperCoins(original, 2);
  const second = addCopperCoins(first, 5);
  assert.equal(second.filter((item) => item.id === COPPER_COIN.id).length, 1);
  assert.equal(second.find((item) => item.id === COPPER_COIN.id)?.quantity, 7);
  assert.deepEqual(second[0], other);
  assert.deepEqual(original, [other]);
  assert.equal(first.find((item) => item.id === COPPER_COIN.id)?.quantity, 2);
  for (const quantity of [0, -1, 1.5, Number.NaN]) assert.throws(() => addCopperCoins(first, quantity));
});

test('只有致命一击抽取掉落，重复攻击已死亡怪物不再发放', () => {
  let player = initialPlayer();
  let enemy = createNormalEnemy(player.stage);
  const unexpected = () => { throw new Error('非击杀不应抽取随机值'); };
  for (let i = 0; i < 5; i++) {
    const result = attackEnemy(player, enemy, unexpected);
    player = result.player;
    enemy = result.enemy;
    assert.equal(result.loot, null);
    assert.deepEqual(player.inventory, initialPlayer().inventory);
  }
  const result = attackEnemy(player, enemy, sequence(0.1, 0.999999));
  assert.equal(result.loot?.quantity, 5);
  assert.equal(result.player.inventory.find((item) => item.id === COPPER_COIN.id)?.quantity, 5);
  assert.equal(result.player.cultivation, 10);
  assert.deepEqual(player.inventory, initialPlayer().inventory);
  const repeated = attackEnemy(result.player, result.enemy, unexpected);
  assert.equal(repeated.loot, null);
  assert.equal(repeated.cultivationGained, 0);
  assert.equal(repeated.player.inventory.find((item) => item.id === COPPER_COIN.id)?.quantity, 5);
});

test('未触发掉落仍发放原修为奖励，且不改变已有铜钱', () => {
  const player = initialPlayer();
  player.inventory = addCopperCoins(player.inventory, 2);
  player.stats = { ...player.stats!, attack: 100 };
  const result = attackEnemy(player, createNormalEnemy(player.stage), sequence(0.2));
  assert.equal(result.defeated, true);
  assert.equal(result.cultivationGained, 10);
  assert.equal(result.loot, null);
  assert.deepEqual(result.player.inventory, player.inventory);
});

test('连续击杀与刷新能累计铜钱，回血不清空背包', () => {
  let player = initialPlayer();
  let enemy = createNormalEnemy(player.stage);
  const random = sequence(0.1, 0, 0.19, 0.999999);
  for (let kills = 0; kills < 2; kills++) {
    for (let hits = 0; hits < 6; hits++) {
      const result = attackEnemy(player, enemy, random);
      player = result.player;
      enemy = result.enemy;
    }
    enemy = respawnNormalEnemy(enemy);
  }
  assert.deepEqual(player.inventory, [...initialPlayer().inventory, { id: COPPER_COIN.id, name: '铜钱', rarity: 'common', quantity: 7 }]);
  assert.equal(player.cultivation, 20);
  assert.equal(enemy.health, 60);
  assert.deepEqual(regeneratePlayer({ ...player, health: 90 }, 1).inventory, player.inventory);
});
