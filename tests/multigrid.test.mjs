import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

// 预拨充足库存，避免建筑放置扣除成本后相互耗尽
function grant(state) {
  const g = { iron_ingot: 500, gear: 500, magnetic_coil: 500, circuit_board: 500, stone_brick: 200, glass: 200, copper_ingot: 500, magnet: 500 };
  for (const k in g) state.stock[k] = (state.stock[k] || 0) + g[k];
}

test('gridRatios 返回 a/b/c 三电网独立比率', () => {
  const state = engine.createInitialState(content, homePlanetId(content));
  grant(state);
  // 电网 a 放发电机
  for (let i = 0; i < 8; i++) {
    const r = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -400 + 80 * i, y: -700 });
    assert.ok(r.ok, '放置风机应成功');
  }
  // 电网 b 放纯耗电建筑（不运行，仅产生需求）
  const c = engine.placeBuilding(state, content, { typeId: 'assembler_mk1', x: 0, y: 0 });
  assert.ok(c.ok, '放置制造台应成功');
  state.buildings[c.id].grid = 'b';

  const gr = engine.gridRatios(state, content);
  assert.ok(gr.a && gr.b && gr.c, 'gridRatios 应包含 a/b/c');
  assert.equal(gr.a.ratio, 1, '电网 a 仅发电无耗电，比率应为 1');
  assert.equal(gr.c.ratio, 1, '电网 c 为空，比率应为 1');
  assert.equal(gr.b.ratio, 0, '电网 b 纯耗电无发电，比率应为 0');
});

test('电网 b 缺电时建筑 stallReason=no_power，进度不推进', () => {
  const state = engine.createInitialState(content, homePlanetId(content));
  grant(state);
  const c = engine.placeBuilding(state, content, { typeId: 'assembler_mk1', x: 0, y: 0 });
  assert.ok(c.ok);
  const cid = c.id;
  const rr = engine.setRecipe(state, content, cid, 'copper_wire');
  assert.ok(rr.ok);
  // setRecipe 会重置 inBuf，故在之后注入输入
  state.buildings[cid].inBuf.copper_ingot = 200;
  state.buildings[cid].grid = 'b'; // 无发电机
  engine.advance(state, content, 20);
  const b = state.buildings[cid];
  assert.equal(b.stalled, true, '缺电建筑应停滞');
  assert.equal(b.stallReason, 'no_power', '停滞原因应为 no_power');
  assert.ok((b.progress || 0) < 0.001, '无电时制造进度不应推进');
});

test('电网 b 有独立发电机后建筑恢复运行', () => {
  const state = engine.createInitialState(content, homePlanetId(content));
  grant(state);
  const c = engine.placeBuilding(state, content, { typeId: 'assembler_mk1', x: 0, y: 0 });
  assert.ok(c.ok);
  const cid = c.id;
  const rr = engine.setRecipe(state, content, cid, 'copper_wire');
  assert.ok(rr.ok);
  state.buildings[cid].inBuf.copper_ingot = 200;
  state.buildings[cid].grid = 'b';
  // 给电网 b 单独配发电机
  for (let i = 0; i < 2; i++) {
    const r = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 200 + 80 * i, y: 200 });
    assert.ok(r.ok);
    state.buildings[r.id].grid = 'b';
  }
  engine.advance(state, content, 20);
  const b = state.buildings[cid];
  assert.notEqual(b.stallReason, 'no_power', '有独立供电后不应缺电');
  assert.ok((b.progress || 0) > 0 || b.outBuf.copper_wire > 0, '有电时应推进生产');
});

test('powerStats 返回分电网明细 grids', () => {
  const state = engine.createInitialState(content, homePlanetId(content));
  grant(state);
  for (let i = 0; i < 6; i++) {
    engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -400 + 80 * i, y: -700 });
  }
  const ps = engine.powerStats(state, content);
  assert.ok(ps.grids, 'powerStats 应含 grids');
  assert.ok(ps.grids.a && ps.grids.b && ps.grids.c, 'grids 应含 a/b/c');
  assert.equal(typeof ps.grids.a.ratio, 'number');
  assert.equal(typeof ps.demandKw, 'number', '应保持聚合 demandKw 向后兼容');
  assert.equal(typeof ps.ratio, 'number', '应保持聚合 ratio 向后兼容');
});
