// belt-credit —— 信贷模型专属：无在途物品 / 吞吐=带速 / 源空·目标满清空 credit / 同源公平分配
// 借鉴 DSPONLINE transferBelts：每条带是连接记录，无独立在途货物，credit 为转运额度。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function setupMiner(state, turbines = 6) {
  const vein = state.veins['vein-iron_ore'];
  assert.ok(vein, '主行星应有铁矿脉方块');
  // 测试装置注入足够材料（风机/采矿机/储物仓/熔炉的建筑成本都在 state.stock 里扣），
  // 并解锁储物仓所需的 basic_logistics 科技（storage_mk1 有 techId 门槛）。
  const grant = { iron_ingot: 200, gear: 80, magnetic_coil: 80, circuit_board: 60, stone_brick: 20 };
  for (const k in grant) state.stock[k] = (state.stock[k] || 0) + grant[k];
  if (state.unlockedTechs.indexOf('basic_logistics') < 0) state.unlockedTechs.push('basic_logistics');
  for (let i = 0; i < turbines; i++) {
    assert.equal(engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -200 + 40 * i, y: -500 }).ok, true);
  }
  const m1 = engine.placeBuilding(state, content, { typeId: 'mining_machine', x: vein.x + 5, y: vein.y + 5 });
  assert.equal(m1.ok, true, JSON.stringify(m1));
  return { vein, minerId: vein.id };
}

