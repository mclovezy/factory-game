// power-throttle —— v2 电力不足降速 / 电力充足满速（矿脉开采速率 × ratio）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function setupWithTurbines(nTurbines, miners) {
  const state = engine.createInitialState(content, homePlanetId(content));
  const vein = state.veins['vein-iron_ore'];
  assert.ok(vein, '主行星应有铁矿脉方块');
  for (let m = 0; m < (miners || 1); m++) {
    const r = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5 * m, y: vein.y + 5 * m });
    assert.equal(r.ok, true);
  }
  for (let i = 0; i < nTurbines; i++) {
    const r = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -200 + 40 * i, y: -500 });
    assert.equal(r.ok, true);
  }
  return { state, vein };
}

describe('电力 throttle（v2）', () => {
  it('1 台风机（300kW）带不动 1 台采矿机（420kW）：ratio < 1', () => {
    const { state } = setupWithTurbines(1, 1);
    const p = engine.powerStats(state, content);
    assert.equal(p.demandKw, 420);
    assert.equal(p.generationKw, 300);
    assert.ok(p.ratio < 1, `ratio=${p.ratio}`);
    assert.ok(p.ratio > 0);
  });

  it('堆够风机后 ratio === 1', () => {
    const { state } = setupWithTurbines(2, 1);
    const p = engine.powerStats(state, content);
    assert.equal(p.generationKw, 600);
    assert.equal(p.ratio, 1);
  });

  it('v2 叠加耗电：矿机 ×2 时需求翻倍', () => {
    const { state } = setupWithTurbines(1, 2);
    const p = engine.powerStats(state, content);
    assert.equal(p.demandKw, 840);
    assert.equal(p.generationKw, 300);
    assert.ok(p.ratio < 1);
  });

  it('ratio < 1 时同窗口矿脉增速严格低于 ratio = 1', () => {
    const a = setupWithTurbines(1, 1); // 0.71 供电
    const b = setupWithTurbines(3, 1); // 满电
    engine.advance(a.state, content, 20);
    engine.advance(b.state, content, 20);
    const bufA = a.vein.buffer;
    const bufB = b.vein.buffer;
    assert.ok(bufA > 0, '欠电时也应有部分产出');
    assert.ok(bufB > bufA, `满电(${bufB}) 应高于欠电(${bufA})`);
  });
});

function unlockTech(state, techId) {
  if (state.unlockedTechs.indexOf(techId) < 0) state.unlockedTechs.push(techId);
}

