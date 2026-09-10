// belt-transport —— v2 传送带搬运：矿脉 buffer → 熔炉 inBuf（类型化端口）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function setupMiner(state) {
  const vein = state.veins['vein-iron_ore'];
  assert.ok(vein, '主行星应有铁矿脉方块');
  // 4 台风机 = 1200kW ≥ 2 台采矿机 840kW（近满速采矿）
  for (let i = 0; i < 4; i++) {
    assert.equal(engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -200 + 40 * i, y: -500 }).ok, true);
  }
  const m1 = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });
  const m2 = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x - 5, y: vein.y - 5 });
  assert.equal(m1.ok, true, JSON.stringify(m1));
  assert.equal(m2.ok, true, JSON.stringify(m2));
  assert.equal(vein.miners, 2);
  return { vein, minerId: vein.id };
}

describe('传送带搬运（v2 类型化端口）', () => {
  it('矿脉→熔炉连线携带正确 itemId，矿石到达熔炉 inBuf', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein, minerId } = setupMiner(state);
    // 熔炉贴近矿脉（端口间距 ≈ 160-150=10，运输几乎瞬时）
    const smelter = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 160, y: vein.y });
    assert.equal(smelter.ok, true);
    assert.equal(engine.setRecipe(state, content, smelter.id, 'iron_ingot').ok, true, '先设配方才有输入端口');
    const belt = engine.connectBelt(state, content, { fromId: minerId, toId: smelter.id, tier: 1 });
    assert.equal(belt.ok, true, JSON.stringify(belt));
    assert.equal(belt.itemId, 'iron_ore', '边应确定搬运物品为 iron_ore');

    engine.advance(state, content, 60);

    const sb = state.buildings[smelter.id];
    const arrived = sb.inBuf['iron_ore'] || 0;
    assert.ok(arrived > 0, `60s 后熔炉 inBuf 仍为空`);
    assert.ok(sb.inBuf['iron_ore'] <= 240 + 1e-9, '不得超过 inputCapacity×count');

    const flow = engine.beltFlow(state, belt.id);
    assert.ok(flow, 'beltFlow 应返回统计');
    assert.equal(flow.item, 'iron_ore');
    assert.equal(typeof flow.perSec, 'number');
    assert.equal(engine.beltFlow(state, 'no-such-belt'), null);
  });

  it('类型校验：终点矿脉拒绝；无配方建筑 itemMismatch；仓库畅通入库', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    state.unlockedTechs.push('basic_logistics'); // storage_mk1 解锁
    const { vein, minerId } = setupMiner(state);

    // 终点为矿脉 → 拒绝（矿脉不可入料；用铜矿脉作终点避免触发自连）
    const vCu = state.veins['vein-copper_ore'];
    const toVein = engine.connectBelt(state, content, { fromId: minerId, toId: vCu.id, tier: 1 });
    assert.equal(toVein.ok, false);
    assert.equal(toVein.reason, 'buildingNotFound');

    // 矿脉 → 无配方制造台 → itemMismatch
    const asm = engine.placeBuilding(state, content, { typeId: 'assembler_mk1', x: vein.x + 160, y: vein.y });
    assert.equal(asm.ok, true);
    const bad = engine.connectBelt(state, content, { fromId: minerId, toId: asm.id, tier: 1 });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, 'itemMismatch');

    // 矿脉 → 仓库（任意输入）→ 持续流动入库
    const store = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 160, y: vein.y + 180 });
    assert.equal(store.ok, true);
    const belt = engine.connectBelt(state, content, { fromId: minerId, toId: store.id, tier: 1 }); // 仓库任意输入，无需配方
    assert.equal(belt.ok, true, JSON.stringify(belt));

    engine.advance(state, content, 90);
    assert.ok((state.stock['iron_ore'] || 0) > 0, '矿石应经仓库入库 stock');
    const flow = engine.beltFlow(state, belt.id);
    assert.equal(flow.item, 'iron_ore');
    assert.ok(flow.perSec > 0, `持续流动的带流量 perSec=${flow.perSec}`);
  });

  it('禁自连 / 重复连接（connectBelt 命令校验）', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const b1 = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 0, y: 0 });
    assert.equal(b1.ok, true);
    const b2 = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 200, y: 0 });
    assert.equal(b2.ok, true);

    // 自连拒绝
    const self = engine.connectBelt(state, content, { fromId: b1.id, toId: b1.id, tier: 1 });
    assert.equal(self.ok, false);
    assert.equal(self.reason, 'selfConnect');

    // 不存在的建筑拒绝
    const missing = engine.connectBelt(state, content, { fromId: 'nope', toId: b2.id, tier: 1 });
    assert.equal(missing.ok, false);

    // 电站无输出端口 → itemMismatch（风机→风机）
    const noPort = engine.connectBelt(state, content, { fromId: b1.id, toId: b2.id, tier: 1 });
    assert.equal(noPort.ok, false);
    assert.equal(noPort.reason, 'itemMismatch');

    // 重复连接拒绝（用合法的矿脉→熔炉验证）
    const state2 = engine.createInitialState(content, homePlanetId(content));
    const vein = state2.veins['vein-iron_ore'];
    engine.placeBuilding(state2, content, { typeId: 'wind_turbine', x: vein.x + 300, y: vein.y + 300 });
    const sm = engine.placeBuilding(state2, content, { typeId: 'arc_smelter', x: vein.x + 160, y: vein.y });
    engine.setRecipe(state2, content, sm.id, 'iron_ingot');
    assert.equal(engine.connectBelt(state2, content, { fromId: vein.id, toId: sm.id, tier: 1 }).ok, true);
    const dup = engine.connectBelt(state2, content, { fromId: vein.id, toId: sm.id, tier: 1 });
    assert.equal(dup.ok, false);
    assert.equal(dup.reason, 'duplicateBelt');
  });
});
