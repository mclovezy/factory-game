/* =========================================================================
 * miner-type —— 开采设备与矿脉品类的匹配契约
 * -------------------------------------------------------------------------
 * 不变量：
 *   1. 采矿机只采固体矿；抽水站只采水/酸/氢；原油萃取站只采原油。
 *   2. 任一可采物品只允许命中一种 miner —— 这样同一矿脉不可能混放不同类型，
 *      removeMiner 只做 miners-1 也不会拆错类型，无需新增持久字段。
 *   3. 全部行星 oreTypes 必须被至少一个 miner 覆盖（否则该资源永远拿不到）。
 * ========================================================================= */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function freshState() {
  const state = engine.createInitialState(content, homePlanetId(content));
  state.unlockedTechs.push('fluid_handling', 'advanced_mining'); // 抽水站 / 萃取站 / 深层采矿机
  // 给足全部建材：placeBuilding 先扣材料再判品类，材料不足会抢先返回 insufficientMaterials
  for (const b of Object.values(content.BUILDINGS)) {
    for (const c of b.costs || []) state.stock[c.itemId] = (state.stock[c.itemId] || 0) + 9999;
  }
  return state;
}

function veinXY(state, itemId) {
  const v = state.veins['vein-' + itemId];
  assert.ok(v, `矿脉缺失: ${itemId}`);
  return { x: v.x, y: v.y };
}

