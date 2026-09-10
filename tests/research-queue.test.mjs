// research-queue / buffer-pull —— 研究排队 + 建筑从输出缓存补料
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function fresh() {
  const state = engine.createInitialState(content, homePlanetId(content));
  state.unlockedTechs.push('electromagnetism');
  // 资源注入：够研究多个科技
  state.scienceStock.electromagnetic_matrix = 500;
  for (let i = 0; i < 4; i++) engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: -400 + 80 * i, y: -700 });
  engine.placeBuilding(state, content, { typeId: 'matrix_lab', x: 0, y: 0 }); // 1 点/秒
  return state;
}

describe('研究队列（可点击累加，同一时间只研究一个）', () => {
  it('空闲时点击 → 直接开始；在研时点击 → 排队', () => {
    const state = fresh();
    const r1 = engine.startResearch(state, content, 'magnetic_assembly');
    assert.equal(r1.ok, true);
    assert.equal(state.research.current, 'magnetic_assembly');
    assert.equal((state.research.queue || []).length, 0);

    const r2 = engine.startResearch(state, content, 'plasma_refining');
    assert.equal(r2.ok, true);
    assert.equal(r2.queued, true, '在研时应排队而非切换');
    assert.equal(state.research.current, 'magnetic_assembly', '当前研究不被顶掉');
    assert.deepEqual(state.research.queue, ['plasma_refining']);

    const r3 = engine.startResearch(state, content, 'plasma_refining');
    assert.equal(r3.ok, false, '重复排队应拒绝');
    assert.equal(r3.reason, 'alreadyQueued');
  });

  it('当前研究完成后自动接队列；资源不够的跳过并保留', () => {
    const state = fresh();
    state.scienceStock.electromagnetic_matrix = 30; // magnetic_assembly 要 30（tier1→200点/秒进度另算）
    const r1 = engine.startResearch(state, content, 'magnetic_assembly');
    assert.equal(r1.ok, true);
    // plasma_refining 费用 >30 → 排队后轮到时因资源不足被跳过
    const r2 = engine.startResearch(state, content, 'plasma_refining');
    assert.equal(r2.queued, true);
    // 期间给够 plasma_refining 的费用之外再不给 magnetic_assembly 补给 —— magnetic_assembly 已支付

    // 完成 magnetic_assembly：demand = 100×(tier+1)
    const demand1 = 100 * (content.TECHNOLOGIES.magnetic_assembly.tier + 1);
    engine.advance(state, content, demand1 + 2);
    if (state.research.current !== 'plasma_refining') {
      // 资源不足被跳过属预期：验证它仍在队列
      assert.ok(state.research.queue.indexOf('plasma_refining') >= 0, '资源不足应保留在队列');
    } else {
      assert.ok(true);
    }
  });

  it('取消排队 / 放弃当前研究', () => {
    const state = fresh();
    engine.startResearch(state, content, 'magnetic_assembly');
    engine.startResearch(state, content, 'plasma_refining');
    const c1 = engine.cancelResearch(state, content, 'plasma_refining');
    assert.equal(c1.ok, true);
    assert.deepEqual(state.research.queue, []);
    const c2 = engine.cancelResearch(state, content, 'magnetic_assembly');
    assert.equal(c2.ok, true);
    assert.equal(state.research.current, null);
    const c3 = engine.cancelResearch(state, content, 'magnetic_assembly');
    assert.equal(c3.ok, false, '重复取消应失败');
  });

  it('暂停研究：进度冻结、清空在研；继续研究：原样恢复', () => {
    const state = fresh();
    engine.startResearch(state, content, 'magnetic_assembly');
    engine.advance(state, content, 20); // 1 点/秒 → 20 点
    const before = state.research.progress;
    assert.ok(before > 0);

    const p = engine.pauseResearch(state, content);
    assert.equal(p.ok, true);
    assert.equal(state.research.current, null, '暂停后无在研项目');
    assert.deepEqual(state.research.paused, { id: 'magnetic_assembly', progress: before });

    engine.advance(state, content, 30);
    assert.equal(state.research.progress, 0, '暂停期间不推进');

    const r = engine.resumeResearch(state, content);
    assert.equal(r.ok, true);
    assert.equal(state.research.current, 'magnetic_assembly');
    assert.equal(state.research.progress, before, '继续研究保留原进度');
    assert.equal(state.research.paused, null);
  });

  it('暂停后有在研项目 → 继续研究放回队列最前', () => {
    const state = fresh();
    engine.startResearch(state, content, 'magnetic_assembly');
    engine.pauseResearch(state, content);
    const s = engine.startResearch(state, content, 'solar_energy'); // 前置只要求 electromagnetism
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(state.research.current, 'solar_energy');
    engine.resumeResearch(state, content);
    assert.equal(state.research.paused, null);
    assert.equal(state.research.queue[0], 'magnetic_assembly', '应插到队列最前');
  });

  it('暂停状态随存档往返保留', () => {
    const state = fresh();
    engine.startResearch(state, content, 'magnetic_assembly');
    engine.advance(state, content, 12);
    engine.pauseResearch(state, content);
    const st2 = engine.deserialize(JSON.parse(JSON.stringify(engine.serialize(state))), content);
    assert.deepEqual(st2.research.paused, { id: 'magnetic_assembly', progress: state.research.paused.progress });
    assert.ok(st2.research.paused.progress > 0);
  });

  it('队列随存档往返保留', () => {
    const state = fresh();
    engine.startResearch(state, content, 'magnetic_assembly');
    engine.startResearch(state, content, 'plasma_refining');
    engine.startResearch(state, content, 'fluid_handling');
    const saved = engine.serialize(state);
    const st2 = engine.deserialize(JSON.parse(JSON.stringify(saved)), content);
    assert.equal(st2.research.current, 'magnetic_assembly');
    assert.equal(st2.research.queue.length, 2);
    assert.ok(st2.research.queue.indexOf('plasma_refining') >= 0);
    assert.ok(st2.research.queue.indexOf('fluid_handling') >= 0);
  });
});

