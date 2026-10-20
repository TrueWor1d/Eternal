import type { InventoryItem } from './model.ts';

// 分页是展示规则，不作为物品容量上限；已堆叠的数量不额外占格。
export const INVENTORY_PAGE_SIZE = 24;

export function paginateInventory(items: readonly InventoryItem[], pageIndex = 0, openedPages = 1) {
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0) throw new RangeError('背包页码无效');
  if (!Number.isSafeInteger(openedPages) || openedPages < 1) throw new RangeError('背包页数无效');
  const start = pageIndex * INVENTORY_PAGE_SIZE;
  return {
    items: items.slice(start, start + INVENTORY_PAGE_SIZE),
    // 恰好填满末页时，预留空白下一页；主动翻到新页也可以扩展页数。
    pageCount: Math.max(openedPages, pageIndex + 1, Math.floor(items.length / INVENTORY_PAGE_SIZE) + 1),
  };
}
