// planet-complementarity —— 行星互补：启明 I 与焰砾 II 必须互相依赖。
//
// 设计（2026-09-10 与用户确认）：
//   启明 I（母星）：铁/铜/石/煤/水/原油 —— 水油石齐备，造得出塑料与有机晶体，硅也能由石矿提炼；
//                  但没有钛矿，钛块 / 钛合金 / 钛晶石一律造不出。
//   焰砾 II：铁/铜/石/煤/水/硅/钛/硫酸/金伯利 —— 硅钛自足，却没有原油，造不出塑料与有机晶体。
//   结构矩阵 = 金刚石（哪都能造）+ 钛晶石，而 钛晶石 = 钛块（只有焰砾 II 有）+ 有机晶体（只有启明 I 能造），
//   所以必须靠跨星物流双向对流才能点亮点黄色矩阵。
//
// 历史事故：processor_tech / planetary_logistics 曾消耗结构矩阵，而结构矩阵又需要另一颗行星的
// 有机晶体 → 「没物流拿不到结构矩阵，没结构矩阵开不了物流」闭环死锁。
// 因此本文件把三件事固化为断言：
//   ① 物流科技链在没有结构矩阵的情况下可达；
//   ② 双星联合（含物流）可达钛晶石 / 结构矩阵；
//   ③ 单星各自存在明确缺口（防止再次退化成「一星全能」而失去分工）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const { ITEMS, RECIPES, BUILDINGS, TECHNOLOGIES: TECH, PLANETS } = content;

// 采矿类建筑 → 可采资源（null = 全部固体矿；与 tech-deadlock.test.mjs 一致）
const MINER_ORES = {
  mining_machine: null,
  advanced_miner: null,
  water_pump: ['water', 'sulfuric_acid', 'hydrogen'],
  oil_extractor: ['crude_oil'],
};
const SOLID_ORES = Object.keys(ITEMS).filter((i) => ITEMS[i].category === 'ore' && ITEMS[i].kind === 'solid');
const NONE = new Set();

/** 单行星一轮推进：pay 为本次可用于支付建筑/配方原料的库存集合 */
function advance(items, buildings, ores, pay, tech, deny) {
  const blocked = deny || NONE;
  let changed = false;
  for (const b of Object.values(BUILDINGS)) {
    if (buildings.has(b.id)) continue;
    if (b.techId != null && !tech.has(b.techId)) continue;
    if (!(b.costs || []).every((c) => pay.has(c.itemId) && !blocked.has(c.itemId))) continue;
    buildings.add(b.id); changed = true;
  }
  for (const [bid, list] of Object.entries(MINER_ORES)) {
    if (!buildings.has(bid)) continue;
    for (const ore of (list || SOLID_ORES)) {
      if (ores.has(ore) && !items.has(ore) && !blocked.has(ore)) { items.add(ore); changed = true; }
    }
  }
  for (const r of Object.values(RECIPES)) {
    if (!r.outputs.length) continue;
    if (r.requiredTechId != null && !tech.has(r.requiredTechId)) continue;
    if (!buildings.has(r.buildingId)) continue;
    if (!r.inputs.every((i) => pay.has(i.itemId) && !blocked.has(i.itemId))) continue;
    for (const o of r.outputs) {
      if (blocked.has(o.itemId)) continue;
      if (!items.has(o.itemId)) { items.add(o.itemId); changed = true; }
    }
  }
  return changed;
}

/** 单行星不动点；blocked 里的 id 视为「永不可得」（科技与物品同名共用） */
function reachableOnPlanet(planetId, seedItems, blocked) {
  const deny = new Set(blocked || []);
  const ores = new Set(PLANETS[planetId].oreTypes);
  const tech = new Set(), items = new Set(), buildings = new Set();
  for (const s of seedItems) if (!deny.has(s)) items.add(s);
  let changed = true, guard = 0;
  while (changed && guard++ < 400) {
    changed = false;
    for (const id in TECH) {
      if (tech.has(id) || deny.has(id)) continue;
      const t = TECH[id];
      if (!t.prerequisites.every((p) => tech.has(p))) continue;
      if (!t.costs.every((c) => items.has(c.itemId) && !deny.has(c.itemId))) continue;
      tech.add(id); changed = true;
    }
    if (advance(items, buildings, ores, items, tech, deny)) changed = true;
  }
  return { tech, items, buildings };
}

/**
 * 双星联合：各自独立生产；物流科技研究完成后库存互通
 * （对应引擎里行星物流站/星际物流站靠 state.shipments 双向发货）。
 */
function reachablePair(pidA, pidB, seedA, seedB) {
  const oresA = new Set(PLANETS[pidA].oreTypes), oresB = new Set(PLANETS[pidB].oreTypes);
  const tech = new Set();
  const itemsA = new Set(seedA), itemsB = new Set(seedB);
  const bldA = new Set(), bldB = new Set();
  let changed = true, guard = 0;
  while (changed && guard++ < 400) {
    changed = false;
    const link = tech.has('planetary_logistics') || tech.has('interstellar_logistics');
    const pool = (own, other) => {
      const u = new Set(own);
      if (link) for (const i of other) u.add(i);
      return u;
    };
    const payA = pool(itemsA, itemsB), payB = pool(itemsB, itemsA);
    for (const id in TECH) {
      if (tech.has(id)) continue;
      const t = TECH[id];
      if (!t.prerequisites.every((p) => tech.has(p))) continue;
      const ok = link
        ? t.costs.every((c) => payA.has(c.itemId))
        : (t.costs.every((c) => itemsA.has(c.itemId)) || t.costs.every((c) => itemsB.has(c.itemId)));
      if (!ok) continue;
      tech.add(id); changed = true;
    }
    if (advance(itemsA, bldA, oresA, payA, tech)) changed = true;
    if (advance(itemsB, bldB, oresB, payB, tech)) changed = true;
  }
  const all = new Set(itemsA);
  for (const i of itemsB) all.add(i);
  return { tech, itemsA, itemsB, all, buildingsA: bldA, buildingsB: bldB };
}

