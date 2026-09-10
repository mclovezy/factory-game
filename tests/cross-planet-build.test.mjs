// cross-planet-build —— 跨行星建造：全局建筑卡池 + 解锁星际物流后的材料调拨
//
// 设计（2026-09-10 与用户确认，对齐参考项目 DSPONLINE 的 state.construction）：
//   ① 建筑卡是全局的：母星拆下的建筑，任何行星都能免材料放置。
//   ② 解锁星际物流后，建造可动用其他行星库存（帝国调度网），
//      否则「到了新星球没有建材 → 物流站建不起来 → 物流系统形同虚设」会重新死锁。
//   ③ 未解锁星际物流时不得跨行星取料，保持行星独立经济。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadContentAndEngine, homePlanetId } from './helpers.mjs';

const { content, engine } = loadContentAndEngine();
const HOME = homePlanetId(content);

/** II 星（焰砾 II）：与母星互补的工业殖民地 */
const NEW = 'yanli';

/** 原地替换库存内容（保持与 state.stock 的引用不变，那是引擎的约定） */
function replaceStock(stockObj, obj) {
  for (const k of Object.keys(stockObj)) delete stockObj[k];
  for (const k in obj) stockObj[k] = obj[k];
}

/** 母星建局 → 解锁星际物流 → 跳到 NEW（首次抵达发殖民补给） */
function arrivedAtNewPlanet() {
  const st = engine.createInitialState(content, HOME);
  st.unlockedTechs = Array.from(new Set([...(st.unlockedTechs || []), 'interstellar_logistics']));
  st.galaxyUnlocked = Object.keys(content.STAR_SYSTEMS);
  const r = engine.travelTo(st, content, NEW);
  assert.ok(r && r.ok !== false, `travelTo(${NEW}) 失败`);
  return st;
}

describe('建筑卡全局池：母星拆的，其他行星能用', () => {
  it('母星拆下的建筑卡，在 II 星 0 材料也能免材料建造', () => {
    const st = engine.createInitialState(content, HOME);
    // 母星造一台风机再拆掉 → 卡入全局池
    const b = engine.placeBuilding(st, content, { typeId: 'wind_turbine', x: 0, y: 0 });
    assert.equal(b.ok, true);
    assert.equal(engine.removeBuilding(st, content, b.id).ok, true);
    assert.equal(st.construction.wind_turbine, 1, '拆除应进入全局建筑卡池');

    // 抵达 II 星，清空本地库存，仅靠卡建造
    engine.travelTo(st, content, NEW);
    replaceStock(st.stock, {});
    const r = engine.placeBuilding(st, content, { typeId: 'wind_turbine', x: 0, y: 0 });
    assert.equal(r.ok, true, '全局建筑卡应可跨行星免材料放置');
    assert.equal(st.construction.wind_turbine, 0, '卡应被消耗');
  });

  it('建筑卡不会被行星切换冲掉（属于顶层全局字段）', () => {
    const st = engine.createInitialState(content, HOME);
    st.construction.arc_smelter = 3;
    st.unlockedTechs = Array.from(new Set([...(st.unlockedTechs || []), 'interstellar_logistics']));
    st.galaxyUnlocked = Object.keys(content.STAR_SYSTEMS);
    engine.travelTo(st, content, NEW);
    assert.equal(st.construction.arc_smelter, 3, '跨行星后建筑卡池应原样保留');
  });
});

describe('解锁星际物流后，新行星可动用帝国库存建站', () => {
  it('II 星本地 0 物资，仍能建起星际物流站（材料从母星调拨）', () => {
    const st = arrivedAtNewPlanet();
    // 母星备好建站三件套；II 星本地清空
    replaceStock(st.planets[HOME].stock, { steel: 30, titanium_alloy: 40, processor: 20 });
    replaceStock(st.stock, {});

    const r = engine.placeBuilding(st, content, { typeId: 'interstellar_station', x: 500, y: 500 });
    assert.equal(r.ok, true, '解锁星际物流后，新行星应能靠调拨建起物流站');
    assert.equal(st.planets[HOME].stock.steel, 0, '母星钢应被调拨走');
    assert.equal(st.planets[HOME].stock.titanium_alloy, 0);
    assert.equal(st.planets[HOME].stock.processor, 0);
  });

  it('材料只够本行星时：优先扣本行星，不足部分再调拨', () => {
    const st = arrivedAtNewPlanet();
    replaceStock(st.planets[HOME].stock, { steel: 30, titanium_alloy: 40, processor: 20 });
    replaceStock(st.stock, { steel: 10 });

    const r = engine.placeBuilding(st, content, { typeId: 'interstellar_station', x: 500, y: 500 });
    assert.equal(r.ok, true);
    assert.equal(st.stock.steel || 0, 0, '本行星钢优先被扣光');
    assert.equal(st.planets[HOME].stock.steel, 10, '剩余 20 钢从母星补足（30-20）');
  });

  it('未解锁星际物流时不得跨行星取料：新行星材料不足即拒绝', () => {
    const st = engine.createInitialState(content, HOME);
    st.galaxyUnlocked = Object.keys(content.STAR_SYSTEMS);
    engine.travelTo(st, content, NEW);
    // 母星给足材料，但没解锁星际物流
    replaceStock(st.planets[HOME].stock, { iron_ingot: 100, gear: 100, magnetic_coil: 100 });
    replaceStock(st.stock, {});
    // 用无科技门槛的风机验证（星际物流站本身有科技门槛，会先被 techLocked 拦下）
    const r = engine.placeBuilding(st, content, { typeId: 'wind_turbine', x: 0, y: 0 });
    assert.equal(r.ok, false, '没解锁星际物流时，不应能调用母星材料');
    assert.equal(r.reason, 'insufficientMaterials');
  });

  it('buildingAffordable 与建造结果一致（UI 判定不撒谎）', () => {
    const st = arrivedAtNewPlanet();
    replaceStock(st.planets[HOME].stock, { steel: 30, titanium_alloy: 40, processor: 20 });
    replaceStock(st.stock, {});
    assert.equal(engine.buildingAffordable(st, content, 'interstellar_station'), true);
    st.planets[HOME].stock.steel = 0;
    assert.equal(engine.buildingAffordable(st, content, 'interstellar_station'), false);
  });

  it('物流闭环：新行星靠调拨建站后，能把本地货发回母星', () => {
    const st = arrivedAtNewPlanet();
    // 母星材料调拨给 II 星建站
    replaceStock(st.planets[HOME].stock, { steel: 30, titanium_alloy: 40, processor: 20 });
    replaceStock(st.stock, { titanium_ingot: 50 });
    const built = engine.placeBuilding(st, content, { typeId: 'interstellar_station', x: 500, y: 500 });
    assert.equal(built.ok, true, 'II 星应能靠调拨建站');
    // 配航线：II 星 → 母星 发钛块
    const route = engine.setStationRoute(st, content, built.id, { itemId: 'titanium_ingot', toPid: HOME, amount: 10 });
    assert.equal(route.ok, true, `配航线失败: ${JSON.stringify(route)}`);

    engine.advance(st, content, 45);
    assert.ok((st.planets[HOME].stock.titanium_ingot || 0) >= 10, '母星应收到 II 星发来的钛块');
  });
});
