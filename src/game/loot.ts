import type { InventoryItem } from './model.ts';

export const COPPER_COIN = {
  id: 'copper_coin',
  name: '铜钱',
  dropRate: 0.2,
  minQuantity: 2,
  maxQuantity: 5,
} as const;

function sample(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('随机值必须在 [0, 1) 内');
  return value;
}

/** 击杀后先判定是否掉落，成功时再均匀抽取2至5个。 */
export function rollCopperCoinDrop(random: () => number = Math.random): InventoryItem | null {
  if (sample(random) >= COPPER_COIN.dropRate) return null;
  const quantity = COPPER_COIN.minQuantity + Math.floor(sample(random) * (COPPER_COIN.maxQuantity - COPPER_COIN.minQuantity + 1));
  return { id: COPPER_COIN.id, name: COPPER_COIN.name, quantity };
}

/** 仅铜钱采用已确认的同格堆叠规则，不改变其他物品。 */
export function addCopperCoins(inventory: readonly InventoryItem[], quantity: number): InventoryItem[] {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError('铜钱数量必须是正整数');
  const index = inventory.findIndex((item) => item.id === COPPER_COIN.id);
  if (index < 0) return [...inventory, { id: COPPER_COIN.id, name: COPPER_COIN.name, quantity }];
  const total = inventory[index].quantity + quantity;
  if (!Number.isSafeInteger(total) || total <= 0) throw new RangeError('铜钱总数量无效');
  return inventory.map((item, i) => i === index ? { ...item, quantity: total } : item);
}
