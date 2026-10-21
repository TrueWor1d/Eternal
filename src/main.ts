import './style.css';
import { initialPlayer, type InventoryItem, type Retreat } from './game/model.ts';
import { caveUnlocked, nextStage, stageLabel, transitionKind } from './game/realms.ts';
import { cultivationAfterFailedRetreat, cultivationReady, regeneratePlayer, resolveRetreat } from './game/rules.ts';
import { cultivationRequirement } from './game/balance.ts';
import { advanceMinorStage, retreatConfig, settleSuccessfulBreakthrough } from './game/progression.ts';
import { attackEnemy, createMonsterEnemy } from './game/combat.ts';
import { inventoryPositions, moveInventoryItem, INVENTORY_PAGE_SIZE, paginateInventory } from './game/inventory.ts';
import { EQUIPMENT_SLOTS, equipItem, equipmentSlotForItem, fitsEquipment, moveEquipment, removeInventoryEquipment, unequipItem, type EquipmentSlotId } from './game/equipment.ts';
import { inventoryContextMenu } from './inventory-menu.ts';
import { rarityColor } from './game/rarity.ts';
import { COPPER_COIN } from './game/loot.ts';
import { AREAS, getArea } from './game/areas.ts';
import { adventureComplete, areaBossStatus, challengeBoss, currentMonster, initialAdventure, recordMonsterVictory, selectArea } from './game/adventure.ts';

type View = 'adventure' | 'inventory' | 'techniques' | 'cave';
let player = initialPlayer();
let adventure = initialAdventure();
let enemy = createMonsterEnemy(currentMonster(adventure).id);
let retreat: Retreat | null = null;
let normalKills = 0;
let inventoryPageIndex = 0;
let inventoryOpenedPages = 1;
let bagPositions = new Map<string, number>();
let selectedBagSlot: number | null = null;
type ItemLocation = { bag: number } | { equipment: EquipmentSlotId };
let draggedItem: ItemLocation | null = null;
let journalExpanded = false;
let combatFeedback = '自动战斗已开始，空手每秒攻击一次。';
const combatLog: { message: string; kind: 'attack' | 'victory' | 'breakthrough' }[] = [];
const integerFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const rateFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const speedFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const views: { id: View; label: string; icon: string }[] = [
  { id: 'adventure', label: '战斗', icon: 'games' },
  { id: 'inventory', label: '背包', icon: 'backpack' },
  { id: 'techniques', label: '功法', icon: 'book' },
  { id: 'cave', label: '洞府', icon: 'home' },
];

// Microsoft Fluent System Icons, bundled locally under the MIT license.
function icon(name: string, className = ''): string {
  return `<img class="icon ${className}" src="./icons/${name}.svg" alt="" aria-hidden="true" />`;
}

