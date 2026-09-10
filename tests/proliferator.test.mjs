// proliferator —— 增产剂喷涂系统（系统4）：绑定/模式切换/增产/加速/矩阵限制/存档往返
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();

function mkMachine(typeId, x, y, recipeId) {
  const r = engine.placeBuilding(state, content, { typeId, x, y });
  if (!r.ok) throw new Error('place ' + typeId + ' fail: ' + JSON.stringify(r));
  const b = state.buildings[r.id];
  if (recipeId) {
    const rr = engine.setRecipe(state, content, r.id, recipeId);
    if (!rr.ok) throw new Error('recipe ' + recipeId + ' fail: ' + JSON.stringify(rr));
  }
  return b;
}

let state;
function fresh() {
  state = engine.createInitialState(content, homePlanetId(content));
  state.unlockedTechs.push('proliferator_1', 'proliferator_2', 'proliferator_3');
  // 测试用途：注入建造材料
  const grant = { iron_ingot: 400, steel: 200, circuit_board: 200, plasma_exciter: 200, gear: 100, magnetic_coil: 100 };
  for (let i = 0; i < 4; i++) engine.placeBuilding(state, content, { typeId: "wind_turbine", x: -400 + 80 * i, y: -700 });
  for (const k in grant) state.stock[k] = (state.stock[k] || 0) + grant[k];
  return state;
}

describe('增产剂喷涂（系统4）', () => {
  it('绑定：空闲喷涂机绑定成功；无空闲时拒绝；非机器目标拒绝', () => {
    fresh();
    const coater = mkMachine('spray_coater', -200, -400);
    const smelter = mkMachine('arc_smelter', 0, -400, 'iron_ingot');
    const r1 = engine.bindSprayCoater(state, content, smelter.id);
    assert.ok(r1.ok, JSON.stringify(r1));
    assert.equal(r1.coaterId, coater.id);
    assert.equal(coater.boundMachineId, smelter.id);
    assert.equal(smelter.sprayMode, 'extra');

    const smelter2 = mkMachine('arc_smelter', 200, -400, 'iron_ingot');
    const r2 = engine.bindSprayCoater(state, content, smelter2.id);
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'noFreeCoater');

    const wind = mkMachine('wind_turbine', 400, -700);
    const r3 = engine.bindSprayCoater(state, content, wind.id);
    assert.equal(r3.ok, false); // 发电建筑不可喷涂
  });

  it('增产模式：每周期按 12.5% 额外产出并消耗 1 件 Mk.I', () => {
    fresh();
    mkMachine('spray_coater', -200, -400);
    const smelter = mkMachine('arc_smelter', 0, -400, 'iron_ingot');
    assert.ok(engine.bindSprayCoater(state, content, smelter.id).ok);
    // 投料：10 矿 + 5 件 Mk.I
    smelter.inBuf = { iron_ore: 10, proliferator_mk1: 5 };
    const before = state.stats.totalProduced.iron_ingot || 0;
    engine.advance(state, content, 10); // speed=1, duration=1 → ≈10 周期
    const made = (state.stats.totalProduced.iron_ingot || 0) - before;
    assert.ok(made >= 10, 'made=' + made);
    assert.ok(made <= 12, 'made=' + made); // 10 周期 + 12.5% 加成 ≈ 11
    assert.ok((state.stats.totalConsumed.proliferator_mk1 || 0) >= 4, 'mk1 consumed=' + state.stats.totalConsumed.proliferator_mk1);
  });

  it('加速模式：进度更快，耗电 ×powerMultiplier', () => {
    fresh();
    mkMachine('spray_coater', -200, -400);
    const smelter = mkMachine('arc_smelter', 0, -400, 'iron_ingot');
    assert.ok(engine.bindSprayCoater(state, content, smelter.id).ok);
    assert.ok(engine.setSprayMode(state, content, smelter.id, 'speed').ok);
    smelter.inBuf = { iron_ore: 40, proliferator_mk1: 30 };
    const pBefore = state.stats.totalProduced.iron_ingot || 0;
    engine.advance(state, content, 10); // +25% 速度 → ≈12 周期
    const made = (state.stats.totalProduced.iron_ingot || 0) - pBefore;
    assert.ok(made > 10, 'made=' + made); // 严格快于普通速度
    const p1 = engine.powerStats(state, content);
    // 熔炉 360kW ×1.3 + 喷涂机 90 = 558（加速生效时供料在库）
    assert.ok(p1.demandKw >= 557, 'demand=' + p1.demandKw);
    // 断供后耗电回落到基础值
    smelter.inBuf = {};
    const p2 = engine.powerStats(state, content);
    assert.ok(p2.demandKw < p1.demandKw, p1.demandKw + ' -> ' + p2.demandKw);
  });

  it('矩阵产物配方禁止增产模式（matrixSpeedOnly）', () => {
    fresh();
    mkMachine('spray_coater', -200, -400);
    const lab = mkMachine('matrix_lab', 0, -400, 'electromagnetic_matrix');
    assert.ok(engine.bindSprayCoater(state, content, lab.id).ok);
    const r = engine.setSprayMode(state, content, lab.id, 'extra');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'matrixSpeedOnly');
    assert.ok(engine.setSprayMode(state, content, lab.id, 'speed').ok);
  });

  it('解绑与拆除联动；存档往返保留 spray/grid', () => {
    fresh();
    const coater = mkMachine('spray_coater', -200, -400);
    const smelter = mkMachine('arc_smelter', 0, -400, 'iron_ingot');
    assert.ok(engine.bindSprayCoater(state, content, smelter.id).ok);
    smelter.grid = 'b';
    // 解绑后喷涂机恢复空闲、机器关闭喷涂
    assert.ok(engine.unbindSprayCoater(state, content, smelter.id).ok);
    assert.equal(smelter.sprayMode, null);
    assert.equal(coater.boundMachineId, null);
    // 重新绑定 → 拆机器 → 喷涂机恢复空闲
    assert.ok(engine.bindSprayCoater(state, content, smelter.id).ok);
    engine.removeBuilding(state, content, smelter.id);
    assert.equal(coater.boundMachineId, null);

    // 存档往返（bind 返回实际绑定的喷涂机 id）
    const smelter2 = mkMachine('arc_smelter', 0, -300, 'iron_ingot');
    const br = engine.bindSprayCoater(state, content, smelter2.id);
    assert.ok(br.ok, JSON.stringify(br));
    const coater2 = state.buildings[br.coaterId];
    assert.ok(engine.setSprayMode(state, content, smelter2.id, 'speed').ok);
    smelter2.grid = 'c';
    const saved = JSON.parse(JSON.stringify(engine.serialize(state)));
    const st2 = engine.deserialize(saved, content);
    assert.ok(st2, 'deserialize null');
    const c2 = st2.buildings[br.coaterId];
    const s2 = st2.buildings[smelter2.id];
    assert.equal(c2.boundMachineId, smelter2.id);
    assert.equal(s2.sprayMode, 'speed');
    assert.equal(s2.grid, 'c');
  });
});
