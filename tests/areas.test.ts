import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, INITIAL_MONSTER, MONSTERS } from '../src/game/areas.ts';
import { CONTENT } from '../src/game/content.ts';
import { validateAreaOrder } from '../src/game/rules.ts';
import { growthMultiplier } from '../src/game/balance.ts';

test('十个大关各有四种轮换普通怪与一个首领，保留全部五十个怪物名称', () => {
  assert.equal(AREAS.length, 10);
  assert.equal(MONSTERS.length, 50);
  assert.equal(new Set(AREAS.map((area) => area.id)).size, 10);
  assert.equal(new Set(MONSTERS.map((monster) => monster.name)).size, 50);
  assert.deepEqual(MONSTERS.map((monster) => monster.id), Array.from({ length: 50 }, (_, index) => index + 1));
  for (const area of AREAS) {
    assert.equal(Object.hasOwn(area, 'levels'), false);
    assert.equal(area.normalMonsters.length, 4);
    assert.ok(area.normalMonsters.every((monster) => monster.kind === 'normal' && monster.areaId === area.id));
    assert.equal(area.boss.kind, 'boss');
    assert.equal(area.boss.areaId, area.id);
  }
  assert.equal(AREAS[0].name, '山野小径');
  assert.equal(INITIAL_MONSTER.name, '尖牙野鼠');
  assert.equal(AREAS.at(-1)?.name, '混沌天渊');
  assert.equal(AREAS.at(-1)?.boss.name, '终劫道主');
  assert.equal(CONTENT.areas, AREAS);
});

test('同一关普通怪共用固定强度，关间成长、首领倍率与进度目标完整', () => {
  assert.equal(INITIAL_MONSTER.strengthMultiplier, 1);
  assert.equal(AREAS.at(-1)?.boss.strengthMultiplier, growthMultiplier({ realmId: 'mahayana', stageIndex: 3 }));
  assert.equal(validateAreaOrder(AREAS), true);
  for (const [index, area] of AREAS.entries()) {
    const strength = area.boss.strengthMultiplier;
    assert.equal(area.killsRequired, 4 * (index + 2));
    assert.ok(area.normalMonsters.every((monster) => monster.strengthMultiplier === strength));
    if (index > 0) assert.ok(strength > AREAS[index - 1].boss.strengthMultiplier);
    for (const monster of [...area.normalMonsters, area.boss]) {
      assert.ok(Number.isFinite(monster.maxHealth) && monster.maxHealth > 0);
      assert.equal(monster.maxHealth, (monster.kind === 'boss' ? 300 : 60) * strength);
      assert.equal(monster.cultivationReward, 10 * strength * (monster.kind === 'boss' ? 5 : 1));
      assert.equal(monster.copperReward, monster.kind === 'boss' ? 10 * (index + 1) : 0);
    }
  }
});
