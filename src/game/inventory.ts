import type { InventoryItem } from './model.ts';

// 分页是展示规则，不作为物品容量上限；已堆叠的数量不额外占格。
export const INVENTORY_PAGE_SIZE = 24;

export function inventoryPositions(items: readonly InventoryItem[], preferred: ReadonlyMap<string, number> = new Map()): Map<string, number> {
  const positions = new Map<string, number>();
  const occupied = new Set<number>();
  for (const item of items) {
    const position = preferred.get(item.id);
    if (position !== undefined && Number.isSafeInteger(position) && position >= 0 && !occupied.has(position)) {
      positions.set(item.id, position);
      occupied.add(position);
    }
  }
  let next = 0;
  for (const item of items) {
    if (positions.has(item.id)) continue;
    while (occupied.has(next)) next++;
    positions.set(item.id, next);
    occupied.add(next);
  }
  return positions;
}

export function moveInventoryItem(positions: ReadonlyMap<string, number>, itemId: string, target: number): Map<string, number> {
  const source = positions.get(itemId);
  if (source === undefined || !Number.isSafeInteger(target) || target < 0) return new Map(positions);
  const result = new Map(positions);
  const previous = [...positions].find(([, position]) => position === target)?.[0];
  result.set(itemId, target);
  if (previous && previous !== itemId) result.set(previous, source);
  return result;
}

export function paginateInventory(items: readonly InventoryItem[], pageIndex = 0, openedPages = 1, preferred?: ReadonlyMap<string, number>) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError('背包页码无效');
  if (!Number.isSafeInteger(openedPages) || openedPages < 1) throw new RangeError('背包页数无效');
  const start = pageIndex * INVENTORY_PAGE_SIZE;
  const positions = inventoryPositions(items, preferred);
  const slots: (InventoryItem | undefined)[] = Array.from({ length: INVENTORY_PAGE_SIZE });
  for (const item of items) {
    const position = positions.get(item.id)! - start;
    if (position >= 0 && position < INVENTORY_PAGE_SIZE) slots[position] = item;
  }
  const occupiedSize = Math.max(-1, ...positions.values()) + 1;
  return {
    items: slots.filter((item): item is InventoryItem => item !== undefined),
    slots,
    positions,
    // 恰好填满末页时，预留空白下一页；主动翻到新页也可以扩展页数。
    pageCount: Math.max(openedPages, pageIndex + 1, Math.floor(occupiedSize / INVENTORY_PAGE_SIZE) + 1),
  };
}
