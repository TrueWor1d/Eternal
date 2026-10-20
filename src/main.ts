import './style.css';
import { CONFIRMED_RULES, PENDING_ITEMS } from './game/content.ts';
import { initialPlayer, type InventoryItem } from './game/model.ts';
import { REALMS, caveUnlocked, nextStage, stageLabel, transitionKind } from './game/realms.ts';
import { breakthroughSummary, cultivationReady, regeneratePlayer } from './game/rules.ts';
import { cultivationRequirement, monsterMaxHealth, playerStatsForStage } from './game/balance.ts';
import { advanceMinorStage } from './game/progression.ts';
import { attackEnemy, createNormalEnemy, respawnNormalEnemy } from './game/combat.ts';
import { INVENTORY_PAGE_SIZE, paginateInventory } from './game/inventory.ts';
import { COPPER_COIN } from './game/loot.ts';

type View = 'adventure' | 'inventory' | 'techniques' | 'cave' | 'realms' | 'handbook';
let player = initialPlayer();
let enemy = createNormalEnemy({ realmId: 'qi', stageIndex: 0 });
let normalKills = 0;
let inventoryPageIndex = 0;
let inventoryOpenedPages = 1;
let journalExpanded = false;
let combatFeedback = '自动战斗已开始，空手每秒攻击一次。';
const combatLog: { message: string; kind: 'attack' | 'victory' | 'breakthrough' }[] = [];
const expandedRealms = new Set<string>(['qi']);
const integerFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const rateFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const speedFormat = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const views: { id: View; label: string; icon: string }[] = [
  { id: 'adventure', label: '战斗', icon: 'games' },
  { id: 'inventory', label: '背包', icon: 'backpack' },
  { id: 'techniques', label: '功法', icon: 'book' },
  { id: 'cave', label: '洞府', icon: 'home' },
  { id: 'realms', label: '境界', icon: 'chart' },
  { id: 'handbook', label: '说明', icon: 'document' },
];

// Microsoft Fluent System Icons, bundled locally under the MIT license.
function icon(name: string, className = ''): string {
  return `<img class="icon ${className}" src="./icons/${name}.svg" alt="" aria-hidden="true" />`;
}

// Game Icons (Lorc / Delapouite), CC BY 3.0; attribution bundled with the assets.
function itemIcon(name: string, className = ''): string {
  return `<img class="item-icon ${className}" src="./icons/gear/${name}.svg" alt="" aria-hidden="true" />`;
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
    <a class="brand" href="#adventure" aria-label="修仙，返回战斗">修仙</a>
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
    : minor ? '修为已达标，可以直接突破' : '闭关时长、成功率与失败损失待确认';
  return { next, required, ready, minor, progress, hint };
}

function playerCard(): string {
  const { next, required, ready, minor, progress, hint } = playerProgress();
  const stats = player.stats!;
  return `<aside class="player-column" aria-label="角色信息">
    <section class="character-panel">
      <h2>角色信息</h2>
      <div class="realm-summary"><span class="field-label">境界</span><p class="character-realm">${stageLabel(player.stage)}</p></div>
      <div class="cultivation-summary">
        <div class="cultivation-row"><span>修为</span><strong>${integerFormat.format(Math.floor(player.cultivation))}<small> / ${required === null ? '凡界圆满' : integerFormat.format(required)}</small></strong></div>
        <div class="progress-track" role="progressbar" aria-label="当前修为进度" aria-valuemin="0" aria-valuemax="${required ?? 100}" aria-valuenow="${required === null ? 100 : Math.min(player.cultivation, required)}"><span style="width:${progress}%"></span></div>
        <p class="helper sr-only" id="breakthrough-hint">${hint}</p>
        <button class="button breakthrough-button" data-breakthrough ${ready && minor ? '' : 'disabled'} title="${hint}" aria-describedby="breakthrough-hint">${next === null ? '凡界已圆满' : minor ? '突破' : '闭关突破'}</button>
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
  </aside>`;
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
  return `<div class="battle-column">
    <section class="encounter-panel" aria-label="战斗区域">
      <h2>当前怪物</h2>
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
          <div class="combatant-caption"><h3>${enemy.name}</h3><p>普通怪 · ${stageLabel(enemy.stage)}</p></div>
        </div>
      </div>
      <p class="enemy-reward">击杀获得 ${integerFormat.format(enemy.cultivationReward)} 修为</p>
      <p class="combat-mode">自动战斗 · 空手每秒攻击 ${rateFormat.format(player.stats!.attackSpeed)} 次</p>
    </section>
    <section class="journal-panel" aria-label="最近记录">${journalMarkup()}</section>
  </div>`;
}

