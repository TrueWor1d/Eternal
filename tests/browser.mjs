import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { AREAS } from '../src/game/areas.ts';
import { REALMS, stageLabel } from '../src/game/realms.ts';
import { playerStatsForStage } from '../src/game/balance.ts';
import { retreatConfig } from '../src/game/progression.ts';

// 默认仅在本机临时提供构建产物，关闭测试时一并关闭服务。
const distRoot = resolve('dist');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = process.argv[2] ? null : createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(distRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(distRoot + sep)) { response.writeHead(403).end(); return; }
    const contents = await readFile(file);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream' }).end(contents);
  } catch {
    response.writeHead(404).end();
  }
});
if (server) await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const targetUrl = process.argv[2] ?? `http://127.0.0.1:${server.address().port}/`;
const allowedOrigin = new URL(targetUrl).origin;
const errors = [];
const nonlocal = [];
let browser;

async function openGame(hash = '', reducedMotion = 'reduce', deviceScaleFactor = 1) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion, deviceScaleFactor });
  await page.clock.install({ time: new Date('2026-10-17T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-17T00:00:01Z'));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'file:' && url.protocol !== 'data:' && url.origin !== allowedOrigin) nonlocal.push(request.url());
  });
  // 仅测试页面固定随机数，发行构建使用正常的Math.random。
  await page.addInitScript(() => { Math.random = () => 0.5; });
  const url = new URL(targetUrl);
  url.hash = hash;
  await page.goto(url.href);
  await page.locator('h1').waitFor();
  return page;
}

async function navigate(page, name) {
  await page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
  await page.getByRole('heading', { name, level: 1 }).waitFor();
}

async function checkBattlePositions(page) {
  const player = await page.getByRole('img', { name: '像素修真者主角', exact: true }).boundingBox();
  const wolf = await page.locator('.enemy-portrait').boundingBox();
  const health = await page.getByRole('progressbar', { name: '怪物生命' }).boundingBox();
  assert.ok(player && wolf && health, '角色、灰狼与血条应可见');
  assert.ok(player.x + player.width <= wolf.x, '2D角色应位于灰狼左侧');
  assert.ok(health.y + health.height <= wolf.y, '怪物血条应悬浮在灰狼上方');
  assert.equal(await page.getByRole('progressbar', { name: '怪物生命' }).count(), 1);
}

function overflowingContents(cells) {
  return cells.filter((cell) => {
    const box = cell.getBoundingClientRect();
    return [...cell.querySelectorAll('img, span')].some((child) => {
      let bounds;
      if (child.tagName === 'SPAN') {
        const range = document.createRange();
        range.selectNodeContents(child);
        bounds = [...range.getClientRects()];
      } else bounds = [child.getBoundingClientRect()];
      return bounds.some((rect) => rect.width > 0 && rect.height > 0 && (rect.left < box.left - .5 || rect.right > box.right + .5 || rect.top < box.top - .5 || rect.bottom > box.bottom + .5));
    });
  }).map((cell) => cell.textContent);
}

async function checkInventoryLayout(page, width) {
  const equipment = await page.getByRole('region', { name: '人物装备', exact: true }).boundingBox();
  const inventory = await page.getByRole('region', { name: '角色背包', exact: true }).boundingBox();
  assert.ok(equipment && inventory, '人物装备与角色背包都应显示');
  if (width > 600) assert.ok(equipment.x + equipment.width <= inventory.x, `装备在左、背包在右：${width}px`);
  else assert.ok(equipment.y + equipment.height <= inventory.y, `窄窗口先显示装备，再显示背包：${width}px`);
  const slot = await page.locator('.inventory-slot').first().boundingBox();
  assert.ok(slot && slot.width >= 48 && slot.width <= 56.1 && Math.abs(slot.width - slot.height) <= 1, `背包格子应小巧、方正且可辨认：${width}px`);
  const grid = await page.locator('.inventory-grid').boundingBox();
  const pager = await page.getByRole('navigation', { name: '背包分页', exact: true }).boundingBox();
  assert.ok(grid && pager && pager.y >= grid.y + grid.height, '翻页按钮应在格子正下方');
  assert.ok(Math.abs((pager.x + pager.width / 2) - (grid.x + grid.width / 2)) < 1, '翻页按钮应相对格子居中');
  assert.equal(await page.locator('.inventory-slot').count(), 24);
  assert.equal(await page.locator('.equipment-character, .equipment-sprite').count(), 0, '装备区不再展示人物');
  const slots = await page.locator('.equipment-slot').all();
  assert.equal(slots.length, 10);
  const positions = [[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2],[3,1],[3,2]];
  const boxes = await Promise.all(slots.map((slot) => slot.boundingBox()));
  const origin = boxes[2];
  const firstRow = boxes[0];
  const stepX = boxes[1].x - firstRow.x;
  const stepY = origin.y - firstRow.y;
  assert.ok(origin && firstRow && stepX > 0 && stepY > 0);
  for (const [index, [row, column]] of positions.entries()) {
    const box = boxes[index];
    assert.ok(box && Math.abs(box.x - origin.x - column * stepX) < 1 && Math.abs(box.y - firstRow.y - row * stepY) < 1, `装备槽应位于指定行列：${index}, ${width}px`);
    assert.ok(Math.abs(box.width - firstRow.width) < 1 && Math.abs(box.height - firstRow.height) < 1, '装备槽尺寸一致');
  }

}

