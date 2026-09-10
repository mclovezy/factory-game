// planet-selfsufficiency —— 单行星自举：从一颗行星的矿脉 + 殖民补给出发，
// 钛晶石 / 结构矩阵必须可达，否则玩家降落该行星后进度死锁。
//
// 背景：结构矩阵需要钛晶石 → 有机晶体（化工厂，需石/水/原油）；
//       而行星间物流科技（processor_tech）反过来消耗结构矩阵，形成环：
//       没有结构矩阵拿不到物流，没有物流又搬不来钛/有机晶体。
//       因此「首次可殖民的钛矿行星」必须能就地跑通整条链，作为全局破环点。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const { ITEMS, RECIPES, BUILDINGS, TECHNOLOGIES: TECH, PLANETS } = content;

// 采矿类建筑 → 可采资源（null = 全部固体矿），与 tech-deadlock.test.mjs 保持一致
const MINER_ORES = {
  mining_machine: null,
  advanced_miner: null,
  water_pump: ['water', 'sulfuric_acid', 'hydrogen'],
  oil_extractor: ['crude_oil'],
};

/** 单行星不动点：采矿只能从该行星的 oreTypes 取得资源 */
function reachableOnPlanet(planetId, seedItems) {
  const ores = new Set(PLANETS[planetId].oreTypes);
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
    for (const [bid, list] of Object.entries(MINER_ORES)) {
      if (!buildings.has(bid)) continue;
      const targets = list || Object.keys(ITEMS).filter((i) => ITEMS[i].category === 'ore' && ITEMS[i].kind === 'solid');
      for (const ore of targets) {
        if (ores.has(ore) && !items.has(ore)) { items.add(ore); changed = true; }
      }
    }
    for (const r of Object.values(RECIPES)) {
      if (r.outputs.length === 0 || !recipeReady(r)) continue;
      for (const o of r.outputs) if (!items.has(o.itemId)) { items.add(o.itemId); changed = true; }
    }
  }
  return { tech, items, buildings };
}

/** 用真实路径取「殖民补给」：母星建局 → travelTo 目标行星（首次抵达发放入门建材） */
function colonySeed(planetId) {
  const st = engine.createInitialState(content, homePlanetId(content));
  const r = engine.travelTo(st, content, planetId);
  assert.ok(r && r.ok !== false, `travelTo(${planetId}) 失败: ${JSON.stringify(r)}`);
  return Object.keys(st.stock);
}

describe('单行星自举：钛晶石 / 结构矩阵链路可跑通', () => {
  it('焰砾 II：仅凭本星矿脉 + 殖民补给即可产出钛晶石与结构矩阵', () => {
    const seed = colonySeed('yanli');
    const { items } = reachableOnPlanet('yanli', seed);
    assert.ok(items.has('stone_brick'), '石材不可达（缺石矿）');
    assert.ok(items.has('plastic'), '塑料不可达（缺原油）');
    assert.ok(items.has('organic_crystal'), '有机晶体不可达（化工厂缺石/水/原油）');
    assert.ok(items.has('titanium_ingot'), '钛块不可达（缺钛矿）');
    assert.ok(items.has('titanium_crystal'), '钛晶石不可达');
    assert.ok(items.has('structure_matrix'), '结构矩阵不可达');
  });

  it('焰砾 II 具备化工厂与钛晶石链所需的全部矿种', () => {
    const ores = PLANETS.yanli.oreTypes;
    for (const need of ['stone', 'water', 'crude_oil', 'titanium_ore', 'coal']) {
      assert.ok(ores.includes(need), `焰砾 II 缺少矿种 ${need}`);
    }
    // 化工厂本体所需的建材也能就地生产
    for (const mat of ['stone_brick', 'glass', 'circuit_board']) {
      assert.ok(content.ITEMS[mat], `建材 ${mat} 不存在`);
    }
  });

  it('老存档兼容：抵达后自动补齐行星新增矿产的矿脉', () => {
    const st = engine.createInitialState(content, homePlanetId(content));
    // 模拟旧档：焰砾 II 只有调整前的 7 种矿脉，位置取任意哨兵值
    const oldOres = ['iron_ore', 'copper_ore', 'silicon_ore', 'titanium_ore', 'coal', 'sulfuric_acid', 'kimberlite_ore'];
    const oldVeins = {};
    for (const o of oldOres) {
      oldVeins['vein-' + o] = {
        id: 'vein-' + o, itemId: o, x: 123, y: 456,
        miners: 0, buffer: 0, cap: 300, minerType: null, minerCounts: {},
      };
    }
    st.planets.yanli = { buildings: {}, belts: {}, veins: oldVeins, stock: {}, buildingReserve: {} };

    const r = engine.travelTo(st, content, 'yanli');
    assert.ok(r && r.ok !== false, `travelTo 失败: ${JSON.stringify(r)}`);
    const veins = st.planets.yanli.veins;
    for (const need of ['stone', 'water', 'crude_oil']) {
      assert.ok(veins['vein-' + need], `旧档未补齐 ${need} 矿脉`);
    }
    // 旧矿脉保持原样，不被覆盖
    assert.equal(veins['vein-iron_ore'].x, 123);
  });
});
