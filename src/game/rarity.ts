// 稀有度名称只保留在资料与代码中，游戏内由物品边框颜色表示。
export const ITEM_RARITIES = [
  { id: 'common', name: '常见', color: '#F0F0F0' },
  { id: 'ordinary', name: '普通', color: '#55C77A' },
  { id: 'rare', name: '稀有', color: '#549EFC' },
  { id: 'scarce', name: '罕见', color: '#AF7CFA' },
  { id: 'precious', name: '珍稀', color: '#E8BE54' },
  { id: 'peerless', name: '绝世', color: '#EB5F60' },
] as const;

export type ItemRarity = (typeof ITEM_RARITIES)[number]['id'];

export function rarityColor(rarity: ItemRarity): string {
  return ITEM_RARITIES.find(({ id }) => id === rarity)!.color;
}