try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  await mkdir('artifacts', { recursive: true });
  const page = await openGame();
  assert.deepEqual(await page.getByRole('navigation', { name: '游戏主导航', exact: true }).getByRole('link').allTextContents(), ['战斗', '背包', '功法', '洞府']);
  assert.equal(await page.locator('a[href="#realms"], a[href="#handbook"], #pending-dialog, [data-open-dialog], [data-realm]').count(), 0, '移除境界与说明入口、资料页和规则弹窗');
  const enemyHealth = page.getByRole('progressbar', { name: '怪物生命' });
  const cultivation = page.getByRole('progressbar', { name: '当前修为进度' });
  assert.equal(await page.locator('.sidebar > .player-column').count(), 1, '角色信息应位于最左侧栏顶部');
  assert.equal(await page.locator('.workspace .player-column').count(), 0, '主内容区不再重复显示角色信息');
  const playerCard = await page.locator('.sidebar .player-column').boundingBox();
  const sidebarNavigation = await page.getByRole('navigation', { name: '游戏主导航', exact: true }).boundingBox();
  assert.ok(playerCard && sidebarNavigation && playerCard.y < 80 && playerCard.y + playerCard.height <= sidebarNavigation.y, '角色信息位于左栏上方、导航位于其下方');
  assert.ok(sidebarNavigation.y + sidebarNavigation.height <= 768, '紧凑左栏应在桌面首屏完整显示全部导航');
  assert.equal(await page.getByRole('button', { name: /^攻击/ }).count(), 0, '不得保留手动攻击入口');
  assert.equal(await page.getByRole('checkbox').count(), 0, '自动攻击不再需要开关');
  assert.equal(await page.locator('[data-attack], [data-auto-attack]').count(), 0);
  assert.equal(await page.locator('.enemy-reward, .combat-mode, [data-level-goal]').count(), 0, '战斗区移除击杀奖励、自动攻击说明和清怪提示三行文字');
  assert.equal(await page.getByRole('button', { name: '突破', exact: true }).isDisabled(), true);
  assert.equal(await page.locator('[data-challenge-boss]').isDisabled(), true);
  assert.deepEqual(await page.locator('.attribute-list dd').allTextContents(), ['100 / 100', '10', '2', '1.0 次/秒', '1 点/秒']);
  assert.equal(await page.getByRole('heading', { name: '尖牙野鼠', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('img', { name: '测试用小灰狼2D立绘' }).isVisible(), true);
  assert.equal(await page.locator('.player-sprite').evaluate((image) => getComputedStyle(image).imageRendering), 'pixelated');
  assert.equal(await page.locator('.enemy-sprite').evaluate((image) => getComputedStyle(image).imageRendering), 'pixelated');
  assert.equal(await page.locator('h1').evaluate((element) => getComputedStyle(element).fontSize), '28px');
  assert.equal(await page.locator('.player-sprite').evaluate((element) => getComputedStyle(element).height), '208px');
  assert.equal(await page.locator('.nav-item.active').evaluate((element) => getComputedStyle(element).color), 'rgb(149, 189, 166)');
  await checkBattlePositions(page);
  assert.deepEqual(await page.locator('.enemy-portrait').evaluate((element) => ({ tag: element.tagName, tabIndex: element.tabIndex })), { tag: 'DIV', tabIndex: -1 });
  await page.locator('.enemy-portrait').click({ clickCount: 5 });
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60', '点击立绘不得造成伤害');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgb(33, 33, 33)');
  assert.equal(await page.locator('.sidebar').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(23, 23, 23)');
  assert.deepEqual(await page.locator('img').evaluateAll((images) => images.filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src)), []);
  const breakthrough = await page.getByRole('button', { name: '突破', exact: true }).boundingBox();
  assert.ok(breakthrough && breakthrough.y + breakthrough.height <= 768, '突破应完整出现在首屏');
  const currentEncounter = await page.getByRole('region', { name: '战斗区域', exact: true }).boundingBox();
  assert.ok(currentEncounter && currentEncounter.y + currentEncounter.height <= 768, '当前战斗与首领进度应完整出现在首屏');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/sidebar-compact-desktop.png' });
  await page.screenshot({ path: 'artifacts/auto-combat-desktop.png', fullPage: true });

  await page.clock.runFor(999);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60', '不足一秒不攻击');
  await page.clock.runFor(1);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '50', '满一秒自动造成原单次10点伤害');
  assert.equal(await page.locator('.damage-number').count(), 0, '减少动态效果时不显示浮字');
  assert.equal(await page.locator('.enemy-sprite').evaluate((element) => element.getAnimations().length), 0, '减少动态效果时不闪烁');
  assert.equal(await cultivation.getAttribute('aria-valuenow'), '0');
  await page.clock.runFor(5000);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60');
  assert.equal(await cultivation.getAttribute('aria-valuenow'), '10');
  assert.equal(await page.locator('.count-label').textContent(), '已击败 1 只');
  assert.equal(await page.locator('[data-combat-feedback]').textContent(), '击败 尖牙野鼠，获得 10 修为。');
  const journalToggle = page.locator('[data-journal-toggle]');
  await journalToggle.click();
  await page.clock.runFor(1000);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '50');
  assert.equal(await journalToggle.evaluate((button) => document.activeElement === button), true);
  assert.equal(await page.getByRole('list', { name: '战斗记录' }).isVisible(), true);
  await journalToggle.click();

  await navigate(page, '背包');
  assert.equal(await page.getByRole('heading', { name: '角色背包', level: 2 }).isVisible(), true);
  assert.equal(await page.locator('.sidebar .player-column').isVisible(), true, '切换页面后角色信息仍在最左栏');
  assert.deepEqual(await page.locator('.equipment-name').allTextContents(), ['头盔', '项链', '主武器', '胸甲', '副武器', '护腕', '裤子', '戒指', '鞋子', '戒指']);
  assert.equal(await page.getByRole('img', { name: '装备区像素修真者', exact: true }).count(), 0);
  assert.equal(await page.getByRole('list', { name: '人物装备槽', exact: true }).getByRole('button').count(), 10);
  assert.equal(await page.locator('.equipment-empty').filter({ hasText: '未装备' }).count(), 10);
  assert.deepEqual(await page.locator('.equipment-slot .item-icon').evaluateAll((images) => images.map((image) => image.getAttribute('src'))), ['helmet', 'necklace', 'sword', 'chest', 'dagger', 'bracer', 'pants', 'ring', 'boots', 'ring'].map((name) => `./icons/gear/${name}.svg`));
  assert.equal(await page.locator('.equipment-panel').getByRole('button').count(), 10);
  await checkInventoryLayout(page, 1366);
  assert.equal(await page.locator('.inventory-empty').isVisible(), false);
  assert.equal(await page.locator('.inventory-slot[draggable="true"]').count(), 10);
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：10');
  assert.equal(await page.locator('.inventory-slot.occupied').count(), 10);
  const previousPage = page.getByRole('button', { name: '上一页', exact: true });
  const nextPage = page.getByRole('button', { name: '下一页', exact: true });
  assert.equal(await previousPage.isDisabled(), true);
  assert.equal(await page.locator('.inventory-page-label').textContent(), '1 / 1');
  await nextPage.click();
  assert.equal(await page.locator('.inventory-page-label').textContent(), '2 / 2');
  assert.equal(await page.getByRole('status').textContent(), '本页暂无物品');
  assert.equal(await nextPage.evaluate((button) => document.activeElement === button), true);
  await nextPage.click();
  assert.equal(await page.locator('.inventory-page-label').textContent(), '3 / 3');
  await previousPage.click();
  await navigate(page, '战斗');
  await navigate(page, '背包');
  assert.equal(await page.locator('.inventory-page-label').textContent(), '2 / 3', '切换页面应保留当前背包页');
  await previousPage.click();
  assert.equal(await previousPage.isDisabled(), true);
  assert.equal(await page.locator('.inventory-page-label').textContent(), '1 / 3');
  await page.locator('.skip-link').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => location.hash), '#inventory');
  assert.equal(await page.locator('main').evaluate((main) => main === document.activeElement), true);
  await page.clock.runFor(5000);
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：10');
  // 多次导航不能创建新的攻击计时器。
  for (let i = 0; i < 3; i++) { await navigate(page, '战斗'); await navigate(page, '背包'); }
  await navigate(page, '战斗');
  assert.equal(await cultivation.getAttribute('aria-valuenow'), '20');
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60');
  await page.clock.runFor(1000);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '50');
  await page.clock.runFor(53_000);
  assert.equal(await page.locator('.cultivation-row strong').textContent(), '110 / 100');
  assert.equal(await page.locator('[data-breakthrough]').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(149, 189, 166)', '可突破状态使用玉青色');
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60');
  // 在半个攻击间隔时突破，下一击仍应在原来的一秒边界发生。
  await page.clock.runFor(500);
  await page.getByRole('button', { name: '突破', exact: true }).click();
  assert.equal(await page.locator('.character-realm').textContent(), '炼气期 · 二层');
  assert.equal(await cultivation.getAttribute('aria-valuenow'), '10');
  assert.equal(await cultivation.getAttribute('aria-valuemax'), '200');
  assert.equal(await page.locator('.attribute-list dd').nth(3).textContent(), '1.0 次/秒');
  await page.clock.runFor(499);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60');
  await page.clock.runFor(1);
  assert.ok(Math.abs(Number(await enemyHealth.getAttribute('aria-valuenow')) - (60 - 10 * 3 ** (1 / 8))) < 1e-10, '伤害继续按成长后的角色攻击值结算');
  await page.clock.runFor(5000);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '60');
  assert.equal(await cultivation.getAttribute('aria-valuenow'), '20');
  const playerHealth = Number(await page.getByRole('meter', { name: '角色生命' }).getAttribute('aria-valuenow'));
  assert.ok(Math.abs(playerHealth - (100 + 6 * 3 ** (1 / 8))) < 1e-10, '突破后沿用成长后的回血，怪物不造成伤害');

  await navigate(page, '功法');
  assert.equal(await page.getByText('采用分类功法槽位', { exact: true }).isVisible(), true);
  await navigate(page, '洞府');
  assert.equal(await page.getByRole('button', { name: '升级洞府' }).isDisabled(), true);
  for (const width of [1920, 1440, 1366, 1024, 768, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const view of ['adventure', 'inventory', 'techniques', 'cave']) {
      await page.evaluate((hash) => { location.hash = hash; }, view);
      await page.locator(`nav a[href="#${view}"][aria-current="page"]`).waitFor();
      const sizes = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(sizes.scroll <= sizes.width, `页面溢出：${view}, ${width}px, scroll=${sizes.scroll}`);
      if (view === 'adventure') await checkBattlePositions(page);
      if (view === 'inventory') await checkInventoryLayout(page, width);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await navigate(page, '战斗');
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/auto-combat-mobile.png', fullPage: true });
  await page.screenshot({ path: 'artifacts/sidebar-compact-mobile.png' });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  await navigate(page, '背包');
  await nextPage.click();
  await page.clock.runFor(6000);
  assert.equal(await page.locator('.inventory-page-label').textContent(), '2 / 3', '掉落不得强制跳回其他背包页');
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：11');
  assert.equal(await page.locator('.inventory-slot.occupied').count(), 0);
  assert.equal(await page.getByRole('status').textContent(), '本页暂无物品');
  assert.equal(await nextPage.evaluate((button) => document.activeElement === button), true, '掉落刷新不得重建翻页按钮或夺取焦点');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/inventory-empty-page.png', fullPage: true });
  await previousPage.click();
  assert.equal(await page.getByRole('option', { name: '铜钱，数量 2', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.inventory-empty').isVisible(), false);
  await navigate(page, '战斗');
  assert.match(await page.locator('[data-combat-feedback]').textContent(), /铜钱 ×2/);
  await page.evaluate(() => { const rolls = [0.199999, 0.999999]; Math.random = () => rolls.shift() ?? 0.5; });
  await navigate(page, '背包');
  await page.clock.runFor(6000);
  assert.equal(await page.getByRole('option', { name: '铜钱，数量 7', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.inventory-quantity').textContent(), '×7');
  assert.equal(await page.locator('.inventory-slot .coin-icon').getAttribute('src'), './icons/gear/coins.svg');
  await page.locator('.item-icon').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：11');
  assert.equal(await page.locator('.inventory-slot.occupied').count(), 11);
  assert.equal(await page.locator('.equipment-empty').filter({ hasText: '未装备' }).count(), 10, '铜钱掉落不得改变装备槽');
  await page.clock.runFor(6000);
  assert.equal(await page.locator('.inventory-quantity').textContent(), '×7');
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/inventory-coins.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/inventory-coins-mobile.png', fullPage: true });

  for (const removed of ['realms', 'handbook']) {
    const removedPage = await openGame(removed);
    assert.equal(await removedPage.getByRole('heading', { name: '战斗', level: 1 }).isVisible(), true, '旧资料页地址回到战斗');
    assert.deepEqual(await removedPage.getByRole('navigation', { name: '游戏主导航', exact: true }).getByRole('link').allTextContents(), ['战斗', '背包', '功法', '洞府']);
    assert.equal(await removedPage.locator('.realm-card, .rules-list, .pending-list, #pending-dialog, [data-realm]').count(), 0, '已删除页面不能通过旧地址显示');
    assert.equal(await removedPage.locator('.character-realm').textContent(), '炼气期 · 一层', '保留角色当前境界');
    await removedPage.clock.runFor(1000);
    assert.equal(await removedPage.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), '50', '旧地址回退后自动战斗正常');
    await removedPage.close();
  }

  const inventoryStart = await openGame('inventory');
  await inventoryStart.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  await inventoryStart.clock.runFor(6000);
  assert.equal(await inventoryStart.getByRole('option', { name: '铜钱，数量 2', exact: true }).isVisible(), true, '从背包页面打开游戏也应自动战斗');
  await navigate(inventoryStart, '战斗');
  assert.equal(await inventoryStart.getByRole('progressbar', { name: '当前修为进度' }).getAttribute('aria-valuenow'), '10');
  assert.equal(await inventoryStart.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), '60');
  await inventoryStart.close();

  const gear = await openGame('inventory');
  const bagItem = (id) => gear.locator(`.inventory-slot[data-item-id="test_${id}"]`);
  const equipmentSlot = (id) => gear.locator(`[data-equipment-slot="${id}"]`);
  const bagSlot = (position) => gear.locator(`[data-bag-slot="${position}"]`);
  await bagItem('helmet').click();
  assert.equal(await bagItem('helmet').getAttribute('aria-selected'), 'true');
  assert.equal(await bagItem('helmet').evaluate((cell) => getComputedStyle(cell, '::after').borderImageSource.includes('selection-corners.svg')), true);
  assert.equal(await bagItem('helmet').evaluate((cell) => getComputedStyle(cell).getPropertyValue('--rarity-color').trim()), '#F0F0F0');
  await bagItem('helmet').dragTo(equipmentSlot('boots'));
  assert.equal(await bagItem('helmet').count(), 1, '错误部位拖放保留原物品');
  assert.equal(await gear.locator('.equipment-slot.equipped').count(), 0);
  await bagItem('helmet').dragTo(equipmentSlot('helmet'));
  assert.equal(await equipmentSlot('helmet').getAttribute('data-item-id'), 'test_helmet');
  assert.equal(await gear.locator('.inventory-slot.occupied').count(), 9);
  await equipmentSlot('helmet').dragTo(bagSlot(23));
  assert.equal(await bagSlot(23).getAttribute('data-item-id'), 'test_helmet');
  assert.equal(await bagSlot(23).getAttribute('aria-selected'), 'true');
  await bagSlot(23).dragTo(bagSlot(1));
  assert.equal(await bagSlot(1).getAttribute('data-item-id'), 'test_helmet');
  assert.equal(await bagSlot(23).getAttribute('data-item-id'), 'test_necklace');
  await bagItem('helmet').dragTo(equipmentSlot('helmet'));
  for (const id of ['necklace', 'main', 'chest', 'offhand', 'bracer', 'pants', 'ring-one', 'boots', 'ring-two']) {
    await bagItem(id).dragTo(equipmentSlot(id));
  }
  assert.equal(await gear.locator('.equipment-slot.equipped').count(), 10);
  assert.equal(await gear.locator('.inventory-slot.occupied').count(), 0);
  assert.equal(await gear.locator('.inventory-empty').textContent(), '背包为空');
  assert.deepEqual(await gear.locator('.attribute-list dd').allTextContents(), ['100 / 100', '10', '2', '1.0 次/秒', '1 点/秒']);
  await equipmentSlot('ring-one').dragTo(equipmentSlot('ring-two'));
  assert.equal(await equipmentSlot('ring-two').getAttribute('data-item-id'), 'test_ring-one');
  await equipmentSlot('ring-one').dragTo(bagSlot(23));
  await equipmentSlot('ring-two').dragTo(bagSlot(23));
  assert.equal(await bagSlot(23).getAttribute('data-item-id'), 'test_ring-one');
  assert.equal(await equipmentSlot('ring-two').getAttribute('data-item-id'), 'test_ring-two');
  await equipmentSlot('helmet').dragTo(bagSlot(23));
  assert.equal(await equipmentSlot('helmet').getAttribute('data-item-id'), 'test_helmet', '错误部位不能交换，物品不丢失');
  // 拖动中收到新掉落：保留源DOM，结束后同时显示掉落和装备位置。
  await gear.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  const dragData = await gear.evaluateHandle(() => new DataTransfer());
  await bagSlot(23).dispatchEvent('dragstart', { dataTransfer: dragData });
  await gear.clock.runFor(6000);
  assert.equal(await bagSlot(23).getAttribute('data-item-id'), 'test_ring-one');
  await equipmentSlot('ring-one').dispatchEvent('drop', { dataTransfer: dragData });
  assert.equal(await equipmentSlot('ring-one').getAttribute('data-item-id'), 'test_ring-one');
  assert.equal(await gear.getByRole('option', { name: '铜钱，数量 2', exact: true }).isVisible(), true);
  await equipmentSlot('helmet').focus();
  await gear.keyboard.press('Delete');
  assert.equal(await bagItem('helmet').count(), 1, '键盘可卸下装备');
  await bagItem('helmet').click();
  await equipmentSlot('helmet').focus();
  await gear.keyboard.press('Enter');
  assert.equal(await equipmentSlot('helmet').getAttribute('data-item-id'), 'test_helmet', '键盘可穿戴选中装备');
  await equipmentSlot('necklace').dragTo(bagSlot(1));
  await bagSlot(1).click();
  await bagSlot(1).focus();
  await gear.keyboard.press('ArrowRight');
  assert.equal(await bagSlot(2).getAttribute('aria-selected'), 'true');
  assert.equal(await bagSlot(2).evaluate((cell) => cell === document.activeElement), true);
  // 真实触摸事件验证指针拖放和结束后的合成点击不会撤销穿戴。
  const touchSession = await gear.context().newCDPSession(gear);
  const from = await bagItem('necklace').boundingBox();
  const to = await equipmentSlot('necklace').boundingBox();
  const point = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(to)] });
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await gear.clock.runFor(1);
  assert.equal(await equipmentSlot('necklace').getAttribute('data-item-id'), 'test_necklace');
  assert.equal(await gear.locator('.item-drag-ghost, .item-dragging, .drop-allowed, .drop-blocked').count(), 0);
  await touchSession.detach();
  // 截图包含已穿戴、背包测试装备及选中状态。
  for (const id of ['main', 'offhand', 'bracer', 'pants', 'ring-one', 'boots', 'ring-two']) {
    await equipmentSlot(id).focus();
    await gear.keyboard.press('Delete');
  }
  await bagItem('main').click();
  await gear.mouse.move(0, 0);
  await gear.screenshot({ path: 'artifacts/equipment-drag-desktop.png', fullPage: true });
  for (const width of [1920, 1024, 768, 700, 390, 320]) {
    await gear.setViewportSize({ width, height: 950 });
    await checkInventoryLayout(gear, width);
    assert.equal(await gear.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.deepEqual(await gear.locator('.gear-item, .equipment-slot.equipped').evaluateAll(overflowingContents), [], '装备文字应完整放在格内');
  }
  await gear.setViewportSize({ width: 390, height: 844 });
  await gear.screenshot({ path: 'artifacts/equipment-drag-mobile.png', fullPage: true });
  assert.equal(await gear.locator('[data-item-id^="test_"]').count(), 10, '全部操作后10件装备守恒');
  await navigate(gear, '战斗');
  await navigate(gear, '背包');
  assert.equal(await equipmentSlot('helmet').getAttribute('data-item-id'), 'test_helmet', '切换页面保留穿戴');
  assert.equal(await bagItem('main').getAttribute('aria-selected'), 'true', '切换页面保留选择边框');
  await gear.close();

  const itemMenuPage = await openGame('inventory');
  const menu = itemMenuPage.getByRole('menu');
  const menuItem = (label) => menu.getByRole('menuitem', { name: label, exact: true });
  const menuBag = (id) => itemMenuPage.locator(`.inventory-slot[data-item-id="test_${id}"]`);
  await menuBag('helmet').click({ button: 'right' });
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['装备', '分解', '出售']);
  assert.equal(await menuBag('helmet').getAttribute('aria-selected'), 'true');
  assert.equal(await menuBag('helmet').getAttribute('aria-expanded'), 'true');
  assert.equal(await menuItem('装备').evaluate((button) => document.activeElement === button), true);
  const menuBounds = await menu.boundingBox();
  const itemBounds = await menuBag('helmet').boundingBox();
  assert.ok(menuBounds.x >= itemBounds.x + itemBounds.width, '菜单显示在物品右侧');
  const actionBounds = await Promise.all(['装备', '分解', '出售'].map((name) => menuItem(name).boundingBox()));
  assert.ok(actionBounds[0].y < actionBounds[1].y && actionBounds[1].y < actionBounds[2].y, '三项操作由上到下排列');
  await itemMenuPage.screenshot({ path: 'artifacts/inventory-menu-desktop.png', fullPage: true });
  await itemMenuPage.keyboard.press('ArrowDown');
  assert.equal(await menuItem('分解').evaluate((button) => document.activeElement === button), true);
  await itemMenuPage.keyboard.press('End');
  assert.equal(await menuItem('出售').evaluate((button) => document.activeElement === button), true);
  await itemMenuPage.keyboard.press('Escape');
  assert.equal(await menu.count(), 0);
  assert.equal(await menuBag('helmet').evaluate((cell) => document.activeElement === cell), true);
  await itemMenuPage.keyboard.press('Shift+F10');
  assert.equal(await menu.count(), 1, '键盘可打开物品菜单');
  await menuItem('装备').click();
  assert.equal(await itemMenuPage.locator('[data-equipment-slot="helmet"]').getAttribute('data-item-id'), 'test_helmet');
  assert.equal(await menu.count(), 0);
  assert.equal(await itemMenuPage.locator('.inventory-slot.occupied').count(), 9);
  // 两枚戒指优先进入不同空槽。
  for (const id of ['ring-two', 'ring-one']) {
    await menuBag(id).click({ button: 'right' });
    await menuItem('装备').click();
  }
  assert.equal(await itemMenuPage.locator('[data-equipment-slot="ring-one"]').getAttribute('data-item-id'), 'test_ring-two');
  assert.equal(await itemMenuPage.locator('[data-equipment-slot="ring-two"]').getAttribute('data-item-id'), 'test_ring-one');
  // 卸下后可通过菜单再次装备。
  await itemMenuPage.locator('[data-equipment-slot="ring-two"]').dragTo(itemMenuPage.locator('[data-bag-slot="23"]'));
  await menuBag('ring-one').click({ button: 'right' });
  await menuItem('装备').click();
  assert.equal(await menuBag('ring-one').count(), 0);
  // 打开菜单期间掉落保留菜单焦点和选中物品。
  await menuBag('chest').click({ button: 'right' });
  await itemMenuPage.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  await itemMenuPage.clock.runFor(6000);
  assert.equal(await menu.count(), 1);
  assert.equal(await menuItem('装备').evaluate((button) => document.activeElement === button), true);
  assert.equal(await menuBag('chest').getAttribute('aria-expanded'), 'true');
  assert.equal(await itemMenuPage.locator('.inventory-quantity').textContent(), '×2');
  await menuItem('分解').click();
  assert.equal(await menuBag('chest').count(), 0);
  assert.equal(await itemMenuPage.locator('[data-equipment-slot="chest"]').getAttribute('data-item-id'), null);
  assert.equal(await itemMenuPage.locator('.inventory-quantity').textContent(), '×2', '分解不发放铜钱');
  await menuBag('offhand').click({ button: 'right' });
  await menuItem('出售').click();
  assert.equal(await menuBag('offhand').count(), 0);
  assert.equal(await itemMenuPage.locator('.inventory-quantity').textContent(), '×2', '出售暂不发放铜钱');
  assert.equal(await itemMenuPage.locator('[data-item-id^="test_"]').count(), 8, '只移除分解与出售的两件装备');
  assert.equal(await itemMenuPage.locator('.inventory-slot.selected').getAttribute('data-bag-slot'), '4');
  // 空格不显示物品菜单；非装备的三个操作不可执行。
  await itemMenuPage.locator('[data-bag-slot="4"]').click({ button: 'right' });
  assert.equal(await menu.count(), 0);
  await itemMenuPage.getByRole('option', { name: '铜钱，数量 2', exact: true }).click({ button: 'right' });
  assert.equal(await menu.getByRole('menuitem').count(), 3);
  for (const name of ['装备', '分解', '出售']) assert.equal(await menuItem(name).isDisabled(), true);
  await itemMenuPage.keyboard.press('Escape');
  await menuBag('main').click({ button: 'right' });
  await itemMenuPage.locator('h1').click();
  assert.equal(await menu.count(), 0, '点击空白处关闭菜单');
  await menuBag('main').click({ button: 'right' });
  await itemMenuPage.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await menu.count(), 0, '翻页关闭菜单');
  await itemMenuPage.getByRole('button', { name: '上一页', exact: true }).click();
  await menuBag('main').click({ button: 'right' });
  await navigate(itemMenuPage, '战斗');
  assert.equal(await menu.count(), 0, '切换页面关闭菜单');
  await navigate(itemMenuPage, '背包');
  await menuBag('main').click({ button: 'right' });
  await menuBag('main').dragTo(itemMenuPage.locator('[data-equipment-slot="main"]'));
  assert.equal(await menu.count(), 0, '拖动开始关闭菜单');
  assert.equal(await itemMenuPage.locator('[data-equipment-slot="main"]').getAttribute('data-item-id'), 'test_main');
  // 窄屏右侧空间不足时自动换侧，菜单不越出视口。
  for (const width of [1920, 1024, 768, 700, 390, 320]) {
    await itemMenuPage.setViewportSize({ width, height: 950 });
    await menuBag('pants').click({ button: 'right' });
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 950, `菜单在视口内：${width}px`);
    assert.equal(await itemMenuPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await itemMenuPage.keyboard.press('Escape');
  }
  await itemMenuPage.setViewportSize({ width: 390, height: 844 });
  await menuBag('pants').click({ button: 'right' });
  await itemMenuPage.screenshot({ path: 'artifacts/inventory-menu-mobile.png' });
  await itemMenuPage.close();

  const rarityPage = await openGame('inventory');
  const rarityItems = rarityPage.locator('.inventory-slot.occupied');
  const expectedRarities = ['common', 'ordinary', 'rare', 'scarce', 'precious', 'peerless'];
  const expectedColors = ['#F0F0F0', '#55C77A', '#549EFC', '#AF7CFA', '#E8BE54', '#EB5F60'];
  assert.deepEqual((await rarityItems.evaluateAll((cells) => cells.map((cell) => cell.dataset.rarity))).slice(0, 6), expectedRarities);
  assert.deepEqual((await rarityItems.evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).getPropertyValue('--rarity-color').trim()))).slice(0, 6), expectedColors);
  for (const cell of await rarityItems.all()) {
    assert.deepEqual(await cell.evaluate((node) => ({ width: getComputedStyle(node).borderTopWidth, radius: getComputedStyle(node).borderTopLeftRadius })), { width: '3px', radius: '0px' });
  }
  assert.equal(await rarityPage.locator('.inventory-slot:not(.occupied)').first().evaluate((cell) => getComputedStyle(cell).borderTopWidth), '1px');
  assert.equal(await rarityPage.locator('.equipment-slot').first().evaluate((cell) => getComputedStyle(cell).borderTopLeftRadius), '0px');
  const visibleItemText = await rarityPage.locator('.inventory-page').innerText();
  for (const label of ['常见', '普通', '稀有', '罕见', '珍稀', '绝世']) assert.equal(visibleItemText.includes(label), false, '稀有度名称不进入游戏文案');
  const purpleItem = rarityPage.locator('.inventory-slot[data-item-id="test_chest"]');
  await purpleItem.click();
  assert.equal(await purpleItem.evaluate((cell) => getComputedStyle(cell).getPropertyValue('--rarity-color').trim()), '#AF7CFA');
  assert.deepEqual(await purpleItem.evaluate((cell) => {
    const style = getComputedStyle(cell, '::after');
    return { content: style.content, offset: style.left, width: style.borderImageWidth, icon: style.borderImageSource.includes('selection-corners.svg') };
  }), { content: '""', offset: '-11px', width: '12px', icon: true });
  await rarityPage.mouse.move(0, 0);
  await rarityPage.screenshot({ path: 'artifacts/rarity-borders-desktop.png', fullPage: true });
  const detailPage = await openGame('inventory', 'reduce', 4);
  await detailPage.locator('.inventory-slot[data-item-id="test_chest"]').click();
  const gridBounds = await detailPage.locator('.inventory-grid').boundingBox();
  await detailPage.screenshot({ path: 'artifacts/rarity-borders-detail.png', clip: { x: gridBounds.x - 6, y: gridBounds.y - 6, width: gridBounds.width + 12, height: gridBounds.height + 12 } });
  await detailPage.close();
  await purpleItem.dragTo(rarityPage.locator('[data-equipment-slot="chest"]'));
  assert.equal(await rarityPage.locator('[data-equipment-slot="chest"]').getAttribute('data-rarity'), 'scarce');
  await rarityPage.locator('[data-equipment-slot="chest"]').dragTo(rarityPage.locator('[data-bag-slot="23"]'));
  assert.equal(await rarityPage.locator('[data-bag-slot="23"]').getAttribute('data-rarity'), 'scarce', '卸下后稀有度保留');
  await rarityPage.locator('.inventory-slot[data-item-id="test_helmet"]').dragTo(rarityPage.locator('[data-equipment-slot="helmet"]'));
  await rarityPage.locator('.inventory-slot[data-item-id="test_necklace"]').dragTo(rarityPage.locator('[data-equipment-slot="necklace"]'));
  await rarityPage.locator('[data-bag-slot="23"]').click();
  await rarityPage.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  await rarityPage.clock.runFor(6000);
  const copperCell = rarityPage.getByRole('option', { name: '铜钱，数量 2', exact: true });
  assert.equal(await copperCell.getAttribute('data-rarity'), 'common');
  assert.equal(await rarityPage.locator('[data-bag-slot="23"]').getAttribute('aria-selected'), 'true');
  for (const width of [1920, 1440, 1366, 1024, 800, 768, 767, 761, 700, 390, 320]) {
    await rarityPage.setViewportSize({ width, height: 950 });
    await checkInventoryLayout(rarityPage, width);
    assert.equal(await rarityPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.deepEqual(await rarityPage.locator('.inventory-slot, .equipment-slot').evaluateAll(overflowingContents), [], `文字应完整放入格内：${width}px`);
    assert.equal(await rarityPage.locator('[data-bag-slot="23"]').evaluate((cell) => getComputedStyle(cell, '::after').left), '-11px');
  }
  await rarityPage.setViewportSize({ width: 390, height: 1500 });
  await rarityPage.evaluate(() => window.scrollTo(0, 0));
  await rarityPage.screenshot({ path: 'artifacts/rarity-borders-mobile.png', fullPage: true });
  await rarityPage.close();

  // 动效只表现已结算伤害，不另设攻击计时器或消耗掉落随机数。
  const motion = await openGame('', 'no-preference');
  assert.equal(await motion.locator('.nav-item').first().evaluate((element) => getComputedStyle(element).transitionDuration), '0.15s, 0.15s, 0.15s');
  await motion.clock.runFor(1000);
  assert.equal(await motion.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), '50');
  assert.equal(await motion.locator('.damage-number').textContent(), '−10');
  assert.equal(await motion.locator('.cultivation-gain').count(), 0, '未获得修为时不产生到账浮字');
  assert.equal(await motion.locator('.damage-layer').getAttribute('aria-hidden'), 'true');
  assert.deepEqual(await motion.locator('.enemy-sprite').evaluate((element) => element.getAnimations().map((animation) => animation.effect.getTiming().duration)), [180]);
  assert.deepEqual(await motion.locator('.damage-number').evaluate((element) => element.getAnimations().map((animation) => animation.effect.getTiming().duration)), [650]);
  // 固定动效中间帧，截图不依赖机器执行速度。
  await motion.locator('.enemy-sprite, .damage-number').evaluateAll((elements) => elements.flatMap((element) => element.getAnimations()).forEach((animation) => { animation.pause(); animation.currentTime = 80; }));
  await motion.screenshot({ path: 'artifacts/combat-hit.png', fullPage: true });
  await motion.locator('.enemy-sprite, .damage-number').evaluateAll((elements) => elements.flatMap((element) => element.getAnimations()).forEach((animation) => animation.finish()));
  await motion.locator('.damage-number').waitFor({ state: 'detached' });
  await motion.clock.runFor(1000);
  assert.equal(await motion.locator('.damage-number').count(), 1, '浮字不应累积');
  await motion.emulateMedia({ reducedMotion: 'reduce' });
  await motion.locator('.damage-number').waitFor({ state: 'detached' });
  assert.equal(await motion.locator('.enemy-sprite').evaluate((element) => element.getAnimations().length), 0);
  assert.equal(await motion.locator('.nav-item').first().evaluate((element) => getComputedStyle(element).transitionDuration), '0s');
  await motion.clock.runFor(1000);
  assert.equal(await motion.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), '30');
  assert.equal(await motion.locator('.damage-number').count(), 0, '切换减少动态效果后继续结算且无浮字');
  await motion.emulateMedia({ reducedMotion: 'no-preference' });
  await motion.clock.runFor(3000);
  const gain = motion.locator('.cultivation-gain');
  assert.equal(await gain.textContent(), '+10', '修为实际到账时显示本次获得数值');
  assert.equal(await motion.locator('.cultivation-row strong').textContent(), '10 / 100', '浮字不混入修为条数字');
  assert.equal(await motion.locator('.cultivation-gain-layer').getAttribute('aria-hidden'), 'true');
  assert.equal(await gain.evaluate((element) => getComputedStyle(element).pointerEvents), 'none');
  assert.deepEqual(await gain.evaluate((element) => element.getAnimations().map((animation) => animation.effect.getTiming().duration)), [450]);
  await gain.evaluate((element) => element.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 160; }));
  const gainBox = await gain.boundingBox();
  const cultivationNumber = await motion.locator('[data-cultivation-current]').boundingBox();
  assert.ok(gainBox && cultivationNumber && gainBox.y < cultivationNumber.y, '增加值应从修为数字上方向上浮动');
  assert.ok(Math.abs(gainBox.x + gainBox.width / 2 - cultivationNumber.x - cultivationNumber.width / 2) < 2, '浮字应对准当前修为数字');
  await motion.screenshot({ path: 'artifacts/cultivation-gain-desktop.png' });
  await motion.setViewportSize({ width: 390, height: 844 });
  assert.ok(await motion.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '修为浮字不得导致窄屏横向溢出');
  await motion.screenshot({ path: 'artifacts/cultivation-gain-mobile.png' });
  await gain.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
  await gain.waitFor({ state: 'detached' });
  await motion.clock.runFor(6000);
  assert.equal(await gain.count(), 1, '连续到账最多保留一条浮字');
  await gain.waitFor({ state: 'detached' });
  await motion.clock.runFor(6000);
  assert.equal(await gain.textContent(), '+10');
  await navigate(motion, '背包');
  assert.equal(await gain.count(), 0, '导航时清理旧浮字及其动画');
  await motion.clock.runFor(6000);
  assert.equal(await gain.textContent(), '+10', '背包页的修为到账也应在侧栏提示');
  await gain.evaluate((element) => element.getAnimations().forEach((animation) => { animation.pause(); animation.currentTime = 100; }));
  await motion.emulateMedia({ reducedMotion: 'reduce' });
  await gain.waitFor({ state: 'detached', timeout: 1000 });
  assert.equal(await gain.count(), 0, '开启减少动态效果时停止现有浮动');
  await motion.clock.runFor(6000);
  assert.equal(await gain.textContent(), '+10', '减少动态效果仍保留静态到账提示');
  assert.ok(await gain.evaluate((element) => element.getAnimations().every((animation) => animation.effect.getKeyframes().every((frame) => !Object.hasOwn(frame, 'transform')))), '减少动态效果不执行位移动画');
  await gain.waitFor({ state: 'detached' });
  await motion.close();

  const picker = await openGame();
  const areaDialog = picker.locator('#area-dialog');
  const openAreas = picker.locator('[data-open-areas]');
  assert.equal(await picker.locator('.level-catalog, .area-card, [data-select-level], [data-next-level]').count(), 0, '移除小关卡与常驻长列表');
  assert.equal(await openAreas.count(), 1, '关卡列表统一收进一个按钮');
  assert.equal(await areaDialog.isVisible(), false);
  await openAreas.click();
  assert.equal(await areaDialog.isVisible(), true);
  assert.equal(await areaDialog.locator('[data-select-area]').count(), 10);
  assert.equal(await areaDialog.locator('[data-select-area]:disabled').count(), 9);
  assert.equal(await areaDialog.locator('.area-state-icon .area-lock').count(), 9, '未解锁关卡右侧显示锁图标');
  assert.equal(await areaDialog.locator('[aria-current="true"] strong').textContent(), '山野小径');
  await picker.locator('[data-select-area="1"]').evaluate((button) => button.click());
  assert.equal(await picker.locator('.encounter-location').textContent(), '山野小径', '禁用关卡不能进入');
  assert.equal(await areaDialog.isVisible(), true);
  await picker.keyboard.press('Escape');
  assert.equal(await areaDialog.isVisible(), false);
  assert.equal(await openAreas.evaluate((button) => document.activeElement === button), true, '关闭弹窗后焦点返回入口');
  await picker.clock.runFor(1000);
  const partialHealth = await picker.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow');
  await openAreas.click();
  await picker.locator('[data-select-area="0"]').click();
  assert.equal(await areaDialog.isVisible(), false);
  assert.equal(await picker.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), partialHealth, '重复选择当前关卡不重置正在刷的怪物');
  await openAreas.click();
  await picker.locator('[data-select-area="0"]').focus();
  await picker.clock.runFor(5000);
  assert.equal(await areaDialog.isVisible(), true, '弹窗打开时自动战斗继续且不关闭弹窗');
  assert.equal(await picker.locator('[data-select-area="0"] .area-status').textContent(), '首领进度 1 / 8');
  assert.equal(await picker.locator('[data-select-area="0"]').evaluate((button) => document.activeElement === button), true, '自动攻击不重建列表或夺取焦点');
  await picker.screenshot({ path: 'artifacts/area-picker-desktop.png' });
  for (const width of [390, 320]) {
    await picker.setViewportSize({ width, height: 844 });
    const box = await areaDialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844, `弹窗应在窗口内：${width}px`);
    assert.ok(await picker.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `关卡弹窗不得横向溢出：${width}px`);
    await picker.locator('[data-select-area="9"]').scrollIntoViewIfNeeded();
    assert.equal(await picker.locator('[data-select-area="9"] .area-lock').isVisible(), true);
    assert.equal(await picker.locator('[data-select-area="9"]').isDisabled(), true);
  }
  await areaDialog.evaluate((dialog) => { dialog.scrollTop = 0; });
  await picker.screenshot({ path: 'artifacts/area-picker-mobile.png' });
  await picker.locator('[data-close-areas]').click();
  assert.equal(await areaDialog.isVisible(), false);
  await picker.close();

  // 通过真实按钮推进前五个大关，不注入角色属性或跳关状态。
  const journey = await openGame();
  const stages = REALMS.flatMap((realm) => realm.stages.map((_, stageIndex) => ({ realmId: realm.id, stageIndex })));
  const currentStage = async () => {
    const label = await journey.locator('.character-realm').textContent();
    const stage = stages.find((stage) => stageLabel(stage) === label);
    assert.ok(stage, `页面境界必须有效：${label}`);
    return stage;
  };
  const chooseArea = async (index) => {
    await journey.locator('[data-open-areas]').click();
    await journey.locator(`[data-select-area="${index}"]`).click();
    assert.equal(await journey.locator('.encounter-location').textContent(), AREAS[index].name);
    assert.equal(await journey.locator('#area-dialog').isVisible(), false);
  };
  let checkedRetreat = false;
  for (const [index, area] of AREAS.slice(0, 5).entries()) {
    if (index > 0) await chooseArea(index);
    assert.equal(await journey.locator('.encounter-location').textContent(), area.name);
    const monsterName = await journey.locator('.enemy-combatant h3').textContent();
    assert.ok(area.normalMonsters.some((monster) => monster.name === monsterName), '普通怪应来自当前关卡');
    const stats = playerStatsForStage(await currentStage());
    const hits = Math.ceil(area.normalMonsters[0].maxHealth / stats.attack);
    let remaining = area.killsRequired;
    if (index === 1) {
      await journey.clock.runFor(hits * 1000);
      await chooseArea(0);
      assert.equal(await journey.locator('[data-challenge-boss]').textContent(), '首领已击败');
      await chooseArea(index);
      assert.equal(await journey.locator('[data-area-progress-count]').textContent(), `1 / ${area.killsRequired}`, '换关后保留各关独立进度');
      remaining -= 1;
    }
    await journey.clock.runFor(hits * (remaining - 1) * 1000);
    assert.equal(await journey.locator('[data-challenge-boss]').isDisabled(), true, '进度未满不能挑战首领');
    await journey.clock.runFor(hits * 1000);
    if (index === 1) {
      const amount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(area.normalMonsters[0].cultivationReward);
      assert.equal(await journey.locator('.cultivation-gain').textContent(), `+${amount}`, '小数修为显示实际到账值');
    }
    assert.equal(await journey.locator('[data-area-progress-count]').textContent(), `${area.killsRequired} / ${area.killsRequired}`);
    assert.equal(await journey.locator('[data-challenge-boss]').isDisabled(), false);
    await journey.clock.runFor(hits * 1000);
    assert.equal(await journey.locator('[data-area-progress-count]').textContent(), `${area.killsRequired} / ${area.killsRequired}`, '满进度后显示封顶且继续刷怪');
    assert.equal(await journey.locator('.enemy-combatant .combatant-caption p').textContent(), '普通怪', '进度满后必须手动挑战首领');
    assert.equal(await journey.locator('.count-label').textContent().then((text) => Number(text.match(/\d+/)[0])) > 0, true);
    await journey.locator('[data-open-areas]').click();
    assert.equal(await journey.locator(`[data-select-area="${index + 1}"]`).isDisabled(), true, '进度满仍未解锁下一关');
    await journey.keyboard.press('Escape');
    if (index === 4) await journey.screenshot({ path: 'artifacts/area-farming-desktop.png' });
    await journey.locator('[data-challenge-boss]').click();
    assert.equal(await journey.locator('.enemy-combatant h3').textContent(), area.boss.name);
    assert.equal(await journey.locator('[data-challenge-boss]').isDisabled(), true, '首领战中不能重复发起');
    await journey.clock.runFor(Math.ceil(area.boss.maxHealth / stats.attack) * 1000);
    if (index === 0) assert.equal(await journey.locator('.cultivation-gain').textContent(), '+50', '首领奖励实际到账后显示');
    assert.equal(await journey.locator('.encounter-location').textContent(), area.name, '击败首领后留在原关继续刷怪');
    assert.equal(await journey.locator('.enemy-combatant .combatant-caption p').textContent(), '普通怪');
    assert.equal(await journey.locator('[data-challenge-boss]').textContent(), '首领已击败');
    assert.equal(await journey.locator('[data-challenge-boss]').isDisabled(), true, '首领只能击败一次');
    await journey.locator('[data-open-areas]').click();
    assert.equal(await journey.locator(`[data-select-area="${index}"] .area-status`).textContent(), '已通关');
    assert.equal(await journey.locator(`[data-select-area="${index + 1}"]`).isDisabled(), false, '首领战胜利解锁下一关');
    if (index < 4) assert.equal(await journey.locator(`[data-select-area="${index + 2}"]`).isDisabled(), true, '每次仅解锁下一关');
    await journey.keyboard.press('Escape');
    if (index === 0) {
      await navigate(journey, '背包');
      assert.equal(await journey.getByRole('option', { name: '铜钱，数量 10', exact: true }).isVisible(), true);
      await navigate(journey, '战斗');
    }
    while (!await journey.locator('[data-breakthrough]').isDisabled()) {
      const before = await currentStage();
      const major = await journey.locator('[data-breakthrough]').textContent() === '闭关突破';
      if (major && !checkedRetreat) {
        const config = retreatConfig(before);
        await journey.evaluate(() => { Math.random = () => 0.99; });
        await journey.locator('[data-breakthrough]').click();
        assert.equal(await journey.locator('[data-breakthrough]').isDisabled(), true, '闭关中不能重复发起');
        await navigate(journey, '背包');
        await journey.clock.runFor(config.durationMs - 1);
        await navigate(journey, '战斗');
        assert.deepEqual(await currentStage(), before, '闭关读条结束前不突破');
        await journey.clock.runFor(1);
        assert.deepEqual(await currentStage(), before);
        assert.match(await journey.locator('[data-combat-feedback]').textContent(), /闭关失败/);
        await journey.evaluate(() => { Math.random = () => 0; });
        while (await journey.locator('[data-breakthrough]').isDisabled()) {
          await journey.clock.runFor(Math.ceil(area.normalMonsters[0].maxHealth / playerStatsForStage(before).attack) * 1000);
        }
        await journey.locator('[data-breakthrough]').click();
        await journey.locator('[data-open-areas]').click();
        await journey.locator('[data-select-area="0"]').focus();
        await journey.clock.runFor(config.durationMs);
        assert.equal(await journey.locator('#area-dialog').isVisible(), true, '闭关结束刷新界面时保留已打开的关卡弹窗');
        assert.equal(await journey.locator('[data-select-area="0"]').evaluate((button) => document.activeElement === button), true, '闭关刷新保留弹窗焦点');
        await journey.keyboard.press('Escape');
        assert.notDeepEqual(await currentStage(), before, '重新积累后闭关成功');
        assert.match(await journey.locator('[data-combat-feedback]').textContent(), /闭关成功/);
        await journey.evaluate(() => { Math.random = () => 0.5; });
        checkedRetreat = true;
      } else {
        if (major) await journey.evaluate(() => { Math.random = () => 0; });
        await journey.locator('[data-breakthrough]').click();
        if (major) {
          await journey.clock.runFor(retreatConfig(before).durationMs);
          await journey.evaluate(() => { Math.random = () => 0.5; });
        }
        assert.notDeepEqual(await currentStage(), before);
      }
    }
  }
  assert.equal(checkedRetreat, true, '实际大关卡奖励应支持大境界闭关');
  assert.equal(await journey.locator('[data-select-area="5"]').isDisabled(), false);
  await journey.setViewportSize({ width: 320, height: 844 });
  assert.ok(await journey.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '首领进度与按钮在320像素下不溢出');
  await journey.screenshot({ path: 'artifacts/area-farming-mobile.png', fullPage: true });
  await chooseArea(0);
  assert.equal(await journey.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuemax'), '60', '回刷旧关强度固定');
  assert.equal(await journey.locator('[data-challenge-boss]').isDisabled(), true, '回刷不会重置首领击败状态');
  assert.equal(await journey.locator('[data-select-area="5"]').isDisabled(), false);
  await journey.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(nonlocal, []);
  console.log('浏览器检查通过：六档稀有度直角厚框、贴近四角选中、稀有度穿脱保留、灰色空槽和文字完整；背包右键三项菜单、直接装备、分解/出售无收益移除、菜单键盘/边界/关闭与掉落焦点保留；10件测试装备、鼠标/触屏拖动穿脱、部位校验、戒指交换、背包换位、选中边框、拖动期间掉落保留、键盘操作与装备物品守恒；10大关选择弹窗、锁图标与禁用、无限刷怪与进度封顶、手动首领战与逐区解锁、回刷保留进度、闭关失败重试和弹窗焦点；回归到账浮字、战斗、背包及四页面8种宽度，移除境界/说明页面及旧地址回退，无运行异常和外部请求。');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
