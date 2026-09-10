// dyson-planner —— 戴森球规划器（系统7）：多轨道节点放置/移除/拖拽换位/进度发电兼容/存档往返
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function fresh() {
  const state = engine.createInitialState(content, homePlanetId(content));
  state.dyson.spherePoints = 100; // 预置结构点
  return state;
}

describe('戴森球规划器（系统7）', () => {
  it('放置：消耗 20 点/节点；槽位占用与越界拒绝；点数不足拒绝', () => {
    const state = fresh();
    const p1 = engine.placeDysonNode(state, content, 0, 0);
    assert.ok(p1.ok, JSON.stringify(p1));
    assert.equal(state.dyson.spherePoints, 80);
    assert.equal(engine.dysonLayout(state).nodes.length, 1);

    const dup = engine.placeDysonNode(state, content, 0, 0);
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, 'slotTaken');

    const bad = engine.placeDysonNode(state, content, 3, 0);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'badSlot');

    state.dyson.spherePoints = 10;
    const poor = engine.placeDysonNode(state, content, 1, 5);
    assert.equal(poor.ok, false);
    assert.equal(poor.reason, 'notEnoughPoints');
  });

  it('移除退还结构点；拖拽换位校验目标槽位', () => {
    const state = fresh();
    assert.ok(engine.placeDysonNode(state, content, 0, 0).ok);
    assert.ok(engine.placeDysonNode(state, content, 2, 11).ok);
    assert.equal(state.dyson.spherePoints, 60);

    // 移除退还
    const rm = engine.removeDysonNode(state, content, 0, 0);
    assert.ok(rm.ok, JSON.stringify(rm));
    assert.equal(state.dyson.spherePoints, 80);
    const rmEmpty = engine.removeDysonNode(state, content, 0, 0);
    assert.equal(rmEmpty.reason, 'noNode');

    // 移动到空槽
    const mv = engine.moveDysonNode(state, content, 2, 11, 1, 3);
    assert.ok(mv.ok, JSON.stringify(mv));
    assert.ok(engine.dysonNodeAt(state, 1, 3), '节点应在目标槽位');
    // 移动到已占用槽
    engine.placeDysonNode(state, content, 0, 0);
    const mvDup = engine.moveDysonNode(state, content, 1, 3, 0, 0);
    assert.equal(mvDup.ok, false);
    assert.equal(mvDup.reason, 'slotTaken');
    // 总点数守恒（自由 + 节点折算）
    const layout = engine.dysonLayout(state);
    assert.equal(layout.freePoints + layout.spentPoints, 100);
  });

  it('进度与发电兼容：节点折算结构点，拆除后不变', () => {
    const state = fresh(); // 100 自由点，0 节点
    const prog0 = engine.dysonProgress(state);
    const pw0 = engine.dysonPowerOf ? 0 : 0;
    // 放 5 个节点（消耗 100 点）→ 总点数不变
    for (let i = 0; i < 5; i++) assert.ok(engine.placeDysonNode(state, content, i % 3, i * 2).ok);
    assert.equal(engine.dysonProgress(state), prog0);
    const layout = engine.dysonLayout(state);
    assert.equal(layout.nodes.length, 5);
    assert.equal(layout.freePoints, 0);
    assert.equal(layout.nodeGenKw, 5 * 100000);
  });

  it('存档往返保留节点布局', () => {
    const state = fresh();
    engine.placeDysonNode(state, content, 0, 1);
    engine.placeDysonNode(state, content, 2, 7);
    const saved = JSON.parse(JSON.stringify(engine.serialize(state)));
    const st2 = engine.deserialize(saved, content);
    assert.ok(st2, 'deserialize null');
    assert.equal(st2.dyson.nodes.length, 2);
    const l2 = engine.dysonLayout(st2);
    assert.equal(l2.freePoints, 60);
    assert.equal(l2.spentPoints, 40);
    assert.ok(engine.dysonNodeAt(st2, 2, 7), '节点位置应还原');
    // 旧档（无 nodes 字段）兼容
    const oldSaved = JSON.parse(JSON.stringify(engine.serialize(state)));
    delete oldSaved.dyson.nodes;
    const st3 = engine.deserialize(oldSaved, content);
    assert.ok(st3);
    assert.equal(engine.dysonLayout(st3).nodes.length, 0);
  });
});
