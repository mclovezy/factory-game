// antimatter —— 反物质链（系统5）：射线接收站×戴森云 → 临界光子 → 反物质 → 燃料发电机
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function fresh(grant) {
  const state = engine.createInitialState(content, homePlanetId(content));
  state.unlockedTechs.push('ray_receiver_tech', 'antimatter_tech', 'artificial_star_tech', 'thermal_power', 'particle_physics');
  const g = { iron_ingot: 400, steel: 400, high_purity_silicon: 200, photon_combiner: 200, processor: 200, titanium_alloy: 200, frame_material: 200, quantum_chip: 100, solar_sail: 200, particle_container: 100, stone_brick: 200, copper_ingot: 100, gear: 100, magnetic_coil: 200, circuit_board: 200, graphene: 200, super_magnetic_ring: 200, annihilation_constraint_sphere: 100 };
  for (const k in (grant || g)) state.stock[k] = (state.stock[k] || 0) + (grant || g)[k];
  for (let i = 0; i < 40; i++) engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -400 + 80 * i, y: -700 });
  return state;
}

function place(state, typeId, x, y) {
  const r = engine.placeBuilding(state, content, { typeId, x, y });
  if (!r.ok) throw new Error('place ' + typeId + ' fail: ' + JSON.stringify(r));
  return state.buildings[r.id];
}

describe('反物质链（系统5）', () => {
  it('射线接收站：无戴森云时 no_dyson 停滞；发射帆后按效率产出临界光子', () => {
    const state = fresh();
    const rx = place(state, 'ray_receiver', 0, -400);
    engine.setRecipe(state, content, rx.id, 'critical_photon');
    engine.advance(state, content, 20);
    assert.equal(rx.stalled, true);
    assert.equal(rx.stallReason, 'no_dyson');
    assert.equal(state.stats.totalProduced.critical_photon || 0, 0);

    // 发射 30 片帆：30×88=2640kW，1 台接收站容量 6000 → 效率 0.44
    for (let i = 0; i < 30; i++) {
      const r = engine.launchSail(state, content);
      assert.ok(r.ok, JSON.stringify(r));
    }
    engine.advance(state, content, 100); // 理论周期 ≈ 100/10 × 0.44 ≈ 4.4
    assert.equal(rx.stalled, false);
    const made = state.stats.totalProduced.critical_photon || 0;
    assert.ok(made >= 2 && made <= 6, 'critical_photon made=' + made);
  });

  it('对撞机：临界光子 → 反物质 + 氢', () => {
    const state = fresh();
    const collider = place(state, 'particle_collider', 0, -400, undefined);
    engine.setRecipe(state, content, collider.id, 'antimatter');
    collider.inBuf = { critical_photon: 10 };
    engine.advance(state, content, 10); // duration 2 → 5 周期
    const am = state.stats.totalProduced.antimatter || 0;
    assert.ok(am >= 5, 'antimatter made=' + am);
    assert.ok((state.stats.totalProduced.hydrogen || 0) >= 10, '氢副产');
  });

  it('人造恒星：缺燃料不发电（no_fuel）；供反物质燃料棒后 72MW 且持续耗棒', () => {
    const state = fresh();
    const star = place(state, 'artificial_star', 0, -400);
    engine.advance(state, content, 1); // 触发一次模拟，标记缺料状态
    const p0 = engine.powerStats(state, content);
    assert.ok(p0.generationKw < 72000, '无燃料时人造星不应出力: ' + p0.generationKw);
    assert.equal(star.stalled, true);
    assert.equal(star.stallReason, 'no_fuel');

    star.inBuf = { antimatter_fuel_rod: 3 };
    const p1 = engine.powerStats(state, content);
    assert.ok(p1.generationKw >= 72000, '供料后应满功率发电: ' + p1.generationKw);
    engine.advance(state, content, 320); // 燃耗=72MW÷7200MJ=0.01/s → 320s 烧 3 件
    assert.ok((state.stats.totalConsumed.antimatter_fuel_rod || 0) >= 3, '应持续消耗燃料棒: ' + state.stats.totalConsumed.antimatter_fuel_rod);
  });

  it('火电厂：缺煤 no_fuel，煤矿供煤后恢复发电', () => {
    const state = fresh();
    const thermal = place(state, 'thermal_power_plant', 0, -400);
    engine.advance(state, content, 1);
    assert.equal(thermal.stallReason, 'no_fuel');
    thermal.inBuf = { coal: 10 };
    engine.advance(state, content, 4); // 燃耗=2.16MW÷2.7MJ=0.8/s → 3.2 件
    assert.ok((state.stats.totalConsumed.coal || 0) >= 1, '应消耗煤');
    assert.ok(thermal.inBuf.coal >= 0);
  });
});
