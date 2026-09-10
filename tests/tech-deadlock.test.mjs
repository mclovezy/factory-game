// tech-deadlock —— 科技/配方解锁链不得自依赖（死锁回归测试）
// 背景：历史上多次出现「解锁某矩阵的科技（或其必需前置/建筑用料）反过来消耗该矩阵」
//       导致该矩阵永远无法产出。本文件把检测固化为可执行断言。
//
// 模型：以 createInitialState 的启动物资 + 全部可采矿脉为起点做不动点迭代，
//       模拟「科技可研究 → 建筑可建造 → 物品可产出」的解锁推进。
//       类别层面可达即算通过（不建模具体数量，死锁本质是类别循环）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const { ITEMS, RECIPES, BUILDINGS, TECHNOLOGIES: TECH, PLANETS, MATRIX_ITEM_IDS } = content;

// 采矿类建筑可采資源を見なす映射（name -> 可采资源）
const MINER_ORES = {
  mining_machine: null, // 全部固体矿
  advanced_miner: null,
  water_pump: ['water', 'sulfuric_acid'],
  oil_extractor: ['crude_oil'],
  orbital_collector: ['hydrogen', 'fire_ice'],
};

/** 从给定初始物品集合出发，迭代推进到不动点，返回 {tech, items, buildings} */
function reachable(seedItems) {
  const tech = new Set();
  const items = new Set(seedItems);
  const buildings = new Set();

  const buildable = (b) => {
    if (b.techId != null && !tech.has(b.techId)) return false;
    for (const c of (b.costs || [])) if (!items.has(c.itemId)) return false;
    return true;
  };
  const recipeReady = (r) => {
    if (r.requiredTechId != null && !tech.has(r.requiredTechId)) return false;
    if (!buildings.has(r.buildingId)) return false;
    for (const inp of r.inputs) if (!items.has(inp.itemId)) return false;
    return true;
  };

  let changed = true, guard = 0;
  while (changed && guard++ < 400) {
    changed = false;
    for (const id in TECH) {
      if (tech.has(id)) continue;
      const t = TECH[id];
      if (!t.prerequisites.every((p) => tech.has(p))) continue;
      if (!t.costs.every((c) => items.has(c.itemId))) continue;
      tech.add(id); changed = true;
    }
    for (const b of Object.values(BUILDINGS)) {
      if (buildings.has(b.id) || !buildable(b)) continue;
      buildings.add(b.id); changed = true;
    }
    // 采矿：建筑就位即可从其矿脉取得資源
    const allOres = new Set();
    for (const p of Object.values(PLANETS)) for (const o of p.oreTypes) allOres.add(o);
    for (const [bid, ores] of Object.entries(MINER_ORES)) {
      if (!buildings.has(bid)) continue;
      const targets = ores || Object.keys(ITEMS).filter((i) => ITEMS[i].category === 'ore' && ITEMS[i].kind === 'solid');
      for (const ore of targets) {
        if (allOres.has(ore) && !items.has(ore)) { items.add(ore); changed = true; }
      }
    }
    for (const r of Object.values(RECIPES)) {
      if (r.outputs.length === 0 || !recipeReady(r)) continue;
      for (const o of r.outputs) if (!items.has(o.itemId)) { items.add(o.itemId); changed = true; }
    }
  }
  return { tech, items, buildings };
}

// 起点：createInitialState 的启动物资 + 全部固体矿脈
const initState = engine.createInitialState(content, 'qiming');
const SEED = Object.keys(initState.stock);
for (const id in ITEMS) {
  if (ITEMS[id].category === 'ore' && ITEMS[id].kind === 'solid') SEED.push(id);
}

describe('解锁链无死锁：全量自举', () => {
  const { tech, items, buildings } = reachable(SEED);

  it('全部 6 种科研矩阵均可产出', () => {
    for (const m of MATRIX_ITEM_IDS) {
      assert.ok(items.has(m), `矩阵 ${m} 永远无法产出（解锁链死锁）`);
    }
  });

  it('全部科技均可研究', () => {
    const unreachable = Object.keys(TECH).filter((id) => !tech.has(id));
    assert.deepEqual(unreachable, [], `不可达科技: ${unreachable.join(', ')}`);
  });

  it('全部建筑均可建造', () => {
    const unreachable = Object.keys(BUILDINGS).filter((id) => !buildings.has(id));
    assert.deepEqual(unreachable, [], `不可建造建筑: ${unreachable.join(', ')}`);
  });
});

describe('阶段递进：第 k 阶矩阵只依赖更低阶矩阵', () => {
  // 对每个矩阵 M(k)：假设 stage<k 的矩阵已可无限供应，M 必须可达。
  // 若失败，说明 M 的生产链上有科技错误地消耗了 ≥k 阶矩阵。
  MATRIX_ITEM_IDS.forEach((matrixId, k) => {
    it(`${matrixId}（第 ${k} 阶）可由前 ${k} 阶矩阵解锁产出`, () => {
      const granted = MATRIX_ITEM_IDS.slice(0, k); // stage < k 的矩阵
      const { items } = reachable([...SEED, ...granted]);
      assert.ok(items.has(matrixId),
        `${matrixId} 的生产链依赖了它自己或更高阶矩阵（其必需科技/建筑用料消耗了 ≥${k} 阶矩阵）`);
    });
  });
});
