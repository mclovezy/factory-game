// offline-settle —— v2 离线结算：produced / seconds / capped（上限 8h）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, buildMatrixChain, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

describe('离线结算 settleOffline（v2）', () => {
  it('推进中的工厂离线 2 小时：produced 非空、seconds=7200、capped=false', () => {
    const { state } = buildMatrixChain(engine, content);
    engine.advance(state, content, 120); // 先让产线跑起来

    const report = engine.settleOffline(state, content, 7200);
    assert.equal(report.seconds, 7200);
    assert.equal(report.capped, false);
    const keys = Object.keys(report.produced);
    assert.ok(keys.length > 0, '离线 2h 应有产出');
    for (const k of keys) {
      assert.ok(content.item(k), `produced 中出现未知物品 ${k}`);
      assert.ok(report.produced[k] > 0);
    }
    // 离线结算真实推进了模拟时间（浮点累加留容差）
    assert.ok(Math.abs(state.stats.playSeconds - 7320) < 1e-6);
  });

  it('离线 3 天：按 8 小时上限截断，capped=true、seconds=28800', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const vein = state.veins['vein-iron_ore'];
    engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -100, y: -400 });
    engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });

    const report = engine.settleOffline(state, content, 3 * 86400);
    assert.equal(report.capped, true);
    assert.equal(report.seconds, 8 * 3600);
    assert.ok(Object.keys(report.produced).length > 0, '8 小时封顶内采矿机应有产出');
  });

  it('elapsedSeconds 非法值（0/负数/NaN）安全处理', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const r0 = engine.settleOffline(state, content, 0);
    assert.equal(r0.seconds, 0);
    assert.equal(r0.capped, false);
    assert.deepEqual(r0.produced, {});
    const rN = engine.settleOffline(state, content, NaN);
    assert.equal(rN.seconds, 0);
  });
});
