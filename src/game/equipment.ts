import type { InventoryItem, Player } from './model.ts';
import { ITEM_RARITIES } from './rarity.ts';

export const EQUIPMENT_SLOTS = [
  { id: 'helmet', name: '头盔', part: 'helmet', icon: 'helmet' },
  { id: 'necklace', name: '项链', part: 'necklace', icon: 'necklace' },
  { id: 'main', name: '主武器', part: 'main', icon: 'sword' },
  { id: 'chest', name: '胸甲', part: 'chest', icon: 'chest' },
  { id: 'offhand', name: '副武器', part: 'offhand', icon: 'dagger' },
  { id: 'bracer', name: '护腕', part: 'bracer', icon: 'bracer' },
  { id: 'pants', name: '裤子', part: 'pants', icon: 'pants' },
  { id: 'ring-one', name: '戒指', part: 'ring', icon: 'ring' },
  { id: 'boots', name: '鞋子', part: 'boots', icon: 'boots' },
  { id: 'ring-two', name: '戒指', part: 'ring', icon: 'ring' },
] as const;

export type EquipmentSlotId = (typeof EQUIPMENT_SLOTS)[number]['id'];
export type EquipmentPart = (typeof EQUIPMENT_SLOTS)[number]['part'];
export interface EquipmentItem extends InventoryItem { equipmentPart: EquipmentPart; quantity: 1 }
export type EquipmentLoadout = Record<EquipmentSlotId, EquipmentItem | null>;

export function emptyEquipment(): EquipmentLoadout {
  return Object.fromEntries(EQUIPMENT_SLOTS.map(({ id }) => [id, null])) as EquipmentLoadout;
}

export function testEquipment(): EquipmentItem[] {
  return EQUIPMENT_SLOTS.map(({ id, name, part }, index) => ({ id: `test_${id}`, name: `测试用${name}`, quantity: 1, equipmentPart: part, rarity: ITEM_RARITIES[index % ITEM_RARITIES.length].id }));
}

export function fitsEquipment(item: InventoryItem | undefined | null, slot: EquipmentSlotId): item is EquipmentItem {
  const definition = EQUIPMENT_SLOTS.find(({ id }) => id === slot);
  return definition !== undefined && item?.quantity === 1 && item.equipmentPart === definition.part;
}

export function equipmentSlotForItem(player: Player, itemId: string): EquipmentSlotId | null {
  const item = player.inventory.find(({ id }) => id === itemId);
  const matching = EQUIPMENT_SLOTS.filter(({ id }) => fitsEquipment(item, id));
  return matching.find(({ id }) => player.equipment[id] === null)?.id ?? matching[0]?.id ?? null;
}

// 当前分解与出售按用户要求仅移除背包装备，暂不提供材料或铜钱。
export function removeInventoryEquipment(player: Player, itemId: string): Player {
  const slot = equipmentSlotForItem(player, itemId);
  if (slot === null) return player;
  return { ...player, inventory: player.inventory.filter(({ id }) => id !== itemId) };
}

// 测试装备只验证穿戴交互，不改变属性，也不参与掉落随机数。
export function equipItem(player: Player, itemId: string, slot: EquipmentSlotId): Player {
  const item = player.inventory.find(({ id }) => id === itemId);
  if (!fitsEquipment(item, slot)) return player;
  const previous = player.equipment[slot];
  return { ...player, inventory: player.inventory.filter(({ id }) => id !== itemId).concat(previous ? [previous] : []), equipment: { ...player.equipment, [slot]: item } };
}

export function unequipItem(player: Player, slot: EquipmentSlotId): Player {
  const item = player.equipment[slot];
  if (!item) return player;
  return { ...player, inventory: [...player.inventory, item], equipment: { ...player.equipment, [slot]: null } };
}

export function moveEquipment(player: Player, source: EquipmentSlotId, target: EquipmentSlotId): Player {
  const item = player.equipment[source];
  if (source === target || !fitsEquipment(item, target)) return player;
  const previous = player.equipment[target];
  if (previous && !fitsEquipment(previous, source)) return player;
  return { ...player, equipment: { ...player.equipment, [source]: previous, [target]: item } };
}
