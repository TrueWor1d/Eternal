import type { InventoryItem } from './game/model.ts';

export type InventoryAction = 'equip' | 'decompose' | 'sell';
interface MenuAction { id: InventoryAction; label: string; enabled: boolean }
interface InventoryMenuOptions {
  item: (id: string) => InventoryItem | undefined;
  select: (position: number) => void;
  actions: (item: InventoryItem) => MenuAction[];
  activate: (action: InventoryAction, itemId: string) => void;
}

/** 浮层独立于背包格，自动掉落刷新格子时保留菜单与焦点。 */
export function inventoryContextMenu(options: InventoryMenuOptions) {
  let state: { itemId: string; position: number; element: HTMLDivElement } | null = null;

  function anchor(): HTMLElement | null {
    if (!state) return null;
    const cell = document.querySelector<HTMLElement>(`[data-bag-slot="${state.position}"]`);
    return cell?.dataset.itemId === state.itemId ? cell : null;
  }

  function close(restoreFocus = false): void {
    if (!state) return;
    const cell = anchor();
    state.element.remove();
    state = null;
    document.querySelectorAll('[aria-controls="inventory-item-menu"]').forEach((element) => {
      element.removeAttribute('aria-controls');
      element.removeAttribute('aria-expanded');
    });
    if (restoreFocus) cell?.focus({ preventScroll: true });
  }

  function refresh(): void {
    if (!state) return;
    const cell = anchor();
    const item = options.item(state.itemId);
    if (!cell || !item) { close(); return; }
    cell.setAttribute('aria-controls', 'inventory-item-menu');
    cell.setAttribute('aria-expanded', 'true');
    for (const action of options.actions(item)) {
      const button = state.element.querySelector<HTMLButtonElement>(`[data-inventory-action="${action.id}"]`)!;
      button.disabled = !action.enabled;
    }
    const bounds = cell.getBoundingClientRect();
    const menu = state.element.getBoundingClientRect();
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (bounds.bottom <= 0 || bounds.top >= height) { close(); return; }
    const right = bounds.right + 8;
    const left = right + menu.width <= width - 8 ? right : bounds.left - menu.width - 8;
    state.element.style.left = `${Math.max(8, Math.min(left, width - menu.width - 8))}px`;
    state.element.style.top = `${Math.max(8, Math.min(bounds.top, height - menu.height - 8))}px`;
  }

  function open(cell: HTMLElement): void {
    const itemId = cell.dataset.itemId;
    const item = itemId ? options.item(itemId) : undefined;
    close();
    if (!itemId || !item) return;
    const position = Number(cell.dataset.bagSlot);
    options.select(position);
    const element = document.createElement('div');
    element.id = 'inventory-item-menu';
    element.className = 'inventory-item-menu';
    element.setAttribute('role', 'menu');
    element.setAttribute('aria-label', `${item.name}操作`);
    element.tabIndex = -1;
    for (const action of options.actions(item)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.inventoryAction = action.id;
      button.textContent = action.label;
      button.disabled = !action.enabled;
      button.tabIndex = -1;
      button.addEventListener('click', () => {
        if (button.disabled || !state || !options.item(itemId) || !anchor()) return;
        close();
        options.activate(action.id, itemId);
      });
      element.append(button);
    }
    state = { itemId, position, element };
    document.body.append(element);
    refresh();
    (element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element).focus({ preventScroll: true });
  }

  document.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof Element)) return;
    const cell = event.target.closest<HTMLElement>('.inventory-slot.occupied');
    if (!cell) { close(); return; }
    event.preventDefault();
    open(cell);
  });
  document.addEventListener('pointerdown', (event) => {
    if (state && event.target instanceof Node && !state.element.contains(event.target)) close();
  }, true);
  document.addEventListener('keydown', (event) => {
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('.inventory-slot.occupied') : null;
    if (cell && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      open(cell);
      return;
    }
    if (!state) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const buttons = [...state.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (buttons.length === 0) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].focus();
    }
  }, true);
  window.addEventListener('resize', refresh);
  document.addEventListener('scroll', refresh, true);
  window.addEventListener('blur', () => close());
  document.addEventListener('dragstart', () => close(), true);
  document.addEventListener('click', (event) => {
    if (state && event.target instanceof Node && !state.element.contains(event.target)) close();
  });
  return { close, refresh };
}
