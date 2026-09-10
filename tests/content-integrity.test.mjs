// content-integrity —— 内容目录规模 + 引用完整性 + 开局引导（SPEC §2）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine } from './helpers.mjs';

const { content } = loadContentAndEngine();

describe('DSP_CONTENT 规模断言', () => {
  it('ITEMS ≈ 78（±3）', () => {
    const n = Object.keys(content.ITEMS).length;
    assert.ok(n >= 75 && n <= 81, `ITEMS=${n}`);
  });
  it('RECIPES ≈ 78（±3）', () => {
    const n = Object.keys(content.RECIPES).length;
    assert.ok(n >= 75 && n <= 81, `RECIPES=${n}`);
  });
  it('BUILDINGS === 38', () => {
    assert.equal(Object.keys(content.BUILDINGS).length, 38);
  });
  it('TECHNOLOGIES ≈ 67（±3）', () => {
    const n = Object.keys(content.TECHNOLOGIES).length;
    assert.ok(n >= 64 && n <= 70, `TECHNOLOGIES=${n}`);
  });
  it('STAR_SYSTEMS === 8', () => {
    assert.equal(Object.keys(content.STAR_SYSTEMS).length, 8);
  });
  it('PLANETS === 22', () => {
    assert.equal(Object.keys(content.PLANETS).length, 22);
  });
  it('MATRIX_ITEM_IDS === 6 且均为 matrix 类物品', () => {
    assert.equal(content.MATRIX_ITEM_IDS.length, 6);
    for (const id of content.MATRIX_ITEM_IDS) {
      const it = content.ITEMS[id];
      assert.ok(it, `矩阵物品缺失: ${id}`);
      assert.equal(it.kind, 'matrix');
    }
  });
  it('BELTS 共 3 级且速度递增', () => {
    assert.equal(content.BELTS.length, 3);
    for (let i = 0; i < 3; i++) {
      assert.equal(content.BELTS[i].tier, i + 1);
      assert.ok(content.BELTS[i].speed > 0);
      if (i > 0) assert.ok(content.BELTS[i].speed > content.BELTS[i - 1].speed);
    }
  });
  it('科技树无循环依赖且 tier 与依赖深度一致（无倒挂）', () => {
    const DONE = new Set(), STACK = new Set();
    const depth = {};
    function visit(id) {
      if (DONE.has(id)) return depth[id];
      assert.ok(!STACK.has(id), `科技循环依赖: ${id}`);
      STACK.add(id);
      const t = content.TECHNOLOGIES[id];
      const ps = (t.prerequisites || []).filter(p => content.TECHNOLOGIES[p]);
      let d = 0;
      for (const p of ps) d = Math.max(d, visit(p) + 1);
      STACK.delete(id); DONE.add(id); depth[id] = d;
      assert.equal(t.tier, d, `科技 ${id} tier(${t.tier}) 应等于依赖深度(${d})`);
      return d;
    }
    for (const id in content.TECHNOLOGIES) visit(id);
  });
});