// Game Icons (Lorc / Delapouite), CC BY 3.0; attribution bundled with the assets.
function itemIcon(name: string, className = ''): string {
  return `<img class="item-icon ${className}" draggable="false" src="./icons/gear/${name}.svg" alt="" aria-hidden="true" />`;
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function currentView(): View {
  const hash = window.location.hash.slice(1);
  return views.some((view) => view.id === hash) ? hash as View : 'adventure';
}

function sectionTitle(title: string, extra = ''): string {
  return `<div class="section-title"><h2>${title}</h2>${extra}</div>`;
}

function sidebar(view: View): string {
  return `<aside class="sidebar">
    <a class="brand" href="#adventure" aria-label="永恒，返回战斗">永恒</a>
    ${playerCard()}
    <nav aria-label="游戏主导航">${views.map((item) => `<a href="#${item.id}" class="nav-item ${view === item.id ? 'active' : ''}" ${view === item.id ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${item.label}</span>${item.id === 'cave' && !caveUnlocked(player.stage) ? icon('lock', 'nav-lock') : ''}</a>`).join('')}</nav>
  </aside>`;
}

function playerProgress() {
  const next = nextStage(player.stage);
  const required = cultivationRequirement(player.stage);
  const ready = cultivationReady(player.cultivation, required);
  const minor = transitionKind(player.stage) === 'minor';
  const progress = required === null ? 100 : Math.min(100, player.cultivation / required * 100);
  const hint = required === null ? '凡界已圆满，后续世界待扩展' : !ready
    ? `距离突破还需 ${integerFormat.format(Math.ceil(required - player.cultivation))} 修为`
    : minor ? '修为已达标，可以直接突破' : (() => {
      const config = retreatConfig(player.stage);
      return `闭关${config.durationMs / 1000}秒，成功率${config.successRate * 100}%，失败扣除${integerFormat.format(config.failureLoss)}修为`;
    })();
  const buttonLabel = retreat ? `闭关中 · ${Math.max(0, Math.ceil((retreat.startedAt + retreat.durationMs - performance.now()) / 1000))}秒`
    : next === null ? '凡界已圆满' : minor ? '突破' : '闭关突破';
  return { next, required, ready, progress, hint, buttonLabel, canBreakthrough: ready && retreat === null };
}

function playerCard(): string {
  const { required, progress, hint, buttonLabel, canBreakthrough } = playerProgress();
  const stats = player.stats!;
  return `<section class="player-column" aria-label="角色信息">
    <section class="character-panel">
      <h2>角色信息</h2>
      <div class="realm-summary"><span class="field-label">境界</span><p class="character-realm">${stageLabel(player.stage)}</p></div>
      <div class="cultivation-summary">
        <div class="cultivation-row"><span>修为</span><span class="cultivation-value"><strong><span data-cultivation-current>${integerFormat.format(Math.floor(player.cultivation))}</span><small> / ${required === null ? '凡界圆满' : integerFormat.format(required)}</small></strong><span class="cultivation-gain-layer" aria-hidden="true"></span></span></div>
        <div class="progress-track" role="progressbar" aria-label="当前修为进度" aria-valuemin="0" aria-valuemax="${required ?? 100}" aria-valuenow="${required === null ? 100 : Math.min(player.cultivation, required)}"><span style="width:${progress}%"></span></div>
        <p class="helper sr-only" id="breakthrough-hint">${hint}</p>
        <button class="button breakthrough-button" data-breakthrough ${canBreakthrough ? '' : 'disabled'} title="${hint}" aria-describedby="breakthrough-hint">${buttonLabel}</button>
      </div>
    </section>
    <section class="attributes-panel">
      <h2>角色属性</h2>
      <dl class="attribute-list"><div><dt>生命</dt><dd><span data-player-health role="meter" aria-label="角色生命" aria-valuemin="0" aria-valuemax="${stats.maxHealth}" aria-valuenow="${player.health}">${integerFormat.format(player.health!)} <small>/ ${integerFormat.format(stats.maxHealth)}</small></span></dd></div>${[
        ['攻击', integerFormat.format(stats.attack)],
        ['防御', integerFormat.format(stats.defense)],
        ['攻速', `${speedFormat.format(stats.attackSpeed)} 次/秒`],
        ['回复', `${rateFormat.format(stats.healthRegen)} 点/秒`],
      ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
    </section>
  </section>`;
}

function logEntries(): string {
  return combatLog.length === 0 ? '<li class="log-empty">暂无战斗记录。</li>' : combatLog.map((entry) => `<li class="log-${entry.kind}">${escapeHTML(entry.message)}</li>`).join('');
}

function journalMarkup(): string {
  return `${sectionTitle('最近记录', `<div class="journal-actions"><span class="count-label">已击败 ${normalKills} 只</span><button type="button" class="text-button journal-toggle" data-journal-toggle aria-expanded="${journalExpanded}" aria-controls="combat-log"><span>${journalExpanded ? '收起' : '展开'}</span>${icon('chevron')}</button></div>`)}
    <p class="journal-latest" data-combat-feedback role="status" aria-live="polite" ${journalExpanded ? 'hidden' : ''}>${escapeHTML(combatFeedback)}</p>
    <ol id="combat-log" class="combat-log" aria-label="战斗记录" ${journalExpanded ? '' : 'hidden'}>${logEntries()}</ol>`;
}

function combatView(): string {
  const area = getArea(adventure.currentAreaIndex);
  return `<div class="battle-column">
    <section class="encounter-panel" aria-label="战斗区域">
      <div class="encounter-heading"><div><h2>当前怪物</h2><p class="encounter-location">${area.name}</p></div><button class="button secondary area-picker-button" data-open-areas aria-haspopup="dialog" aria-controls="area-dialog">选择关卡${icon('chevron')}</button></div>
      <div class="battle-stage" aria-label="战斗场景">
        <div class="combatant player-combatant">
          <div class="combatant-visual"><img class="actor-sprite player-sprite pixel-sprite" src="./actors/player.png" alt="像素修真者主角" draggable="false" /></div>
          <div class="combatant-caption"><span class="actor-name">角色</span></div>
        </div>
        <div class="combatant enemy-combatant">
          <div class="combatant-visual">
            <div class="enemy-health"><div class="health-row"><span>生命</span><strong data-enemy-health>${rateFormat.format(enemy.health)} <small>/ ${integerFormat.format(enemy.maxHealth)}</small></strong></div><div class="health-track" role="progressbar" aria-label="怪物生命" aria-valuemin="0" aria-valuemax="${enemy.maxHealth}" aria-valuenow="${enemy.health}"><span style="width:${enemy.health / enemy.maxHealth * 100}%"></span></div></div>
            <div class="enemy-portrait"><img class="actor-sprite enemy-sprite pixel-sprite" src="./actors/wolf.png" alt="测试用小灰狼2D立绘" draggable="false" /></div>
            <div class="damage-layer" aria-hidden="true"></div>
          </div>
          <div class="combatant-caption"><h3>${enemy.name}</h3><p>${enemy.kind === 'boss' ? '区域首领' : '普通怪'}</p></div>
        </div>
      </div>
      <div class="area-progress-panel"><div class="area-progress-summary"><div class="area-progress-heading"><span>首领挑战进度</span><strong data-area-progress-count></strong></div><div class="progress-track area-progress-track" role="progressbar" aria-label="首领挑战进度" aria-valuemin="0" aria-valuemax="${area.killsRequired}" aria-valuenow="0"><span></span></div></div><button class="button secondary" data-challenge-boss disabled>挑战首领</button></div>
      <p class="completion-note" data-adventure-complete ${adventureComplete(adventure) ? '' : 'hidden'}>全部关卡已通关，可继续刷怪。</p>
    </section>
    <section class="journal-panel" aria-label="最近记录">${journalMarkup()}</section>
  </div>`;
}

function areaRowStatus(index: number): string {
  const state = adventure.areas[index];
  if (!state.unlocked) return '未解锁';
  if (state.bossDefeated) return '已通关';
  if (areaBossStatus(adventure, index) === 'ready') return '可挑战首领';
  return `首领进度 ${Math.min(state.normalKills, getArea(index).killsRequired)} / ${getArea(index).killsRequired}`;
}

function areaStateIcon(index: number): string {
  return !adventure.areas[index].unlocked ? icon('lock', 'area-lock')
    : index === adventure.currentAreaIndex ? icon('check') : icon('chevron');
}

function areaDialog(): string {
  return `<dialog id="area-dialog" aria-labelledby="area-dialog-title"><div class="dialog-heading"><h2 id="area-dialog-title">选择关卡</h2><button class="icon-button" data-close-areas aria-label="关闭关卡选择">${icon('close')}</button></div><div class="area-options">${AREAS.map((area, index) => `<button type="button" class="area-option ${index === adventure.currentAreaIndex ? 'selected' : ''}" data-select-area="${index}" ${adventure.areas[index].unlocked ? '' : 'disabled'} aria-label="进入第${index + 1}关 ${area.name}${adventure.areas[index].unlocked ? '' : '，未解锁'}" ${index === adventure.currentAreaIndex ? 'aria-current="true"' : ''}><span class="area-number">${String(index + 1).padStart(2, '0')}</span><span class="area-option-label"><strong>${area.name}</strong><small class="area-status">${areaRowStatus(index)}</small></span><span class="area-state-icon">${areaStateIcon(index)}</span></button>`).join('')}</div></dialog>`;
}

function refreshAdventure(): void {
  const area = getArea(adventure.currentAreaIndex);
  const state = adventure.areas[adventure.currentAreaIndex];
  const location = document.querySelector<HTMLElement>('.encounter-location');
  if (location) location.textContent = area.name;
  const name = document.querySelector<HTMLElement>('.enemy-combatant h3');
  if (name) name.textContent = enemy.name;
  const subtitle = document.querySelector<HTMLElement>('.enemy-combatant .combatant-caption p');
  if (subtitle) subtitle.textContent = enemy.kind === 'boss' ? '区域首领' : '普通怪';
  const count = document.querySelector<HTMLElement>('[data-area-progress-count]');
  if (count) count.textContent = `${Math.min(state.normalKills, area.killsRequired)} / ${area.killsRequired}`;
  updateBar(document.querySelector<HTMLElement>('[aria-label="首领挑战进度"]'), state.normalKills, area.killsRequired);
  const boss = document.querySelector<HTMLButtonElement>('[data-challenge-boss]');
  if (boss) {
    boss.disabled = adventure.mode === 'boss' || areaBossStatus(adventure) !== 'ready';
    boss.textContent = state.bossDefeated ? '首领已击败' : adventure.mode === 'boss' ? '挑战中' : '挑战首领';
  }
  const completion = document.querySelector<HTMLElement>('[data-adventure-complete]');
  if (completion) completion.hidden = !adventureComplete(adventure);
  document.querySelectorAll<HTMLButtonElement>('[data-select-area]').forEach((button) => {
    const index = Number(button.dataset.selectArea);
    const selected = index === adventure.currentAreaIndex;
    button.disabled = !adventure.areas[index].unlocked;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-label', `进入第${index + 1}关 ${getArea(index).name}${button.disabled ? '，未解锁' : ''}`);
    if (selected) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    button.querySelector<HTMLElement>('.area-status')!.textContent = areaRowStatus(index);
    button.querySelector<HTMLElement>('.area-state-icon')!.innerHTML = areaStateIcon(index);
  });
}

function enterArea(index: number): void {
  const next = selectArea(adventure, index);
  document.querySelector<HTMLDialogElement>('#area-dialog')?.close();
  if (index === adventure.currentAreaIndex && adventure.mode === 'normal') return;
  adventure = next;
  enemy = createMonsterEnemy(currentMonster(adventure).id);
  clearHitFeedback();
  combatFeedback = `进入 ${getArea(index).name}，开始刷怪。`;
  refreshAdventure();
  refreshCombat();
}

function inventoryPageState() {
  const page = paginateInventory(player.inventory, inventoryPageIndex, inventoryOpenedPages, bagPositions);
  inventoryOpenedPages = page.pageCount;
  bagPositions = page.positions;
  return page;
}

function inventoryGridMarkup(items: readonly (InventoryItem | undefined)[]): string {
  return items.map((item, index) => {
    const position = inventoryPageIndex * INVENTORY_PAGE_SIZE + index;
    const selected = selectedBagSlot === position;
    const name = escapeHTML(item?.name ?? '');
    const label = item?.equipmentPart ? name.replace(/^测试用/, '测试用<br>') : name;
    const image = item?.equipmentPart ? EQUIPMENT_SLOTS.find(({ part }) => part === item.equipmentPart)!.icon : 'coins';
    return `<li class="inventory-slot ${item ? 'occupied' : ''} ${item?.equipmentPart ? 'gear-item' : ''} ${selected ? 'selected' : ''}" data-bag-slot="${position}" ${item ? `data-item-id="${escapeHTML(item.id)}" data-rarity="${item.rarity}" style="--rarity-color:${rarityColor(item.rarity)}" aria-haspopup="menu"` : ''} role="option" aria-selected="${selected}" tabindex="${selected || (index === 0 && (selectedBagSlot === null || selectedBagSlot < inventoryPageIndex * INVENTORY_PAGE_SIZE || selectedBagSlot >= (inventoryPageIndex + 1) * INVENTORY_PAGE_SIZE)) ? 0 : -1}" draggable="${Boolean(item)}" title="${item ? escapeHTML(item.name) : '空背包格'}" aria-label="${item ? `${escapeHTML(item.name)}，数量 ${integerFormat.format(item.quantity)}` : `空背包格 ${position + 1}`}">${item ? `${itemIcon(image, item.id === COPPER_COIN.id ? 'coin-icon' : '')}<span class="inventory-item-name">${label}</span>${item.equipmentPart ? '' : `<span class="inventory-quantity">×${integerFormat.format(item.quantity)}</span>`}` : ''}</li>`;
  }).join('');
}

function equipmentGridMarkup(): string {
  return EQUIPMENT_SLOTS.map(({ id, name, icon: image }) => {
    const item = player.equipment[id];
    return `<li class="equipment-slot equipment-${id} ${item ? 'equipped' : ''}" data-equipment-slot="${id}" ${item ? `data-item-id="${escapeHTML(item.id)}" data-rarity="${item.rarity}" style="--rarity-color:${rarityColor(item.rarity)}"` : ''} role="button" tabindex="0" draggable="${Boolean(item)}" aria-label="${name}，${item ? escapeHTML(item.name) : '未装备'}" title="${item ? '拖回背包卸下' : name}">${itemIcon(image)}<span class="equipment-name">${name}</span><span class="${item ? 'equipment-item-name' : 'equipment-empty'}">${item ? escapeHTML(item.name) : '未装备'}</span></li>`;
  }).join('');
}

function refreshEquipment(): void {
  const grid = document.querySelector('.equipment-grid');
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.equipmentSlot : undefined;
  if (grid) grid.innerHTML = equipmentGridMarkup();
  const count = document.querySelector('[data-equipment-count]');
  if (count) count.textContent = `已装备 ${Object.values(player.equipment).filter(Boolean).length} / 10`;
  if (focused) document.querySelector<HTMLElement>(`[data-equipment-slot="${focused}"]`)?.focus({ preventScroll: true });
}

function inventoryView(): string {
  const page = inventoryPageState();
  return `<div class="inventory-page">
    <section class="equipment-panel" aria-labelledby="equipment-title">
      <div class="section-title inventory-heading"><h2 id="equipment-title">人物装备</h2></div>
      <p class="page-description" data-equipment-count>已装备 ${Object.values(player.equipment).filter(Boolean).length} / 10</p>
      <div class="equipment-display">
        <ul class="equipment-grid" aria-label="人物装备槽">${equipmentGridMarkup()}</ul>
      </div>
    </section>
    <section class="inventory-panel" aria-labelledby="inventory-title">
      <div class="section-title inventory-heading"><h2 id="inventory-title">角色背包</h2><span class="inventory-count">物品种类：${integerFormat.format(player.inventory.length)}</span></div>
      <p class="page-description">存放打怪获得的掉落物品。</p>
      <div class="inventory-storage">
        <ul id="inventory-grid" class="inventory-grid" role="listbox" aria-label="背包物品">${inventoryGridMarkup(page.slots)}</ul>
        <nav class="inventory-pagination" aria-label="背包分页">
          <button type="button" class="inventory-page-button" data-inventory-page="previous" aria-controls="inventory-grid" ${inventoryPageIndex === 0 ? 'disabled' : ''}>上一页</button>
          <span class="inventory-page-label" aria-live="polite" aria-atomic="true" aria-label="第${inventoryPageIndex + 1}页，共${page.pageCount}页">${integerFormat.format(inventoryPageIndex + 1)} / ${integerFormat.format(page.pageCount)}</span>
          <button type="button" class="inventory-page-button" data-inventory-page="next" aria-controls="inventory-grid">下一页</button>
        </nav>
        <p class="inventory-empty" role="status" ${page.items.length === 0 ? '' : 'hidden'}>${player.inventory.length === 0 && inventoryPageIndex === 0 ? '背包为空' : '本页暂无物品'}</p>
      </div>
    </section>
  </div>`;
}

function techniquesView(): string {
  return `<div class="page-stack">
    <p class="page-description">刷怪可掉落功法，装配后提升属性。功法资料与掉落规则待确认。</p>
    <section class="panel">${sectionTitle('功法装配')}<div class="info-row">${icon('book')}<div><h3>采用分类功法槽位</h3><p>具体类别与槽位数量确定后开放装配。</p></div><span class="tag">未开放</span></div></section>
    <section class="panel">${sectionTitle('功法行囊')}<div class="info-row">${icon('document')}<div><h3>尚无功法</h3><p>功法资料与掉落规则待确认。</p></div></div></section>
    <section class="panel">${sectionTitle('功法效果')}<dl class="description-list"><div><dt>被动属性</dt><dd>装配功法后获得属性加成。</dd></div><div><dt>主动技能</dt><dd>部分功法提供主动技能，具体机制待确认。</dd></div></dl></section>
  </div>`;
}

function caveView(): string {
  const unlocked = caveUnlocked(player.stage);
  return `<div class="page-stack">
    <div class="inline-note">${icon(unlocked ? 'home' : 'lock')}<p>${unlocked ? '洞府已解锁。收益与升级规则待确认。' : '达到筑基期后，解锁洞府与自动修炼。'}</p><span class="tag">${unlocked ? '已解锁' : '未解锁'}</span></div>
    <section class="panel">${sectionTitle('自动修炼')}<div class="description-row"><div><h3>修为收益待确认</h3><p>解锁洞府后，自动修炼提供修为。</p></div></div></section>
    <section class="panel">${sectionTitle('洞府升级')}<div class="description-row"><div><h3>升级条件与收益待确认</h3><p>升级洞府可以提高自动修炼的修为收益。</p></div><button class="button secondary" disabled>升级洞府</button></div></section>
  </div>`;
}

function addCombatLog(message: string, kind: (typeof combatLog)[number]['kind']): void {
  combatLog.unshift({ message, kind });
  combatLog.splice(8);
}

function updateBar(bar: HTMLElement | null, value: number, max: number): void {
  if (!bar) return;
  bar.setAttribute('aria-valuemax', String(max));
  bar.setAttribute('aria-valuenow', String(Math.min(max, value)));
  const fill = bar.querySelector<HTMLElement>('span');
  if (fill) fill.style.width = `${Math.min(100, value / max * 100)}%`;
}

function refreshPlayerHealth(): void {
  const label = document.querySelector<HTMLElement>('[data-player-health]');
  if (label) {
    label.innerHTML = `${integerFormat.format(player.health!)} <small>/ ${integerFormat.format(player.stats!.maxHealth)}</small>`;
    label.setAttribute('aria-valuenow', String(player.health));
    label.setAttribute('aria-valuemax', String(player.stats!.maxHealth));
  }
}

function refreshPlayerProgress(): void {
  const { required, hint, canBreakthrough, buttonLabel } = playerProgress();
  const value = document.querySelector<HTMLElement>('.cultivation-row strong');
  if (value) value.innerHTML = `<span data-cultivation-current>${integerFormat.format(Math.floor(player.cultivation))}</span><small> / ${required === null ? '凡界圆满' : integerFormat.format(required)}</small>`;
  const helper = document.querySelector<HTMLElement>('.character-panel .helper');
  if (helper) helper.textContent = hint;
  const button = document.querySelector<HTMLButtonElement>('[data-breakthrough]');
  if (button) { button.disabled = !canBreakthrough; button.title = hint; button.textContent = buttonLabel; }
  updateBar(document.querySelector<HTMLElement>('[role="progressbar"][aria-label="当前修为进度"]'), required === null ? 100 : player.cultivation, required ?? 100);
}

function refreshInventory(): void {
  // 自动掉落继续结算；拖动结束后再刷新DOM，避免拖动中物品被重建。
  if (draggedItem) return;
  const grid = document.querySelector<HTMLElement>('.inventory-grid');
  if (!grid) return;
  const page = inventoryPageState();
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.bagSlot : undefined;
  grid.innerHTML = inventoryGridMarkup(page.slots);
  if (focused) document.querySelector<HTMLElement>(`[data-bag-slot="${focused}"]`)?.focus({ preventScroll: true });
  const count = document.querySelector<HTMLElement>('.inventory-count');
  if (count) count.textContent = `物品种类：${integerFormat.format(player.inventory.length)}`;
  const empty = document.querySelector<HTMLElement>('.inventory-empty');
  if (empty) {
    empty.hidden = page.items.length > 0;
    const message = player.inventory.length === 0 && inventoryPageIndex === 0 ? '背包为空' : '本页暂无物品';
    if (empty.textContent !== message) empty.textContent = message;
  }
  const previous = document.querySelector<HTMLButtonElement>('[data-inventory-page="previous"]');
  if (previous) previous.disabled = inventoryPageIndex === 0;
  const label = document.querySelector<HTMLElement>('.inventory-page-label');
  if (label) {
    const text = `${integerFormat.format(inventoryPageIndex + 1)} / ${integerFormat.format(page.pageCount)}`;
    if (label.textContent !== text) {
      label.textContent = text;
      label.setAttribute('aria-label', `第${inventoryPageIndex + 1}页，共${page.pageCount}页`);
    }
  }
  inventoryMenu.refresh();
}

function refreshCombat(): void {
  const health = document.querySelector<HTMLElement>('[data-enemy-health]');
  if (health) health.innerHTML = `${rateFormat.format(enemy.health)} <small>/ ${integerFormat.format(enemy.maxHealth)}</small>`;
  updateBar(document.querySelector<HTMLElement>('[role="progressbar"][aria-label="怪物生命"]'), enemy.health, enemy.maxHealth);
  const feedback = document.querySelector<HTMLElement>('[data-combat-feedback]');
  if (feedback) feedback.textContent = combatFeedback;
  const entries = document.querySelector<HTMLElement>('#combat-log');
  if (entries) entries.innerHTML = logEntries();
  const killCount = document.querySelector<HTMLElement>('.count-label');
  if (killCount) killCount.textContent = `已击败 ${normalKills} 只`;
  refreshPlayerProgress();
}

function clearCultivationFeedback(): void {
  const layer = document.querySelector('.cultivation-gain-layer');
  layer?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
  layer?.replaceChildren();
}

/** 只展示已经到账的修为，不追加结算或战斗计时器。 */
function showCultivationGain(amount: number): void {
  if (amount <= 0) return;
  const current = document.querySelector<HTMLElement>('[data-cultivation-current]');
  const layer = document.querySelector<HTMLElement>('.cultivation-gain-layer');
  if (!current || !layer) return;
  clearCultivationFeedback();
  const number = document.createElement('span');
  number.className = 'cultivation-gain';
  number.textContent = `+${rateFormat.format(amount)}`;
  number.style.left = `${current.offsetLeft + current.offsetWidth / 2}px`;
  layer.append(number);
  const frames = reducedMotion.matches ? [{ opacity: 1 }, { opacity: 1 }] : [
    { opacity: 1, transform: 'translate(-50%, 0)' },
    { opacity: 1, transform: 'translate(-50%, -8px)', offset: 0.35 },
    { opacity: 0, transform: 'translate(-50%, -20px)' },
  ];
  const animation = number.animate(frames, { duration: 450, easing: 'ease-out', fill: 'forwards' });
  void animation.finished.then(() => number.remove(), () => number.remove());
}

function clearHitFeedback(): void {
  const layer = document.querySelector('.damage-layer');
  layer?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
  layer?.replaceChildren();
  document.querySelector('.enemy-sprite')?.getAnimations().forEach((animation) => animation.cancel());
}

function showHitFeedback(damage: number): void {
  if (reducedMotion.matches || damage <= 0) return;
  const sprite = document.querySelector<HTMLElement>('.enemy-sprite');
  const layer = document.querySelector<HTMLElement>('.damage-layer');
  if (!sprite || !layer) return;
  clearHitFeedback();
  sprite.animate([
    { filter: 'brightness(1)' }, { filter: 'brightness(1.65)', offset: 0.35 }, { filter: 'brightness(1)' },
  ], { duration: 180, easing: 'ease-out' });
  const number = document.createElement('span');
  number.className = 'damage-number';
  number.textContent = `−${rateFormat.format(damage)}`;
  layer.append(number);
  const animation = number.animate([
    { opacity: 1, transform: 'translate(-50%, 0)' },
    { opacity: 0, transform: 'translate(-50%, -24px)' },
  ], { duration: 650, easing: 'ease-out', fill: 'forwards' });
  // A single decorative number per visible hit, removed after finishing or cancellation.
  void animation.finished.then(() => number.remove(), () => number.remove());
}

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    clearHitFeedback();
    clearCultivationFeedback();
  }
});