function inventoryPageState() {
  const page = paginateInventory(player.inventory, inventoryPageIndex, inventoryOpenedPages);
  inventoryOpenedPages = page.pageCount;
  return page;
}

function inventoryGridMarkup(items: readonly InventoryItem[]): string {
  return Array.from({ length: INVENTORY_PAGE_SIZE }, (_, index) => {
      const item = items[index];
      return item ? `<li class="inventory-slot occupied" title="${escapeHTML(item.name)} ×${integerFormat.format(item.quantity)}" aria-label="${escapeHTML(item.name)}，数量 ${integerFormat.format(item.quantity)}">${item.id === COPPER_COIN.id ? itemIcon('coins', 'coin-icon') : ''}<span>${escapeHTML(item.name)}</span><span class="inventory-quantity">×${integerFormat.format(item.quantity)}</span></li>` : '<li class="inventory-slot" aria-hidden="true"></li>';
    }).join('');
}

function inventoryView(): string {
  const page = inventoryPageState();
  return `<div class="inventory-page">
    <section class="equipment-panel" aria-labelledby="equipment-title">
      <div class="section-title inventory-heading"><h2 id="equipment-title">人物装备</h2></div>
      <p class="page-description">暂无装备。</p>
      <div class="equipment-display">
        <div class="equipment-character"><img class="equipment-sprite pixel-sprite" src="./actors/player.png" alt="装备区像素修真者" draggable="false" /></div>
        <ul class="equipment-grid" aria-label="人物装备槽">${[
          ['头盔', 'helmet'], ['胸甲', 'chest'], ['左护腕', 'bracer'], ['右护腕', 'bracer'],
          ['主武器', 'sword'], ['副武器', 'dagger'], ['左靴', 'boots'], ['右靴', 'boots'],
        ].map(([name, image]) => `<li class="equipment-slot" aria-label="${name}，未装备">${itemIcon(image)}<span class="equipment-name">${name}</span><span class="equipment-empty">未装备</span></li>`).join('')}</ul>
      </div>
    </section>
    <section class="inventory-panel" aria-labelledby="inventory-title">
      <div class="section-title inventory-heading"><h2 id="inventory-title">角色背包</h2><span class="inventory-count">物品种类：${integerFormat.format(player.inventory.length)}</span></div>
      <p class="page-description">存放打怪获得的掉落物品。</p>
      <div class="inventory-storage">
        <ul id="inventory-grid" class="inventory-grid" aria-label="背包物品">${inventoryGridMarkup(page.items)}</ul>
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

function realmsView(): string {
  return `<div class="page-stack"><p class="page-description">凡界共七大境界。炼气分九层，其余境界分为初期、中期、后期、圆满。当前境界：${stageLabel(player.stage)}。</p>
    <p class="page-description">同境界首尾基础属性累计3倍，跨大境界再变为3倍；空手攻速固定为每秒1次。展开境界可查看各阶段数值。</p>
    <div class="realm-path">${REALMS.map((realm, index) => {
      const active = realm.id === player.stage.realmId;
      const expanded = expandedRealms.has(realm.id);
      const rows = realm.stages.map((label, stageIndex) => {
        const stage = { realmId: realm.id, stageIndex };
        const stats = playerStatsForStage(stage);
        const required = cultivationRequirement(stage);
        return `<tr data-stage="${realm.id}-${stageIndex}"><th scope="row">${label}</th><td>${integerFormat.format(stats.maxHealth)}</td><td>${integerFormat.format(stats.attack)}</td><td>${integerFormat.format(stats.defense)}</td><td>${speedFormat.format(stats.attackSpeed)}</td><td>${rateFormat.format(stats.healthRegen)}</td><td>${integerFormat.format(monsterMaxHealth(stage, 'normal'))}</td><td>${integerFormat.format(monsterMaxHealth(stage, 'boss'))}</td><td>${required === null ? '后续世界待定' : `${integerFormat.format(required)}${transitionKind(stage) === 'major' ? '<small>闭关</small>' : ''}`}</td></tr>`;
      }).join('');
      return `<section class="realm-card ${active ? 'current' : ''}"><button class="realm-heading" data-realm="${realm.id}" aria-expanded="${expanded}" aria-controls="stages-${realm.id}"><span class="realm-index">${String(index + 1).padStart(2, '0')}</span><span class="realm-name"><strong>${realm.name}</strong><small>${realm.stages.length === 9 ? '一至九层' : '初期 · 中期 · 后期 · 圆满'}</small></span>${active ? '<span class="tag">当前</span>' : ''}${icon('chevron', 'realm-expand')}</button><div id="stages-${realm.id}" class="realm-details" ${expanded ? '' : 'hidden'}><div class="realm-stages">${realm.stages.map((stage, i) => `<span class="stage-chip ${active && i === player.stage.stageIndex ? 'selected' : ''}">${stage}${active && i === player.stage.stageIndex ? icon('check') : ''}</span>`).join('')}</div><div class="balance-scroll" role="region" aria-label="${realm.name}基础数值" tabindex="0"><table class="balance-table"><caption>角色属性、对应实力的怪物生命与突破修为。怪物攻击暂不配置；表格可横向滚动。</caption><thead><tr><th scope="col">阶段</th><th scope="col">角色生命</th><th scope="col">攻击</th><th scope="col">防御</th><th scope="col">攻速/秒</th><th scope="col">回血/秒</th><th scope="col">普通怪生命</th><th scope="col">首领生命</th><th scope="col">突破修为</th></tr></thead><tbody>${rows}</tbody></table></div></div></section>`;
    }).join('')}</div>
    <section class="panel">${sectionTitle('突破规则')}<dl class="description-list"><div><dt>小阶段</dt><dd>修为达标后直接突破，扣除本阶段所需修为，保留溢出部分。</dd></div><div><dt>大境界</dt><dd>需要闭关读条后判定。时长、成功率与失败损失待确认。</dd></div></dl><p class="page-description">${breakthroughSummary(player.stage)}。</p></section>
  </div>`;
}

function handbookView(): string {
  return `<div class="page-stack"><div class="description-row"><p class="page-description">查看已确认的规则与尚未开放的内容。</p><button class="button secondary" data-open-dialog>待确认内容</button></div><section class="panel">${sectionTitle('已确认规则')}<div class="rules-list">${CONFIRMED_RULES.map((rule) => `<article class="rule-entry"><h3>${rule.title}</h3><p>${rule.detail}</p></article>`).join('')}</div></section><section class="panel">${sectionTitle('待确认内容')}<div class="pending-list">${pendingItems()}</div></section></div>`;
}

function pendingItems(): string {
  return PENDING_ITEMS.map((item) => `<article class="pending-item"><div><h3>${item.title}</h3><p>${item.detail}</p></div><span class="tag">${item.affects}</span></article>`).join('');
}

function pendingDialog(): string {
  return `<dialog id="pending-dialog" aria-labelledby="pending-title"><div class="dialog-heading"><h2 id="pending-title">待确认内容</h2><button class="icon-button" data-close-dialog aria-label="关闭待确认内容">${icon('close')}</button></div><div class="pending-list">${pendingItems()}</div><form method="dialog"><button class="button primary">知道了</button></form></dialog>`;
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
  const { required, ready, minor, hint } = playerProgress();
  const value = document.querySelector<HTMLElement>('.cultivation-row strong');
  if (value) value.innerHTML = `${integerFormat.format(Math.floor(player.cultivation))}<small> / ${required === null ? '凡界圆满' : integerFormat.format(required)}</small>`;
  const helper = document.querySelector<HTMLElement>('.character-panel .helper');
  if (helper) helper.textContent = hint;
  const button = document.querySelector<HTMLButtonElement>('[data-breakthrough]');
  if (button) { button.disabled = !(ready && minor); button.title = hint; }
  updateBar(document.querySelector<HTMLElement>('[role="progressbar"][aria-label="当前修为进度"]'), required === null ? 100 : player.cultivation, required ?? 100);
}

function refreshInventory(): void {
  const grid = document.querySelector<HTMLElement>('.inventory-grid');
  if (!grid) return;
  const page = inventoryPageState();
  grid.innerHTML = inventoryGridMarkup(page.items);
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
  if (reducedMotion.matches) clearHitFeedback();
});

function performAttack(): void {
  const result = attackEnemy(player, enemy);
  player = result.player;
  enemy = result.enemy;
  if (result.defeated) {
    normalKills++;
    combatFeedback = `击败 ${enemy.name}，获得 ${rateFormat.format(result.cultivationGained)} 修为${result.loot ? `、${result.loot.name} ×${integerFormat.format(result.loot.quantity)}` : ''}。`;
    addCombatLog(combatFeedback, 'victory');
    enemy = respawnNormalEnemy(enemy);
  } else {
    combatFeedback = `对 ${enemy.name} 造成 ${rateFormat.format(result.damage)} 点伤害。`;
    addCombatLog(combatFeedback, 'attack');
  }
  if (result.loot) refreshInventory();
  refreshCombat();
  showHitFeedback(result.damage);
}

function render(focusHeading = false): void {
  const view = currentView();
  const selected = views.find((item) => item.id === view)!;
  const pages: Record<View, () => string> = { adventure: combatView, inventory: inventoryView, techniques: techniquesView, cave: caveView, realms: realmsView, handbook: handbookView };
  document.title = `${selected.label} · 修仙`;
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<a href="#main-content" class="skip-link">跳到主要内容</a><div class="app-shell">${sidebar(view)}<main id="main-content" class="workspace" tabindex="-1"><header class="page-heading"><h1 tabindex="-1">${selected.label}</h1></header>${view === 'adventure' ? `<div class="content-layout">${playerCard()}<div class="view-content">${pages[view]()}</div></div>` : `<div class="secondary-content">${pages[view]()}</div>`}<footer class="page-footer">刷新页面会重置进度。</footer></main></div>${pendingDialog()}`;
  if (focusHeading) document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('.skip-link')) {
    event.preventDefault();
    document.querySelector<HTMLElement>('#main-content')?.focus();
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
  if (target.closest('[data-open-dialog]')) document.querySelector<HTMLDialogElement>('#pending-dialog')?.showModal();
  if (target.closest('[data-close-dialog]')) document.querySelector<HTMLDialogElement>('#pending-dialog')?.close();
  const breakthroughButton = target.closest<HTMLButtonElement>('[data-breakthrough]');
  if (breakthroughButton && !breakthroughButton.disabled) {
    const result = advanceMinorStage(player.stage, player.cultivation);
    player.stage = result.stage;
    player.cultivation = result.cultivation;
    player.stats = result.stats;
    combatFeedback = `突破成功，当前境界 ${stageLabel(player.stage)}。`;
    addCombatLog(combatFeedback, 'breakthrough');
    render();
  }
  const realmButton = target.closest<HTMLButtonElement>('[data-realm]');
  if (realmButton) {
    const id = realmButton.dataset.realm!;
    if (expandedRealms.has(id)) expandedRealms.delete(id); else expandedRealms.add(id);
    realmButton.setAttribute('aria-expanded', String(expandedRealms.has(id)));
    const content = document.getElementById(`stages-${id}`);
    if (content) content.hidden = !expandedRealms.has(id);
  }
});
window.addEventListener('hashchange', () => render(true));
render();
// 战斗计时只启动一次，切换页面或突破不会追加计时器、重置攻击间隔。
window.setInterval(performAttack, 1000 / player.stats!.attackSpeed);
window.setInterval(() => {
  const previous = player.health;
  player = regeneratePlayer(player, 1);
  if (player.health !== previous) refreshPlayerHealth();
}, 1000);
