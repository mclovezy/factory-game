// input-cap-share —— 多输入配方的输入缓存按种类均分，避免一路吃满导致卡死
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

/** 挑一条 2 输入的机器/实验室配方，返回 { recipeId, buildingId, recipe } */
function twoInputRecipe() {
  for (const r of Object.values(content.RECIPES)) {
    const bid = r.buildingId;
    if (!bid || !content.BUILDINGS[bid]) continue;
    const kind = content.BUILDINGS[bid].kind;
    if (kind !== 'machine' && kind !== 'lab') continue;
    if ((r.inputs || []).length >= 2) return { recipeId: r.id, buildingId: bid, recipe: r };
  }
  return null;
}

/** 建一个带该配方的建筑（必要时解锁所需科技） */
function buildWith(pick) {
  const st = engine.createInitialState(content, homePlanetId(content));
  if (pick.recipe.requiredTechId) st.unlockedTechs.push(pick.recipe.requiredTechId);
  const def = content.BUILDINGS[pick.buildingId];
  if (def.techId) st.unlockedTechs.push(def.techId);
  const r = engine.placeBuilding(st, content, { typeId: pick.buildingId, x: 800, y: 800 });
  assert.ok(r.ok, `placeBuilding(${pick.buildingId}) 失败: ${JSON.stringify(r)}`);
  const b = st.buildings[r.id];
  assert.ok(engine.setRecipe(st, content, r.id, pick.recipeId).ok);
  return { st, b };
}

describe('输入缓存按种类均分', () => {
  it('两输入配方：单种物品上限 = 总容量 / 种类数', () => {
    const pick = twoInputRecipe();
    assert.ok(pick, '内容里应存在 2 输入配方');
    const { st, b } = buildWith(pick);
    const total = engine.inputCapOf(content, b);
    const per = engine.inputItemCapOf(content, b, pick.recipe.inputs[0].itemId);
    assert.equal(per, Math.floor(total / pick.recipe.inputs.length));
    assert.ok(per >= Math.max(...pick.recipe.inputs.map((i) => i.amount)),
      '均分后的单格容量必须够一个生产周期，否则配方永远跑不起来');
  });

  it('一路塞满到单格上限后，另一路仍能继续入料（不再互相挤占）', () => {
    const pick = twoInputRecipe();
    const { st, b } = buildWith(pick);
    const [a, c] = pick.recipe.inputs.map((i) => i.itemId);
    const per = engine.inputItemCapOf(content, b, a);

    b.inBuf[a] = per;                       // 第一路塞到单格上限
    st.stock[c] = 500;
    assert.ok(engine.depositFromStock(st, content, b.id, c, 50).ok, '第二路不应被第一路挤占');
    assert.equal(b.inBuf[c], 50);
    assert.equal(b.inBuf[a], per);
    assert.equal(engine.depositFromStock(st, content, b.id, a, 10).ok, false,
      '已达单格上限的输入应拒绝继续入料');
  });

  it('两路都无限供料时各停在自己的上限，而不是 239/1 卡死', () => {
    const pick = twoInputRecipe();
    const { st, b } = buildWith(pick);
    const [a, c] = pick.recipe.inputs.map((i) => i.itemId);
    const per = engine.inputItemCapOf(content, b, a);

    st.stock[a] = 10000; st.stock[c] = 10000;
    for (let i = 0; i < 40; i++) engine.depositFromStock(st, content, b.id, a, 100);
    for (let i = 0; i < 40; i++) engine.depositFromStock(st, content, b.id, c, 100);

    assert.equal(b.inBuf[a], per);
    assert.equal(b.inBuf[c], per);
  });

  it('无配方建筑（仓储类）按已存种类动态均分，新物品仍有空间进入', () => {
    const st = engine.createInitialState(content, homePlanetId(content));
    const storeId = Object.keys(content.BUILDINGS).find((k) => content.BUILDINGS[k].kind === 'storage');
    assert.ok(storeId, '内容里应有仓储建筑');
    if (content.BUILDINGS[storeId].techId) st.unlockedTechs.push(content.BUILDINGS[storeId].techId);
    const r = engine.placeBuilding(st, content, { typeId: storeId, x: 800, y: 800 });
    assert.ok(r.ok);
    const b = st.buildings[r.id];
    const total = engine.inputCapOf(content, b);
    st.stock.iron_ingot = total;
    st.stock.copper_ingot = total;
    engine.depositFromStock(st, content, b.id, 'iron_ingot', total);
    assert.equal(engine.inputItemCapOf(content, b, 'copper_ingot'), Math.floor(total / 2));
    assert.ok(engine.depositFromStock(st, content, b.id, 'copper_ingot', 10).ok,
      '第二种物品应能进入（按 2 种均分）');
    assert.equal(b.inBuf.copper_ingot, 10);
  });
});