const HOME = homePlanetId(content);
const homeSeed = () => Object.keys(engine.createInitialState(content, HOME).stock);

/** 用真实路径取「殖民补给」：母星建局 → travelTo 目标行星（首次抵达发放入门建材） */
function colonySeed(planetId) {
  const st = engine.createInitialState(content, HOME);
  const r = engine.travelTo(st, content, planetId);
  assert.ok(r && r.ok !== false, `travelTo(${planetId}) 失败: ${JSON.stringify(r)}`);
  return Object.keys(st.planets[planetId].stock);
}

describe('行星互补：I 星与 II 星互相依赖', () => {
  it('物流科技链不再被结构矩阵锁死：还没有结构矩阵时也能开到星际物流', () => {
    const { tech } = reachableOnPlanet(HOME, homeSeed(), ['structure_matrix']);
    assert.ok(tech.has('processor_tech'), '处理器架构被结构矩阵锁住');
    assert.ok(tech.has('planetary_logistics'), '行星物流被结构矩阵锁住（跨星死锁根因）');
    assert.ok(tech.has('interstellar_logistics'), '星际物流被结构矩阵锁住');
  });

  it('双星联合可达钛晶石与结构矩阵', () => {
    const r = reachablePair(HOME, 'yanli', homeSeed(), colonySeed('yanli'));
    for (const need of ['plastic', 'organic_crystal', 'processor', 'titanium_ingot', 'titanium_crystal', 'structure_matrix']) {
      assert.ok(r.all.has(need), `双星联合仍不可达 ${need}`);
    }
    assert.ok(r.tech.has('interstellar_logistics'), '双星联合仍开不出星际物流');
  });

  it('矿种互补：启明 I 有原油无钛，焰砾 II 有钛无原油', () => {
    const qiming = PLANETS[HOME].oreTypes;
    const yanli = PLANETS.yanli.oreTypes;
    for (const o of ['water', 'crude_oil', 'stone', 'coal']) {
      assert.ok(qiming.includes(o), `启明 I 缺 ${o}`);
    }
    for (const o of ['silicon_ore', 'titanium_ore', 'sulfuric_acid']) {
      assert.ok(yanli.includes(o), `焰砾 II 缺 ${o}`);
    }
    assert.ok(!yanli.includes('crude_oil'), '焰砾 II 不该有原油（否则有机晶体无需进口）');
    assert.ok(!qiming.includes('titanium_ore'), '启明 I 不该有钛矿（否则钛晶石无需进口）');
  });

  it('单星都有明确缺口：谁也做不到全能，结构矩阵必须双星合作', () => {
    const home = reachableOnPlanet(HOME, homeSeed());
    assert.ok(home.items.has('plastic'), '启明 I 应能自产塑料（有原油）');
    assert.ok(home.items.has('organic_crystal'), '启明 I 应能自产有机晶体（水 + 原油 + 石）');
    assert.ok(home.items.has('diamond'), '启明 I 应能自产金刚石（煤 → 高能石墨）');
    assert.ok(!home.items.has('titanium_ingot'), '启明 I 不该能自产钛块（缺钛矿）');
    assert.ok(!home.items.has('titanium_crystal'), '启明 I 不该能自产钛晶石');
    assert.ok(!home.items.has('structure_matrix'), '启明 I 不该能独自点亮结构矩阵');

    const yanli = reachableOnPlanet('yanli', colonySeed('yanli'));
    assert.ok(yanli.items.has('titanium_ingot'), '焰砾 II 应能自产钛块（有钛矿）');
    assert.ok(yanli.items.has('processor'), '焰砾 II 应能自产处理器（有硅矿）');
    assert.ok(!yanli.items.has('plastic'), '焰砾 II 不该能自产塑料（缺原油）');
    assert.ok(!yanli.items.has('organic_crystal'), '焰砾 II 不该能自产有机晶体（必须从启明 I 进口）');
    assert.ok(!yanli.items.has('titanium_crystal'), '焰砾 II 不该能自产钛晶石（缺有机晶体）');
    assert.ok(!yanli.items.has('structure_matrix'), '焰砾 II 不该能独自点亮结构矩阵');
  });
});

describe('老存档兼容：抵达后自动补齐行星新增矿产的矿脉', () => {
  it('焰砾 II 只补 石/水，不再生成原油', () => {
    const st = engine.createInitialState(content, HOME);
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
    for (const need of ['stone', 'water']) {
      assert.ok(veins['vein-' + need], `旧档未补齐 ${need} 矿脉`);
    }
    assert.ok(!veins['vein-crude_oil'], '焰砾 II 不该再长出原油矿脉');
    // 旧矿脉保持原样，不被覆盖
    assert.equal(veins['vein-iron_ore'].x, 123);
  });
});