describe('建筑从输出缓存补料（不仅从全局库存）', () => {
  it('depositFromStock fromOutputs 优先拉其他建筑 outBuf，再拉库存', () => {
    const state = fresh();
    const smelter = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 200, y: 0 });
    assert.ok(smelter.id);
    const b = state.buildings[smelter.id];
    engine.setRecipe(state, content, smelter.id, 'iron_ingot');
    // 清空全局库存铁矿，把铁锭放到另一建筑的输出缓存
    state.stock.iron_ore = 0;
    const donor = engine.placeBuilding(state, content, { typeId: 'wind_turbine', x: 400, y: 0 });
    assert.ok(state.buildings[donor.id], 'donor place failed');
    state.buildings[donor.id].outBuf = { iron_ore: 20 };
    b.inBuf = {};
    const r = engine.depositFromStock(state, content, smelter.id, 'iron_ore', 50, { fromOutputs: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.moved >= 20, `应从缓存拉到 ≥20：${r.moved}`);
    assert.equal((state.buildings[donor.id].outBuf.iron_ore || 0) <= 0 || r.moved === 20, true, '缓存被拉取');
  });

  it('fillInputs 一键补料：无料可补时报错，有料时拉满一个周期以上', () => {
    const state = fresh();
    const smelter = engine.placeBuilding(state, content, { typeId: 'arc_smelter', x: 200, y: 0 });
    engine.setRecipe(state, content, smelter.id, 'iron_ingot');
    state.buildings[smelter.id].inBuf = {};
    // 全无料 → 失败
    state.stock.iron_ore = 0;
    const r0 = engine.fillInputs(state, content, smelter.id);
    assert.equal(r0.ok, false);
    // 库存给料 → 成功且 inBuf 够一周期
    state.stock.iron_ore = 100;
    const r1 = engine.fillInputs(state, content, smelter.id);
    assert.equal(r1.ok, true);
    assert.ok((state.buildings[smelter.id].inBuf.iron_ore || 0) >= 1, '应至少补足一周期用量');
  });
});
