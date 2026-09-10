// stock-withdraw —— 建筑输入缓存 ⇄ 全局库存 双向搬运（withdrawFromStock 与 depositFromStock 对称）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

/** 建一个电弧熔炉（炼铁：铁矿→铁块，单输入），预灌库存 */
function buildSmelter() {
  const st = engine.createInitialState(content, homePlanetId(content));
  const def = content.BUILDINGS.arc_smelter;
  if (def && def.techId) st.unlockedTechs.push(def.techId);
  const recipe = Object.values(content.RECIPES).find(
    (r) => r.buildingId === 'arc_smelter' && (r.inputs || []).some((i) => i.itemId === 'iron_ore')
  );
  assert.ok(recipe, '内容里应存在电弧熔炉炼铁配方');
  for (const it of (content.BUILDING_COSTS ? Object.keys(content.BUILDING_COSTS.arc_smelter || {}) : [])) st.stock[it] = 200;
  const r = engine.placeBuilding(st, content, { typeId: 'arc_smelter', x: 800, y: 800 });
  assert.ok(r.ok, `placeBuilding(arc_smelter) 失败: ${JSON.stringify(r)}`);
  assert.ok(engine.setRecipe(st, content, r.id, recipe.id).ok);
  return { st, id: r.id, recipe };
}

describe('建筑缓存 ⇄ 库存 双向搬运', () => {
  it('deposit 后 withdraw 全额退回，库存守恒', () => {
    const { st, id, recipe } = buildSmelter();
    const ore = recipe.inputs[0].itemId;
    st.stock[ore] = 50;
    const d = engine.depositFromStock(st, content, id, ore);
    assert.ok(d.ok && d.moved > 0, '投料应成功');
    const afterDeposit = st.stock[ore];
    const w = engine.withdrawFromStock(st, content, id, ore);
    assert.ok(w.ok, `withdraw 应成功: ${JSON.stringify(w)}`);
    assert.equal(w.moved, d.moved, '取回数量应等于投入数量');
    assert.equal(st.stock[ore], afterDeposit + w.moved, '库存应恢复');
    assert.ok(!(st.buildings[id].inBuf[ore] > 0), '建筑缓存应清空该物品');
  });

  it('withdraw 指定数量：只取回一部分', () => {
    const { st, id, recipe } = buildSmelter();
    const ore = recipe.inputs[0].itemId;
    st.stock[ore] = 50;
    engine.depositFromStock(st, content, id, ore);
    const inBuf = Math.floor(st.buildings[id].inBuf[ore] || 0);
    assert.ok(inBuf >= 2, '缓存应至少 2 个才能测部分取回');
    const w = engine.withdrawFromStock(st, content, id, ore, 2);
    assert.ok(w.ok);
    assert.equal(w.moved, 2);
    assert.equal(st.buildings[id].inBuf[ore], inBuf - 2);
  });

  it('缓存为空时 withdraw 报 nothingToWithdraw；未知物品报 unknownItem', () => {
    const { st, id, recipe } = buildSmelter();
    const ore = recipe.inputs[0].itemId;
    assert.equal(engine.withdrawFromStock(st, content, id, ore).reason, 'nothingToWithdraw');
    assert.equal(engine.withdrawFromStock(st, content, id, '__no_such_item__').reason, 'unknownItem');
  });

  it('withdraw 后可再次 deposit（往返无损，缓存恢复原量）', () => {
    const { st, id, recipe } = buildSmelter();
    const ore = recipe.inputs[0].itemId;
    st.stock[ore] = 50;
    const d1 = engine.depositFromStock(st, content, id, ore);
    const buf1 = Math.floor(st.buildings[id].inBuf[ore] || 0);
    assert.ok(d1.ok && buf1 > 0);
    assert.equal(engine.withdrawFromStock(st, content, id, ore).ok, true);
    assert.ok(!(st.buildings[id].inBuf[ore] > 0), '取回后缓存清空');
    const d2 = engine.depositFromStock(st, content, id, ore);
    assert.ok(d2.ok, '再次投料应成功');
    assert.equal(Math.floor(st.buildings[id].inBuf[ore] || 0), buf1, '缓存恢复原量');
  });
});