function performAttack(): void {
  const result = attackEnemy(player, enemy);
  player = result.player;
  enemy = result.enemy;
  if (result.defeated) {
    normalKills++;
    combatFeedback = `击败 ${enemy.name}，获得 ${rateFormat.format(result.cultivationGained)} 修为${result.loot ? `、${result.loot.name} ×${integerFormat.format(result.loot.quantity)}` : ''}。`;
    addCombatLog(combatFeedback, 'victory');
    adventure = recordMonsterVictory(adventure, enemy.monsterId!);
    if (enemy.kind === 'boss') {
      const next = AREAS[adventure.currentAreaIndex + 1];
      combatFeedback += next ? ` 已解锁 ${next.name}。` : ' 全部关卡已通关！';
      combatLog[0].message = combatFeedback;
    }
    enemy = createMonsterEnemy(currentMonster(adventure).id);
    refreshAdventure();
  } else {
    combatFeedback = `对 ${enemy.name} 造成 ${rateFormat.format(result.damage)} 点伤害。`;
    addCombatLog(combatFeedback, 'attack');
  }
  if (result.loot) refreshInventory();
  refreshCombat();
  showCultivationGain(result.cultivationGained);
  if (result.defeated && result.enemy.kind === 'boss') clearHitFeedback();
  else showHitFeedback(result.damage);
}

