// stats —— 详细生产统计：生产/消耗速率对称、累计统计、UI 列数据可用
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, buildMatrixChain } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

describe('生产/消耗统计', () => {
  it('consumptionRates 与 productionRates 在运行后均有数据且与累计一致', () => {
    const { state } = buildMatrixChain(engine, content);
    // 推进一段时间以填充 _consLog / _rateLog（每秒一次记账）
    engine.advance(state, content, 120);

    const prod = engine.productionRates(state, content, 10);
    const cons = engine.consumptionRates(state, content, 10);
    assert.ok(prod.length > 0, '生产速率应为非空');
    assert.ok(cons.length > 0, '消耗速率应为非空');

    // 矩阵生产链中，实验室消耗磁线圈/电路板，熔炉消耗矿石等
    const consIds = new Set(cons.map(c => c.itemId));
    assert.ok(consIds.has('magnetic_coil') || consIds.has('circuit_board') || consIds.has('iron_ore') || consIds.has('copper_ore'),
      '应至少记录一种中间/原料消耗');

    // 累计消耗应 >= 窗口期内瞬时消耗之和
    const totalCons = state.stats.totalConsumed || {};
    let consSum = 0;
    for (const c of cons) consSum += c.perSec * 10;
    let totalConsSum = 0;
    for (const k in totalCons) totalConsSum += totalCons[k];
    assert.ok(totalConsSum >= consSum - 1, '累计消耗应不小于窗口期内瞬时消耗之和');
  });

  it('productionRates 包含电磁矩阵产出', () => {
    const { state } = buildMatrixChain(engine, content);
    // 推进直到矩阵研究站实际产出至少 1 个电磁矩阵（验证整条链 + trackProduced）
    const elapsed = (function () {
      let e = 0;
      while ((state.scienceStock.electromagnetic_matrix || 0) < 1 && e < 3600) {
        engine.advance(state, content, 60);
        e += 60;
      }
      return e;
    })();
    assert.ok(elapsed < 3600, '矩阵生产链应在 3600s 内产出首个矩阵');
    const prod = engine.productionRates(state, content, 10);
    const map = {};
    for (const p of prod) map[p.itemId] = p.perSec;
    assert.ok(map.electromagnetic_matrix !== undefined, '应统计电磁矩阵产出速率');
  });

  it('serialize/deserialize 保留累计消耗统计', () => {
    const { state } = buildMatrixChain(engine, content);
    engine.advance(state, content, 60);
    const dump = engine.serialize(state);
    const restored = engine.deserialize(dump, content); // 签名: deserialize(json, content)
    assert.ok(restored.stats.totalConsumed, '反序列化后应有 totalConsumed');
    const before = Object.keys(state.stats.totalConsumed || {}).length;
    const after = Object.keys(restored.stats.totalConsumed || {}).length;
    assert.equal(after, before, '累计消耗条目数应保持一致');
  });
});
