import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_PAGE_SIZE, paginateInventory } from '../src/game/inventory.ts';
import { addCopperCoins } from '../src/game/loot.ts';

// 仅用于验证分页边界，不进入正式游戏或掉落配置。
const fixtures = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `test_${i}`, name: `隔离测试物品${i}`, quantity: 1, rarity: 'common' as const }));

test('背包每页24格，末页恰好填满时自动增加空白下一页', () => {
  assert.equal(INVENTORY_PAGE_SIZE, 24);
  for (const [count, pages] of [[0, 1], [23, 1], [24, 2], [25, 2], [47, 2], [48, 3], [49, 3]]) {
    assert.equal(paginateInventory(fixtures(count)).pageCount, pages);
  }
  assert.deepEqual(paginateInventory(fixtures(24), 1).items, []);
  assert.equal(paginateInventory(fixtures(25), 1).items[0].id, 'test_24');
});

test('跨页切片不遗漏、不重复或重排物品，原数组保持不变', () => {
  const original = fixtures(70);
  const before = structuredClone(original);
  const pages = [0, 1, 2].map((index) => paginateInventory(original, index).items);
  assert.deepEqual(pages.map((page) => page.length), [24, 24, 22]);
  assert.deepEqual(pages.flat(), original);
  assert.deepEqual(original, before);
});

test('未满页或空背包也能主动进入空白下一页，返回后保留已打开页数', () => {
  const original = fixtures(1);
  const opened = paginateInventory(original, 3);
  assert.equal(opened.pageCount, 4);
  assert.deepEqual(opened.items, []);
  const first = paginateInventory(original, 0, opened.pageCount);
  assert.equal(first.pageCount, 4);
  assert.deepEqual(first.items, original);
  assert.equal(paginateInventory([], 1).pageCount, 2);
});

test('铜钱数量增长仍只占原来一格，不因翻页或堆叠额外开页', () => {
  const inventory = addCopperCoins(addCopperCoins([], 2), 5);
  assert.deepEqual(paginateInventory(inventory).items.map((item) => item.quantity), [7]);
  assert.equal(paginateInventory(inventory).pageCount, 1);
  assert.deepEqual(paginateInventory(inventory, 1).items, []);
  assert.equal(inventory.length, 1);
});

test('非法页码和页数不会导致倒序切片或无效分页状态', () => {
  for (const index of [-1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => paginateInventory([], index));
  }
  for (const count of [0, -1, 1.5, Number.NaN, Infinity]) {
    assert.throws(() => paginateInventory([], 0, count));
  }
});

test('拖动空位、交换与跨页后保留位置，新掉落只填空格，不重排已有物品', async () => {
  const { inventoryPositions, moveInventoryItem } = await import('../src/game/inventory.ts');
  const items = fixtures(3);
  const initial = inventoryPositions(items);
  const swapped = moveInventoryItem(initial, 'test_0', 1);
  assert.equal(swapped.get('test_1'), 0);
  assert.equal(initial.get('test_0'), 0);
  const moved = moveInventoryItem(swapped, 'test_0', 47);
  const first = paginateInventory(items, 0, 1, moved);
  assert.equal(first.slots[1], undefined);
  assert.equal(first.slots[0]?.id, 'test_1');
  const second = paginateInventory(items, 1, 1, moved);
  assert.equal(second.slots[23]?.id, 'test_0');
  assert.equal(second.pageCount, 3);
  const withCoins = addCopperCoins(items, 7);
  const positioned = inventoryPositions(withCoins, moved);
  assert.equal(positioned.get('copper_coin'), 1);
  assert.equal(positioned.get('test_0'), 47);
  const removed = inventoryPositions(withCoins.filter((item) => item.id !== 'test_1'), positioned);
  assert.equal(removed.has('test_1'), false);
  assert.equal(removed.get('test_2'), 2);
});