function render(focusHeading = false): void {
  const areasOpen = document.querySelector<HTMLDialogElement>('#area-dialog')?.open ?? false;
  const focusedArea = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.selectArea : undefined;
  inventoryMenu.close();
  cancelItemDrag();
  clearCultivationFeedback();
  const view = currentView();
  const selected = views.find((item) => item.id === view)!;
  const pages: Record<View, () => string> = { adventure: combatView, inventory: inventoryView, techniques: techniquesView, cave: caveView };
  document.title = `${selected.label} · 永恒`;
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<a href="#main-content" class="skip-link">跳到主要内容</a><div class="app-shell">${sidebar(view)}<main id="main-content" class="workspace" tabindex="-1"><header class="page-heading"><h1 tabindex="-1">${selected.label}</h1></header>${view === 'adventure' ? `<div class="content-layout"><div class="view-content">${pages[view]()}</div></div>` : `<div class="secondary-content">${pages[view]()}</div>`}<footer class="page-footer">刷新页面会重置进度。</footer></main></div>${areaDialog()}`;
  if (focusHeading) document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  refreshAdventure();
  if (areasOpen && view === 'adventure') {
    document.querySelector<HTMLDialogElement>('#area-dialog')?.showModal();
    if (focusedArea !== undefined) document.querySelector<HTMLButtonElement>(`[data-select-area="${focusedArea}"]`)?.focus();
  }
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.skip-link')) {
    event.preventDefault();
    document.querySelector<HTMLElement>('#main-content')?.focus();
    return;
  }
  if (target.closest('[data-open-areas]')) {
    document.querySelector<HTMLDialogElement>('#area-dialog')?.showModal();
    return;
  }
  if (target.closest('[data-close-areas]')) {
    document.querySelector<HTMLDialogElement>('#area-dialog')?.close();
    return;
  }
  const areaButton = target.closest<HTMLButtonElement>('[data-select-area]');
  if (areaButton && !areaButton.disabled) {
    enterArea(Number(areaButton.dataset.selectArea));
    return;
  }
  const bossButton = target.closest<HTMLButtonElement>('[data-challenge-boss]');
  if (bossButton && !bossButton.disabled) {
    adventure = challengeBoss(adventure);
    enemy = createMonsterEnemy(currentMonster(adventure).id);
    clearHitFeedback();
    combatFeedback = `开始挑战首领 ${enemy.name}。`;
    refreshAdventure();
    refreshCombat();
    return;
  }
  const inventoryPageButton = target.closest<HTMLButtonElement>('[data-inventory-page]');
  if (inventoryPageButton && !inventoryPageButton.disabled) {
    inventoryPageIndex = Math.max(0, inventoryPageIndex + (inventoryPageButton.dataset.inventoryPage === 'next' ? 1 : -1));
    refreshInventory();
    return;
  }
  const journalToggle = target.closest<HTMLButtonElement>('[data-journal-toggle]');
  if (journalToggle) {
    journalExpanded = !journalExpanded;
    journalToggle.setAttribute('aria-expanded', String(journalExpanded));
    journalToggle.querySelector('span')!.textContent = journalExpanded ? '收起' : '展开';
    document.querySelector<HTMLElement>('#combat-log')!.hidden = !journalExpanded;
    document.querySelector<HTMLElement>('.journal-latest')!.hidden = journalExpanded;
  }
  const breakthroughButton = target.closest<HTMLButtonElement>('[data-breakthrough]');
  if (breakthroughButton && !breakthroughButton.disabled) {
    if (transitionKind(player.stage) === 'major') {
      const config = retreatConfig(player.stage);
      retreat = { startedAt: performance.now(), durationMs: config.durationMs, successRate: config.successRate, resolved: false };
      combatFeedback = `开始闭关，${config.durationMs / 1000}秒后判定，成功率${config.successRate * 100}%。`;
      addCombatLog(combatFeedback, 'breakthrough');
      refreshCombat();
      return;
    }
    const result = advanceMinorStage(player.stage, player.cultivation);
    player.stage = result.stage;
    player.cultivation = result.cultivation;
    player.stats = result.stats;
    combatFeedback = `突破成功，当前境界 ${stageLabel(player.stage)}。`;
    addCombatLog(combatFeedback, 'breakthrough');
    render();
  }

});
function itemLocation(element: Element | null): ItemLocation | null {
  const cell = element?.closest<HTMLElement>('[data-bag-slot], [data-equipment-slot]');
  if (cell?.dataset.bagSlot !== undefined) return { bag: Number(cell.dataset.bagSlot) };
  if (cell?.dataset.equipmentSlot) return { equipment: cell.dataset.equipmentSlot as EquipmentSlotId };
  return null;
}

function itemAt(location: ItemLocation): InventoryItem | null {
  if ('equipment' in location) return player.equipment[location.equipment];
  const id = [...bagPositions].find(([, position]) => position === location.bag)?.[0];
  return player.inventory.find((item) => item.id === id) ?? null;
}

function canDropItem(source: ItemLocation, target: ItemLocation): boolean {
  const item = itemAt(source);
  if (!item) return false;
  if ('equipment' in target) return fitsEquipment(item, target.equipment);
  const previous = itemAt(target);
  return 'bag' in source || !previous || fitsEquipment(previous, source.equipment);
}

function transferItem(source: ItemLocation, target: ItemLocation): void {
  // 使用最新玩家状态，保留拖动期间自动获得的修为和掉落。
  bagPositions = inventoryPositions(player.inventory, bagPositions);
  if (!canDropItem(source, target)) return;
  const item = itemAt(source)!;
  if ('equipment' in target) {
    if ('equipment' in source) player = moveEquipment(player, source.equipment, target.equipment);
    else {
      const previous = player.equipment[target.equipment];
      player = equipItem(player, item.id, target.equipment);
      bagPositions.delete(item.id);
      if (previous) bagPositions.set(previous.id, source.bag);
    }
  } else {
    if ('bag' in source) bagPositions = moveInventoryItem(bagPositions, item.id, target.bag);
    else {
      const previous = itemAt(target);
      player = previous ? equipItem(player, previous.id, source.equipment) : unequipItem(player, source.equipment);
      if (previous) bagPositions.delete(previous.id);
      bagPositions.set(item.id, target.bag);
    }
    selectedBagSlot = target.bag;
  }
}

function selectBagSlot(position: number): void {
  selectedBagSlot = position;
  document.querySelectorAll<HTMLElement>('[data-bag-slot]').forEach((cell) => {
    const selected = Number(cell.dataset.bagSlot) === position;
    cell.classList.toggle('selected', selected);
    cell.setAttribute('aria-selected', String(selected));
    cell.tabIndex = selected ? 0 : -1;
  });
}

function clearDropHighlight(): void {
  document.querySelectorAll('.drop-allowed, .drop-blocked').forEach((cell) => cell.classList.remove('drop-allowed', 'drop-blocked'));
}

function highlightDrop(element: Element | null): ItemLocation | null {
  clearDropHighlight();
  const target = itemLocation(element);
  if (target && draggedItem) element?.closest('[data-bag-slot], [data-equipment-slot]')?.classList.add(canDropItem(draggedItem, target) ? 'drop-allowed' : 'drop-blocked');
  return target;
}

let suppressTouchClick = false;
let touchDrag: { pointerId: number; source: ItemLocation; x: number; y: number; element: HTMLElement; ghost: HTMLElement | null } | null = null;

function cancelItemDrag(): void {
  draggedItem = null;
  touchDrag?.ghost?.remove();
  touchDrag = null;
  clearDropHighlight();
  document.querySelectorAll('.item-dragging').forEach((cell) => cell.classList.remove('item-dragging'));
}

function finishItemDrag(target: ItemLocation | null): void {
  if (draggedItem && target) transferItem(draggedItem, target);
  cancelItemDrag();
  refreshInventory();
  refreshEquipment();
}

document.addEventListener('dragstart', (event) => {
  const element = event.target;
  if (!(element instanceof Element)) return;
  const source = itemLocation(element);
  if (!source || !itemAt(source) || !event.dataTransfer) return;
  draggedItem = source;
  if ('bag' in source) selectBagSlot(source.bag);
  element.closest('[draggable]')?.classList.add('item-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', itemAt(source)!.id);
});
document.addEventListener('dragover', (event) => {
  if (!draggedItem || !(event.target instanceof Element)) return;
  const target = highlightDrop(event.target);
  if (target) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = canDropItem(draggedItem, target) ? 'move' : 'none';
  }
});
document.addEventListener('dragleave', (event) => {
  if (event.target instanceof Element && !event.target.closest('[data-bag-slot], [data-equipment-slot]')?.contains(event.relatedTarget as Node | null)) clearDropHighlight();
});
document.addEventListener('drop', (event) => {
  if (!draggedItem) return;
  event.preventDefault();
  finishItemDrag(event.target instanceof Element ? itemLocation(event.target) : null);
});
document.addEventListener('dragend', () => { if (draggedItem) finishItemDrag(null); });

// 触屏使用指针拖动；鼠标保留浏览器原生拖放。
document.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'mouse' || !event.isPrimary || !(event.target instanceof Element)) return;
  const source = itemLocation(event.target);
  if (!source || !itemAt(source)) return;
  touchDrag = { pointerId: event.pointerId, source, x: event.clientX, y: event.clientY, element: event.target.closest<HTMLElement>('[draggable]')!, ghost: null };
});
document.addEventListener('pointermove', (event) => {
  if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
  if (!draggedItem && Math.hypot(event.clientX - touchDrag.x, event.clientY - touchDrag.y) < 8) return;
  event.preventDefault();
  if (!draggedItem) {
    inventoryMenu.close();
    draggedItem = touchDrag.source;
    if ('bag' in draggedItem) selectBagSlot(draggedItem.bag);
    touchDrag.element.classList.add('item-dragging');
    touchDrag.ghost = document.createElement('div');
    touchDrag.ghost.className = 'item-drag-ghost';
    touchDrag.ghost.setAttribute('aria-hidden', 'true');
    touchDrag.ghost.textContent = itemAt(draggedItem)!.name;
    document.body.append(touchDrag.ghost);
  }
  touchDrag.ghost!.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`;
  highlightDrop(document.elementFromPoint(event.clientX, event.clientY));
}, { passive: false });
document.addEventListener('pointerup', (event) => {
  if (!touchDrag || touchDrag.pointerId !== event.pointerId) return;
  if (draggedItem) {
    event.preventDefault();
    suppressTouchClick = true;
    window.setTimeout(() => { suppressTouchClick = false; }, 0);
    finishItemDrag(itemLocation(document.elementFromPoint(event.clientX, event.clientY)));
  } else touchDrag = null;
});
document.addEventListener('pointercancel', () => { if (touchDrag) finishItemDrag(null); });
window.addEventListener('blur', () => { if (draggedItem || touchDrag) finishItemDrag(null); });

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const location = itemLocation(event.target);
  if (!location) return;
  if (suppressTouchClick) { event.preventDefault(); return; }
  if ('bag' in location) selectBagSlot(location.bag);
  else if (selectedBagSlot !== null) {
    const bag = { bag: selectedBagSlot };
    if (itemAt(bag)) transferItem(bag, location);
    else transferItem(location, bag);
    refreshInventory();
    refreshEquipment();
  }
});
document.addEventListener('keydown', (event) => {
  if (!(event.target instanceof Element)) return;
  const location = itemLocation(event.target);
  if (!location) return;
  if (event.key === 'Escape') { finishItemDrag(null); return; }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    (event.target as HTMLElement).click();
  } else if ('bag' in location && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const grid = document.querySelector<HTMLElement>('.inventory-grid')!;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key]!;
    const start = inventoryPageIndex * INVENTORY_PAGE_SIZE;
    const position = Math.max(start, Math.min(start + INVENTORY_PAGE_SIZE - 1, location.bag + offset));
    selectBagSlot(position);
    document.querySelector<HTMLElement>(`[data-bag-slot="${position}"]`)?.focus();
  } else if ('equipment' in location && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    inventoryPageState();
    let position = inventoryPageIndex * INVENTORY_PAGE_SIZE;
    const occupied = new Set(bagPositions.values());
    while (occupied.has(position)) position++;
    transferItem(location, { bag: position });
    refreshInventory();
    refreshEquipment();
  }
});