describe('开采设备与矿脉品类匹配', () => {
  it('采矿机不能放在流体矿（水 / 原油）上', () => {
    const state = freshState();
    for (const itemId of ['water', 'crude_oil']) {
      const p = veinXY(state, itemId);
      const r = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: p.x, y: p.y });
      assert.equal(r.ok, false, `采矿机不该能采 ${itemId}`);
      assert.equal(r.reason, 'wrongMinerForVein');
    }
  });

  it('抽水站不能放在固体矿（铁矿）上', () => {
    const state = freshState();
    const p = veinXY(state, 'iron_ore');
    const r = engine.placeBuilding(state, content, { typeId: 'water_pump', x: p.x, y: p.y });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'wrongMinerForVein');
  });

  it('抽水站不能抢原油萃取站的活（原油脉）', () => {
    const state = freshState();
    const p = veinXY(state, 'crude_oil');
    const r = engine.placeBuilding(state, content, { typeId: 'water_pump', x: p.x, y: p.y });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'wrongMinerForVein');
  });

  it('原油萃取站不能抢抽水站的活（水脉）', () => {
    const state = freshState();
    const p = veinXY(state, 'water');
    const r = engine.placeBuilding(state, content, { typeId: 'oil_extractor', x: p.x, y: p.y });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'wrongMinerForVein');
  });

  it('正确组合可放置，且真的产出对应资源', () => {
    const state = freshState();
    for (let i = 0; i < 8; i++) {
      engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -400 + 80 * i, y: -700 });
    }
    const cases = [
      ['mining_machine', 'iron_ore'],
      ['water_pump', 'water'],
      ['oil_extractor', 'crude_oil']
    ];
    for (const [typeId, itemId] of cases) {
      const p = veinXY(state, itemId);
      const r = engine.placeBuilding(state, content, { typeId, x: p.x, y: p.y });
      assert.equal(r.ok, true, `${typeId} 应能采 ${itemId}: ${JSON.stringify(r)}`);
    }
    const vFe = state.veins['vein-iron_ore'];
    const vH2O = state.veins['vein-water'];
    const vOil = state.veins['vein-crude_oil'];
    assert.equal(vFe.miners, 1);
    assert.equal(vH2O.miners, 1);
    assert.equal(vOil.miners, 1);

    engine.advance(state, content, 30);
    assert.ok((vFe.buffer || 0) > 0, '铁矿脉应有产出');
    assert.ok((vH2O.buffer || 0) > 0, '水脉应有产出');
    assert.ok((vOil.buffer || 0) > 0, '油泉应有产出');
  });

  it('同一矿脉已有「采矿机」时再放「深层采矿机」被拒（型号锁，避免拆除时串台）', () => {
    const state = freshState();
    const p = veinXY(state, 'iron_ore');
    const a = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: p.x, y: p.y });
    assert.equal(a.ok, true);
    const b = engine.placeBuilding(state, content, { typeId: 'advanced_miner', x: p.x + 6, y: p.y + 6 });
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'mixedMinerType');
    assert.equal(state.veins['vein-iron_ore'].miners, 1, '被拒的放置不应增加 miners');

    // 同型号可以继续叠加
    const c = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: p.x - 6, y: p.y - 6 });
    assert.equal(c.ok, true);
    assert.equal(state.veins['vein-iron_ore'].miners, 2);
  });

  it('跨品类：异类设备放在同一矿脉被拒（water_pump 上铁矿脉）', () => {
    const state = freshState();
    const p = veinXY(state, 'iron_ore');
    const a = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: p.x, y: p.y });
    assert.equal(a.ok, true);
    const b = engine.placeBuilding(state, content, { typeId: 'water_pump', x: p.x + 6, y: p.y + 6 });
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'wrongMinerForVein');
  });

  it('拆到最后一台：清除型号锁，可换另一种设备开采', () => {
    const state = freshState();
    const p = veinXY(state, 'iron_ore');
    const vid = 'vein-iron_ore';
    engine.placeBuilding(state, content, { typeId: 'mining_machine', x: p.x, y: p.y });
    assert.equal(state.veins[vid].minerType, 'mining_machine');
    engine.removeBuilding(state, content, vid);
    assert.equal(state.veins[vid].miners, 0);
    assert.equal(state.veins[vid].minerType, null, '型号锁应随空脉清除');

    // 清空后可以换装置（铁矿脉只允许 solid 类，换成深采机）
    const r = engine.placeBuilding(state, content, { typeId: 'advanced_miner', x: p.x, y: p.y });
    assert.equal(r.ok, true);
    assert.equal(state.veins[vid].minerType, 'advanced_miner');
  });

  it('存档往返：minerType 不丢失（新增持久字段必须三处同步）', () => {
    const state = freshState();
    const p = veinXY(state, 'water');
    engine.placeBuilding(state, content, { typeId: 'water_pump', x: p.x, y: p.y });
    const clone = engine.deserialize(JSON.parse(JSON.stringify(engine.serialize(state))), content);
    assert.equal(clone.veins['vein-water'].miners, 1);
    assert.equal(clone.veins['vein-water'].minerType, 'water_pump', '读档后型号锁丢失会把叠加/拆除判错');
  });

  it('未声明 mineKind / mineItems 的 miner 保持不限品类（向后兼容）', () => {
    const generic = { id: 'x', kind: 'miner' };
    assert.equal(engine.minerAcceptsItem(content, generic, 'iron_ore'), true);
    assert.equal(engine.minerAcceptsItem(content, generic, 'water'), true);
  });

  it('内容契约：每个 miner 都声明了开采范围', () => {
    const miners = Object.values(content.BUILDINGS).filter((b) => b.kind === 'miner');
    assert.ok(miners.length >= 4, '至少应有采矿机 / 深层采矿机 / 抽水站 / 萃取站');
    for (const m of miners) {
      assert.ok(
        m.mineKind || (m.mineItems && m.mineItems.length),
        `${m.id} 未声明 mineKind / mineItems，会退化成「什么都能采」`
      );
    }
  });

  it('内容契约：固体矿只能被 solid 类设备采，流体矿只能按白名单采', () => {
    const miners = Object.values(content.BUILDINGS).filter((b) => b.kind === 'miner');
    const oreSet = new Set();
    for (const p of Object.values(content.PLANETS)) for (const t of p.oreTypes) oreSet.add(t);

    for (const itemId of oreSet) {
      const it = content.ITEMS[itemId];
      const hit = miners.filter((m) => engine.minerAcceptsItem(content, m, itemId));
      assert.ok(hit.length >= 1, `${itemId} 没有任何设备能开采`);
      for (const m of hit) {
        if (it.kind === 'solid') {
          assert.equal(m.mineKind, 'solid', `固体矿 ${itemId} 竟可被 ${m.id} 开采`);
        } else {
          assert.ok(
            m.mineItems && m.mineItems.indexOf(itemId) >= 0,
            `流体 ${itemId} 被 ${m.id} 开采，但不在其 mineItems 白名单里`
          );
        }
      }
    }
  });

  it('内容契约：所有行星矿脉都有可用开采设备（无资源死锁）', () => {
    const miners = Object.values(content.BUILDINGS).filter((b) => b.kind === 'miner');
    for (const p of Object.values(content.PLANETS)) {
      for (const itemId of p.oreTypes) {
        const ok = miners.some((m) => engine.minerAcceptsItem(content, m, itemId));
        assert.ok(ok, `${p.id} 的 ${itemId} 没有任何设备能开采`);
      }
    }
    // 硫酸是钛合金的唯一路径：必须保证「天然开采」或「合成」至少一条通
    const acidMinable = miners.some((m) => engine.minerAcceptsItem(content, m, 'sulfuric_acid'));
    const acidSynth = Object.values(content.RECIPES).some(
      (r) => (r.outputs || []).some((o) => o.itemId === 'sulfuric_acid')
    );
    assert.ok(acidMinable || acidSynth, '硫酸必须可通过开采或合成获得（钛合金依赖它）');
  });
});
