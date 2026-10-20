import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

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

async function openGame(hash = '', reducedMotion = 'reduce') {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion });
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
  const character = await page.locator('.equipment-character').boundingBox();
  assert.ok(character && await page.getByRole('img', { name: '装备区像素修真者', exact: true }).isVisible(), '装备中央角色应可见');
  const slots = await page.locator('.equipment-slot').all();
  let previousRow = -1;
  for (let i = 0; i < slots.length; i += 2) {
    const left = await slots[i].boundingBox();
    const right = await slots[i + 1].boundingBox();
    assert.ok(left && right && left.y > previousRow, '装备槽应从上向下排列');
    assert.ok(Math.abs(left.y - right.y) < 1 && Math.abs(left.width - right.width) < 1, '两侧装备槽应成对对齐');
    assert.ok(left.x + left.width <= character.x && character.x + character.width <= right.x, '角色应位于两侧装备槽之间');
    const midpoint = (left.x + left.width / 2 + right.x + right.width / 2) / 2;
    assert.ok(Math.abs(midpoint - (character.x + character.width / 2)) < 1, '装备槽应以角色中心对称');
    previousRow = left.y;
  }
}

try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  await mkdir('artifacts', { recursive: true });
  const page = await openGame();
  const enemyHealth = page.getByRole('progressbar', { name: '怪物生命' });
  const cultivation = page.getByRole('progressbar', { name: '当前修为进度' });
  assert.equal(await page.getByRole('button', { name: /^攻击/ }).count(), 0, '不得保留手动攻击入口');
  assert.equal(await page.getByRole('checkbox').count(), 0, '自动攻击不再需要开关');
  assert.equal(await page.locator('[data-attack], [data-auto-attack]').count(), 0);
  assert.equal(await page.locator('.combat-mode').textContent(), '自动战斗 · 空手每秒攻击 1 次');
  assert.equal(await page.getByRole('button', { name: '突破', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '挑战首领' }).count(), 0);
  assert.deepEqual(await page.locator('.attribute-list dd').allTextContents(), ['100 / 100', '10', '2', '1.0 次/秒', '1 点/秒']);
  assert.equal(await page.getByRole('heading', { name: '[待编辑]', exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('img', { name: '测试用小灰狼2D立绘' }).isVisible(), true);
  const battleSprite = await page.getByRole('img', { name: '像素修真者主角', exact: true }).getAttribute('src');
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
  assert.ok(await page.evaluate(() => document.documentElement.scrollHeight <= 768));
  await page.mouse.move(0, 0);
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
  assert.equal(await page.locator('[data-combat-feedback]').textContent(), '击败 [待编辑]，获得 10 修为。');
  const journalToggle = page.locator('[data-journal-toggle]');
  await journalToggle.click();
  await page.clock.runFor(1000);
  assert.equal(await enemyHealth.getAttribute('aria-valuenow'), '50');
  assert.equal(await journalToggle.evaluate((button) => document.activeElement === button), true);
  assert.equal(await page.getByRole('list', { name: '战斗记录' }).isVisible(), true);
  await journalToggle.click();

  await navigate(page, '背包');
  assert.equal(await page.getByRole('heading', { name: '角色背包', level: 2 }).isVisible(), true);
  assert.deepEqual(await page.locator('.equipment-name').allTextContents(), ['头盔', '胸甲', '左护腕', '右护腕', '主武器', '副武器', '左靴', '右靴']);
  assert.equal(await page.getByRole('img', { name: '装备区像素修真者', exact: true }).getAttribute('src'), battleSprite, '战斗与装备应使用同一角色素材');
  assert.equal(await page.locator('.equipment-sprite').evaluate((image) => getComputedStyle(image).imageRendering), 'pixelated');
  assert.equal(await page.getByRole('list', { name: '人物装备槽', exact: true }).getByRole('listitem').count(), 8);
  assert.equal(await page.locator('.equipment-empty').filter({ hasText: '未装备' }).count(), 8);
  assert.deepEqual(await page.locator('.equipment-slot .item-icon').evaluateAll((images) => images.map((image) => image.getAttribute('src'))), ['helmet', 'chest', 'bracer', 'bracer', 'sword', 'dagger', 'boots', 'boots'].map((name) => `./icons/gear/${name}.svg`));
  assert.equal(await page.locator('.equipment-panel').getByRole('button').count(), 0);
  await checkInventoryLayout(page, 1366);
  assert.equal(await page.getByRole('status').textContent(), '背包为空');
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：0');
  assert.equal(await page.locator('.inventory-slot.occupied').count(), 0);
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
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：0');
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

  await navigate(page, '境界');
  assert.equal(await page.locator('.realm-card').count(), 7);
  await page.getByRole('button', { name: /02 筑基期/ }).click();
  assert.equal(await page.locator('#stages-foundation .stage-chip').count(), 4);
  assert.deepEqual(await page.locator('tr[data-stage="qi-0"] > *').allTextContents(), ['一层', '100', '10', '2', '1.0', '1', '60', '300', '100']);
  assert.deepEqual(await page.locator('tr[data-stage="foundation-0"] > *').allTextContents(), ['初期', '900', '90', '18', '1.0', '9', '540', '2,700', '5,000']);
  assert.equal(await page.getByRole('columnheader', { name: '怪物攻击', exact: true }).count(), 0);
  await page.getByRole('button', { name: /07 大乘期/ }).click();
  assert.deepEqual(await page.locator('tr[data-stage="mahayana-3"] > *').allTextContents(), ['圆满', '159,432,300', '15,943,230', '3,188,646', '1.0', '1,594,323', '95,659,380', '478,296,900', '后续世界待定']);
  await navigate(page, '功法');
  assert.equal(await page.getByText('采用分类功法槽位', { exact: true }).isVisible(), true);
  await navigate(page, '洞府');
  assert.equal(await page.getByRole('button', { name: '升级洞府' }).isDisabled(), true);
  await navigate(page, '说明');
  assert.equal(await page.locator('.rule-entry').filter({ hasText: '战斗采用纯自动攻击' }).isVisible(), true);
  await page.getByRole('button', { name: '待确认内容', exact: true }).click();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  await page.goBack();
  await page.getByRole('heading', { name: '洞府', level: 1 }).waitFor();

  for (const width of [1920, 1440, 1366, 1024, 768, 700, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    for (const view of ['adventure', 'inventory', 'techniques', 'cave', 'realms', 'handbook']) {
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

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  await navigate(page, '背包');
  await nextPage.click();
  await page.clock.runFor(6000);
  assert.equal(await page.locator('.inventory-page-label').textContent(), '2 / 3', '掉落不得强制跳回其他背包页');
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：1');
  assert.equal(await page.locator('.inventory-slot.occupied').count(), 0);
  assert.equal(await page.getByRole('status').textContent(), '本页暂无物品');
  assert.equal(await nextPage.evaluate((button) => document.activeElement === button), true, '掉落刷新不得重建翻页按钮或夺取焦点');
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/inventory-empty-page.png', fullPage: true });
  await previousPage.click();
  assert.equal(await page.getByRole('listitem', { name: '铜钱，数量 2', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.inventory-empty').isVisible(), false);
  await navigate(page, '战斗');
  assert.match(await page.locator('[data-combat-feedback]').textContent(), /铜钱 ×2/);
  await page.evaluate(() => { const rolls = [0.199999, 0.999999]; Math.random = () => rolls.shift() ?? 0.5; });
  await navigate(page, '背包');
  await page.clock.runFor(6000);
  assert.equal(await page.getByRole('listitem', { name: '铜钱，数量 7', exact: true }).isVisible(), true);
  assert.equal(await page.locator('.inventory-quantity').textContent(), '×7');
  assert.equal(await page.locator('.inventory-slot .coin-icon').getAttribute('src'), './icons/gear/coins.svg');
  await page.locator('.item-icon').evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
  assert.equal(await page.locator('.inventory-count').textContent(), '物品种类：1');
  assert.equal(await page.locator('.inventory-slot.occupied').count(), 1);
  assert.equal(await page.locator('.equipment-empty').filter({ hasText: '未装备' }).count(), 8, '铜钱掉落不得改变装备槽');
  await page.clock.runFor(6000);
  assert.equal(await page.locator('.inventory-quantity').textContent(), '×7');
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/inventory-coins.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/inventory-coins-mobile.png', fullPage: true });

  const inventoryStart = await openGame('inventory');
  await inventoryStart.evaluate(() => { const rolls = [0.1, 0]; Math.random = () => rolls.shift() ?? 0.5; });
  await inventoryStart.clock.runFor(6000);
  assert.equal(await inventoryStart.getByRole('listitem', { name: '铜钱，数量 2', exact: true }).isVisible(), true, '从背包页面打开游戏也应自动战斗');
  await navigate(inventoryStart, '战斗');
  assert.equal(await inventoryStart.getByRole('progressbar', { name: '当前修为进度' }).getAttribute('aria-valuenow'), '10');
  assert.equal(await inventoryStart.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), '60');
  await inventoryStart.close();

  // 动效只表现已结算伤害，不另设攻击计时器或消耗掉落随机数。
  const motion = await openGame('', 'no-preference');
  assert.equal(await motion.locator('.nav-item').first().evaluate((element) => getComputedStyle(element).transitionDuration), '0.15s, 0.15s, 0.15s');
  await motion.clock.runFor(1000);
  assert.equal(await motion.getByRole('progressbar', { name: '怪物生命' }).getAttribute('aria-valuenow'), '50');
  assert.equal(await motion.locator('.damage-number').textContent(), '−10');
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
  await motion.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(nonlocal, []);
  console.log('浏览器检查通过：像素主角与灰狼、玉青选中与突破状态、物品装备图标、受击闪白与浮字及减少动态效果、紧凑分页与焦点、铜钱堆叠、自动战斗与突破、六页面及8种宽度，无运行异常和外部请求。');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