const inventoryMenu = inventoryContextMenu({
  item: (id) => player.inventory.find((item) => item.id === id),
  select: selectBagSlot,
  actions: (item) => {
    const equipment = equipmentSlotForItem(player, item.id) !== null;
    return [
      { id: 'equip', label: '装备', enabled: equipment },
      { id: 'decompose', label: '分解', enabled: equipment },
      { id: 'sell', label: '出售', enabled: equipment },
    ];
  },
  activate: (action, itemId) => {
    const position = bagPositions.get(itemId);
    if (position === undefined) return;
    if (action === 'equip') {
      const slot = equipmentSlotForItem(player, itemId);
      if (slot !== null) transferItem({ bag: position }, { equipment: slot });
    } else {
      player = removeInventoryEquipment(player, itemId);
      bagPositions.delete(itemId);
    }
    refreshInventory();
    refreshEquipment();
    document.querySelector<HTMLElement>(`[data-bag-slot="${position}"]`)?.focus({ preventScroll: true });
  },
});

window.addEventListener('hashchange', () => render(true));
render();
// 战斗计时只启动一次，切换页面或突破不会追加计时器、重置攻击间隔。
window.setInterval(performAttack, 1000 / player.stats!.attackSpeed);
window.setInterval(() => {
  const previous = player.health;
  player = regeneratePlayer(player, 1);
  if (player.health !== previous) refreshPlayerHealth();
  if (retreat) {
    const result = resolveRetreat(retreat, performance.now(), Math.random);
    if (result.outcome === 'waiting') {
      refreshPlayerProgress();
    } else {
      if (result.outcome === 'success') {
        const breakthrough = settleSuccessfulBreakthrough(player.stage, player.cultivation);
        player = { ...player, stage: breakthrough.stage, cultivation: breakthrough.cultivation, stats: breakthrough.stats };
        combatFeedback = `闭关成功，当前境界 ${stageLabel(player.stage)}。`;
      } else {
        const loss = retreatConfig(player.stage).failureLoss;
        player = { ...player, cultivation: cultivationAfterFailedRetreat(player.cultivation, loss) };
        combatFeedback = `闭关失败，损失 ${integerFormat.format(loss)} 修为，可以重新积累后再试。`;
      }
      retreat = null;
      addCombatLog(combatFeedback, 'breakthrough');
      render();
    }
  }
}, 1000);
