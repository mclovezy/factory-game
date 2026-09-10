// main-chain —— 主模拟链：采矿→熔炼→制造→科研矩阵→解锁科技（SPEC §3 模拟规则）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, buildMatrixChain, advanceUntilMatrix } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

describe('主链：采矿 → 熔炼 → 制造 → 科研矩阵 → 科技解锁', () => {
  it('starter 套件 + 传送带 + 配方 推进后产出电磁矩阵', () => {
    const { state } = buildMatrixChain(engine, content);
    const elapsed = advanceUntilMatrix(engine, content, state, 5);
    assert.ok(
      (state.scienceStock.electromagnetic_matrix || 0) > 0,
      `推进 ${elapsed}s 后电磁矩阵仍为 0`
    );
  });

  it('电磁矩阵 ≥5 时可开始研究 electromagnetism，推进后解锁', () => {
    const { state } = buildMatrixChain(engine, content);
    advanceUntilMatrix(engine, content, state, 5);

    const r = engine.startResearch(state, content, 'electromagnetism');
    assert.equal(r.ok, true, `startResearch 失败: ${JSON.stringify(r)}`);
    assert.equal(state.research.current, 'electromagnetism');

    // 需求 = 100 × (tier+1) = 100 点；1 个 lab = 1 点/秒
    let guard = 0;
    while (state.unlockedTechs.indexOf('electromagnetism') < 0 && guard++ < 20) {
      engine.advance(state, content, 60);
    }
    assert.ok(state.unlockedTechs.indexOf('electromagnetism') >= 0, '研究未在 1200s 内完成');
    assert.equal(state.research.current, null);
  });

  it('startResearch 在矩阵不足时拒绝（命令返回 {ok:false, reason}）', () => {
    const state = engine.createInitialState(content, Object.keys(content.PLANETS)[0]);
    const r = engine.startResearch(state, content, 'electromagnetism');
    assert.equal(r.ok, false);
    assert.ok(r.reason, '缺少 reason 文案 key');
  });

  it('解锁科技后对应建筑可放置（科技锁链生效）', () => {
    const state = engine.createInitialState(content, Object.keys(content.PLANETS)[0]);
    // splitter 需要 basic_logistics —— 未解锁时应拒绝
    const denied = engine.placeBuilding(state, content, { typeId: 'splitter', x: 0, y: 0 });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'techLocked');

    state.unlockedTechs.push('basic_logistics');
    const allowed = engine.placeBuilding(state, content, { typeId: 'splitter', x: 0, y: 0 });
    assert.equal(allowed.ok, true);
  });
});
