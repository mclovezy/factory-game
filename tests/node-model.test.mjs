// node-model —— v2 节点方块模型：矿脉唯一性 / 矿机叠加 / 建筑叠加 / 移动合并 / 手动采集
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const home = homePlanetId(content);

describe('v2 节点方块模型', () => {
  it('矿脉唯一性：每矿种恰好 1 块（id=vein-<itemId>），储量无限（无 remaining）', () => {
    const state = engine.createInitialState(content, home);
    const planet = content.PLANETS[home];
    assert.equal(Object.keys(state.veins).length, planet.oreTypes.length);
    for (const ore of planet.oreTypes) {
      const v = state.veins['vein-' + ore];
      assert.ok(v, `缺少矿脉 vein-${ore}`);
      assert.equal(v.itemId, ore);
      assert.equal(v.miners, 0);
      assert.ok(!('remaining' in v), 'v2 矿脉不应有 remaining（储量无限）');
      assert.ok(v.cap > 0);
    }
    // 位置两两不重叠（≥75）
    const vs = Object.values(state.veins);
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const d = Math.hypot(vs[i].x - vs[j].x, vs[i].y - vs[j].y);
      assert.ok(d >= 75, `矿脉 ${vs[i].id}/${vs[j].id} 距离 ${d} < 75`);
    }
  });

  it('矿机叠加：同脉 2 台速率 ×2，removeBuilding 递减且不删矿脉', () => {
    const state = engine.createInitialState(content, home);
    const vein = state.veins['vein-iron_ore'];
    for (let i = 0; i < 4; i++) {
      engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: vein.x + 300, y: vein.y + 300 });
    }
    const r1 = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });
    assert.equal(r1.ok, true);
    assert.equal(r1.id, vein.id, '矿机放置应返回矿脉 id');
    assert.equal(vein.miners, 1);

    // 吸附：即使点击位置偏离脉心，只要在吸附半径内就落到同一矿脉
    const r2 = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x - 40, y: vein.y - 40 });
    assert.equal(r2.ok, true);
    assert.equal(vein.miners, 2);

    // 脱离矿脉放置 → 拒绝
    const far = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 800, y: vein.y + 800 });
    assert.equal(far.ok, false);

    // 速率 ×2：buffer 增量在满电时 = 2×5/s
    engine.advance(state, content, 10);
    assert.ok(vein.buffer > 80, `10s 后 buffer=${vein.buffer}，应接近 100（2 机 × 5/s × 0.95 电比）`);

    // 拆除递减
    const rm = engine.removeBuilding(state, content, vein.id);
    assert.equal(rm.ok, true);
    assert.equal(vein.miners, 1);
    assert.ok(state.veins['vein-iron_ore'], '矿脉方块不应被删除');
  });

  it('建筑叠加：同型合并 count、效率/耗电 ×2；异型重叠拒绝', () => {
    const state = engine.createInitialState(content, home);
    state.unlockedTechs.push('basic_logistics');
    const vein = state.veins['vein-iron_ore'];
    engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: vein.x + 300, y: vein.y + 300 });
    engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: vein.x + 400, y: vein.y + 300 });
    engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: vein.x + 500, y: vein.y + 300 });
    const s1 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 160, y: vein.y });
    assert.equal(s1.ok, true);
    const s2 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 180, y: vein.y });
    assert.equal(s2.ok, true);
    assert.equal(s2.id, s1.id, '同型叠放应并入原方块');
    assert.equal(state.buildings[s1.id].count, 2);

    const before = engine.powerStats(state, content).demandKw;
    const s3 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 190, y: vein.y });
    assert.equal(s3.ok, true);
    assert.equal(state.buildings[s1.id].count, 3);
    const after = engine.powerStats(state, content).demandKw;
    assert.ok(after - before >= 360, '叠加应增加对应耗电');

    // 异型重叠拒绝
    const bad = engine.placeBuilding(state, content, { typeId: 'matrix_lab', x: vein.x + 170, y: vein.y });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'occupied');

    // 拆到 0 才消失
    engine.removeBuilding(state, content, s1.id);
    engine.removeBuilding(state, content, s1.id);
    const res = engine.removeBuilding(state, content, s1.id);
    assert.equal(res.ok, true);
    assert.ok(!state.buildings[s1.id], 'count 归 0 后应删除方块');
  });

  it('moveBuilding：矿脉整块移动（miners 保留）、建筑异型拒绝、同型并入', () => {
    const state = engine.createInitialState(content, home);
    const vein = state.veins['vein-iron_ore'];
    engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });
    const mv = engine.moveBuilding(state, content, vein.id, vein.x + 500, vein.y + 500);
    assert.equal(mv.ok, true);
    assert.equal(state.veins['vein-iron_ore'].x, 1095.97, '矿脉应移动到新坐标');
    assert.equal(state.veins['vein-iron_ore'].miners, 1);

    const a1 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 0, y: 0 });
    const b1 = engine.placeBuilding(state, content, { typeId: 'matrix_lab', x: 400, y: 0 });
    // 移动熔炉到实验室上 → 拒绝
    const bad = engine.moveBuilding(state, content, a1.id, 400, 0);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'occupied');
    // 移动实验室到熔炉上 → 拒绝（异型）
    const bad2 = engine.moveBuilding(state, content, b1.id, 0, 0);
    assert.equal(bad2.ok, false);

    // 同型并入：再造一台熔炉移过去
    const a2 = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: -400, y: 0 });
    const merged = engine.moveBuilding(state, content, a2.id, 0, 0);
    assert.equal(merged.ok, true);
    assert.equal(merged.mergedTo, a1.id);
    assert.equal(state.buildings[a1.id].count, 2);
    assert.ok(!state.buildings[a2.id], '并入后原方块应删除');
  });

  it('manualMine：产量 = 10×(1+miners) 入全局库存并计入产量统计', () => {
    const state = engine.createInitialState(content, home);
    const vein = state.veins['vein-copper_ore'];
    engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });
    const before = state.stats.totalProduced.copper_ore || 0;
    const r = engine.manualMine(state, content, vein.id);
    assert.equal(r.ok, true);
    assert.equal(r.gained, 20);
    assert.equal(state.stock.copper_ore, 20);
    assert.equal((state.stats.totalProduced.copper_ore || 0) - before, 20);

    const rBad = engine.manualMine(state, content, 'vein-nope');
    assert.equal(rBad.ok, false);
  });

  it('veinInfo / canConnect 查询契约', () => {
    const state = engine.createInitialState(content, home);
    const vein = state.veins['vein-iron_ore'];
    const info = engine.veinInfo(state, content, vein.id);
    assert.equal(info.itemId, 'iron_ore');
    assert.equal(info.name, '铁矿石');
    assert.equal(info.ratePerSec, 0);
    assert.equal(info.percent, 0);

    const sm = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 160, y: vein.y });
    // 未设配方的建筑没有输入端口 → 不可连
    assert.equal(engine.canConnect(state, content, vein.id, sm.id), false);
    engine.setRecipe(state, content, sm.id, 'iron_ingot');
    assert.equal(engine.canConnect(state, content, vein.id, sm.id), true);
    assert.equal(engine.canConnect(state, content, sm.id, vein.id), false, '反向不可连');
    assert.equal(engine.canConnect(state, content, vein.id, vein.id), false, '自连不可');
  });
});
