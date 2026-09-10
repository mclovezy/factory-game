// stock-overflow —— 溢出入库（outBuf 堵住 → 过剩产物入库存，单种上限 STOCK_OVERFLOW_CAP）
// + withdrawFromStock 输出端（srcBuf='out'）回收
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

/** 搭最小产线：矿机→带→熔炉(铁块)，熔炉出口不接任何带 → outBuf 必堵 */
function buildJammedSmelter() {
  const state = engine.createInitialState(content, homePlanetId(content));
  state.unlockedTechs.push('basic_logistics');
  state.buildingReserve.wind_turbine = 4;
  state.buildingReserve.mining_machine = 1;
  state.buildingReserve.arc_smelter = 1;
  for (let i = 0; i < 4; i++) {
    const r = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -700 + 90 * i, y: -700 });
    assert.ok(r.ok, 'place wind_turbine: ' + JSON.stringify(r));
  }
  const v = state.veins['vein-iron_ore'];
  assert.ok(engine.placeBuilding(state, content, { typeId: 'mining_machine', x: v.x + 10, y: v.y + 10 }).ok, 'place miner');
  const sm = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 0, y: 0 });
  assert.ok(sm.ok, 'place smelter');
  assert.ok(engine.setRecipe(state, content, sm.id, 'iron_ingot').ok, 'set recipe');
  assert.ok(engine.connectBelt(state, content, { fromId: v.id, toId: sm.id, tier: 1 }).ok, 'belt vein->smelter');
  return { state, smId: sm.id };
}

describe('溢出入库（outBuf 堵住 → stock）', () => {
  it('出口无带时产物溢出入库存，机器保持运转', () => {
    const { state, smId } = buildJammedSmelter();
    engine.advance(state, content, 300);
    const sm = state.buildings[smId];
    assert.ok((state.stock.iron_ingot || 0) > 0, '溢出应使库存增长');
    assert.ok(sumOut(sm) <= outputCap(sm) + 1e-6, 'outBuf 不应超过容量');
    // 机器没有被 output_full 卡死：300s 内持续产出
    assert.ok((state.stats.totalProduced.iron_ingot || 0) > 50, '应持续生产而非停转');
  });

  it('库存达到单种上限后停止溢出，恢复背压停转（output_full）', () => {
    const { state, smId } = buildJammedSmelter();
    state.stock.iron_ingot = 999; // 距上限仅 1
    engine.advance(state, content, 600);
    assert.ok(state.stock.iron_ingot <= 1000, '库存不应突破溢出上限');
    const sm = state.buildings[smId];
    // 库存到顶后 outBuf 放不下 → output_full
    assert.equal(sm.stallReason, 'output_full');
    assert.equal(sm.stalled, true);
  });
});

describe('withdrawFromStock 输出端回收', () => {
  it('srcBuf=\'out\'：从 outBuf 回收产物入库存', () => {
    const { state, smId } = buildJammedSmelter();
    state.buildings[smId].outBuf.iron_ingot = 50;
    const r = engine.withdrawFromStock(state, content, smId, 'iron_ingot', undefined, 'out');
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.moved, 50);
    assert.equal(state.buildings[smId].outBuf.iron_ingot || 0, 0);
    assert.ok((state.stock.iron_ingot || 0) >= 50);
  });

  it('缺省仍从 inBuf 回收（向后兼容，不动 outBuf）', () => {
    const { state, smId } = buildJammedSmelter();
    state.buildings[smId].inBuf.iron_ore = 20;
    state.buildings[smId].outBuf.iron_ingot = 30;
    // inBuf 里没有 iron_ingot → 缺省路径报 nothingToWithdraw，outBuf 原样保留
    const r = engine.withdrawFromStock(state, content, smId, 'iron_ingot');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'nothingToWithdraw');
    assert.equal(state.buildings[smId].outBuf.iron_ingot, 30);
    assert.equal(state.buildings[smId].inBuf.iron_ore, 20);
    // inBuf 有货时缺省路径正常回收
    state.buildings[smId].inBuf.iron_ingot = 7;
    const r2 = engine.withdrawFromStock(state, content, smId, 'iron_ingot');
    assert.ok(r2.ok);
    assert.equal(r2.moved, 7);
    assert.equal(state.buildings[smId].outBuf.iron_ingot, 30);
  });
});

function sumOut(b) { let s = 0; for (const k in (b.outBuf || {})) s += b.outBuf[k]; return s; }
function outputCap(b) {
  const def = content.BUILDINGS[b.typeId];
  return (def ? def.outputCapacity || 0 : 0) * Math.max(1, b.count || 1);
}