describe('DSP_CONTENT 引用完整性', () => {
  it('所有配方：建筑 / 输入 / 输出 / 前置科技 均存在', () => {
    for (const id in content.RECIPES) {
      const r = content.RECIPES[id];
      assert.ok(content.BUILDINGS[r.buildingId], `配方 ${id} 建筑不存在: ${r.buildingId}`);
      assert.ok(r.duration > 0, `配方 ${id} duration 非法`);
      if (r.requiredTechId != null) {
        assert.ok(content.TECHNOLOGIES[r.requiredTechId], `配方 ${id} 前置科技不存在: ${r.requiredTechId}`);
      }
      for (const inp of r.inputs) assert.ok(content.ITEMS[inp.itemId], `配方 ${id} 输入物品不存在: ${inp.itemId}`);
      for (const out of r.outputs) assert.ok(content.ITEMS[out.itemId], `配方 ${id} 输出物品不存在: ${out.itemId}`);
    }
  });
  it('所有建筑：解锁科技存在，尺寸/功率合法', () => {
    for (const id in content.BUILDINGS) {
      const b = content.BUILDINGS[id];
      if (b.techId != null) {
        assert.ok(content.TECHNOLOGIES[b.techId], `建筑 ${id} 科技不存在: ${b.techId}`);
      }
      assert.ok(b.w > 0 && b.h > 0, `建筑 ${id} 尺寸非法`);
      assert.ok(b.powerDemandKw >= 0 && b.powerGenerationKw >= 0, `建筑 ${id} 功率非法`);
      assert.ok(b.icon, `建筑 ${id} 缺 icon`);
    }
  });
  it('所有科技：消耗物品 / 前置科技 均存在', () => {
    for (const id in content.TECHNOLOGIES) {
      const t = content.TECHNOLOGIES[id];
      for (const c of t.costs) assert.ok(content.ITEMS[c.itemId], `科技 ${id} 消耗物品不存在: ${c.itemId}`);
      for (const p of t.prerequisites) {
        assert.ok(content.TECHNOLOGIES[p], `科技 ${id} 前置不存在: ${p}`);
      }
    }
  });
  it('所有行星：星系 / 矿种引用存在，太阳系数值合法', () => {
    for (const id in content.PLANETS) {
      const p = content.PLANETS[id];
      assert.ok(content.STAR_SYSTEMS[p.systemId], `行星 ${id} 星系不存在: ${p.systemId}`);
      assert.ok(Array.isArray(p.oreTypes) && p.oreTypes.length > 0, `行星 ${id} 缺矿种`);
      for (const ore of p.oreTypes) assert.ok(content.ITEMS[ore], `行星 ${id} 矿种不存在: ${ore}`);
      assert.equal(typeof p.solarMultiplier, 'number');
      assert.ok(p.solarMultiplier > 0);
    }
  });
  it('每个星系至少有一颗行星；BUILDING_ORDER 与建筑一一对应', () => {
    for (const sid in content.STAR_SYSTEMS) {
      const has = Object.values(content.PLANETS).some((p) => p.systemId === sid);
      assert.ok(has, `星系 ${sid} 没有行星`);
    }
    for (const bid of content.BUILDING_ORDER) {
      assert.ok(content.BUILDINGS[bid], `BUILDING_ORDER 引用不存在: ${bid}`);
    }
    assert.equal(content.BUILDING_ORDER.length, Object.keys(content.BUILDINGS).length);
  });
  it('矿种齐全：至少 15 类矿物/流体资源且 category=ore 的物品均被行星引用', () => {
    const ores = Object.values(content.ITEMS).filter((i) => i.category === 'ore');
    assert.ok(ores.length >= 15, `ore 物品只有 ${ores.length} 种`);
    const onPlanets = new Set();
    for (const p of Object.values(content.PLANETS)) for (const o of p.oreTypes) onPlanets.add(o);
    for (const o of ores) {
      assert.ok(onPlanets.has(o.id), `矿种 ${o.id} 未出现在任何行星`);
    }
  });
});

describe('开局引导', () => {
  it('mining_machine / arc_smelter / assembler_mk1 / matrix_lab / wind_turbine 均无科技门槛', () => {
    for (const id of ['mining_machine', 'arc_smelter', 'assembler_mk1', 'matrix_lab', 'wind_turbine']) {
      assert.equal(content.BUILDINGS[id].techId, null, `建筑 ${id} 应开局可用`);
    }
  });
  it('电磁矩阵配方无科技门槛，且所需原料可由无门槛配方生产', () => {
    assert.equal(content.RECIPES.electromagnetic_matrix.requiredTechId, null);
    // magnetic_coil = magnet + copper_wire；circuit_board = iron_ingot + copper_wire
    assert.equal(content.RECIPES.magnet.requiredTechId, null);
    assert.equal(content.RECIPES.copper_wire.requiredTechId, null);
    assert.equal(content.RECIPES.iron_ingot.requiredTechId, null);
    assert.equal(content.RECIPES.copper_ingot.requiredTechId, null);
  });
  it('便捷查询函数可用', () => {
    assert.equal(content.item('iron_ore').id, 'iron_ore');
    assert.equal(content.item('no_such_item'), null);
    assert.equal(content.building('matrix_lab').kind, 'lab');
    assert.ok(content.recipesForBuilding('matrix_lab').some((r) => r.id === 'electromagnetic_matrix'));
    assert.ok(Object.keys(content.itemsByCategory()).length >= 5);
    assert.ok(content.planet(Object.keys(content.PLANETS)[0]));
  });
});
