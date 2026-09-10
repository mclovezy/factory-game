// building-reserve —— 回收库 / 库存投料 / 切配方退料
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const home = homePlanetId(content);

describe('建筑回收库（拆除 → 免材料再建）', () => {
  it('整块拆除入回收库，库存不足时仍可免材料重建', () => {
    const state = engine.createInitialState(content, home);
    // 清空库存，构造"材料不足"场景
    for (const k of Object.keys(state.stock)) state.stock[k] = 0;

    // 先给足材料建一台熔炉
    state.stock.iron_ingot = 100;
    state.stock.stone_brick = 100;
    state.stock.circuit_board = 100;
    state.stock.magnetic_coil = 100;
    const r1 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    assert.equal(r1.ok, true);
    assert.equal(state.buildingReserve.arc_smelter || 0, 0, '建造时不应产生回收库');

    // 拆除 → 入回收库
    const r2 = engine.removeBuilding(state, content, r1.id);
    assert.equal(r2.ok, true);
    assert.equal(state.buildingReserve.arc_smelter, 1);

    // 清空库存后再建 → 免材料成功
    for (const k of Object.keys(state.stock)) state.stock[k] = 0;
    const r3 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 700, y: 500 });
    assert.equal(r3.ok, true, '回收库命中时即使库存为 0 也应可放置');
    assert.equal(state.buildingReserve.arc_smelter, 0, '回收库应被消耗');

    // 回收库耗尽后，材料不足 → 拒绝
    const r4 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 900, y: 500 });
    assert.equal(r4.ok, false);
    assert.equal(r4.reason, 'insufficientMaterials');
  });

  it('叠加块 count-1 拆除同样入回收库', () => {
    const state = engine.createInitialState(content, home);
    state.stock.iron_ingot = 100; state.stock.stone_brick = 100;
    state.stock.circuit_board = 100; state.stock.magnetic_coil = 100;
    const r1 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    const r2 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    assert.equal(r2.ok, true);
    assert.equal(state.buildings[r1.id].count, 2);

    const r3 = engine.removeBuilding(state, content, r1.id);
    assert.equal(r3.ok, true);
    assert.equal(state.buildings[r1.id].count, 1);
    assert.equal(state.buildingReserve.arc_smelter, 1, 'count-1 也应回收一台');
  });

  it('serialize/deserialize 往返保留回收库', () => {
    const state = engine.createInitialState(content, home);
    state.stock.iron_ingot = 100; state.stock.stone_brick = 100;
    state.stock.circuit_board = 100; state.stock.magnetic_coil = 100;
    const r = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    engine.removeBuilding(state, content, r.id);
    const snap = JSON.parse(JSON.stringify(engine.serialize(state)));
    const restored = engine.deserialize(snap, content);
    assert.ok(restored, 'v2 档应可反序列化');
    assert.equal(restored.buildingReserve.arc_smelter, 1);
  });
});

describe('切换配方退料', () => {
  it('切换配方时 inBuf/outBuf 全部退回库存', () => {
    const state = engine.createInitialState(content, home);
    state.stock.iron_ingot = 100; state.stock.stone_brick = 100;
    state.stock.circuit_board = 100; state.stock.magnetic_coil = 100;
    const r = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    assert.equal(r.ok, true);

    // 设置铁块配方并塞入缓存
    assert.equal(engine.setRecipe(state, content, r.id, 'iron_ingot').ok, true);
    const b = state.buildings[r.id];
    b.inBuf = { iron_ore: 10 };
    b.outBuf = { iron_ingot: 3 };

    const beforeOre = state.stock.iron_ore || 0;
    const beforeIngot = state.stock.iron_ingot || 0;

    // 切到磁铁配方 → 缓存退库
    assert.equal(engine.setRecipe(state, content, r.id, 'magnet').ok, true);
    assert.equal(Object.keys(b.inBuf).length, 0, 'inBuf 应清空');
    assert.equal(Object.keys(b.outBuf).length, 0, 'outBuf 应清空');
    assert.equal(state.stock.iron_ore, beforeOre + 10);
    assert.equal(state.stock.iron_ingot, beforeIngot + 3);
    assert.equal(b.progress, 0);

    // 同配方重复设置 → 不动作（缓存保留）
    b.inBuf = { iron_ore: 7 };
    assert.equal(engine.setRecipe(state, content, r.id, 'magnet').ok, true);
    assert.equal(b.inBuf.iron_ore, 7);
  });
});

describe('库存投料 depositFromStock', () => {
  it('正常投料 / 容量截断 / 库存不足', () => {
    const state = engine.createInitialState(content, home);
    state.stock.iron_ingot = 100; state.stock.stone_brick = 100;
    state.stock.circuit_board = 100; state.stock.magnetic_coil = 100;
    const r = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    assert.equal(r.ok, true);

    // 投入铁矿石（库存里没有 → 失败）
    const bad = engine.depositFromStock(state, content, r.id, 'iron_ore');
    assert.equal(bad.ok, false);

    state.stock.iron_ore = 500;
    const ok1 = engine.depositFromStock(state, content, r.id, 'iron_ore');
    assert.equal(ok1.ok, true);
    // 电弧熔炉 inputCapacity = 120
    assert.equal(state.buildings[r.id].inBuf.iron_ore, 120, '应投入至输入缓存上限');
    assert.equal(state.stock.iron_ore, 380);

    // 缓存已满 → 拒绝
    const full = engine.depositFromStock(state, content, r.id, 'iron_ore');
    assert.equal(full.ok, false);
    assert.equal(full.reason, 'inputFull');
  });

  it('清除配方同样退缓存', () => {
    const state = engine.createInitialState(content, home);
    state.stock.iron_ingot = 100; state.stock.stone_brick = 100;
    state.stock.circuit_board = 100; state.stock.magnetic_coil = 100;
    const r = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 500, y: 500 });
    engine.setRecipe(state, content, r.id, 'iron_ingot');
    const b = state.buildings[r.id];
    b.inBuf = { iron_ore: 5 };
    engine.setRecipe(state, content, r.id, null);
    assert.equal(state.stock.iron_ore, 5);
    assert.equal(b.recipeId, null);
  });
});
