import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine } from './helpers.mjs';

const { content } = loadContentAndEngine();
const TECHS = content.TECHNOLOGIES;
const STAGES = content.TECH_STAGES;
const stageIndexOfItem = {};
STAGES.forEach((s, i) => { stageIndexOfItem[s.id] = i; });

// 成本里的最高阶矩阵序号（无矩阵成本视为 0）
function matrixStageOf(tech) {
  let s = 0;
  for (const c of tech.costs || []) {
    const idx = stageIndexOfItem[c.itemId];
    if (idx !== undefined && idx > s) s = idx;
  }
  return s;
}

test('每个科技都有 stage，且等于成本最高阶矩阵序号或更高（前置传播）', () => {
  for (const id of Object.keys(TECHS)) {
    const t = TECHS[id];
    assert.ok(Number.isInteger(t.stage), id + ' 缺少 stage');
    assert.ok(t.stage >= 0 && t.stage < STAGES.length, id + ' stage 越界: ' + t.stage);
    assert.ok(t.stage >= matrixStageOf(t), id + ' stage 小于自身成本矩阵阶');
  }
});

test('stage 沿前置单调：科技 stage ≥ 其所有前置的 stage', () => {
  for (const id of Object.keys(TECHS)) {
    const t = TECHS[id];
    for (const preId of t.prerequisites || []) {
      assert.ok(TECHS[preId], id + ' 的前置不存在: ' + preId);
      assert.ok(t.stage >= TECHS[preId].stage,
        id + '(stage ' + t.stage + ') 早于前置 ' + preId + '(stage ' + TECHS[preId].stage + ')');
    }
  }
});

test('阶段 0 只含只需电磁矩阵的科技，高级矩阵科技全部靠后', () => {
  for (const id of Object.keys(TECHS)) {
    const t = TECHS[id];
    if (matrixStageOf(t) === 0) continue; // 自身只要电磁矩阵，允许在任意阶段（前置传播）
    assert.ok(t.stage > 0, id + ' 需要高级矩阵却在阶段 0');
  }
  // 至少存在一个阶段 0 科技
  assert.ok(Object.keys(TECHS).some(id => TECHS[id].stage === 0), '阶段 0 不应为空');
});

test('全部 6 个阶段都有科技（分列不为空）', () => {
  const used = new Set(Object.keys(TECHS).map(id => TECHS[id].stage));
  for (let i = 0; i < STAGES.length; i++) {
    assert.ok(used.has(i), '阶段 ' + i + '（' + STAGES[i].name + '）没有科技');
  }
});

test('tier 语义不变：仍等于依赖深度（前置 tier 严格更小）', () => {
  for (const id of Object.keys(TECHS)) {
    const t = TECHS[id];
    for (const preId of t.prerequisites || []) {
      assert.ok(t.tier > TECHS[preId].tier, id + ' tier 未大于前置 ' + preId);
    }
  }
});
