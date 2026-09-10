// save-roundtrip —— v2 serialize → JSON → parse → deserialize 后模拟确定性
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, buildMatrixChain, advanceUntilMatrix } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

describe('存档往返确定性（v2）', () => {
  it('serialize→JSON.stringify→parse→deserialize 后推进相同秒数，scienceStock/stock/统计完全一致', () => {
    const { state } = buildMatrixChain(engine, content);
    advanceUntilMatrix(engine, content, state, 5);
    assert.ok((state.scienceStock.electromagnetic_matrix || 0) > 0);

    const snap = engine.serialize(state);
    assert.equal(snap.version, 2);
    const json = JSON.stringify(snap);
    const clone = engine.deserialize(JSON.parse(json), content);
    assert.ok(clone && clone !== state);
    assert.equal(clone.version, 2);
    assert.equal(clone.planetId, state.planetId);
    assert.equal(Object.keys(clone.buildings).length, Object.keys(state.buildings).length);
    assert.equal(Object.keys(clone.belts).length, Object.keys(state.belts).length);
    assert.equal(Object.keys(clone.veins).length, Object.keys(state.veins).length);

    engine.advance(state, content, 120);
    engine.advance(clone, content, 120);

    assert.deepEqual(clone.scienceStock, state.scienceStock);
    assert.deepEqual(clone.stock, state.stock);
    assert.deepEqual(clone.stats.totalProduced, state.stats.totalProduced);
    assert.deepEqual(clone.unlockedTechs, state.unlockedTechs);
    assert.equal(clone.time, state.time);
    assert.equal(clone.stats.playSeconds, state.stats.playSeconds);
  });

  it('v2 版本闸门：旧版本/脏数据返回 null（上层提示版本过旧）', () => {
    assert.equal(engine.deserialize('not-json{{', content), null);
    assert.equal(engine.deserialize({}, content), null);
    assert.equal(engine.deserialize({ version: 1, buildings: {} }, content), null);
  });

  it('瞬态字段不进入存档（serialize 输出可直接 JSON 化）', () => {
    const { state } = buildMatrixChain(engine, content);
    engine.advance(state, content, 30);
    const snap = engine.serialize(state);
    const keys = Object.keys(snap);
    for (const k of keys) assert.ok(!k.startsWith('_'), `存档不应含瞬态字段 ${k}`);
    assert.ok(Object.keys(snap.veins).length > 0, '存档应包含矿脉');
    assert.ok(snap.stats && typeof snap.stats.playSeconds === 'number');
  });
});