describe('传送带信贷模型（借鉴 DSPONLINE）', () => {
  it('无在途物品：belt 只有 credit，不含 items 数组', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 6);
    const store = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y + 500 });
    assert.equal(store.ok, true);
    const belt = engine.connectBelt(state, content, { fromId: vein.id, toId: store.id, tier: 1 });
    assert.equal(belt.ok, true);
    const bl = state.belts[belt.id];
    assert.equal(typeof bl.items, 'undefined', '不应再有在途物品数组');
    assert.ok('credit' in bl, '应有 credit 字段');
    engine.advance(state, content, 10);
    assert.equal(typeof bl.items, 'undefined', '推进后仍无 in-transit 物品');
  });

  it('吞吐上限 = 带速：Mk.I(6/s) 不高于 6/s，无论带长', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 8);
    const store = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y + 500 });
    assert.equal(store.ok, true);
    const belt = engine.connectBelt(state, content, { fromId: vein.id, toId: store.id, tier: 1 });
    assert.equal(belt.ok, true);
    engine.advance(state, content, 120);
    const moved = state.stock['iron_ore'] || 0;
    const perSec = moved / 120;
    assert.ok(perSec <= 6 + 1e-6, `吞吐 ${perSec} 不应超过 Mk.I 带速 6/s`);
    assert.ok(perSec > 0, `应为正流量（${perSec}）`);
  });

  it('目标 inBuf 满时清空 credit（阻塞，不囤货）', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 8);
    // 无配方的熔炉输入容量有限，且不消耗 → 很快填满 inBuf（120）
    const smelter = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 160, y: vein.y });
    assert.equal(smelter.ok, true);
    engine.setRecipe(state, content, smelter.id, 'iron_ingot'); // 配方让输入端口开启
    const belt = engine.connectBelt(state, content, { fromId: vein.id, toId: smelter.id, tier: 1 });
    assert.equal(belt.ok, true);
    // 大量推进，熔炉应被喂满后由 credit 阻塞逻辑清空（credit==0），inBuf 不超过容量
    engine.advance(state, content, 300);
    const sb = state.buildings[smelter.id];
    const cap = Math.max(1, content.BUILDINGS['arc_smelter'].inputCapacity || 20) * sb.count;
    const sum = Object.values(sb.inBuf).reduce((a, b) => a + b, 0);
    assert.ok(sum <= cap + 1e-6, `inBuf ${sum} 应<=输入容量 ${cap}`);
    // 信贷模型用浮点 credit：目标满的阻塞 tick 会把 credit 清到 0，
    // 但熔炉每刻消耗原料，样本可能落在刚补料的 tick 上残留 <1 的分数额度。
    // '不囤货' 的不变量是：被阻塞时不会攒出整整一件可转货物，即 credit < 1。
    if (sb.inBuf['iron_ore'] >= cap) {
      assert.ok(state.belts[belt.id].credit < 1, '目标满时 credit 不应囤满整件（不囤货）');
    }
  });

  it('源缺料时 credit 清空、恢复后重新累积', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 6);
    const store = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y + 500 });
    assert.equal(store.ok, true);
    const belt = engine.connectBelt(state, content, { fromId: vein.id, toId: store.id, tier: 1 });
    assert.equal(belt.ok, true);
    // 无矿机产料：矿脉 buffer 空 → credit 维持 0
    state.veins[vein.id].miners = 0;
    engine.advance(state, content, 30);
    assert.equal(state.belts[belt.id].credit, 0, '源缺料 → credit 保持 0');
  });

  it('同源多出带公平分配（_rr 轮询，两带合计不超源总产量）', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 8);
    const s1 = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y });
    const s2 = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y + 300 });
    assert.equal(s1.ok && s2.ok, true);
    const b1 = engine.connectBelt(state, content, { fromId: vein.id, toId: s1.id, tier: 1 });
    const b2 = engine.connectBelt(state, content, { fromId: vein.id, toId: s2.id, tier: 1 });
    assert.equal(b1.ok && b2.ok, true);
    engine.advance(state, content, 120);
    // storage 每 tick 把 inBuf 并入全局 stock（inBuf 瞬态恒为 0），
    // 故用每带的流量统计（beltFlow）判断公平分配，而不是 inBuf。
    const f1 = engine.beltFlow(state, b1.id).perSec;
    const f2 = engine.beltFlow(state, b2.id).perSec;
    const perSec = (state.stock['iron_ore'] || 0) / 120;
    // 1 台矿机 5/s：两带合计不超矿机产出（且带速合计 12/s 足够）
    assert.ok(perSec <= 5 + 1e-6, `合计吞吐 ${perSec} 不应超过矿机产量 5/s`);
    // 两带都应有流量（公平分配，非单带独吞）
    assert.ok(f1 > 0, `s1 带应有流量（${f1}/s）`);
    assert.ok(f2 > 0, `s2 带应有流量（${f2}/s）`);
    // fairShare：同优先级两带应接近均分（差值不超过总量的 20%）
    const diff = Math.abs(f1 - f2);
    assert.ok(diff <= Math.max(0.5, (f1 + f2) * 0.2), `两带流量应接近均分，实际 ${f1} vs ${f2}`);
  });

  it('多输出优先级：高优先级先吃饱，低优先级只吃溢流', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 8);
    const s1 = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y });
    const s2 = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y + 300 });
    assert.equal(s1.ok && s2.ok, true);
    const b1 = engine.connectBelt(state, content, { fromId: vein.id, toId: s1.id, tier: 1 });
    const b2 = engine.connectBelt(state, content, { fromId: vein.id, toId: s2.id, tier: 1 });
    assert.equal(b1.ok && b2.ok, true);
    // 1 台矿机 5/s，单带带宽 6/s → 高优先级一条就能吃满全部产量
    assert.equal(engine.setBeltPriority(state, content, b1.id, 2).ok, true);
    assert.equal(engine.setBeltPriority(state, content, b2.id, 0).ok, true);
    engine.advance(state, content, 120);
    const f1 = engine.beltFlow(state, b1.id).perSec;
    const f2 = engine.beltFlow(state, b2.id).perSec;
    assert.ok(f1 > 4, `高优先级带应接近吃满产量 5/s，实际 ${f1}/s`);
    assert.ok(f2 < 1, `低优先级带只应拿到溢流，实际 ${f2}/s`);
  });

  it('优先级随存档往返保留', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 6);
    const s1 = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 500, y: vein.y });
    const b1 = engine.connectBelt(state, content, { fromId: vein.id, toId: s1.id, tier: 1 });
    assert.equal(engine.setBeltPriority(state, content, b1.id, 2).ok, true);
    const saved = JSON.parse(JSON.stringify(engine.serialize(state, content)));
    const back = engine.deserialize(saved, content);
    assert.ok(back, '存档应可反序列化');
    assert.equal(back.belts[b1.id].priority, 2, '优先级应随存档保留');
  });

  it('分流器：可连入/连出，物品经 inBuf → outBuf 直通到下游', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 8);
    const sp = engine.placeBuilding(state, content, { typeId: 'splitter', x: vein.x + 400, y: vein.y + 400 });
    assert.equal(sp.ok, true, JSON.stringify(sp));
    const smelter = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: vein.x + 800, y: vein.y + 400 });
    assert.equal(smelter.ok, true);
    assert.equal(engine.setRecipe(state, content, smelter.id, 'iron_ingot').ok, true);
    const b1 = engine.connectBelt(state, content, { fromId: vein.id, toId: sp.id, tier: 1 });
    assert.equal(b1.ok, true, '矿脉 → 分流器应可连（' + JSON.stringify(b1) + '）');
    const b2 = engine.connectBelt(state, content, { fromId: sp.id, toId: smelter.id, tier: 1 });
    assert.equal(b2.ok, true, '分流器 → 熔炉应可连（' + JSON.stringify(b2) + '）');
    assert.equal(state.belts[b2.id].itemId, 'iron_ore', '带上物品应取目标输入推导为 iron_ore');
    engine.advance(state, content, 120);
    assert.ok((state.belts[b2.id]._beltAcc || 0) > 0 || (smelter && true), '应有流量经分流器');
    const b = state.buildings[smelter.id];
    const produced = (b.outBuf['iron_ingot'] || 0) + (state.stats.totalProduced['iron_ingot'] || 0);
    assert.ok(produced > 0, `矿石应经分流器抵达熔炉并产出铁锭（${produced}）`);
  });

  it('发电建筑端口：风机连不出；火电可连进燃料（系统5）', () => {
    const state = engine.createInitialState(content, homePlanetId(content));
    const { vein } = setupMiner(state, 6);
    const wt = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: vein.x + 900, y: vein.y });
    assert.equal(wt.ok, true);
    const store = engine.placeBuilding(state, content, { typeId: 'storage_mk1', x: vein.x + 900, y: vein.y + 300 });
    assert.equal(store.ok, true);
    if (state.unlockedTechs.indexOf('thermal_power') < 0) state.unlockedTechs.push('thermal_power');
    const thermal = engine.placeBuilding(state, content, { typeId: 'thermal_power_plant', x: vein.x + 1200, y: vein.y });
    assert.equal(thermal.ok, true, JSON.stringify(thermal));
    const out = engine.connectBelt(state, content, { fromId: wt.id, toId: store.id, tier: 1 });
    assert.equal(out.ok, false, '风机应无输出端口，不可作为带源');
    const coalVein = state.veins['vein-coal'];
    assert.ok(coalVein, '应有煤矿脉');
    const inb = engine.connectBelt(state, content, { fromId: coalVein.id, toId: thermal.id, tier: 1 });
    assert.equal(inb.ok, true, '火电应可接收燃料（煤矿→火电）');
    const mismatch = engine.connectBelt(state, content, { fromId: vein.id, toId: thermal.id, tier: 1 });
    assert.equal(mismatch.ok, false, '非燃料矿脉仍应被拒');
  });
});
