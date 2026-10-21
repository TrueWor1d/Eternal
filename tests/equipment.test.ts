import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialPlayer, type Player } from '../src/game/model.ts';
import { EQUIPMENT_SLOTS, equipItem, equipmentSlotForItem, moveEquipment, removeInventoryEquipment, unequipItem } from '../src/game/equipment.ts';
import { addCopperCoins } from '../src/game/loot.ts';

const allIds = (player: Player) => [...player.inventory, ...Object.values(player.equipment).filter((item) => item !== null)].map((item) => item.id).sort();

test('每个槽位各有测试装备，两个戒指独立，初始化不会共用可变状态', () => {
  const player = initialPlayer();
  assert.equal(player.inventory.length, 10);
  assert.equal(new Set(allIds(player)).size, 10);
  assert.deepEqual(player.inventory.map((item) => item.name), EQUIPMENT_SLOTS.map((slot) => `测试用${slot.name}`));
  assert.equal(player.inventory.filter((item) => item.equipmentPart === 'ring').length, 2);
  assert.equal(new Set(player.inventory.map((item) => item.rarity)).size, 6);
  assert.ok(Object.values(player.equipment).every((item) => item === null));
  player.inventory.pop();
  assert.equal(initialPlayer().inventory.length, 10);
});

test('所有部位可穿戴再卸下，物品守恒且不修改基础属性或原数据', () => {
  const original = initialPlayer();
  const before = structuredClone(original);
  let player = original;
  for (const { id } of EQUIPMENT_SLOTS) player = equipItem(player, `test_${id}`, id);
  assert.equal(player.inventory.length, 0);
  assert.equal(Object.values(player.equipment).filter(Boolean).length, 10);
  assert.deepEqual(allIds(player), allIds(original));
  assert.deepEqual(player.stats, original.stats);
  assert.deepEqual(Object.values(player.equipment).map((item) => item!.rarity), original.inventory.map((item) => item.rarity));
  for (const { id } of EQUIPMENT_SLOTS) player = unequipItem(player, id);
  assert.deepEqual(allIds(player), allIds(original));
  assert.equal(player.inventory.length, 10);
  assert.deepEqual(original, before);
});

test('部位错误、铜钱、重复穿戴或空槽操作不能丢失或复制物品', () => {
  const original = initialPlayer();
  original.inventory = addCopperCoins(original.inventory, 7);
  assert.equal(equipItem(original, 'test_helmet', 'boots'), original);
  assert.equal(equipItem(original, 'copper_coin', 'helmet'), original);
  assert.equal(equipItem(original, 'missing', 'helmet'), original);
  assert.equal(unequipItem(original, 'helmet'), original);
  const player = equipItem(original, 'test_helmet', 'helmet');
  assert.equal(equipItem(player, 'test_helmet', 'helmet'), player);
  assert.equal(moveEquipment(player, 'helmet', 'boots'), player);
  assert.deepEqual(allIds(player), allIds(original));
});

test('戒指允许交换，替换的装备回到背包，自动掉落不被覆盖', () => {
  const original = initialPlayer();
  let player = equipItem(original, 'test_ring-one', 'ring-one');
  player = equipItem(player, 'test_ring-two', 'ring-two');
  player = moveEquipment(player, 'ring-one', 'ring-two');
  assert.equal(player.equipment['ring-one']?.id, 'test_ring-two');
  assert.equal(player.equipment['ring-two']?.id, 'test_ring-one');
  player = unequipItem(player, 'ring-one');
  player = { ...player, inventory: addCopperCoins(player.inventory, 5), cultivation: 20 };
  player = equipItem(player, 'test_ring-two', 'ring-two');
  assert.equal(player.inventory.find((item) => item.id === 'copper_coin')?.quantity, 5);
  assert.equal(player.inventory.find((item) => item.id === 'test_ring-one')?.quantity, 1);
  assert.equal(player.cultivation, 20);
  assert.deepEqual(allIds(player).filter((id) => id !== 'copper_coin'), allIds(original));
});


test('菜单装备优先空槽，戒指装满后替换第一个戒指，非装备没有目标槽', () => {
  let player = initialPlayer();
  assert.equal(equipmentSlotForItem(player, 'test_helmet'), 'helmet');
  assert.equal(equipmentSlotForItem(player, 'test_ring-two'), 'ring-one');
  player = equipItem(player, 'test_ring-one', 'ring-one');
  assert.equal(equipmentSlotForItem(player, 'test_ring-two'), 'ring-two');
  player = equipItem(player, 'test_ring-two', 'ring-two');
  player.inventory = [...player.inventory, { id: 'test_extra_ring', name: '测试用戒指', quantity: 1, rarity: 'precious', equipmentPart: 'ring' }];
  assert.equal(equipmentSlotForItem(player, 'test_extra_ring'), 'ring-one');
  player.inventory = addCopperCoins(player.inventory, 7);
  assert.equal(equipmentSlotForItem(player, 'copper_coin'), null);
  assert.equal(equipmentSlotForItem(player, 'missing'), null);
});

test('分解与出售仅移除指定背包装备，不给收益，不删除铜钱、另一戒指或已穿戴装备', () => {
  let player = equipItem(initialPlayer(), 'test_helmet', 'helmet');
  player = { ...player, inventory: addCopperCoins(player.inventory, 7), cultivation: 123 };
  const before = structuredClone(player);
  const result = removeInventoryEquipment(player, 'test_ring-one');
  assert.equal(result.inventory.length, player.inventory.length - 1);
  assert.equal(result.inventory.some((item) => item.id === 'test_ring-one'), false);
  assert.equal(result.inventory.find((item) => item.id === 'test_ring-two')?.quantity, 1);
  assert.equal(result.inventory.find((item) => item.id === 'copper_coin')?.quantity, 7);
  assert.deepEqual(result.equipment, player.equipment);
  assert.deepEqual(result.stats, player.stats);
  assert.equal(result.cultivation, 123);
  assert.equal(result.health, player.health);
  assert.equal(removeInventoryEquipment(result, 'test_ring-one'), result);
  assert.equal(removeInventoryEquipment(result, 'copper_coin'), result);
  assert.equal(removeInventoryEquipment(result, 'test_helmet'), result);
  assert.deepEqual(player, before);
});