describe('发电厂燃料切换（v2）', () => {
  it('火力发电厂默认使用煤，供煤后发电', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'thermal_power');
    state.stock.coal = 10;
    const r = engine.placeBuilding(state, content, { typeId: 'thermal_power_plant', x: 0, y: 0 });
    assert.equal(r.ok, true);
    const b = state.buildings[r.id];
    assert.equal(b.fuelItemId, 'coal');
    engine.depositFromStock(state, content, r.id, 'coal', 10);
    const p1 = engine.powerStats(state, content);
    assert.equal(p1.generationKw, 2160);
    engine.advance(state, content, 2);
    assert.ok((b.inBuf.coal || 0) < 10, '煤应被消耗');
  });

  it('可切换为高能石墨并消耗', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'thermal_power');
    state.stock.coal = 10;
    state.stock.energetic_graphite = 10;
    const r = engine.placeBuilding(state, content, { typeId: 'thermal_power_plant', x: 0, y: 0 });
    engine.depositFromStock(state, content, r.id, 'coal', 10);
    const res = engine.setFuelItemId(state, content, r.id, 'energetic_graphite');
    assert.equal(res.ok, true, JSON.stringify(res));
    const b = state.buildings[r.id];
    assert.equal(b.fuelItemId, 'energetic_graphite');
    assert.equal(b.inBuf.coal || 0, 0, '旧燃料应清空');
    assert.ok((state.stock.coal || 0) > 0, '旧燃料应退回库存');
    engine.depositFromStock(state, content, r.id, 'energetic_graphite', 10);
    engine.advance(state, content, 6); // 2160kW ÷ 6.3MJ ≈ 0.343/s → 6s ≈ 2.06 件
    assert.ok((b.inBuf.energetic_graphite || 0) < 10, '高能石墨应被消耗');
  });

  it('聚变站燃耗按能量计算（氘棒 600MJ → 0.025/s）', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'fusion_power');
    for (const it of ['steel', 'titanium_alloy', 'super_magnetic_ring', 'carbon_nanotube', 'processor']) state.stock[it] = 100;
    state.stock.deuteron_fuel_rod = 10;
    const r = engine.placeBuilding(state, content, { typeId: 'fusion_plant', x: 0, y: 0 });
    assert.equal(r.ok, true);
    engine.depositFromStock(state, content, r.id, 'deuteron_fuel_rod', 10);
    const p1 = engine.powerStats(state, content);
    assert.equal(p1.generationKw, 15000);
    engine.advance(state, content, 40); // 15000kW÷600MJ=0.025/s → 40s 烧 1 件
    assert.equal(state.stats.totalConsumed.deuteron_fuel_rod || 0, 1, '40 秒应恰好烧 1 根氘棒');
  });

  it('能量枢纽：充电模式计 45MW 需求，放电模式供 45MW 出力', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'energy_storage');
    for (const it of ['steel', 'titanium_alloy', 'processor', 'particle_container']) state.stock[it] = 100;
    const r = engine.placeBuilding(state, content, { typeId: 'energy_hub', x: 0, y: 0 });
    assert.equal(r.ok, true);
    const b = state.buildings[r.id];
    // 默认充电模式：demand 应含 45000
    const p1 = engine.powerStats(state, content);
    assert.ok(p1.demandKw >= 45000, '充电模式应计入 45MW 需求: ' + p1.demandKw);
    // 切放电：无满蓄电器不出力
    engine.setEnergyMode(state, content, r.id, 'discharge');
    const p2 = engine.powerStats(state, content);
    assert.ok(p2.generationKw === 0, '无满蓄电器时放电不应出力');
    // 有满蓄电器：放电 45MW
    b.inBuf = { charged_accumulator: 2 };
    const p3 = engine.powerStats(state, content);
    assert.ok(p3.generationKw >= 45000, '放电模式应供 45MW: ' + p3.generationKw);
    assert.ok(p3.demandKw < 45000, '放电模式不应再计充电需求');
    // 非法模式拒绝
    assert.equal(engine.setEnergyMode(state, content, r.id, 'turbo').reason, 'invalidEnergyMode');
    // 序列化往返保留 energyMode
    const saved = engine.serialize(state);
    assert.equal(saved.buildings[r.id].energyMode, 'discharge');
  });

  it('燃料能量越高烧得越久（氢慢于煤）', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'thermal_power');
    state.stock.coal = 20;
    state.stock.hydrogen = 20;
    const r = engine.placeBuilding(state, content, { typeId: 'thermal_power_plant', x: 0, y: 0 });
    assert.equal(r.ok, true);
    const b = state.buildings[r.id];
    engine.depositFromStock(state, content, r.id, 'coal', 10);
    engine.advance(state, content, 5); // 煤 2.7MJ → 0.8/s → 烧 4 件
    const coalLeft = b.inBuf.coal || 0;
    assert.equal(coalLeft, 6, '煤 5 秒应消耗 4 件');
    engine.setFuelItemId(state, content, r.id, 'hydrogen');
    engine.depositFromStock(state, content, r.id, 'hydrogen', 10);
    engine.advance(state, content, 5); // 氢 8MJ → 0.27/s → 烧 1 件
    const hLeft = b.inBuf.hydrogen || 0;
    assert.equal(hLeft, 9, '氢 5 秒只应消耗 1 件');
    assert.ok(hLeft > coalLeft, '同时间内氢消耗应少于煤');
  });

  it('拒绝切换到非允许燃料', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'thermal_power');
    const r = engine.placeBuilding(state, content, { typeId: 'thermal_power_plant', x: 0, y: 0 });
    const res = engine.setFuelItemId(state, content, r.id, 'iron_ingot');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalidFuel');
  });

  it('序列化往返保留燃料选择', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    unlockTech(state, 'thermal_power');
    const r = engine.placeBuilding(state, content, { typeId: 'thermal_power_plant', x: 0, y: 0 });
    engine.setFuelItemId(state, content, r.id, 'energetic_graphite');
    const saved = engine.serialize(state);
    const bSave = saved.buildings[r.id];
    assert.equal(bSave.fuelItemId, 'energetic_graphite');
    const restored = engine.deserialize(JSON.stringify(saved), content);
    const b2 = restored.buildings[r.id];
    assert.equal(b2.fuelItemId, 'energetic_graphite');
  });
});
